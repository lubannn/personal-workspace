import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord, setWorkspaceRecordDeleted } from "./protocol";
import {
  activeLearningGoals,
  archivedLearningGoals,
  completedLearningGoals,
  createLearningGoalData,
  parseLearningGoalRecord,
  setLearningGoalStatus,
  trashedLearningGoals,
  updateLearningGoalDetails,
} from "./learning-goals";

function goal(id: string, title = "完成统计学基础") {
  return createWorkspaceRecord({
    entityType: "learning_goal",
    id,
    ownerId: "github_lubannn",
    timestamp: "2026-09-15T08:00:00.000Z",
    data: createLearningGoalData({
      learning_area_id: "learning_area_data",
      title,
      description: "掌握描述统计与推断统计",
      target_date: "2026-12-31",
      success_criteria_markdown: "- 完成课程\n- 独立完成练习",
    }),
  });
}

describe("LearningGoal canonical records", () => {
  it("round-trips a user-defined area reference and v1 fields", () => {
    const record = goal("learning_goal_statistics");
    expect(parseLearningGoalRecord(serializeRecord(record))).toEqual(record);
    expect(record.data).toMatchObject({ learning_goal_version: 1, learning_area_id: "learning_area_data", status: "active" });
  });

  it("updates details without moving the goal to another area", () => {
    const updated = updateLearningGoalDetails(goal("learning_goal_edit"), {
      title: "完成概率论基础",
      description: "从概率开始",
      target_date: null,
      success_criteria_markdown: "完成全部章节",
    }, "2026-09-15T09:00:00.000Z");
    expect(updated).toMatchObject({
      version: 2,
      updated_at: "2026-09-15T09:00:00.000Z",
      data: { learning_area_id: "learning_area_data", title: "完成概率论基础", target_date: null },
    });
  });

  it("supports completion, archival and soft-delete views", () => {
    const active = goal("learning_goal_active", "A");
    const completed = setLearningGoalStatus(goal("learning_goal_completed", "B"), "completed", "2026-09-15T09:00:00.000Z");
    const archived = setLearningGoalStatus(goal("learning_goal_archived", "C"), "archived", "2026-09-15T10:00:00.000Z");
    const trashed = setWorkspaceRecordDeleted(goal("learning_goal_trashed", "D"), "2026-09-15T11:00:00.000Z", "2026-09-15T11:00:00.000Z");
    const records = [archived, trashed, completed, active];
    expect(activeLearningGoals(records)).toEqual([active]);
    expect(completedLearningGoals(records)).toEqual([completed]);
    expect(archivedLearningGoals(records)).toEqual([archived]);
    expect(trashedLearningGoals(records)).toEqual([trashed]);
  });

  it("rejects invalid references, dates, statuses and unknown fields", () => {
    expect(() => createLearningGoalData({ learning_area_id: "bad id", title: "目标", description: "", target_date: null, success_criteria_markdown: "" })).toThrow("INVALID_LEARNING_GOAL_DETAILS");
    expect(() => createLearningGoalData({ learning_area_id: "learning_area_data", title: " ", description: "", target_date: "2026-02-30", success_criteria_markdown: "" })).toThrow("INVALID_LEARNING_GOAL_DETAILS");
    expect(() => setLearningGoalStatus(goal("learning_goal_status"), "paused" as never)).toThrow("INVALID_LEARNING_GOAL_STATUS");
    const invalid = { ...goal("learning_goal_unknown"), data: { ...goal("learning_goal_unknown").data, surprise: true } };
    expect(() => parseLearningGoalRecord(serializeRecord(invalid))).toThrow("INVALID_LEARNING_GOAL_RECORD");
  });
});
