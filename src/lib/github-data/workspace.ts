import { parseRecord, type WorkspaceRecord } from "./protocol";
import { CAPTURE_KINDS, isCaptureDate, isCaptureTime, isCaptureTimezone, type CaptureKind } from "./capture-details";

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
  kind?: CaptureKind;
  noted_date?: string | null;
  noted_time?: string | null;
  timezone?: string;
  routed_to?: { path: string; tab: "tasks" | "calendar" | "journal"; label: string; end_time?: string | null };
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
    || (record.data.kind !== undefined && !CAPTURE_KINDS.includes(record.data.kind as CaptureKind))
    || (record.data.noted_date !== undefined && record.data.noted_date !== null && !isCaptureDate(record.data.noted_date))
    || (record.data.noted_time !== undefined && record.data.noted_time !== null && !isCaptureTime(record.data.noted_time))
    || (record.data.noted_time != null && record.data.noted_date == null)
    || (record.data.timezone !== undefined && !isCaptureTimezone(record.data.timezone))
    || (record.data.routed_to !== undefined && !isCaptureRoute(record.data.routed_to))
  ) throw new Error("INVALID_CAPTURE_RECORD");
  return record as CaptureRecord;
}

function isCaptureRoute(value: unknown): value is NonNullable<CaptureData["routed_to"]> {
  if (!value || typeof value !== "object") return false;
  const link = value as Record<string, unknown>;
  const folder = ({ tasks: "tasks", calendar: "calendar-events", journal: "journal-entries" } as Record<string, string>)[String(link.tab)];
  return Boolean(folder) && typeof link.path === "string" && new RegExp(`^data/${folder}/[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\\.json$`).test(link.path)
    && typeof link.label === "string" && link.label.length > 0 && link.label.length <= 50
    && (link.end_time == null || isCaptureTime(link.end_time));
}

export function newestCaptures(records: CaptureRecord[], limit = 6) {
  return [...records]
    .filter((record) => record.deleted_at === null)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, Math.max(0, limit));
}

export function newestTrashedCaptures(records: CaptureRecord[], limit = 20) {
  return [...records]
    .filter((record) => record.deleted_at !== null)
    .sort((left, right) => String(right.deleted_at).localeCompare(String(left.deleted_at)))
    .slice(0, Math.max(0, limit));
}
