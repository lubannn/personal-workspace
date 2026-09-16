import { describe, expect, it, vi } from "vitest";

import { GitHubConflictError } from "./github-contents";
import { createLearningAreaData, setLearningAreaStatus } from "./learning-areas";
import { createLearningGoalData, setLearningGoalStatus } from "./learning-goals";
import { writeLearningChildWithParents } from "./learning-parent-write";
import { createWorkspaceRecord, serializeRecord, setWorkspaceRecordDeleted } from "./protocol";

const timestamp = "2026-09-16T10:00:00.000Z";
const area = createWorkspaceRecord({ entityType: "learning_area", id: "learning_area_test", ownerId: "owner_1", timestamp, data: createLearningAreaData({ name: "韩语", description_markdown: "", area_type: "language", icon: null, color: null }) });
const goal = createWorkspaceRecord({ entityType: "learning_goal", id: "learning_goal_test", ownerId: "owner_1", timestamp, data: createLearningGoalData({ learning_area_id: area.id, title: "练习", description: "", target_date: null, success_criteria_markdown: "" }) });
const areaItem = { record: area, path: `data/learning-areas/${area.id}.json`, blobSha: "area-sha" };
const goalItem = { record: goal, path: `data/learning-goals/${goal.id}.json`, blobSha: "goal-sha" };
const child = { path: "data/learning-activities/learning_activity_test.json", blobSha: "child-sha" };

function fixture(currentArea = area, currentGoal = goal, currentChildSha = child.blobSha) {
  const adapter = {
    readBranchSnapshot: vi.fn().mockResolvedValue({ headCommitSha: "head-one", rootTreeSha: "tree-one" }),
    readText: vi.fn().mockImplementation(async (path: string, ref: string) => {
      expect(ref).toBe("head-one");
      if (path === areaItem.path) return { path, blobSha: currentArea === area ? areaItem.blobSha : "new-area-sha", text: serializeRecord(currentArea) };
      if (path === goalItem.path) return { path, blobSha: currentGoal === goal ? goalItem.blobSha : "new-goal-sha", text: serializeRecord(currentGoal) };
      return { path, blobSha: currentChildSha, text: "{}" };
    }),
    writeAtomicFiles: vi.fn().mockResolvedValue({ files: [{ path: child.path, blobSha: "updated-child-sha" }] }),
  };
  return adapter;
}

function write(adapter: ReturnType<typeof fixture>) {
  return writeLearningChildWithParents({ adapter, ownerId: "owner_1", area: areaItem, goal: goalItem, child, text: "updated", message: "learning activity: edit test" });
}

describe("Learning child parent-aware writes", () => {
  it("pins parent and child checks to one HEAD and commits against that HEAD", async () => {
    const adapter = fixture();
    await expect(write(adapter)).resolves.toEqual({ path: child.path, blobSha: "updated-child-sha" });
    expect(adapter.readText).toHaveBeenCalledTimes(3);
    expect(adapter.writeAtomicFiles).toHaveBeenCalledWith({ files: [{ path: child.path, text: "updated" }], message: "learning activity: edit test", expectedHeadCommitSha: "head-one", baseTreeSha: "tree-one" });
  });

  it("refuses a parent archived or deleted on another device", async () => {
    for (const changed of [setLearningAreaStatus(area, "archived", "2026-09-16T11:00:00.000Z"), setWorkspaceRecordDeleted(area, "2026-09-16T11:00:00.000Z", "2026-09-16T11:00:00.000Z")]) {
      const adapter = fixture(changed);
      await expect(write(adapter)).rejects.toBeInstanceOf(GitHubConflictError);
      expect(adapter.writeAtomicFiles).not.toHaveBeenCalled();
    }
    const adapter = fixture(area, setLearningGoalStatus(goal, "archived", "2026-09-16T11:00:00.000Z"));
    await expect(write(adapter)).rejects.toBeInstanceOf(GitHubConflictError);
    expect(adapter.writeAtomicFiles).not.toHaveBeenCalled();
  });

  it("refuses a stale child blob even when parents are unchanged", async () => {
    const adapter = fixture(area, goal, "new-child-sha");
    await expect(write(adapter)).rejects.toBeInstanceOf(GitHubConflictError);
    expect(adapter.writeAtomicFiles).not.toHaveBeenCalled();
  });

  it("propagates a branch-head race without claiming a successful write", async () => {
    const adapter = fixture();
    adapter.writeAtomicFiles.mockRejectedValueOnce(new GitHubConflictError());
    await expect(write(adapter)).rejects.toBeInstanceOf(GitHubConflictError);
  });
});
