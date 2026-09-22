import { parseRecord, updateWorkspaceRecord, type WorkspaceRecord } from "./protocol";
import { COROS_ACTIVITY_MAPPING_VERSION, type CorosWorkoutProposal } from "./coros-activity-mapping";

export const HEALTH_STAGING_VERSION = 1 as const;
export const HEALTH_STAGING_STATUSES = ["pending", "confirmed", "rejected", "superseded"] as const;

export type HealthStagingStatus = typeof HEALTH_STAGING_STATUSES[number];
export type HealthMetricCandidate = {
  metric_type: string;
  measured_at: string;
  local_date: string;
  timezone: string;
  value: number;
  unit: string;
  aggregation_period: "instant" | "daily";
};
export const SLEEP_SESSION_TYPES = ["main_sleep", "nap", "unknown"] as const;
export type SleepSessionType = typeof SLEEP_SESSION_TYPES[number];
export type SleepSessionCandidate = {
  start_at: string;
  end_at: string;
  local_date: string;
  timezone: string;
  session_type: SleepSessionType;
  duration_minutes: number;
};
export type HealthStagingFields = {
  source_label: string;
  normalized_json: HealthMetricCandidate;
};
export type SleepStagingFields = {
  source_label: string;
  normalized_json: Omit<SleepSessionCandidate, "duration_minutes">;
};
type HealthReviewFields = {
  health_staging_version: typeof HEALTH_STAGING_VERSION;
  status: HealthStagingStatus;
  diagnostics_json: Array<{ code: string; message: string }>;
  reviewed_at: string | null;
  review_reason: string | null;
  canonical_record_id: string | null;
};
type ManualHealthStagingBase = HealthReviewFields & {
  source: { kind: "manual"; label: string; imported_at: string };
  raw_record_id: null;
  classifier_version: "manual-v1";
  confidence: null;
};
export type CorosWorkoutCandidate = Omit<CorosWorkoutProposal, "importKey" | "duplicate" | "duplicateReason" | "diagnostics" | "confirmation_status" | "staging_record_id">;
export type CorosWorkoutSource = {
  kind: "coros_file";
  label: "COROS FIT file" | "COROS TCX file";
  format: "fit" | "tcx";
  source_sha256: string;
  parser_version: string;
  mapping_version: typeof COROS_ACTIVITY_MAPPING_VERSION;
  batch_identity: string;
};
export type CorosWorkoutStagingFields = {
  source: CorosWorkoutSource;
  import_key: string;
  normalized_json: CorosWorkoutCandidate;
  diagnostics_json: Array<{ code: string; message: string }>;
};
export type MetricHealthStagingData = ManualHealthStagingBase & { health_type: "metric"; normalized_json: HealthMetricCandidate; classification: "health_metric" };
export type SleepHealthStagingData = ManualHealthStagingBase & { health_type: "sleep_session"; normalized_json: SleepSessionCandidate; classification: SleepSessionType };
export type WorkoutHealthStagingData = HealthReviewFields & {
  source: CorosWorkoutSource;
  raw_record_id: null;
  health_type: "workout";
  normalized_json: CorosWorkoutCandidate;
  import_key: string;
  classifier_version: "coros-mapping-v1";
  classification: "workout";
  confidence: null;
};
export type HealthStagingData = MetricHealthStagingData | SleepHealthStagingData | WorkoutHealthStagingData;
export type HealthStagingRecord = WorkspaceRecord<HealthStagingData>;

export function createHealthStagingData(fields: HealthStagingFields, importedAt = new Date().toISOString()): HealthStagingData {
  assertInstant(importedAt);
  return validateData({
    health_staging_version: HEALTH_STAGING_VERSION,
    source: { kind: "manual", label: fields.source_label.trim(), imported_at: importedAt },
    raw_record_id: null,
    health_type: "metric",
    normalized_json: normalizeCandidate(fields.normalized_json),
    classifier_version: "manual-v1",
    classification: "health_metric",
    confidence: null,
    status: "pending",
    diagnostics_json: [],
    reviewed_at: null,
    review_reason: null,
    canonical_record_id: null,
  });
}

