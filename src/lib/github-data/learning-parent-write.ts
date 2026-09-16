import { GitHubConflictError, type GitHubContentsAdapter } from "./github-contents";
import { parseLearningAreaRecord, type LearningAreaRecord } from "./learning-areas";
import { parseLearningGoalRecord, type LearningGoalRecord } from "./learning-goals";

type SyncedRecord<T> = { record: T; path: string; blobSha: string };
type LearningWriteAdapter = Pick<GitHubContentsAdapter, "readBranchSnapshot" | "readText" | "writeAtomicFiles">;

// A child update must not outlive the parent state shown to this device.
// Pin every read to one HEAD, then advance that HEAD only if it is still current.
export async function writeLearningChildWithParents(input: {
  adapter: LearningWriteAdapter;
  ownerId: string;
  area: SyncedRecord<LearningAreaRecord>;
  goal?: SyncedRecord<LearningGoalRecord> | null;
  child: { path: string; blobSha: string };
  text: string;
  message: string;
}) {
  const { adapter, area, goal, child } = input;
  const snapshot = await adapter.readBranchSnapshot();
  const [areaFile, goalFile, childFile] = await Promise.all([
    adapter.readText(area.path, snapshot.headCommitSha),
    goal ? adapter.readText(goal.path, snapshot.headCommitSha) : Promise.resolve(null),
    adapter.readText(child.path, snapshot.headCommitSha),
  ]);
  const currentArea = parseLearningAreaRecord(areaFile.text);
  if (areaFile.blobSha !== area.blobSha || currentArea.owner_id !== input.ownerId ||
    currentArea.deleted_at !== null || currentArea.data.status !== "active") {
    throw new GitHubConflictError("LearningArea changed before child update.");
  }
  if (goal && goalFile) {
    const currentGoal = parseLearningGoalRecord(goalFile.text);
    if (goalFile.blobSha !== goal.blobSha || currentGoal.owner_id !== input.ownerId ||
      currentGoal.deleted_at !== null || currentGoal.data.status === "archived" ||
      currentGoal.data.learning_area_id !== area.record.id) {
      throw new GitHubConflictError("LearningGoal changed before child update.");
    }
  }
  if (childFile.blobSha !== child.blobSha) {
    throw new GitHubConflictError("Learning child changed before update.");
  }
  const result = await adapter.writeAtomicFiles({
    files: [{ path: child.path, text: input.text }],
    message: input.message,
    expectedHeadCommitSha: snapshot.headCommitSha,
    baseTreeSha: snapshot.rootTreeSha,
  });
  return result.files[0]!;
}
