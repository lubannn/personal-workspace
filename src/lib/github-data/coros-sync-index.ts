import { parseRecord, recordPath, type WorkspaceRecord } from "./protocol";
import type { SleepSessionRecord } from "./sleep-sessions";
import type { WorkoutRecord } from "./workouts";

/** Derived private metadata. Portable backups omit this cache and rebuild it from canonical records. */
export type CorosSyncIndexEntry = {
  id: string;
  owner_id: string;
  kind: "sleep" | "workout";
  path: string;
  blob_sha: string;
  source: { source_id: string; source_sha256: string } | null;
  start_at: string;
  end_at: string;
  session_type: "main_sleep" | "nap" | "unknown" | null;
  deleted_at: string | null;
  latest_date: string;
};
export type CorosSyncIndexData = { index_version: 1; records: CorosSyncIndexEntry[] };
export type CorosSyncIndexRecord = WorkspaceRecord<CorosSyncIndexData>;
export const COROS_SYNC_INDEX_ID = "index";
export const COROS_SYNC_INDEX_PATH = recordPath("coros_sync_index", COROS_SYNC_INDEX_ID);

function localDate(instant: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  const get = (name: string) => parts.find((part) => part.type === name)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function corosSyncIndexEntry(record: SleepSessionRecord | WorkoutRecord, blobSha: string): CorosSyncIndexEntry {
  const sleep = record.entity_type === "sleep_session" ? record as SleepSessionRecord : null;
  const source = "source" in record.data ? record.data.source : null;
  return {
    id: record.id, owner_id: record.owner_id, kind: sleep ? "sleep" : "workout",
    path: recordPath(record.entity_type, record.id), blob_sha: blobSha,
    source: source ? { source_id: source.source_id, source_sha256: source.source_sha256 } : null,
    start_at: record.data.start_at, end_at: record.data.end_at,
    session_type: sleep ? sleep.data.session_type : null, deleted_at: record.deleted_at,
    latest_date: sleep ? sleep.data.sleep_session_version === 2 ? sleep.data.sleep_metrics_json.wake_date : sleep.data.local_date
      : localDate(record.data.start_at, record.data.timezone),
  };
}

export async function corosCanonicalBlobSha(text: string): Promise<string> {
  const body = new TextEncoder().encode(text);
  const header = new TextEncoder().encode(`blob ${body.byteLength}\0`);
  const bytes = new Uint8Array(header.byteLength + body.byteLength);
  bytes.set(header);
  bytes.set(body, header.byteLength);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parseCorosSyncIndexRecord(text: string): CorosSyncIndexRecord {
  const record = parseRecord(text);
  const data = record.data as CorosSyncIndexData;
  const id = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(value);
  const instant = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
  if (record.entity_type !== "coros_sync_index" || record.id !== COROS_SYNC_INDEX_ID || !id(record.owner_id)
    || !Number.isInteger(record.version) || record.version < 1 || record.deleted_at !== null
    || !instant(record.created_at) || !instant(record.updated_at)
    || Object.keys(data).sort().join(",") !== "index_version,records" || data.index_version !== 1 || !Array.isArray(data.records)) throw new Error("INVALID_COROS_SYNC_INDEX");
  const paths = new Set<string>();
  for (const entry of data.records) {
    if (!entry || Object.keys(entry).sort().join(",") !== "blob_sha,deleted_at,end_at,id,kind,latest_date,owner_id,path,session_type,source,start_at"
      || !id(entry.id) || entry.owner_id !== record.owner_id || !["sleep", "workout"].includes(entry.kind)
      || entry.path !== recordPath(entry.kind === "sleep" ? "sleep_session" : "workout", entry.id)
      || paths.has(entry.path) || !/^[a-f0-9]{40}$/u.test(entry.blob_sha)
      || !instant(entry.start_at) || !instant(entry.end_at) || Date.parse(entry.end_at) <= Date.parse(entry.start_at)
      || !(entry.deleted_at === null || instant(entry.deleted_at))
      || (entry.kind === "sleep" ? !["main_sleep", "nap", "unknown"].includes(String(entry.session_type)) : entry.session_type !== null)
      || typeof entry.latest_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(entry.latest_date)
      || !instant(`${entry.latest_date}T00:00:00Z`) || new Date(`${entry.latest_date}T00:00:00Z`).toISOString().slice(0, 10) !== entry.latest_date) throw new Error("INVALID_COROS_SYNC_INDEX");
    if (entry.source !== null && (!entry.source || Object.keys(entry.source).sort().join(",") !== "source_id,source_sha256"
      || typeof entry.source.source_id !== "string" || entry.source.source_id.length === 0 || entry.source.source_id.length > 256
      || /[\u0000-\u001f\u007f]/u.test(entry.source.source_id) || !/^[a-f0-9]{64}$/u.test(entry.source.source_sha256))) throw new Error("INVALID_COROS_SYNC_INDEX");
    paths.add(entry.path);
  }
  return record as CorosSyncIndexRecord;
}
