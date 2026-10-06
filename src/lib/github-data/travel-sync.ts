import { GitHubContentsAdapter, GitHubDataError } from "./github-contents";
import { createWorkspaceRecord, recordPath, serializeRecord, setWorkspaceRecordDeleted, updateWorkspaceRecord } from "./protocol";
import { createTravelVisitData, parseTravelVisitRecord, type TravelVisitFields, type TravelVisitRecord } from "./travel-visits";

export type SyncedTravelVisit = { record: TravelVisitRecord; path: string; blobSha: string };

export async function readTravelVisits(adapter: GitHubContentsAdapter, ownerId: string) {
  let items;
  try { items = await adapter.listDirectory("data/travel-visits"); }
  catch (error) {
    if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return [];
    throw error;
  }
  const files: SyncedTravelVisit[] = [];
  const candidates = items.filter(item => item.type === "file" && item.name.endsWith(".json"));
  // Bounded concurrent reads; invalid files fail the snapshot rather than silently
  // changing the visited count or allowing edits against incomplete data.
  for (let i = 0; i < candidates.length; i += 6) {
    files.push(...await Promise.all(candidates.slice(i, i + 6).map(async item => {
      const file = await adapter.readText(item.path);
      const record = parseTravelVisitRecord(file.text);
      if (record.owner_id !== ownerId || recordPath("travel_visit", record.id) !== item.path || file.blobSha !== item.blobSha) throw new Error("TRAVEL_SNAPSHOT_CHANGED");
      return { record, path: file.path, blobSha: file.blobSha };
    })));
  }
  return files;
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
