import { parseRecord, type WorkspaceRecord } from "./protocol";
import type { HealthMetricCandidate } from "./health-staging-records";

export const HEALTH_METRIC_VERSION = 1 as const;
export type HealthMetricData = HealthMetricCandidate & {
  health_metric_version: typeof HEALTH_METRIC_VERSION;
  confirmation_status: "confirmed";
  staging_record_id: string;
};
export type HealthMetricRecord = WorkspaceRecord<HealthMetricData>;

export function createConfirmedHealthMetricData(candidate: HealthMetricCandidate, stagingRecordId: string): HealthMetricData {
  if (!stagingRecordId.trim()) throw new Error("INVALID_HEALTH_STAGING_ID");
  const data = { health_metric_version: HEALTH_METRIC_VERSION, ...candidate, confirmation_status: "confirmed" as const, staging_record_id: stagingRecordId };
  validateData(data);
  return data;
}

export function parseHealthMetricRecord(value: string): HealthMetricRecord {
  const record = parseRecord(value);
  if (record.entity_type !== "health_metric") throw new Error("INVALID_HEALTH_METRIC_RECORD");
  try { validateData(record.data as HealthMetricData); } catch { throw new Error("INVALID_HEALTH_METRIC_RECORD"); }
  return record as HealthMetricRecord;
}

function validateData(data: HealthMetricData) {
  const keys = "aggregation_period,confirmation_status,health_metric_version,local_date,measured_at,metric_type,staging_record_id,timezone,unit,value";
  if (Object.keys(data).sort().join(",") !== keys || data.health_metric_version !== 1 || data.confirmation_status !== "confirmed"
    || !data.staging_record_id || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(data.metric_type) || !data.unit || data.unit.length > 64
    || !Number.isFinite(data.value) || !isDateOnly(data.local_date) || Number.isNaN(Date.parse(data.measured_at))
    || !["instant", "daily"].includes(data.aggregation_period)) throw new Error("INVALID_HEALTH_METRIC_DETAILS");
  try { new Intl.DateTimeFormat("en", { timeZone: data.timezone }).format(); } catch { throw new Error("INVALID_HEALTH_METRIC_DETAILS"); }
  return data;
}

function isDateOnly(value: string) { const parsed = /^\d{4}-\d{2}-\d{2}$/u.test(value) ? new Date(`${value}T00:00:00Z`) : null; return Boolean(parsed && !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value); }
