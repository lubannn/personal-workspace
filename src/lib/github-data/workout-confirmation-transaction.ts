import type { GitHubContentsAdapter } from "./github-contents";
import { confirmWorkoutHealthStaging, parseHealthStagingRecord, type HealthStagingRecord } from "./health-staging-records";
import { createWorkspaceRecord, recordPath, serializeRecord } from "./protocol";
import { createConfirmedWorkoutData, parseWorkoutRecord, type WorkoutRecord } from "./workouts";
import { inspectWorkoutConfirmationPreconditions } from "./workout-confirmation-preflight";

type ConfirmationAdapter = Pick<GitHubContentsAdapter, "readBranchSnapshot" | "readText" | "writeAtomicFiles">;
type SyncedStaging = { record: HealthStagingRecord; path: string; blobSha: string };

export type PreparedWorkoutConfirmation = {
  snapshot: Awaited<ReturnType<ConfirmationAdapter["readBranchSnapshot"]>>;
  staging: { record: HealthStagingRecord; path: string; text: string };
  workout: { record: WorkoutRecord; path: string; text: string };
  confirmationText: string;
};

export async function prepareWorkoutConfirmationTransaction(input: {
  adapter: ConfirmationAdapter;
  staging: SyncedStaging;
  ownerId: string;
  timestamp?: string;
}): Promise<PreparedWorkoutConfirmation> {
  const checked = await inspectWorkoutConfirmationPreconditions(input);
  const timestamp = input.timestamp ?? new Date().toISOString();
  const reviewed = confirmWorkoutHealthStaging(checked.staging.record, timestamp);
  const workout = createWorkspaceRecord({
    entityType: "workout", id: checked.canonicalId, ownerId: input.ownerId, timestamp,
    data: createConfirmedWorkoutData(checked.staging.record, timestamp),
  });
  const stagingPath = recordPath("health_staging_record", reviewed.id);
  const workoutPath = recordPath("workout", workout.id);
  if (stagingPath !== checked.staging.path || workoutPath !== checked.canonicalPath) throw new Error("WORKOUT_CONFIRMATION_PATH_CHANGED");
  const stagingText = serializeRecord(reviewed);
  const workoutText = serializeRecord(workout);
  parseHealthStagingRecord(stagingText);
  parseWorkoutRecord(workoutText);
  return {
    snapshot: checked.snapshot,
    staging: { record: reviewed, path: stagingPath, text: stagingText },
    workout: { record: workout, path: workoutPath, text: workoutText },
    confirmationText: `${checked.confirmationText}\n这次操作将确认暂存记录并创建正式 Workout，且只在同一个 Git 提交中生效。确认执行吗？`,
  };
}

export async function commitWorkoutConfirmationTransaction(adapter: ConfirmationAdapter, prepared: PreparedWorkoutConfirmation) {
  const result = await adapter.writeAtomicFiles({
    files: [{ path: prepared.staging.path, text: prepared.staging.text }, { path: prepared.workout.path, text: prepared.workout.text }],
    message: `workout: confirm ${prepared.staging.record.id}`,
    expectedHeadCommitSha: prepared.snapshot.headCommitSha,
    baseTreeSha: prepared.snapshot.rootTreeSha,
  });
  return {
    staging: { record: prepared.staging.record, path: prepared.staging.path, blobSha: result.files.find((file) => file.path === prepared.staging.path)!.blobSha },
    workout: { record: prepared.workout.record, path: prepared.workout.path, blobSha: result.files.find((file) => file.path === prepared.workout.path)!.blobSha },
    commitSha: result.commitSha,
  };
}