export function createSleepHealthStagingData(fields: SleepStagingFields, importedAt = new Date().toISOString()): SleepHealthStagingData {
  assertInstant(importedAt);
  const candidate = normalizeSleepCandidate(fields.normalized_json);
  return validateData({
    health_staging_version: HEALTH_STAGING_VERSION,
    source: { kind: "manual", label: fields.source_label.trim(), imported_at: importedAt },
    raw_record_id: null,
    health_type: "sleep_session",
    normalized_json: candidate,
    classifier_version: "manual-v1",
    classification: candidate.session_type,
    confidence: null,
    status: "pending",
    diagnostics_json: candidate.session_type === "unknown" ? [{ code: "SLEEP_CLASSIFICATION_REQUIRED", message: "确认前请明确选择夜间睡眠或小睡，或保留为未确定。" }] : [],
    reviewed_at: null,
    review_reason: null,
    canonical_record_id: null,
  }) as SleepHealthStagingData;
}

export function createCorosWorkoutStagingData(fields: CorosWorkoutStagingFields): WorkoutHealthStagingData {
  return validateData({
    health_staging_version: HEALTH_STAGING_VERSION,
    source: fields.source,
    raw_record_id: null,
    health_type: "workout",
    normalized_json: fields.normalized_json,
    import_key: fields.import_key,
    classifier_version: "coros-mapping-v1",
    classification: "workout",
    confidence: null,
    status: "pending",
    diagnostics_json: fields.diagnostics_json,
    reviewed_at: null,
    review_reason: null,
    canonical_record_id: null,
  }) as WorkoutHealthStagingData;
}

export function correctPendingHealthStaging(current: HealthStagingRecord, fields: HealthStagingFields, timestamp = new Date().toISOString()) {
  assertPending(current); assertInstant(timestamp);
  if (current.data.health_type !== "metric") throw new Error("HEALTH_STAGING_TYPE_MISMATCH");
  return updateWorkspaceRecord(current, validateData({
    ...current.data,
    source: { ...current.data.source, label: fields.source_label.trim() },
    normalized_json: normalizeCandidate(fields.normalized_json),
  }), timestamp);
}

export function correctPendingSleepHealthStaging(current: HealthStagingRecord, fields: SleepStagingFields, timestamp = new Date().toISOString()) {
  assertPending(current); assertInstant(timestamp);
  if (current.data.health_type !== "sleep_session") throw new Error("HEALTH_STAGING_TYPE_MISMATCH");
  const candidate = normalizeSleepCandidate(fields.normalized_json);
  return updateWorkspaceRecord(current, validateData({
    ...current.data,
    source: { ...current.data.source, label: fields.source_label.trim() },
    normalized_json: candidate,
    classification: candidate.session_type,
    diagnostics_json: candidate.session_type === "unknown" ? [{ code: "SLEEP_CLASSIFICATION_REQUIRED", message: "确认前请明确选择夜间睡眠或小睡，或保留为未确定。" }] : [],
  }), timestamp) as HealthStagingRecord;
}

export function confirmHealthStaging(current: HealthStagingRecord, canonicalRecordId: string, timestamp = new Date().toISOString()) {
  assertPending(current); assertInstant(timestamp);
  if (current.data.health_type === "workout") throw new Error("HEALTH_STAGING_CANONICAL_NOT_REGISTERED");
  if (!canonicalRecordId.trim()) throw new Error("INVALID_HEALTH_CANONICAL_ID");
  return updateWorkspaceRecord(current, validateData({ ...current.data, status: "confirmed", reviewed_at: timestamp, review_reason: null, canonical_record_id: canonicalRecordId }), timestamp);
}

export function rejectHealthStaging(current: HealthStagingRecord, reason: string, timestamp = new Date().toISOString()) {
  assertPending(current); assertInstant(timestamp);
  if (!reason.trim() || reason.length > 500) throw new Error("INVALID_HEALTH_REVIEW_REASON");
  return updateWorkspaceRecord(current, validateData({ ...current.data, status: "rejected", reviewed_at: timestamp, review_reason: reason.trim(), canonical_record_id: null }), timestamp);
}

