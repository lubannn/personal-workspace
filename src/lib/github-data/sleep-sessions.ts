import { parseRecord, type WorkspaceRecord } from "./protocol";
import { SLEEP_SESSION_TYPES, type SleepSessionCandidate } from "./health-staging-records";
import { validAutomaticCorosFields, type AutomaticCorosFields, type CorosProvenance } from "./coros-sync-types";

export const SLEEP_SESSION_VERSION = 1 as const;
export type ConfirmedSleepSessionData = SleepSessionCandidate & {
  sleep_session_version: typeof SLEEP_SESSION_VERSION;
  sleep_metrics_json: Record<string, never>;
  confirmation_status: "confirmed";
  staging_record_id: string;
  user_adjusted: boolean;
  adjustment_reason: string | null;
};
export type CorosSleepMetrics = {
  asleep_minutes: number | null;
  awake_minutes: number | null;
  score: number | null;
  wake_date: string;
};
export type AutomaticSleepSessionData = SleepSessionCandidate & AutomaticCorosFields & {
  sleep_session_version: 2;
  sleep_metrics_json: CorosSleepMetrics;
  user_adjusted?: never;
  adjustment_reason?: never;
};
export type SleepSessionData = ConfirmedSleepSessionData | AutomaticSleepSessionData;
export type SleepSessionRecord = WorkspaceRecord<SleepSessionData>;

export function createConfirmedSleepSessionData(candidate: SleepSessionCandidate, stagingRecordId: string): ConfirmedSleepSessionData {
  if (!stagingRecordId.trim()) throw new Error("INVALID_HEALTH_STAGING_ID");
  const data: ConfirmedSleepSessionData = {
    sleep_session_version: SLEEP_SESSION_VERSION,
    ...candidate,
    sleep_metrics_json: {},
    confirmation_status: "confirmed",
    staging_record_id: stagingRecordId,
    user_adjusted: true,
    adjustment_reason: "用户在健康暂存区确认分类与时间",
  };
  validateData(data);
  return data;
}

export function createAutomaticSleepSessionData(candidate: SleepSessionCandidate, provenance: CorosProvenance, metrics: CorosSleepMetrics): AutomaticSleepSessionData {
  const data: AutomaticSleepSessionData = { ...candidate, sleep_session_version: 2, sleep_metrics_json: metrics, import_mode: "automatic", review_status: "validated", source: provenance };
  validateData(data);
  return data;
}

export function parseSleepSessionRecord(value: string): SleepSessionRecord {
  const record = parseRecord(value);
  if (record.entity_type !== "sleep_session") throw new Error("INVALID_SLEEP_SESSION_RECORD");
  try { validateData(record.data as SleepSessionData); } catch { throw new Error("INVALID_SLEEP_SESSION_RECORD"); }
  return record as SleepSessionRecord;
}

function validateData(data: SleepSessionData) {
  if (!data || typeof data !== "object") throw new Error("INVALID_SLEEP_SESSION_DETAILS");
  const keys = "adjustment_reason,confirmation_status,duration_minutes,end_at,local_date,session_type,sleep_metrics_json,sleep_session_version,staging_record_id,start_at,timezone,user_adjusted";
  const duration = Math.round((Date.parse(data.end_at) - Date.parse(data.start_at)) / 60_000);
  if (data.sleep_session_version === 2) {
    const automaticKeys = "duration_minutes,end_at,import_mode,local_date,review_status,session_type,sleep_metrics_json,sleep_session_version,source,start_at,timezone";
    const metrics = data.sleep_metrics_json;
    const validMinutes = (value: number | null) => value === null || (Number.isFinite(value) && value >= 0 && value <= duration);
    if (Object.keys(data).sort().join(",") !== automaticKeys || !validAutomaticCorosFields(data)
      || typeof data.start_at !== "string" || typeof data.end_at !== "string" || typeof data.timezone !== "string" || !data.timezone
      || !["main_sleep", "nap"].includes(data.session_type) || !isDateOnly(data.local_date)
      || !Number.isFinite(duration) || duration <= 0 || duration > 2_160 || duration !== data.duration_minutes
      || !metrics || Object.keys(metrics).sort().join(",") !== "asleep_minutes,awake_minutes,score,wake_date"
      || !validMinutes(metrics.asleep_minutes) || !validMinutes(metrics.awake_minutes)
      || (metrics.asleep_minutes !== null && metrics.awake_minutes !== null && metrics.asleep_minutes + metrics.awake_minutes > duration + 1)
      || !(metrics.score === null || (Number.isFinite(metrics.score) && metrics.score >= 0 && metrics.score <= 100))
      || !isDateOnly(metrics.wake_date)) throw new Error("INVALID_SLEEP_SESSION_DETAILS");
    try {
      if (localDateForInstant(data.start_at, data.timezone) !== data.local_date || localDateForInstant(data.end_at, data.timezone) !== metrics.wake_date) throw new Error("INVALID_SLEEP_SESSION_DETAILS");
    } catch { throw new Error("INVALID_SLEEP_SESSION_DETAILS"); }
    return data;
  }
  if (Object.keys(data).sort().join(",") !== keys || data.sleep_session_version !== 1 || data.confirmation_status !== "confirmed"
    || !data.staging_record_id || !SLEEP_SESSION_TYPES.includes(data.session_type) || !isDateOnly(data.local_date)
    || Number.isNaN(duration) || duration <= 0 || duration > 2_160 || duration !== data.duration_minutes
    || Object.keys(data.sleep_metrics_json).length !== 0 || data.user_adjusted !== true || !data.adjustment_reason) throw new Error("INVALID_SLEEP_SESSION_DETAILS");
  try { if (localDateForInstant(data.start_at, data.timezone) !== data.local_date) throw new Error("INVALID_SLEEP_SESSION_DETAILS"); } catch { throw new Error("INVALID_SLEEP_SESSION_DETAILS"); }
  return data;
}

function isDateOnly(value: string) { const parsed = /^\d{4}-\d{2}-\d{2}$/u.test(value) ? new Date(`${value}T00:00:00Z`) : null; return Boolean(parsed && !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value); }
function localDateForInstant(value: string, timezone: string) { const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value)); const pick = (type: string) => parts.find((part) => part.type === type)?.value; return `${pick("year")}-${pick("month")}-${pick("day")}`; }
