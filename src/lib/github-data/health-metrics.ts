import { parseRecord, type WorkspaceRecord } from "./protocol";
import type { HealthMetricCandidate } from "./health-staging-records";
import { validAutomaticCorosFields, type AutomaticCorosFields, type CorosProvenance } from "./coros-sync-types";
import { healthTimezoneFormatter } from "./health-timezone";

export const HEALTH_METRIC_VERSION = 1 as const;
export type ConfirmedHealthMetricData = HealthMetricCandidate & {
  health_metric_version: typeof HEALTH_METRIC_VERSION;
  confirmation_status: "confirmed";
  staging_record_id: string;
};
export type AutomaticHealthMetricData = HealthMetricCandidate & AutomaticCorosFields & {
  health_metric_version: 2;
  /** Explicit source evidence for completed daily aggregates; absent means unknown. */
  day_complete?: boolean;
  /** Daily endpoint dates identify buckets, not measurement instants. */
  measurement_time_kind?: "observed_at";
  /** Immutable prior version retained by the metric sync writer; excluded from live ratings. */
  revision_of?: string;
};
export type HealthMetricData = ConfirmedHealthMetricData | AutomaticHealthMetricData;
export type HealthMetricRecord = WorkspaceRecord<HealthMetricData>;

export function createConfirmedHealthMetricData(candidate: HealthMetricCandidate, stagingRecordId: string): ConfirmedHealthMetricData {
  if (!stagingRecordId.trim()) throw new Error("INVALID_HEALTH_STAGING_ID");
  const data = { health_metric_version: HEALTH_METRIC_VERSION, ...candidate, confirmation_status: "confirmed" as const, staging_record_id: stagingRecordId };
  validateData(data);
  return data;
}

export function createAutomaticHealthMetricData(candidate: HealthMetricCandidate, provenance: CorosProvenance, dayComplete?: boolean, measurementTimeKind?: "observed_at"): AutomaticHealthMetricData {
  const data: AutomaticHealthMetricData = { ...candidate, health_metric_version: 2, import_mode: "automatic", review_status: "validated", source: provenance,
    ...(dayComplete === undefined ? {} : { day_complete: dayComplete }),
    ...(measurementTimeKind === undefined ? {} : { measurement_time_kind: measurementTimeKind }) };
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
  if (!data || typeof data !== "object") throw new Error("INVALID_HEALTH_METRIC_DETAILS");
  const keys = "aggregation_period,confirmation_status,health_metric_version,local_date,measured_at,metric_type,staging_record_id,timezone,unit,value";
  const automaticKeys = "aggregation_period,health_metric_version,import_mode,local_date,measured_at,metric_type,review_status,source,timezone,unit,value";
  const validOrigin = data.health_metric_version === 2
    ? Object.keys(data).filter(key => !["day_complete", "measurement_time_kind", "revision_of"].includes(key)).sort().join(",") === automaticKeys && validAutomaticCorosFields(data)
      && (!Object.hasOwn(data, "day_complete") || (typeof data.day_complete === "boolean" && data.aggregation_period === "daily"))
      && (!Object.hasOwn(data, "measurement_time_kind") || data.measurement_time_kind === "observed_at")
      && (!Object.hasOwn(data, "revision_of") || (typeof data.revision_of === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(data.revision_of)))
      && typeof data.measured_at === "string" && typeof data.timezone === "string" && Boolean(data.timezone)
    : Object.keys(data).sort().join(",") === keys && data.health_metric_version === 1 && data.confirmation_status === "confirmed" && Boolean(data.staging_record_id);
  if (!validOrigin || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(data.metric_type) || !data.unit || data.unit.length > 64
    || !Number.isFinite(data.value) || !isDateOnly(data.local_date) || Number.isNaN(Date.parse(data.measured_at))
    || !["instant", "daily"].includes(data.aggregation_period)) throw new Error("INVALID_HEALTH_METRIC_DETAILS");
  try { healthTimezoneFormatter(data.timezone).format(); } catch { throw new Error("INVALID_HEALTH_METRIC_DETAILS"); }
  return data;
}

function isDateOnly(value: string) { const parsed = /^\d{4}-\d{2}-\d{2}$/u.test(value) ? new Date(`${value}T00:00:00Z`) : null; return Boolean(parsed && !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value); }
