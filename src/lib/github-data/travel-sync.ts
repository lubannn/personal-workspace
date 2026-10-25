import { GitHubContentsAdapter, GitHubDataError, type BlobReadOptions, type GitHubStoredFile } from "./github-contents";
import { createWorkspaceRecord, recordPath, serializeRecord, setWorkspaceRecordDeleted, updateWorkspaceRecord } from "./protocol";
import { createTravelVisitData, parseTravelVisitRecord, type TravelVisitFields, type TravelVisitRecord } from "./travel-visits";

export type SyncedTravelVisit = { record: TravelVisitRecord; path: string; blobSha: string };

export async function readTravelVisits(adapter: GitHubContentsAdapter, ownerId: string, options: { isCurrent?: () => boolean; signal?: AbortSignal } = {}) {
  const assertCurrent = () => { options.signal?.throwIfAborted(); if (options.isCurrent && !options.isCurrent()) throw new Error("TRAVEL_LOAD_CANCELLED"); };
  assertCurrent();
  let items;
  try { items = await adapter.listDirectory("data/travel-visits"); }
  catch (error) {
    assertCurrent();
    if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return [];
    throw error;
  }
  assertCurrent();
  const candidates = items.filter(item => item.type === "file" && item.name.endsWith(".json"));
  // Always authenticate and re-list first. Reuse the adapter's bounded, SHA-pinned
  // batch reader and session-only body cache. Keep travel's original six-read
  // REST ceiling, without changing the other collections' shared four slots.
  // Validate the entire snapshot before publishing any records or enabling edits.
  const readRestFiles: NonNullable<BlobReadOptions["readRestFiles"]> = async (missing, assertActive, signal) => {
    const records = new Array<GitHubStoredFile>(missing.length);
    let next = 0, failed = false;
    const worker = async () => {
      while (next < missing.length) {
        assertActive();
        if (failed) return;
        const index = next++, file = missing[index];
        try {
          records[index] = await adapter.readBlobText(file.path, file.blobSha, signal);
          assertActive();
        } catch (error) { failed = true; throw error; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, missing.length) }, worker));
    return records;
  };
  const files = await adapter.readBlobTexts(candidates, options.isCurrent, options.signal, { readRestFiles });
  assertCurrent();
  return files.map((file, index) => {
    const item = candidates[index];
    const record = parseTravelVisitRecord(file.text);
    if (record.owner_id !== ownerId || recordPath("travel_visit", record.id) !== item.path || file.path !== item.path || file.blobSha !== item.blobSha) throw new Error("TRAVEL_SNAPSHOT_CHANGED");
    return { record, path: file.path, blobSha: file.blobSha };
  });
}

export async function writeTravelVisit(adapter: GitHubContentsAdapter, ownerId: string, input:
  | { kind: "save"; fields: TravelVisitFields; current?: SyncedTravelVisit; id?: string }
  | { kind: "delete" | "restore"; current: SyncedTravelVisit },
): Promise<SyncedTravelVisit> {
  const current = input.current;
  if (current && (current.record.owner_id !== ownerId || current.path !== recordPath("travel_visit", current.record.id))) throw new Error("INVALID_TRAVEL_VISIT");
  const record = input.kind === "save"
    ? current
      ? updateWorkspaceRecord(current.record, { ...current.record.data, ...createTravelVisitData(input.fields) })
      : createWorkspaceRecord({ entityType: "travel_visit", id: input.id ?? `travel_${crypto.randomUUID()}`, ownerId, data: createTravelVisitData(input.fields) })
    : setWorkspaceRecordDeleted(current!.record, input.kind === "delete" ? new Date().toISOString() : null);
  if (input.kind === "save" && current && current.record.deleted_at !== null) throw new Error("INVALID_TRAVEL_VISIT");
  const path = recordPath("travel_visit", record.id);
  const result = await adapter.writeText({ path, text: serializeRecord(record), message: `workspace: ${input.kind} travel visit`, expectedBlobSha: current?.blobSha });
  return { record, path, blobSha: result.blobSha };
}
