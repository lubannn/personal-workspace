import { GitHubContentsAdapter, GitHubDataError } from "./github-contents";
import { createWorkspaceRecord, recordPath, serializeRecord, setWorkspaceRecordDeleted, updateWorkspaceRecord } from "./protocol";
import { createNoticeData, parseNoticeRecord, type NoticeRecord } from "./notices";

export type SyncedNotice = { record: NoticeRecord; path: string; blobSha: string };

export async function readNotices(adapter: GitHubContentsAdapter, ownerId: string): Promise<SyncedNotice[]> {
  let items;
  try { items = await adapter.listDirectory("data/notices"); }
  catch (error) {
    if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return [];
    throw error;
  }
  const candidates = items.filter(item => item.type === "file" && item.name.endsWith(".json"));
  const files: SyncedNotice[] = [];
  for (let i = 0; i < candidates.length; i += 6) {
    files.push(...await Promise.all(candidates.slice(i, i + 6).map(async item => {
      const file = await adapter.readText(item.path);
      const record = parseNoticeRecord(file.text);
      if (record.owner_id !== ownerId || recordPath("notice", record.id) !== item.path || file.blobSha !== item.blobSha) throw new Error("NOTICE_SNAPSHOT_CHANGED");
      return { record, path: file.path, blobSha: file.blobSha };
    })));
  }
  return files;
}

export type NoticeMutation =
  | { kind: "save"; body: string; current?: SyncedNotice; id?: string; timestamp?: string }
  | { kind: "delete" | "restore"; current: SyncedNotice; timestamp?: string };

export async function writeNotice(adapter: GitHubContentsAdapter, ownerId: string, input: NoticeMutation): Promise<SyncedNotice> {
  const current = input.current;
  if (current && (current.record.owner_id !== ownerId || current.path !== recordPath("notice", current.record.id))) throw new Error("INVALID_NOTICE");
  const timestamp = input.timestamp ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(timestamp))) throw new Error("INVALID_NOTICE");
  const record = input.kind === "save"
    ? current
      ? updateWorkspaceRecord(current.record, { ...current.record.data, ...createNoticeData(input.body) }, timestamp)
      : createWorkspaceRecord({ entityType: "notice", id: input.id ?? `notice_${crypto.randomUUID()}`, ownerId, data: createNoticeData(input.body), timestamp })
    : setWorkspaceRecordDeleted(current!.record, input.kind === "delete" ? timestamp : null, timestamp);
  if (input.kind === "save" && current && current.record.deleted_at !== null) throw new Error("INVALID_NOTICE");
  const path = recordPath("notice", record.id);
  const text = serializeRecord(record);
  try {
    const result = await adapter.writeText({ path, text, message: `workspace: ${input.kind} notice`, expectedBlobSha: current?.blobSha });
    return { record, path, blobSha: result.blobSha };
  } catch (error) {
    // A response can be lost after GitHub commits. A retry uses the same ID and
    // timestamp; acknowledge only an exact match, never overwrite newer text.
    try {
      const remote = await adapter.readText(path);
      if (remote.text === text) return { record, path, blobSha: remote.blobSha };
    } catch { /* Preserve the original write failure. */ }
    throw error;
  }
}
