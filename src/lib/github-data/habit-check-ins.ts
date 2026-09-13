import { parseRecord, updateWorkspaceRecord, type WorkspaceRecord } from "./protocol";

export const HABIT_CHECK_IN_VERSION = 1 as const;
export const HABIT_CHECK_IN_STATUSES = ["completed", "missed", "skipped", "unknown"] as const;
export const HABIT_ENTRY_METHODS = ["manual", "automatic", "corrected"] as const;

export type HabitCheckInStatus = typeof HABIT_CHECK_IN_STATUSES[number];
export type HabitEntryMethod = typeof HABIT_ENTRY_METHODS[number];
export type HabitCheckInData = {
  habit_check_in_version: typeof HABIT_CHECK_IN_VERSION;
  habit_id: string;
  local_date: string;
  timezone: string;
  status: HabitCheckInStatus;
  value_json: Record<string, unknown>;
  entry_method: HabitEntryMethod;
  evidence_type: string | null;
  evidence_id: string | null;
  rule_id: string | null;
  rule_version: number | null;
  evaluated_at: string | null;
  confirmed_at: string;
  correction_reason: string | null;
};
export type HabitCheckInRecord = WorkspaceRecord<HabitCheckInData>;

export function createManualHabitCheckInData(input: {
  habitId: string;
  localDate: string;
  timezone: string;
  status: HabitCheckInStatus;
  valueJson?: Record<string, unknown>;
  confirmedAt: string;
}): HabitCheckInData {
  return validateData({
    habit_check_in_version: HABIT_CHECK_IN_VERSION,
    habit_id: input.habitId,
    local_date: input.localDate,
    timezone: input.timezone,
    status: input.status,
    value_json: structuredClone(input.valueJson ?? {}),
    entry_method: "manual",
    evidence_type: null,
    evidence_id: null,
    rule_id: null,
    rule_version: null,
    evaluated_at: null,
    confirmed_at: input.confirmedAt,
    correction_reason: null,
  });
}

export function createAutomaticHabitCheckInData(input: {
  habitId: string;
  localDate: string;
  timezone: string;
  status: HabitCheckInStatus;
  valueJson?: Record<string, unknown>;
  evidenceType: string;
  evidenceId: string;
  ruleId: string;
  ruleVersion: number;
  evaluatedAt: string;
  confirmedAt: string;
}): HabitCheckInData {
  return validateData({
    habit_check_in_version: HABIT_CHECK_IN_VERSION,
    habit_id: input.habitId,
    local_date: input.localDate,
    timezone: input.timezone,
    status: input.status,
    value_json: structuredClone(input.valueJson ?? {}),
    entry_method: "automatic",
    evidence_type: input.evidenceType,
    evidence_id: input.evidenceId,
    rule_id: input.ruleId,
    rule_version: input.ruleVersion,
    evaluated_at: input.evaluatedAt,
    confirmed_at: input.confirmedAt,
    correction_reason: null,
  });
}

export function correctHabitCheckIn(current: HabitCheckInRecord, input: {
  status: HabitCheckInStatus;
  valueJson: Record<string, unknown>;
  reason: string;
  confirmedAt: string;
}) {
  const data = validateData({
    ...current.data,
    status: input.status,
    value_json: structuredClone(input.valueJson),
    entry_method: "corrected",
    confirmed_at: input.confirmedAt,
    correction_reason: input.reason.trim(),
  });
  return updateWorkspaceRecord(current, data, input.confirmedAt);
}

export function parseHabitCheckInRecord(value: string): HabitCheckInRecord {
  const record = parseRecord(value);
  if (record.entity_type !== "habit_check_in") throw new Error("INVALID_HABIT_CHECK_IN_RECORD");
  try { validateData(record.data as HabitCheckInData); }
  catch { throw new Error("INVALID_HABIT_CHECK_IN_RECORD"); }
  return record as HabitCheckInRecord;
}

export function checkInsForMonth(records: HabitCheckInRecord[], habitId: string, yearMonth: string) {
  if (!isStableId(habitId) || !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(yearMonth)) throw new Error("INVALID_HABIT_MONTH_QUERY");
  return records.filter((record) => record.deleted_at === null && record.data.habit_id === habitId && record.data.local_date.startsWith(`${yearMonth}-`))
    .sort((left, right) => left.data.local_date.localeCompare(right.data.local_date) || left.id.localeCompare(right.id));
}

function validateData(data: HabitCheckInData) {
  const expectedKeys = "confirmed_at,correction_reason,entry_method,evaluated_at,evidence_id,evidence_type,habit_check_in_version,habit_id,local_date,rule_id,rule_version,status,timezone,value_json";
  const evidencePair = (data.evidence_type === null && data.evidence_id === null)
    || (isSlug(data.evidence_type) && isStableId(data.evidence_id));
  const ruleSet = data.rule_id !== null || data.rule_version !== null || data.evaluated_at !== null;
  const ruleComplete = isStableId(data.rule_id) && Number.isSafeInteger(data.rule_version) && Number(data.rule_version) >= 1 && isInstant(data.evaluated_at);
  if (Object.keys(data).sort().join(",") !== expectedKeys
    || data.habit_check_in_version !== HABIT_CHECK_IN_VERSION
    || !isStableId(data.habit_id)
    || !isDateOnly(data.local_date)
    || !isValidTimezone(data.timezone)
    || !HABIT_CHECK_IN_STATUSES.includes(data.status)
    || !isPlainJsonObject(data.value_json) || JSON.stringify(data.value_json).length > 50_000
    || !HABIT_ENTRY_METHODS.includes(data.entry_method)
    || !evidencePair
    || (ruleSet && !ruleComplete)
    || !isInstant(data.confirmed_at)
    || !(data.correction_reason === null || (typeof data.correction_reason === "string" && Boolean(data.correction_reason.trim()) && data.correction_reason.length <= 1_000))
    || (data.entry_method === "manual" && (data.evidence_id !== null || ruleSet || data.correction_reason !== null))
    || (data.entry_method === "automatic" && (data.evidence_id === null || !ruleComplete || data.correction_reason !== null))
    || (data.entry_method === "corrected" && data.correction_reason === null)
  ) throw new Error("INVALID_HABIT_CHECK_IN_DETAILS");
  return data;
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try { return JSON.parse(JSON.stringify(value)) !== null; } catch { return false; }
}
function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
function isInstant(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function isStableId(value: unknown): value is string { return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(value); }
function isSlug(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(value); }
function isValidTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 100) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; }
  catch { return false; }
}
