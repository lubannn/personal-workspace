import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord, setWorkspaceRecordDeleted } from "./protocol";
import { activeLearningAreas, archivedLearningAreas, createLearningAreaData, parseLearningAreaRecord, setLearningAreaStatus, trashedLearningAreas, updateLearningAreaDetails } from "./learning-areas";

function area(id: string, name = "韩语") {
  return createWorkspaceRecord({ entityType: "learning_area", id, ownerId: "github_lubannn", timestamp: "2026-09-12T12:00:00.000Z", data: createLearningAreaData({ name, description_markdown: "", area_type: "language", icon: "한", color: "#65735f" }) });
}

describe("LearningArea canonical records", () => {
  it("keeps learning domains user-defined and round-trips the v1 record", () => {
    const record = area("learning_area_korean");
    expect(parseLearningAreaRecord(serializeRecord(record))).toEqual(record);
    expect(record.data).toMatchObject({ area_type: "language", status: "active", settings_json: {} });
  });

  it("updates details and lifecycle with monotonically increasing versions", () => {
    const edited = updateLearningAreaDetails(area("learning_area_music", "钢琴"), { name: "古典钢琴", description_markdown: "每周练习", area_type: "music", icon: "♪", color: "#334455" }, "2026-09-12T13:00:00.000Z");
    const archived = setLearningAreaStatus(edited, "archived", "2026-09-12T14:00:00.000Z");
    expect(archived).toMatchObject({ version: 3, data: { name: "古典钢琴", area_type: "music", status: "archived" } });
  });

  it("separates active, archived and trashed views", () => {
    const active = area("learning_area_a", "英语");
    const paused = setLearningAreaStatus(area("learning_area_b", "羽毛球"), "on_hold", "2026-09-12T13:00:00.000Z");
    const archived = setLearningAreaStatus(area("learning_area_c", "钢琴"), "archived", "2026-09-12T13:00:00.000Z");
    const trashed = setWorkspaceRecordDeleted(area("learning_area_d", "阅读"), "2026-09-12T14:00:00.000Z", "2026-09-12T14:00:00.000Z");
    expect(activeLearningAreas([archived, trashed, paused, active]).map((record) => record.id).sort()).toEqual(["learning_area_a", "learning_area_b"]);
    expect(archivedLearningAreas([active, archived])).toEqual([archived]);
    expect(trashedLearningAreas([active, trashed])).toEqual([trashed]);
  });

  it("rejects empty names, hard-coded-looking invalid types, colors and unknown fields", () => {
    expect(() => createLearningAreaData({ name: " ", description_markdown: "", area_type: "language", icon: null, color: null })).toThrow("INVALID_LEARNING_AREA_DETAILS");
    expect(() => createLearningAreaData({ name: "韩语", description_markdown: "", area_type: "Language Course", icon: null, color: null })).toThrow("INVALID_LEARNING_AREA_DETAILS");
    expect(() => createLearningAreaData({ name: "韩语", description_markdown: "", area_type: "language", icon: null, color: "red" })).toThrow("INVALID_LEARNING_AREA_DETAILS");
    const invalid = { ...area("learning_area_invalid"), data: { ...area("learning_area_invalid").data, surprise: true } };
    expect(() => parseLearningAreaRecord(serializeRecord(invalid))).toThrow("INVALID_LEARNING_AREA_RECORD");
  });
});
