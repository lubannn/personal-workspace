import { previewCorosActivityFile, type CorosFilePreflight, type CorosImportFile } from "./coros-file-preflight";
import { prepareCorosWorkoutStagingWrite } from "./coros-workout-staging-write";
import type { CorosWorkoutStagingPlan, CorosWorkoutStagingPlanItem } from "./coros-workout-staging-plan";
import type { GitHubContentsAdapter } from "./github-contents";
import type { HealthStagingRecord } from "./health-staging-records";
import { prepareWorkoutConfirmationTransaction } from "./workout-confirmation-transaction";
import type { WorkoutRecord } from "./workouts";

export const COROS_BATCH_MAX_FILES = 200;
export const COROS_BATCH_COMMIT_SIZE = 16;

type BatchAdapter = Pick<GitHubContentsAdapter, "readBranchSnapshot" | "readText" | "writeAtomicFiles">;
type SyncedStaging = { record: HealthStagingRecord; path: string; blobSha: string };
type SyncedWorkout = { record: WorkoutRecord; path: string; blobSha: string };

export type CorosBatchPreviewRow = {
  name: string;
  preview: CorosFilePreflight | null;
  error: string | null;
};

export async function previewCorosBatch(
  files: readonly CorosImportFile[],
  timezone: string,
  onProgress?: (done: number, total: number) => void,
): Promise<CorosBatchPreviewRow[]> {
  if (files.length === 0 || files.length > COROS_BATCH_MAX_FILES) throw new Error("COROS_BATCH_FILE_COUNT_INVALID");
  const rows: CorosBatchPreviewRow[] = [];
  for (const file of files) {
    try {
      rows.push({ name: file.name, preview: await previewCorosActivityFile(file, { timezone }), error: null });
    } catch (error) {
      rows.push({ name: file.name, preview: null, error: error instanceof Error ? error.message : "COROS_IMPORT_UNKNOWN_ERROR" });
    }
    onProgress?.(rows.length, files.length);
  }
  return rows;
}

export type CorosBatchSelection = {
  items: CorosWorkoutStagingPlanItem[];
  acceptedFiles: number;
  blockedFiles: number;
  repeatedFiles: number;
  suspectedDuplicateActivities: number;
  rowStatuses: string[];
};

export function selectCorosBatchItems(rows: readonly CorosBatchPreviewRow[]): CorosBatchSelection {
  const items: CorosWorkoutStagingPlanItem[] = [];
  const sourceHashes = new Set<string>();
  const activitySignatures = new Set<string>();
  let acceptedFiles = 0;
  let blockedFiles = 0;
  let repeatedFiles = 0;
  let suspectedDuplicateActivities = 0;
  const rowStatuses: string[] = [];

  for (const row of rows) {
    const preview = row.preview;
    if (!preview?.readyForMapping || !preview.stagingPlan.readyForProtocolActivation) {
      blockedFiles += 1;
      rowStatuses.push("未通过预检，不导入");
      continue;
    }
    if (sourceHashes.has(preview.source.sha256)) {
      repeatedFiles += 1;
      rowStatuses.push("与本批已选文件内容相同，跳过");
      continue;
    }
    sourceHashes.add(preview.source.sha256);
    let accepted = false;
    let ambiguous = 0;
    for (const item of preview.stagingPlan.items) {
      const activity = item.proposedData.normalized_json;
      const signature = `${activity.start_at}|${activity.end_at}|${activity.activity_type}`;
      if (activitySignatures.has(signature)) {
        suspectedDuplicateActivities += 1;
        ambiguous += 1;
        continue;
      }
      activitySignatures.add(signature);
      items.push(item);
      accepted = true;
    }
    if (accepted) acceptedFiles += 1;
    rowStatuses.push(ambiguous ? accepted ? `部分可导入，跳过 ${ambiguous} 条疑似重复活动` : "疑似与本批其他文件重复，跳过" : "可导入");
  }
  return { items, acceptedFiles, blockedFiles, repeatedFiles, suspectedDuplicateActivities, rowStatuses };
}