export function parseHealthStagingRecord(value: string): HealthStagingRecord {
  const record = parseRecord(value);
  if (record.entity_type !== "health_staging_record") throw new Error("INVALID_HEALTH_STAGING_RECORD");
  try { validateData(record.data as HealthStagingData); } catch { throw new Error("INVALID_HEALTH_STAGING_RECORD"); }
  return record as HealthStagingRecord;
}

function assertPending(record: HealthStagingRecord) {
  if (record.deleted_at !== null || record.data.status !== "pending") throw new Error("HEALTH_STAGING_NOT_PENDING");
}

function normalizeCandidate(value: HealthMetricCandidate): HealthMetricCandidate {
  return { ...value, metric_type: value.metric_type.trim().toLowerCase(), timezone: value.timezone.trim(), unit: value.unit.trim() };
}

function normalizeSleepCandidate(value: Omit<SleepSessionCandidate, "duration_minutes">): SleepSessionCandidate {
  assertInstant(value.start_at); assertInstant(value.end_at);
  const durationMinutes = Math.round((Date.parse(value.end_at) - Date.parse(value.start_at)) / 60_000);
  return { ...value, timezone: value.timezone.trim(), duration_minutes: durationMinutes };
}

function validateData(data: HealthStagingData) {
  const manualKeys = "canonical_record_id,classification,classifier_version,confidence,diagnostics_json,health_staging_version,health_type,normalized_json,raw_record_id,review_reason,reviewed_at,source,status";
  const workoutKeys = "canonical_record_id,classification,classifier_version,confidence,diagnostics_json,health_staging_version,health_type,import_key,normalized_json,raw_record_id,review_reason,reviewed_at,source,status";
  const validNormalized = data.health_type === "metric"
    ? data.classification === "health_metric" && validCandidate(data.normalized_json)
    : data.health_type === "sleep_session"
      ? SLEEP_SESSION_TYPES.includes(data.classification) && data.classification === data.normalized_json.session_type && validSleepCandidate(data.normalized_json)
      : data.classification === "workout" && validWorkoutCandidate(data.normalized_json);
  const validShape = data.health_type === "workout"
    ? Object.keys(data).sort().join(",") === workoutKeys && data.classifier_version === "coros-mapping-v1" && validCorosSource(data.source) && /^[0-9a-f]{64}$/u.test(data.import_key)
    : Object.keys(data).sort().join(",") === manualKeys && data.classifier_version === "manual-v1" && validManualSource(data.source);
  if (!validShape || data.health_staging_version !== 1 || !validNormalized || data.confidence !== null
    || !HEALTH_STAGING_STATUSES.includes(data.status)
    || data.raw_record_id !== null || !Array.isArray(data.diagnostics_json) || data.diagnostics_json.some((item) => !item || typeof item.code !== "string" || typeof item.message !== "string")
    || !(data.reviewed_at === null || !Number.isNaN(Date.parse(data.reviewed_at)))
    || !(data.review_reason === null || (typeof data.review_reason === "string" && data.review_reason.length <= 500))
    || !(data.canonical_record_id === null || (typeof data.canonical_record_id === "string" && Boolean(data.canonical_record_id)))) throw new Error("INVALID_HEALTH_STAGING_DETAILS");
  if (data.status === "pending" && (data.reviewed_at !== null || data.canonical_record_id !== null)) throw new Error("INVALID_HEALTH_STAGING_DETAILS");
  if (data.status === "confirmed" && (!data.reviewed_at || !data.canonical_record_id)) throw new Error("INVALID_HEALTH_STAGING_DETAILS");
  if (data.status === "rejected" && (!data.reviewed_at || !data.review_reason || data.canonical_record_id !== null)) throw new Error("INVALID_HEALTH_STAGING_DETAILS");
  if (data.health_type === "workout" && (data.status === "confirmed" || data.canonical_record_id !== null)) throw new Error("INVALID_HEALTH_STAGING_DETAILS");
  return data;
}

function validManualSource(value: MetricHealthStagingData["source"] | SleepHealthStagingData["source"]) {
  return Boolean(value && Object.keys(value).sort().join(",") === "imported_at,kind,label" && value.kind === "manual"
    && value.label && value.label.length <= 120 && !Number.isNaN(Date.parse(value.imported_at)));
}

