import { parseRecord, updateWorkspaceRecord, type WorkspaceRecord } from "./protocol";

export const HABIT_VERSION = 1 as const;
export const HABIT_TRACKING_TYPES = ["boolean", "count", "duration", "threshold"] as const;
export const HABIT_AUTOMATION_MODES = ["manual", "rule_assisted"] as const;
export const HABIT_STATUSES = ["active", "paused", "archived"] as const;

export type HabitTrackingType = typeof HABIT_TRACKING_TYPES[number];
export type HabitAutomationMode = typeof HABIT_AUTOMATION_MODES[number];
export type HabitStatus = typeof HABIT_STATUSES[number];
export type HabitSchedule = {
  frequency: "daily" | "weekly";
  weekdays: number[];
};
export type HabitTarget = {
  value: number;
  unit: string | null;
};
export type HabitData = {
  habit_version: typeof HABIT_VERSION;
  name: string;
  description_markdown: string;
  schedule_json: HabitSchedule;
  timezone: string;
  tracking_type: HabitTrackingType;
  target_json: HabitTarget;
  automation_mode: HabitAutomationMode;
  status: HabitStatus;
  start_date: string;
  end_date: string | null;
};
export type HabitRecord = WorkspaceRecord<HabitData>;
export type HabitFields = Pick<HabitData,
  "name" | "description_markdown" | "schedule_json" | "timezone" | "tracking_type" | "target_json" | "automation_mode" | "start_date" | "end_date"
>;

export function createHabitData(fields: HabitFields): HabitData {
  return validateData({ habit_version: HABIT_VERSION, ...normalizeFields(fields), status: "active" });
}

export function updateHabitDetails(current: HabitRecord, fields: HabitFields, timestamp = new Date().toISOString()) {
  assertInstant(timestamp);
  return updateWorkspaceRecord(current, validateData({ ...current.data, ...normalizeFields(fields) }), timestamp);
}

export function setHabitStatus(current: HabitRecord, status: HabitStatus, timestamp = new Date().toISOString()) {
  assertInstant(timestamp);
  if (!HABIT_STATUSES.includes(status)) throw new Error("INVALID_HABIT_STATUS");
  return updateWorkspaceRecord(current, { ...current.data, status }, timestamp);
}

export function parseHabitRecord(value: string): HabitRecord {
  const record = parseRecord(value);
  if (record.entity_type !== "habit") throw new Error("INVALID_HABIT_RECORD");
  try { validateData(record.data as HabitData); }
  catch { throw new Error("INVALID_HABIT_RECORD"); }
  return record as HabitRecord;
}

export function activeHabits(records: HabitRecord[]) {
  return records.filter((record) => record.deleted_at === null && record.data.status !== "archived")
    .sort((left, right) => left.data.name.localeCompare(right.data.name, "zh-CN") || left.id.localeCompare(right.id));
}

export function archivedHabits(records: HabitRecord[]) {
  return records.filter((record) => record.deleted_at === null && record.data.status === "archived")
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export function trashedHabits(records: HabitRecord[]) {
  return records.filter((record) => record.deleted_at !== null)
    .sort((left, right) => String(right.deleted_at).localeCompare(String(left.deleted_at)));
}

function normalizeFields(fields: HabitFields): HabitFields {
  return {
    name: fields.name.trim(),
    description_markdown: fields.description_markdown,
    schedule_json: {
      frequency: fields.schedule_json.frequency,
      weekdays: [...new Set(fields.schedule_json.weekdays)].sort((left, right) => left - right),
    },
    timezone: fields.timezone.trim(),
    tracking_type: fields.tracking_type,
    target_json: {
      value: fields.target_json.value,
      unit: fields.target_json.unit?.trim() || null,
    },
    automation_mode: fields.automation_mode,
    start_date: fields.start_date,
    end_date: fields.end_date,
  };
}

function validateData(data: HabitData): HabitData {
  const expectedKeys = "automation_mode,description_markdown,end_date,habit_version,name,schedule_json,start_date,status,target_json,timezone,tracking_type";
  if (
    Object.keys(data).sort().join(",") !== expectedKeys
    || data.habit_version !== HABIT_VERSION
    || typeof data.name !== "string" || !data.name.trim() || data.name.length > 200
    || typeof data.description_markdown !== "string" || data.description_markdown.length > 50_000
    || !isValidSchedule(data.schedule_json)
    || !isValidTimezone(data.timezone)
    || !HABIT_TRACKING_TYPES.includes(data.tracking_type)
    || !isValidTarget(data.target_json, data.tracking_type)
    || !HABIT_AUTOMATION_MODES.includes(data.automation_mode)
    || !HABIT_STATUSES.includes(data.status)
    || !isDateOnly(data.start_date)
    || !(data.end_date === null || (isDateOnly(data.end_date) && data.end_date >= data.start_date))
  ) throw new Error("INVALID_HABIT_DETAILS");
  return data;
}

function isValidSchedule(value: unknown): value is HabitSchedule {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const schedule = value as Record<string, unknown>;
  const weekdays = schedule.weekdays;
  if (Object.keys(schedule).sort().join(",") !== "frequency,weekdays"
    || (schedule.frequency !== "daily" && schedule.frequency !== "weekly")
    || !Array.isArray(weekdays)
    || weekdays.some((day) => typeof day !== "number" || !Number.isInteger(day) || day < 1 || day > 7)
  ) return false;
  const days = weekdays as number[];
  if (new Set(days).size !== days.length || days.some((day, index) => index > 0 && days[index - 1]! >= day)) return false;
  return schedule.frequency === "daily" ? days.length === 0 : days.length > 0;
}

function isValidTarget(value: unknown, trackingType: HabitTrackingType): value is HabitTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  if (Object.keys(target).sort().join(",") !== "unit,value"
    || typeof target.value !== "number" || !Number.isFinite(target.value) || target.value <= 0
    || !(target.unit === null || (typeof target.unit === "string" && Boolean(target.unit.trim()) && target.unit.length <= 64))
  ) return false;
  return trackingType === "boolean" ? target.value === 1 && target.unit === null : target.unit !== null;
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 100) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; }
  catch { return false; }
}

function assertInstant(value: string) {
  if (Number.isNaN(Date.parse(value))) throw new Error("INVALID_HABIT_TIMESTAMP");
}
