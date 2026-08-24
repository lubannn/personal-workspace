import { parseRecord, type WorkspaceRecord } from "./protocol";

export type WorkspaceDescriptor = {
  schema_version: 1;
  workspace_id: string;
  owner_id: string;
  owner_login: string;
  locale: string;
  timezone: string;
};

export type CaptureData = {
  raw_text: string;
  status: "inbox" | "archived";
};

export type CaptureRecord = WorkspaceRecord<CaptureData>;

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
}

export function parseWorkspaceDescriptor(value: string): WorkspaceDescriptor {
  const parsed = JSON.parse(value) as Partial<WorkspaceDescriptor>;
  if (
    parsed.schema_version !== 1
    || !isStableId(parsed.workspace_id)
    || !isStableId(parsed.owner_id)
    || typeof parsed.owner_login !== "string"
    || !parsed.owner_login
    || typeof parsed.locale !== "string"
    || typeof parsed.timezone !== "string"
  ) throw new Error("INVALID_WORKSPACE_DESCRIPTOR");
  return parsed as WorkspaceDescriptor;
}

export function parseCaptureRecord(value: string): CaptureRecord {
  const record = parseRecord(value);
  if (
    record.entity_type !== "capture"
    || typeof record.data.raw_text !== "string"
    || (record.data.status !== "inbox" && record.data.status !== "archived")
  ) throw new Error("INVALID_CAPTURE_RECORD");
  return record as CaptureRecord;
}

export function newestCaptures(records: CaptureRecord[], limit = 6) {
  return [...records]
    .filter((record) => record.deleted_at === null)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, Math.max(0, limit));
}