function validCorosSource(value: CorosWorkoutSource) {
  return Boolean(value && Object.keys(value).sort().join(",") === "batch_identity,format,kind,label,mapping_version,parser_version,source_sha256"
    && value.kind === "coros_file" && ["fit", "tcx"].includes(value.format)
    && value.label === (value.format === "fit" ? "COROS FIT file" : "COROS TCX file")
    && /^[0-9a-f]{64}$/u.test(value.source_sha256) && /^[0-9a-f]{64}$/u.test(value.batch_identity)
    && value.parser_version.length > 0 && value.parser_version.length <= 64
    && value.mapping_version === COROS_ACTIVITY_MAPPING_VERSION);
}

function validWorkoutCandidate(value: CorosWorkoutCandidate) {
  if (!value || Object.keys(value).sort().join(",") !== "activity_type,distance,distance_unit,duration_seconds,end_at,metrics_json,start_at,timezone,training_load") return false;
  if (!["run", "ride", "swim", "walk", "hike", "strength", "other"].includes(value.activity_type)
    || Number.isNaN(Date.parse(value.start_at)) || Number.isNaN(Date.parse(value.end_at)) || Date.parse(value.end_at) <= Date.parse(value.start_at)
    || !Number.isInteger(value.duration_seconds) || value.duration_seconds <= 0 || value.duration_seconds > 7 * 24 * 60 * 60
    || !(value.distance === null || (Number.isFinite(value.distance) && value.distance >= 0)) || value.distance_unit !== "m" || value.training_load !== null) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value.timezone }).format(); } catch { return false; }
  const metrics = value.metrics_json;
  if (!metrics || Object.keys(metrics).sort().join(",") !== "average_cadence_rpm,average_heart_rate_bpm,average_power_watts,calories,elapsed_seconds,maximum_heart_rate_bpm,moving_seconds,trackpoints") return false;
  const optionalNonNegative = [metrics.moving_seconds, metrics.calories, metrics.average_heart_rate_bpm, metrics.maximum_heart_rate_bpm, metrics.average_cadence_rpm, metrics.average_power_watts];
  return metrics.elapsed_seconds === value.duration_seconds && Number.isInteger(metrics.trackpoints) && metrics.trackpoints >= 0
    && optionalNonNegative.every((metric) => metric === null || (Number.isFinite(metric) && metric >= 0));
}

function validSleepCandidate(value: SleepSessionCandidate) {
  if (!value || Object.keys(value).sort().join(",") !== "duration_minutes,end_at,local_date,session_type,start_at,timezone") return false;
  const duration = Math.round((Date.parse(value.end_at) - Date.parse(value.start_at)) / 60_000);
  if (!isDateOnly(value.local_date) || Number.isNaN(duration) || duration <= 0 || duration > 2_160 || duration !== value.duration_minutes || !SLEEP_SESSION_TYPES.includes(value.session_type)) return false;
  try { return localDateForInstant(value.start_at, value.timezone) === value.local_date; } catch { return false; }
}

function validCandidate(value: HealthMetricCandidate) {
  if (!value || Object.keys(value).sort().join(",") !== "aggregation_period,local_date,measured_at,metric_type,timezone,unit,value") return false;
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(value.metric_type) || !value.unit || value.unit.length > 64 || !Number.isFinite(value.value)) return false;
  if (!isDateOnly(value.local_date) || Number.isNaN(Date.parse(value.measured_at)) || !["instant", "daily"].includes(value.aggregation_period)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value.timezone }).format(); return true; } catch { return false; }
}

function assertInstant(value: string) { if (Number.isNaN(Date.parse(value))) throw new Error("INVALID_HEALTH_TIMESTAMP"); }
function isDateOnly(value: string) { const parsed = /^\d{4}-\d{2}-\d{2}$/u.test(value) ? new Date(`${value}T00:00:00Z`) : null; return Boolean(parsed && !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value); }
function localDateForInstant(value: string, timezone: string) { const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value)); const pick = (type: string) => parts.find((part) => part.type === type)?.value; return `${pick("year")}-${pick("month")}-${pick("day")}`; }
