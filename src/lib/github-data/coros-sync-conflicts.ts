import type { CorosWorkoutCandidate, SleepSessionCandidate } from "./health-staging-records";
import { createWorkspaceRecord, parseRecord, type WorkspaceRecord } from "./protocol";
import { createAutomaticSleepSessionData, type CorosSleepMetrics } from "./sleep-sessions";
import { createAutomaticWorkoutData } from "./workouts";

export type CorosSyncConflictPayload =
  | { kind: "sleep"; candidate: SleepSessionCandidate; metrics: CorosSleepMetrics }
  | { kind: "workout"; candidate: CorosWorkoutCandidate };

export type CorosSyncConflictData = {
  conflict_version: 1;
  status: "pending";
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
  data: Omit<CorosSyncConflictData, "conflict_version" | "status" | "detected_at">;
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
      || record.version !== 1 || record.deleted_at !== null || record.created_at !== record.updated_at
      || data.detected_at !== record.created_at || !Number.isFinite(Date.parse(data.detected_at))
      || Object.keys(data).sort().join(",") !== "candidate,conflict_version,detected_at,existing_record_id,existing_source_sha256,mapping_version,reason,record_kind,source_id,source_sha256,status"
      || data.conflict_version !== 1 || data.status !== "pending" || data.mapping_version !== 1
      || !["source_changed", "existing_record"].includes(data.reason) || !id(data.existing_record_id)
      || !hash(data.source_sha256) || !(data.existing_source_sha256 === null || hash(data.existing_source_sha256))
      || !data.candidate || data.candidate.kind !== data.record_kind) throw new Error();
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
