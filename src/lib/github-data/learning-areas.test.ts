import { describe, expect, it } from "vitest";
import { generateLearningRoadmap } from "./learning-planner";

import { createWorkspaceRecord, serializeRecord, setWorkspaceRecordDeleted } from "./protocol";
import { activeLearningAreas, archivedLearningAreas, createLearningAreaData, isLearningResourceUrl, learningAreaPlan, parseLearningAreaRecord, setLearningAreaStatus, trashedLearningAreas, updateLearningAreaDetails } from "./learning-areas";

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

  it("reads existing v1 areas without a plan and preserves their notes", () => {
    const legacy = area("learning_area_legacy");
    legacy.data.description_markdown = "原来的领域说明\n\n[资料](https://example.com)";
    const parsed = parseLearningAreaRecord(serializeRecord(legacy));
    expect(learningAreaPlan(parsed.data)).toEqual({ goal: "", next_step: "", resource_url: "" });
    expect(parsed.data.description_markdown).toBe(legacy.data.description_markdown);
  });

  it("round-trips a learning plan and keeps it across lifecycle changes", () => {
    const legacy = area("learning_area_plan");
    const record = createWorkspaceRecord({ entityType: "learning_area", id: legacy.id, ownerId: legacy.owner_id, timestamp: legacy.created_at, data: createLearningAreaData({ ...legacy.data, learning_plan: { goal: " 读懂一篇短文 ", next_step: " 读第一段 ", resource_url: " https://example.com/course " } }) });
    expect(learningAreaPlan(parseLearningAreaRecord(serializeRecord(record)).data)).toEqual({ goal: "读懂一篇短文", next_step: "读第一段", resource_url: "https://example.com/course" });
    const paused = setLearningAreaStatus(record, "on_hold");
    const trashed = setWorkspaceRecordDeleted(paused, "2026-10-22T12:00:00.000Z");
    const restored = setWorkspaceRecordDeleted(trashed, null);
    expect(restored.data.settings_json).toEqual(record.data.settings_json);
    expect(restored.data.status).toBe("on_hold");
  });

  it("updates or clears the plan without replacing other settings or notes", () => {
    const original = area("learning_area_settings");
    original.data.settings_json = { custom: { enabled: true }, learning_plan: { goal: "旧目标", next_step: "旧行动", resource_url: "" } };
    original.data.description_markdown = "旧笔记";
    const edited = updateLearningAreaDetails(original, { ...original.data, learning_plan: { goal: "新目标", next_step: "新行动", resource_url: "https://example.com" } });
    const detailsOnly = updateLearningAreaDetails(edited, { ...edited.data, name: "新名称" });
    expect(learningAreaPlan(detailsOnly.data).goal).toBe("新目标");
    expect(detailsOnly.data.description_markdown).toBe("旧笔记");
    const cleared = updateLearningAreaDetails(detailsOnly, { ...detailsOnly.data, learning_plan: { goal: "", next_step: "", resource_url: "" } });
    expect(cleared.data.settings_json).toEqual({ custom: { enabled: true }, learning_plan: { goal: "", next_step: "", resource_url: "" } });
  });

  it("persists reviewed template roadmaps with notes and unrelated settings intact", () => {
    const original = area("learning_area_roadmap");
    original.data.description_markdown = "原有笔记与资料";
    original.data.settings_json = { custom: { enabled: true } };
    const roadmap = generateLearningRoadmap({ topic: "Python", goal: "完成一个小工具", level: "basic", weekly_hours: 3, local_date: "2026-10-22" });
    roadmap.actions[0].title = "用户修改后的行动";
    const edited = updateLearningAreaDetails(original, { ...original.data, learning_plan: { goal: "完成一个小工具", next_step: roadmap.actions[0].title, resource_url: "", roadmap } });
    const restored = parseLearningAreaRecord(serializeRecord(setLearningAreaStatus(edited, "on_hold")));
    expect(learningAreaPlan(restored.data).roadmap).toEqual(roadmap);
    expect(restored.data.description_markdown).toBe("原有笔记与资料");
    expect(restored.data.settings_json.custom).toEqual({ enabled: true });
    const malformed = { ...restored, data: { ...restored.data, settings_json: { learning_plan: { ...learningAreaPlan(restored.data), roadmap: { ...roadmap, actions: [] } } } } };
    expect(() => parseLearningAreaRecord(serializeRecord(malformed))).toThrow("INVALID_LEARNING_AREA_RECORD");
  });

  it("rejects unsafe resources and malformed or oversized plans on write and import", () => {
    const original = area("learning_area_invalid_plan");
    for (const url of ["javascript:alert(1)", "data:text/html,hello", "file:///tmp/test", "https://user:password@example.com", "not-a-url", "https:example.com"]) {
      expect(isLearningResourceUrl(url)).toBe(false);
      expect(() => createLearningAreaData({ ...original.data, learning_plan: { goal: "", next_step: "", resource_url: url } })).toThrow("INVALID_LEARNING_AREA_DETAILS");
    }
    for (const plan of [null, [], { goal: 3 }, { goal: "x".repeat(501), next_step: "", resource_url: "" }, { goal: "", next_step: "x".repeat(501), resource_url: "" }, { goal: "", next_step: "", resource_url: `https://example.com/${"x".repeat(2048)}` }, { goal: "", next_step: "", resource_url: "javascript:alert(1)" }]) {
      const invalid = { ...original, data: { ...original.data, settings_json: { learning_plan: plan } } };
      expect(() => parseLearningAreaRecord(serializeRecord(invalid))).toThrow("INVALID_LEARNING_AREA_RECORD");
    }
    expect(isLearningResourceUrl("")).toBe(true);
    expect(isLearningResourceUrl("https://example.com/course")).toBe(true);
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
