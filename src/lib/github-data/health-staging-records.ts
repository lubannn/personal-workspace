import { parseRecord, updateWorkspaceRecord, type WorkspaceRecord } from "./protocol";

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
export type HealthStagingFields = {
  source_label: string;
  normalized_json: HealthMetricCandidate;
};
export type HealthStagingData = {
  health_staging_version: typeof HEALTH_STAGING_VERSION;
  source: { kind: "manual"; label: string; imported_at: string };
  raw_record_id: string | null;
  health_type: "metric";
  normalized_json: HealthMetricCandidate;
  classifier_version: "manual-v1";
  classification: "health_metric";
  confidence: null;
  status: HealthStagingStatus;
  diagnostics_json: Array<{ code: string; message: string }>;
  reviewed_at: string | null;
  review_reason: string | null;
  canonical_record_id: string | null;
};
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

export function correctPendingHealthStaging(current: HealthStagingRecord, fields: HealthStagingFields, timestamp = new Date().toISOString()) {
  assertPending(current); assertInstant(timestamp);
  return updateWorkspaceRecord(current, validateData({
    ...current.data,
    source: { ...current.data.source, label: fields.source_label.trim() },
    normalized_json: normalizeCandidate(fields.normalized_json),
  }), timestamp);
}

export function confirmHealthStaging(current: HealthStagingRecord, canonicalRecordId: string, timestamp = new Date().toISOString()) {
  assertPending(current); assertInstant(timestamp);
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

function validateData(data: HealthStagingData) {
  const keys = "canonical_record_id,classification,classifier_version,confidence,diagnostics_json,health_staging_version,health_type,normalized_json,raw_record_id,review_reason,reviewed_at,source,status";
  if (Object.keys(data).sort().join(",") !== keys || data.health_staging_version !== 1 || data.health_type !== "metric"
    || data.classifier_version !== "manual-v1" || data.classification !== "health_metric" || data.confidence !== null
    || !HEALTH_STAGING_STATUSES.includes(data.status) || !validCandidate(data.normalized_json)
    || !data.source || Object.keys(data.source).sort().join(",") !== "imported_at,kind,label" || data.source.kind !== "manual"
    || !data.source.label || data.source.label.length > 120 || Number.isNaN(Date.parse(data.source.imported_at))
    || data.raw_record_id !== null || !Array.isArray(data.diagnostics_json) || data.diagnostics_json.some((item) => !item || typeof item.code !== "string" || typeof item.message !== "string")
    || !(data.reviewed_at === null || !Number.isNaN(Date.parse(data.reviewed_at)))
    || !(data.review_reason === null || (typeof data.review_reason === "string" && data.review_reason.length <= 500))
    || !(data.canonical_record_id === null || (typeof data.canonical_record_id === "string" && Boolean(data.canonical_record_id)))) throw new Error("INVALID_HEALTH_STAGING_DETAILS");
  if (data.status === "pending" && (data.reviewed_at !== null || data.canonical_record_id !== null)) throw new Error("INVALID_HEALTH_STAGING_DETAILS");
  if (data.status === "confirmed" && (!data.reviewed_at || !data.canonical_record_id)) throw new Error("INVALID_HEALTH_STAGING_DETAILS");
  if (data.status === "rejected" && (!data.reviewed_at || !data.review_reason || data.canonical_record_id !== null)) throw new Error("INVALID_HEALTH_STAGING_DETAILS");
  return data;
}

function validCandidate(value: HealthMetricCandidate) {
  if (!value || Object.keys(value).sort().join(",") !== "aggregation_period,local_date,measured_at,metric_type,timezone,unit,value") return false;
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(value.metric_type) || !value.unit || value.unit.length > 64 || !Number.isFinite(value.value)) return false;
  if (!isDateOnly(value.local_date) || Number.isNaN(Date.parse(value.measured_at)) || !["instant", "daily"].includes(value.aggregation_period)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value.timezone }).format(); return true; } catch { return false; }
}

function assertInstant(value: string) { if (Number.isNaN(Date.parse(value))) throw new Error("INVALID_HEALTH_TIMESTAMP"); }
function isDateOnly(value: string) { const parsed = /^\d{4}-\d{2}-\d{2}$/u.test(value) ? new Date(`${value}T00:00:00Z`) : null; return Boolean(parsed && !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value); }
