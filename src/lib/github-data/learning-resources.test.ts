import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord, setWorkspaceRecordDeleted } from "./protocol";
import { activeLearningResources, archivedLearningResources, completedLearningResources, createLearningResourceData, parseLearningResourceRecord, setLearningResourceStatus, trashedLearningResources, updateLearningResourceDetails } from "./learning-resources";

const fields = { learning_area_id: "learning_area_data", title: "统计学公开课", resource_type: "course", url: "https://example.com/statistics", notes_markdown: "只保存元数据。" } as const;
function record(id: string) { return createWorkspaceRecord({ entityType: "learning_resource", id, ownerId: "github_lubannn", timestamp: "2026-09-15T13:00:00.000Z", data: createLearningResourceData(fields) }); }

describe("LearningResource v1", () => {
  it("creates, parses and version-edits metadata without changing Area", () => {
    const created = record("learning_resource_course");
    expect(parseLearningResourceRecord(serializeRecord(created))).toEqual(created);
    const updated = updateLearningResourceDetails(created, { title: "统计学公开课（更新）", resource_type: "course", url: fields.url, notes_markdown: "更新笔记" }, "2026-09-15T14:00:00.000Z");
    expect(updated).toMatchObject({ version: 2, data: { learning_area_id: fields.learning_area_id, title: "统计学公开课（更新）" } });
  });

  it("accepts only http(s) metadata references and configured slugs", () => {
    expect(() => createLearningResourceData({ ...fields, url: "javascript:alert(1)" })).toThrow("INVALID_LEARNING_RESOURCE_DETAILS");
    expect(() => createLearningResourceData({ ...fields, resource_type: "Course Name" })).toThrow("INVALID_LEARNING_RESOURCE_DETAILS");
  });

  it("supports completed, archived and recoverable trash views", () => {
    const active = record("learning_resource_active");
    const completed = setLearningResourceStatus(record("learning_resource_completed"), "completed", "2026-09-15T14:00:00.000Z");
    const archived = setLearningResourceStatus(record("learning_resource_archived"), "archived", "2026-09-15T15:00:00.000Z");
    const trashed = setWorkspaceRecordDeleted(active, "2026-09-15T16:00:00.000Z", "2026-09-15T16:00:00.000Z");
    expect(activeLearningResources([active, completed, archived, trashed])).toHaveLength(1);
    expect(completedLearningResources([active, completed, archived, trashed])).toHaveLength(1);
    expect(archivedLearningResources([active, completed, archived, trashed])).toHaveLength(1);
    expect(trashedLearningResources([active, completed, archived, trashed])).toHaveLength(1);
  });
});