function stagingChunkPlan(items: CorosWorkoutStagingPlanItem[]): CorosWorkoutStagingPlan {
  return {
    planVersion: "1",
    protocolDecision: {
      stagingEntity: "health_staging_record",
      canonicalEntity: "workout",
      stagingProtocolRegistered: true,
      canonicalProtocolRegistered: false,
      reason: "Batch uses the same validated create-only Workout staging protocol as a single file.",
    },
    items,
    skippedDuplicateCount: 0,
    retentionPolicy: {
      retained: ["source_sha256", "format", "parser_version", "mapping_version", "batch_identity", "workout_summary", "diagnostics"],
      discarded: ["original_file", "file_name", "gps_coordinates", "trackpoint_series", "fit_developer_fields", "tcx_extensions"],
    },
    exactConfirmationPreview: "Batch records are reviewed before the first write.",
    readyForProtocolActivation: items.length > 0,
    localOnly: true,
    protocolAccepted: true,
    commitEnabled: false,
  };
}

export async function stageCorosBatch(input: {
  adapter: BatchAdapter;
  ownerId: string;
  items: readonly CorosWorkoutStagingPlanItem[];
  onCommitted?: (created: SyncedStaging[], completed: number, total: number) => void;
}) {
  const paths = new Set<string>();
  for (const item of input.items) {
    if (paths.has(item.path)) throw new Error("COROS_BATCH_DUPLICATE_PATH");
    paths.add(item.path);
  }
  let created = 0;
  let alreadyPresent = 0;
  for (let offset = 0; offset < input.items.length; offset += COROS_BATCH_COMMIT_SIZE) {
    const chunk = input.items.slice(offset, offset + COROS_BATCH_COMMIT_SIZE);
    const prepared = await prepareCorosWorkoutStagingWrite({ adapter: input.adapter, ownerId: input.ownerId, plan: stagingChunkPlan(chunk) });
    if (prepared.files.length) {
      const result = await input.adapter.writeAtomicFiles({
        files: prepared.files.map(({ path, text }) => ({ path, text })),
        message: `coros: stage ${prepared.files.length} workouts`,
        expectedHeadCommitSha: prepared.snapshot.headCommitSha,
        baseTreeSha: prepared.snapshot.rootTreeSha,
        inlineContent: true,
      });
      const blobByPath = new Map(result.files.map((file) => [file.path, file.blobSha]));
      const saved = prepared.files.map(({ path, record }) => ({ path, record, blobSha: blobByPath.get(path)! }));
      created += saved.length;
      input.onCommitted?.(saved, offset + chunk.length, input.items.length);
    } else {
      input.onCommitted?.([], offset + chunk.length, input.items.length);
    }
    alreadyPresent += prepared.alreadyPresent;
  }
  return { created, alreadyPresent };
}

export async function confirmCorosBatch(input: {
  adapter: BatchAdapter;
  ownerId: string;
  staging: readonly SyncedStaging[];
  onCommitted?: (staging: SyncedStaging[], workouts: SyncedWorkout[], completed: number, total: number) => void;
}) {
  const paths = new Set<string>();
  for (const item of input.staging) {
    if (paths.has(item.path)) throw new Error("COROS_BATCH_DUPLICATE_PATH");
    paths.add(item.path);
  }
  let confirmed = 0;
  for (let offset = 0; offset < input.staging.length; offset += COROS_BATCH_COMMIT_SIZE) {
    const chunk = input.staging.slice(offset, offset + COROS_BATCH_COMMIT_SIZE);
    const snapshot = await input.adapter.readBranchSnapshot();
    const prepared = [];
    for (const staging of chunk) {
      prepared.push(await prepareWorkoutConfirmationTransaction({ adapter: input.adapter, staging, ownerId: input.ownerId, snapshot }));
    }
    const files = prepared.flatMap((item) => [
      { path: item.staging.path, text: item.staging.text },
      { path: item.workout.path, text: item.workout.text },
    ]);
    const result = await input.adapter.writeAtomicFiles({
      files,
      message: `workout: confirm ${prepared.length} COROS activities`,
      expectedHeadCommitSha: snapshot.headCommitSha,
      baseTreeSha: snapshot.rootTreeSha,
      inlineContent: true,
    });
    const blobByPath = new Map(result.files.map((file) => [file.path, file.blobSha]));
    const updatedStaging = prepared.map((item) => ({ record: item.staging.record, path: item.staging.path, blobSha: blobByPath.get(item.staging.path)! }));
    const workouts = prepared.map((item) => ({ record: item.workout.record, path: item.workout.path, blobSha: blobByPath.get(item.workout.path)! }));
    confirmed += prepared.length;
    input.onCommitted?.(updatedStaging, workouts, confirmed, input.staging.length);
  }
  return { confirmed };
}
