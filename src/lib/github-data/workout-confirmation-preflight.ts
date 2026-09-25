import { GitHubConflictError, GitHubDataError, type GitHubContentsAdapter } from "./github-contents";
import { parseHealthStagingRecord, type HealthStagingRecord } from "./health-staging-records";
import { recordPath } from "./protocol";

type ReadOnlyAdapter = Pick<GitHubContentsAdapter, "readBranchSnapshot" | "readText">;
type SyncedStaging = { record: HealthStagingRecord; path: string; blobSha: string };

export type WorkoutConfirmationPreflight = {
  snapshot: Awaited<ReturnType<ReadOnlyAdapter["readBranchSnapshot"]>>;
  staging: SyncedStaging;
  canonicalId: string;
  canonicalPath: string;
  confirmationText: string;
};

// Read-only preflight; the caller must obtain action-time confirmation before commit.
export async function inspectWorkoutConfirmationPreconditions(input: {
  adapter: ReadOnlyAdapter;
  staging: SyncedStaging;
  ownerId: string;
}): Promise<WorkoutConfirmationPreflight> {
  const { adapter, staging, ownerId } = input;
  if (staging.record.data.health_type !== "workout" || staging.record.owner_id !== ownerId ||
    staging.path !== recordPath("health_staging_record", staging.record.id)) {
    throw new GitHubConflictError("Workout staging identity does not match the connected workspace.");
  }
  const snapshot = await adapter.readBranchSnapshot();
  const latestFile = await adapter.readText(staging.path, snapshot.headCommitSha);
  if (latestFile.blobSha !== staging.blobSha) throw new GitHubConflictError("Workout staging changed after it was loaded.");
  let latest: HealthStagingRecord;
  try { latest = parseHealthStagingRecord(latestFile.text); }
  catch { throw new GitHubConflictError("Workout staging is invalid at the current HEAD."); }
  if (latest.id !== staging.record.id || latest.owner_id !== ownerId || latest.deleted_at !== null ||
    latest.data.health_type !== "workout" || latest.data.status !== "pending" ||
    latest.id !== `coros_workout_${latest.data.import_key}`) {
    throw new GitHubConflictError("Workout staging is no longer eligible for confirmation.");
  }
  const canonicalId = `workout_${latest.data.import_key}`;
  const canonicalPath = recordPath("workout", canonicalId);
  try {
    await adapter.readText(canonicalPath, snapshot.headCommitSha);
    throw new GitHubConflictError("The canonical Workout path already exists.");
  } catch (error) {
    if (!(error instanceof GitHubDataError) || error.code !== "GITHUB_NOT_FOUND") throw error;
  }
  const workout = latest.data.normalized_json;
  const confirmationText = `待确认 Workout：${workout.activity_type} · ${workout.start_at} · ${workout.duration_seconds} 秒 · ${workout.distance === null ? "无距离" : `${workout.distance} m`}。\n来源 SHA-256：${latest.data.source.source_sha256}\n暂存记录：${staging.path}\n正式记录：${canonicalPath}\n只保存活动摘要，不保存原始文件、文件名或 GPS 轨迹。确认后必须在同一提交中更新暂存状态并创建正式记录。`;
  return { snapshot, staging: { record: latest, path: staging.path, blobSha: latestFile.blobSha }, canonicalId, canonicalPath, confirmationText };
}
