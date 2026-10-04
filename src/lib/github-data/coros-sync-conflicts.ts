import type { CorosWorkoutCandidate, SleepSessionCandidate } from "./health-staging-records";
import { createWorkspaceRecord, parseRecord, updateWorkspaceRecord, type WorkspaceRecord } from "./protocol";
import { createAutomaticSleepSessionData, parseSleepSessionRecord, type CorosSleepMetrics, type SleepSessionRecord } from "./sleep-sessions";
import { createAutomaticWorkoutData, parseWorkoutRecord, type WorkoutRecord } from "./workouts";

export type CorosSyncConflictPayload =
  | { kind: "sleep"; candidate: SleepSessionCandidate; metrics: CorosSleepMetrics }
  | { kind: "workout"; candidate: CorosWorkoutCandidate };

export type CorosSyncConflictData = {
  conflict_version: 1;
  status: "pending" | "resolved";
  resolution?: { action: "accept_source"; resolved_at: string; previous_record: SleepSessionRecord | WorkoutRecord };
  source_id: string;
  source_sha256: string;
  mapping_version: 1;
  record_kind: "sleep" | "workout";
  reason: "source_changed" | "existing_record";
  existing_record_id: string;
  existing_source_sha256: string | null;
  candidate: CorosSyncConflictPayload;
  detected_at: string;
};
export type CorosSyncConflictRecord = WorkspaceRecord<CorosSyncConflictData>;

export function createCorosSyncConflictRecord(input: {
  id: string;
  ownerId: string;
  detectedAt: string;
  data: Omit<CorosSyncConflictData, "conflict_version" | "status" | "detected_at" | "resolution">;
}): CorosSyncConflictRecord {
  return parseCorosSyncConflictRecord(JSON.stringify(createWorkspaceRecord({
    entityType: "coros_sync_conflict", id: input.id, ownerId: input.ownerId, timestamp: input.detectedAt,
    data: { ...input.data, conflict_version: 1, status: "pending", detected_at: input.detectedAt },
  })));
}

export function parseCorosSyncConflictRecord(text: string): CorosSyncConflictRecord {
  const record = parseRecord(text);
  const data = record.data as CorosSyncConflictData;
  const id = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(value);
  const hash = (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
  try {
    if (record.entity_type !== "coros_sync_conflict" || !id(record.id) || !id(record.owner_id)
      || record.deleted_at !== null
      || data.detected_at !== record.created_at || !Number.isFinite(Date.parse(data.detected_at))
      || Object.keys(data).sort().join(",") !== (data.status === "resolved"
        ? "candidate,conflict_version,detected_at,existing_record_id,existing_source_sha256,mapping_version,reason,record_kind,resolution,source_id,source_sha256,status"
        : "candidate,conflict_version,detected_at,existing_record_id,existing_source_sha256,mapping_version,reason,record_kind,source_id,source_sha256,status")
      || data.conflict_version !== 1 || !["pending", "resolved"].includes(data.status) || data.mapping_version !== 1
      || !["source_changed", "existing_record"].includes(data.reason) || !id(data.existing_record_id)
      || !hash(data.source_sha256) || !(data.existing_source_sha256 === null || hash(data.existing_source_sha256))
      || !data.candidate || data.candidate.kind !== data.record_kind) throw new Error();
    if (data.status === "pending") {
      if (record.version !== 1 || record.created_at !== record.updated_at) throw new Error();
    } else {
      const resolution = data.resolution;
      if (record.version !== 2 || !resolution || resolution.action !== "accept_source"
        || Object.keys(resolution).sort().join(",") !== "action,previous_record,resolved_at"
        || resolution.resolved_at !== record.updated_at || !Number.isFinite(Date.parse(resolution.resolved_at))
        || Date.parse(resolution.resolved_at) < Date.parse(data.detected_at) || data.reason !== "source_changed") throw new Error();
      const previous = data.record_kind === "sleep" ? parseSleepSessionRecord(JSON.stringify(resolution.previous_record))
        : parseWorkoutRecord(JSON.stringify(resolution.previous_record));
      const previousSource = "source" in previous.data ? previous.data.source : null;
      if (previous.id !== data.existing_record_id || previous.owner_id !== record.owner_id || previous.deleted_at !== null
        || Date.parse(previous.updated_at) > Date.parse(resolution.resolved_at)
        || previousSource?.source_id !== data.source_id
        || previousSource?.source_sha256 !== data.existing_source_sha256) throw new Error();
    }
    const source = { kind: "coros_mcp" as const, source_id: data.source_id, source_sha256: data.source_sha256, mapping_version: 1 as const, retrieved_at: data.detected_at };
    if (data.candidate.kind === "sleep") {
      if (Object.keys(data.candidate).sort().join(",") !== "candidate,kind,metrics") throw new Error();
      createAutomaticSleepSessionData(data.candidate.candidate, source, data.candidate.metrics);
    } else if (data.candidate.kind === "workout") {
      if (Object.keys(data.candidate).sort().join(",") !== "candidate,kind") throw new Error();
      createAutomaticWorkoutData(data.candidate.candidate, source);
    } else throw new Error();
  } catch { throw new Error("INVALID_COROS_SYNC_CONFLICT_RECORD"); }
  return record as CorosSyncConflictRecord;
}

/** Apply an explicitly accepted source revision and retain the original record as audit evidence. */
export function acceptCorosSourceRevision(conflict: CorosSyncConflictRecord, current: SleepSessionRecord | WorkoutRecord, resolvedAt: string) {
  parseCorosSyncConflictRecord(JSON.stringify(conflict));
  const data = conflict.data;
  const currentSource = "source" in current.data ? current.data.source : null;
  if (data.status !== "pending" || data.reason !== "source_changed" || current.deleted_at !== null
    || current.id !== data.existing_record_id || current.owner_id !== conflict.owner_id
    || current.entity_type !== (data.record_kind === "sleep" ? "sleep_session" : "workout")
    || currentSource?.source_id !== data.source_id
    || currentSource?.source_sha256 !== data.existing_source_sha256) throw new Error("COROS_CONFLICT_RECORD_CHANGED");
  const source = { kind: "coros_mcp" as const, source_id: data.source_id, source_sha256: data.source_sha256,
    mapping_version: 1 as const, retrieved_at: data.detected_at };
  const nextData = data.candidate.kind === "sleep"
    ? createAutomaticSleepSessionData(data.candidate.candidate, source, data.candidate.metrics)
    : createAutomaticWorkoutData(data.candidate.candidate, source);
  const next = updateWorkspaceRecord<Record<string, unknown>>(current, nextData, resolvedAt);
  const record = data.record_kind === "sleep" ? parseSleepSessionRecord(JSON.stringify(next)) : parseWorkoutRecord(JSON.stringify(next));
  const resolved = parseCorosSyncConflictRecord(JSON.stringify(updateWorkspaceRecord(conflict, { ...data, status: "resolved",
    resolution: { action: "accept_source", resolved_at: resolvedAt, previous_record: current } }, resolvedAt)));
  return { record, conflict: resolved };
}
