import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord, setWorkspaceRecordDeleted } from "./protocol";
import {
  activeLearningActivities,
  createLearningActivityData,
  parseLearningActivityRecord,
  trashedLearningActivities,
  updateLearningActivityDetails,
} from "./learning-activities";

const fields = {
  learning_area_id: "learning_area_data",
  goal_id: "learning_goal_stats",
  activity_type: "course",
  title: "完成概率论第三讲",
  occurred_at: "2026-09-15T10:30:00.000Z",
  duration_minutes: 45,
  quantity: 12,
  unit: "pages",
  notes_markdown: "整理了贝叶斯公式。",
  linked_task_id: null,
  source_ref: "课程：统计学基础",
} as const;

function record(id: string, occurredAt: string = fields.occurred_at) {
  return createWorkspaceRecord({
    entityType: "learning_activity",
    id,
    ownerId: "github_lubannn",
    timestamp: "2026-09-15T11:00:00.000Z",
    data: createLearningActivityData({ ...fields, occurred_at: occurredAt }),
  });
}

describe("LearningActivity v1", () => {
  it("creates, serializes, parses and version-edits a manual activity", () => {
    const created = record("learning_activity_01");
    expect(parseLearningActivityRecord(serializeRecord(created))).toEqual(created);
    const updated = updateLearningActivityDetails(created, {
      ...fields,
      title: "完成概率论第四讲",
    }, "2026-09-15T12:00:00.000Z");
    expect(updated).toMatchObject({ version: 2, data: { learning_area_id: fields.learning_area_id, goal_id: fields.goal_id, title: "完成概率论第四讲" } });
  });

  it("rejects invalid duration, loose instants and incomplete quantity units", () => {
    expect(() => createLearningActivityData({ ...fields, duration_minutes: 0 })).toThrow("INVALID_LEARNING_ACTIVITY_DETAILS");
    expect(() => createLearningActivityData({ ...fields, occurred_at: "2026-09-15" })).toThrow("INVALID_LEARNING_ACTIVITY_DETAILS");
    expect(() => createLearningActivityData({ ...fields, unit: null })).toThrow("INVALID_LEARNING_ACTIVITY_DETAILS");
  });

  it("sorts active records newest-first and keeps trash recoverable", () => {
    const older = record("learning_activity_old", "2026-09-14T10:00:00.000Z");
    const newer = record("learning_activity_new", "2026-09-15T10:00:00.000Z");
    const trashed = setWorkspaceRecordDeleted(older, "2026-09-16T00:00:00.000Z", "2026-09-16T00:00:00.000Z");
    expect(activeLearningActivities([older, newer, trashed]).map((item) => item.id)).toEqual([newer.id, older.id]);
    expect(trashedLearningActivities([older, newer, trashed]).map((item) => item.id)).toEqual([trashed.id]);
  });
});
