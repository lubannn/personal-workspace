import { parseRecord, type WorkspaceRecord } from "./protocol";

export type TimeEntryData = {
  task_id: string;
  project_id: string | null;
  local_date: string;
  timezone: string;
  started_at: null;
  ended_at: null;
  duration_minutes: number;
  entry_method: "manual_duration";
  notes_markdown: string;
  source_ref: null;
};

export type TimeEntryRecord = WorkspaceRecord<TimeEntryData>;

const STABLE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

export function createTimeEntryData(input: {
  taskId: string;
  projectId: string | null;
  localDate: string;
  timezone: string;
  durationMinutes: number;
  notesMarkdown?: string;
}): TimeEntryData {
  const data: TimeEntryData = {
    task_id: input.taskId,
    project_id: input.projectId,
    local_date: input.localDate,
    timezone: input.timezone,
    started_at: null,
    ended_at: null,
    duration_minutes: input.durationMinutes,
    entry_method: "manual_duration",
    notes_markdown: input.notesMarkdown?.trim() ?? "",
    source_ref: null,
  };
  if (!isValidData(data)) throw new Error("INVALID_TIME_ENTRY_DETAILS");
  return data;
}

export function parseTimeEntryRecord(value: string): TimeEntryRecord {
  const record = parseRecord(value);
  if (record.entity_type !== "time_entry" || !isValidData(record.data)) throw new Error("INVALID_TIME_ENTRY_RECORD");
  return record as TimeEntryRecord;
}

export function activeTimeEntries(records: TimeEntryRecord[]) {
  return [...records].filter((record) => record.deleted_at === null).sort(sortNewest);
}

export function trashedTimeEntries(records: TimeEntryRecord[]) {
  return [...records].filter((record) => record.deleted_at !== null).sort(sortNewest);
}

function sortNewest(left: TimeEntryRecord, right: TimeEntryRecord) {
  return right.data.local_date.localeCompare(left.data.local_date) || right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id);
}

function isValidData(data: Record<string, unknown>): data is TimeEntryData {
  return typeof data.task_id === "string" && STABLE_ID.test(data.task_id)
    && (data.project_id === null || (typeof data.project_id === "string" && STABLE_ID.test(data.project_id)))
    && isDateOnly(data.local_date)
    && isTimezone(data.timezone)
    && data.started_at === null && data.ended_at === null
    && Number.isInteger(data.duration_minutes) && Number(data.duration_minutes) >= 1 && Number(data.duration_minutes) <= 1440
    && data.entry_method === "manual_duration"
    && typeof data.notes_markdown === "string" && data.notes_markdown.length <= 50_000
    && data.source_ref === null;
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 100) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}
