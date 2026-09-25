import { validWorkoutCandidate, type CorosWorkoutCandidate, type HealthStagingRecord } from "./health-staging-records";
import { parseRecord, type WorkspaceRecord } from "./protocol";

export const WORKOUT_VERSION = 1 as const;

export type WorkoutData = CorosWorkoutCandidate & {
  workout_version: typeof WORKOUT_VERSION;
  confirmation_status: "confirmed";
  staging_record_id: string;
  import_key: string;
  source_sha256: string;
  confirmed_at: string;
};
export type WorkoutRecord = WorkspaceRecord<WorkoutData>;

// This builds canonical data; the caller must commit it atomically with the staging review.
export function createConfirmedWorkoutData(staging: HealthStagingRecord, confirmedAt: string): WorkoutData {
  if (staging.deleted_at !== null || staging.data.health_type !== "workout" || staging.data.status !== "pending") {
    throw new Error("WORKOUT_STAGING_NOT_PENDING");
  }
  const data: WorkoutData = {
    workout_version: WORKOUT_VERSION,
    ...staging.data.normalized_json,
    confirmation_status: "confirmed",
    staging_record_id: staging.id,
    import_key: staging.data.import_key,
    source_sha256: staging.data.source.source_sha256,
    confirmed_at: confirmedAt,
  };
  return validateWorkoutData(data);
}

export function parseWorkoutRecord(value: string): WorkoutRecord {
  const record = parseRecord(value);
  if (record.entity_type !== "workout") throw new Error("INVALID_WORKOUT_RECORD");
  try {
    validateWorkoutData(record.data as WorkoutData);
    if (record.id !== `workout_${(record.data as WorkoutData).import_key}`) throw new Error("INVALID_WORKOUT_RECORD");
  }
  catch { throw new Error("INVALID_WORKOUT_RECORD"); }
  return record as WorkoutRecord;
}

export function isWorkoutLinkedToStaging(workout: WorkoutRecord, staging: HealthStagingRecord): boolean {
  if (staging.data.health_type !== "workout") return false;
  const candidate = workoutCandidateFromData(workout.data);
  return staging.deleted_at === null && staging.data.status === "confirmed"
    && staging.owner_id === workout.owner_id
    && staging.id === workout.data.staging_record_id
    && staging.data.canonical_record_id === workout.id
    && staging.data.import_key === workout.data.import_key
    && staging.data.source.source_sha256 === workout.data.source_sha256
    && stableJson(staging.data.normalized_json) === stableJson(candidate);
}

function validateWorkoutData(data: WorkoutData): WorkoutData {
  const keys = "activity_type,confirmation_status,confirmed_at,distance,distance_unit,duration_seconds,end_at,import_key,metrics_json,source_sha256,staging_record_id,start_at,timezone,training_load,workout_version";
  if (!data || typeof data !== "object") throw new Error("INVALID_WORKOUT_DETAILS");
  const candidate = workoutCandidateFromData(data);
  if (Object.keys(data).sort().join(",") !== keys || data.workout_version !== WORKOUT_VERSION
    || data.confirmation_status !== "confirmed" || !validWorkoutCandidate(candidate)
    || !/^[0-9a-f]{64}$/u.test(data.import_key) || !/^[0-9a-f]{64}$/u.test(data.source_sha256)
    || data.staging_record_id !== `coros_workout_${data.import_key}`
    || typeof data.confirmed_at !== "string" || Number.isNaN(Date.parse(data.confirmed_at))) {
    throw new Error("INVALID_WORKOUT_DETAILS");
  }
  return data;
}

function workoutCandidateFromData(data: WorkoutData): CorosWorkoutCandidate {
  return {
    activity_type: data.activity_type, start_at: data.start_at, end_at: data.end_at,
    timezone: data.timezone, duration_seconds: data.duration_seconds, distance: data.distance,
    distance_unit: data.distance_unit, training_load: data.training_load, metrics_json: data.metrics_json,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
