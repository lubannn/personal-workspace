import { recordPath } from "./protocol";
import type { CorosMappingDryRun, CorosWorkoutProposal } from "./coros-activity-mapping";

export const COROS_WORKOUT_STAGING_PLAN_VERSION = "1";

export const COROS_WORKOUT_RETENTION_POLICY = {
  retained: ["source_sha256", "format", "parser_version", "mapping_version", "batch_identity", "workout_summary", "diagnostics"],
  discarded: ["original_file", "file_name", "gps_coordinates", "trackpoint_series", "fit_developer_fields", "tcx_extensions"],
} as const;

export type ProposedCorosWorkoutStagingData = {
  health_staging_version: 1;
  source: {
    kind: "coros_file";
    label: "COROS FIT file" | "COROS TCX file";
    format: "fit" | "tcx";
    source_sha256: string;
    parser_version: string;
    mapping_version: string;
    batch_identity: string;
  };
  raw_record_id: null;
  health_type: "workout";
  normalized_json: Omit<CorosWorkoutProposal, "duplicate" | "duplicateReason" | "diagnostics" | "confirmation_status" | "staging_record_id">;
  import_key: string;
  classifier_version: "coros-mapping-v1";
  classification: "workout";
  confidence: null;
  status: "pending";
  diagnostics_json: Array<{ code: string; message: string }>;
  reviewed_at: null;
  review_reason: null;
  canonical_record_id: null;
};

export type CorosWorkoutStagingPlanItem = {
  stagingRecordId: string;
  path: string;
  writeMode: "create_only";
  expectedBlobSha: null;
  payloadSha256: string;
  proposedData: ProposedCorosWorkoutStagingData;
};

export type CorosWorkoutStagingPlan = {
  planVersion: typeof COROS_WORKOUT_STAGING_PLAN_VERSION;
  protocolDecision: {
    stagingEntity: "health_staging_record";
    canonicalEntity: "workout";
    canonicalProtocolRegistered: false;
    reason: string;
  };
  items: CorosWorkoutStagingPlanItem[];
  skippedDuplicateCount: number;
  retentionPolicy: typeof COROS_WORKOUT_RETENTION_POLICY;
  exactConfirmationPreview: string;
  readyForProtocolActivation: boolean;
  localOnly: true;
  protocolAccepted: false;
  commitEnabled: false;
};

export async function planCorosWorkoutStaging(input: {
  format: "fit" | "tcx";
  sourceSha256: string;
  parserVersion: string;
  mapping: CorosMappingDryRun;
}): Promise<CorosWorkoutStagingPlan> {
  assertSha256(input.sourceSha256);
  const eligible = input.mapping.candidates.filter((candidate) => !candidate.duplicate);
  const items = await Promise.all(eligible.map(async (candidate) => {
    const stagingRecordId = `coros_workout_${candidate.importKey}`;
    const proposedData: ProposedCorosWorkoutStagingData = {
      health_staging_version: 1,
      source: {
        kind: "coros_file",
        label: input.format === "fit" ? "COROS FIT file" : "COROS TCX file",
        format: input.format,
        source_sha256: input.sourceSha256,
        parser_version: input.parserVersion,
        mapping_version: input.mapping.mappingVersion,
        batch_identity: input.mapping.batchIdentity,
      },
      raw_record_id: null,
      health_type: "workout",
      normalized_json: normalizedCandidate(candidate),
      import_key: candidate.importKey,
      classifier_version: "coros-mapping-v1",
      classification: "workout",
      confidence: null,
      status: "pending",
      diagnostics_json: candidate.diagnostics.filter((item) => item.code !== "ACTIVITY_DUPLICATE").map((item) => ({ code: item.code, message: item.message })),
      reviewed_at: null,
      review_reason: null,
      canonical_record_id: null,
    };
    return {
      stagingRecordId,
      path: recordPath("health_staging_record", stagingRecordId),
      writeMode: "create_only" as const,
      expectedBlobSha: null,
      payloadSha256: await sha256Hex(stableJson(proposedData)),
      proposedData,
    };
  }));

  return {
    planVersion: COROS_WORKOUT_STAGING_PLAN_VERSION,
    protocolDecision: {
      stagingEntity: "health_staging_record",
      canonicalEntity: "workout",
      canonicalProtocolRegistered: false,
      reason: "Workout 先复用 HealthStagingRecord 审核边界；canonical workout 仅在确认/导出/恢复语义同时就绪后注册。",
    },
    items,
    skippedDuplicateCount: input.mapping.candidates.length - eligible.length,
    retentionPolicy: COROS_WORKOUT_RETENTION_POLICY,
    exactConfirmationPreview: confirmationPreview(items),
    readyForProtocolActivation: items.length > 0 && input.mapping.readyForStagingDesign,
    localOnly: true,
    protocolAccepted: false,
    commitEnabled: false,
  };
}

function normalizedCandidate(candidate: CorosWorkoutProposal): ProposedCorosWorkoutStagingData["normalized_json"] {
  return {
    importKey: candidate.importKey,
    activity_type: candidate.activity_type,
    start_at: candidate.start_at,
    end_at: candidate.end_at,
    timezone: candidate.timezone,
    duration_seconds: candidate.duration_seconds,
    distance: candidate.distance,
    distance_unit: candidate.distance_unit,
    training_load: candidate.training_load,
    metrics_json: candidate.metrics_json,
  };
}

function confirmationPreview(items: CorosWorkoutStagingPlanItem[]) {
  if (items.length === 0) return "没有可写入的非重复 Workout staging 候选。";
  const paths = items.map((item) => item.path).join("、");
  return `未来若启用，将以 create-only 方式向 Private 数据仓库创建 ${items.length} 条 pending HealthStagingRecord：${paths}。只保存活动摘要与来源哈希，不保存原始 FIT/TCX、文件名、GPS 坐标或轨迹点序列；执行时必须重新获得精确确认。`;
}

function stableJson(value: unknown) { return `${JSON.stringify(value)}\n`; }
function assertSha256(value: string) { if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error("INVALID_COROS_SOURCE_SHA256"); }
async function sha256Hex(value: string) { const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
