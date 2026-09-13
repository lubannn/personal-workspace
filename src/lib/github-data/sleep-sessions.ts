import { parseRecord, type WorkspaceRecord } from "./protocol";
import { SLEEP_SESSION_TYPES, type SleepSessionCandidate } from "./health-staging-records";

export const SLEEP_SESSION_VERSION = 1 as const;
export type SleepSessionData = SleepSessionCandidate & {
  sleep_session_version: typeof SLEEP_SESSION_VERSION;
  sleep_metrics_json: Record<string, never>;
  confirmation_status: "confirmed";
  staging_record_id: string;
  user_adjusted: boolean;
  adjustment_reason: string | null;
};
export type SleepSessionRecord = WorkspaceRecord<SleepSessionData>;

export function createConfirmedSleepSessionData(candidate: SleepSessionCandidate, stagingRecordId: string): SleepSessionData {
  if (!stagingRecordId.trim()) throw new Error("INVALID_HEALTH_STAGING_ID");
  const data: SleepSessionData = {
    sleep_session_version: SLEEP_SESSION_VERSION,
    ...candidate,
    sleep_metrics_json: {},
    confirmation_status: "confirmed",
    staging_record_id: stagingRecordId,
    user_adjusted: true,
    adjustment_reason: "用户在健康暂存区确认分类与时间",
  };
  return validateData(data);
}

export function parseSleepSessionRecord(value: string): SleepSessionRecord {
  const record = parseRecord(value);
  if (record.entity_type !== "sleep_session") throw new Error("INVALID_SLEEP_SESSION_RECORD");
  try { validateData(record.data as SleepSessionData); } catch { throw new Error("INVALID_SLEEP_SESSION_RECORD"); }
  return record as SleepSessionRecord;
}

function validateData(data: SleepSessionData) {
  const keys = "adjustment_reason,confirmation_status,duration_minutes,end_at,local_date,session_type,sleep_metrics_json,sleep_session_version,staging_record_id,start_at,timezone,user_adjusted";
  const duration = Math.round((Date.parse(data.end_at) - Date.parse(data.start_at)) / 60_000);
  if (Object.keys(data).sort().join(",") !== keys || data.sleep_session_version !== 1 || data.confirmation_status !== "confirmed"
    || !data.staging_record_id || !SLEEP_SESSION_TYPES.includes(data.session_type) || !isDateOnly(data.local_date)
    || Number.isNaN(duration) || duration <= 0 || duration > 2_160 || duration !== data.duration_minutes
    || Object.keys(data.sleep_metrics_json).length !== 0 || data.user_adjusted !== true || !data.adjustment_reason) throw new Error("INVALID_SLEEP_SESSION_DETAILS");
  try { if (localDateForInstant(data.start_at, data.timezone) !== data.local_date) throw new Error("INVALID_SLEEP_SESSION_DETAILS"); } catch { throw new Error("INVALID_SLEEP_SESSION_DETAILS"); }
  return data;
}

function isDateOnly(value: string) { const parsed = /^\d{4}-\d{2}-\d{2}$/u.test(value) ? new Date(`${value}T00:00:00Z`) : null; return Boolean(parsed && !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value); }
function localDateForInstant(value: string, timezone: string) { const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value)); const pick = (type: string) => parts.find((part) => part.type === type)?.value; return `${pick("year")}-${pick("month")}-${pick("day")}`; }
