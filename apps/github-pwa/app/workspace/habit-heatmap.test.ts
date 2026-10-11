import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createWorkspaceRecord } from "../../../../src/lib/github-data/protocol";
import { createHabitData, setHabitStatus, type HabitFields } from "../../../../src/lib/github-data/habits";
import { createManualHabitCheckInData, correctHabitCheckIn } from "../../../../src/lib/github-data/habit-check-ins";
import { buildHabitHeatmap } from "./habit-heatmap";
import { HabitHeatmapWidget } from "./habit-heatmap-widget";

const timestamp = "2026-10-11T00:00:00Z";
function habit(id: string, fields: Partial<HabitFields> = {}) {
  return createWorkspaceRecord({ entityType: "habit", id, ownerId: "test_owner", timestamp, data: createHabitData({ name: id === "reading" ? "阅读" : id, description_markdown: "", schedule_json: { frequency: "daily", weekdays: [] }, timezone: "Asia/Shanghai", tracking_type: "boolean", target_json: { value: 1, unit: null }, automation_mode: "manual", start_date: "2026-01-01", end_date: null, ...fields }) });
}
function checkIn(habitId: string, date: string, status: "completed" | "missed" | "skipped" | "unknown" = "completed") {
  return createWorkspaceRecord({ entityType: "habit_check_in", id: `${habitId}_${date}`, ownerId: "test_owner", timestamp, data: createManualHabitCheckInData({ habitId, localDate: date, timezone: "Asia/Shanghai", status, confirmedAt: timestamp }) });
}
function synced<T extends { id: string }>(record: T) { return { record, path: record.id, blobSha: "a".repeat(40) }; }

describe("overview habit heatmap", () => {
  it("uses actual local dates and a Monday-first calendar, including leap years", () => {
    const result = buildHabitHeatmap([habit("reading")], [checkIn("reading", "2024-02-29")], "2024-02-29")!;
    expect(result.offset).toBe(3);
    expect(result.days).toHaveLength(29);
    expect(result.days.at(-1)?.completed).toBe(1);
    expect(buildHabitHeatmap([], [], "2026-02-30")).toBeNull();
    expect(buildHabitHeatmap([], [], "")).toBeNull();
  });

  it("counts only completed records for visible habits, and never future or deleted records", () => {
    const deleted = { ...habit("deleted"), deleted_at: timestamp };
    const archived = setHabitStatus(habit("archived"), "archived");
    const deletedCheckIn = { ...checkIn("reading", "2026-10-09"), deleted_at: timestamp };
    const records = [checkIn("reading", "2026-10-11"), checkIn("walking", "2026-10-11", "missed"), checkIn("reading", "2026-10-10", "skipped"), checkIn("walking", "2026-10-10", "unknown"), checkIn("reading", "2026-10-12"), checkIn("deleted", "2026-10-11"), checkIn("archived", "2026-10-11"), checkIn("orphan", "2026-10-11"), deletedCheckIn];
    const result = buildHabitHeatmap([habit("reading"), habit("walking"), deleted, archived], records, "2026-10-11")!;
    expect(result.completed).toBe(1);
    expect(result.days[10]).toMatchObject({ completed: 1, level: 2 });
    expect(result.days[9]?.entries.map((entry) => entry.status).sort()).toEqual(["skipped", "unknown"]);
    expect(result.days[11]).toMatchObject({ future: true, completed: 0, entries: [] });
    expect(result.days[8]?.entries.every((entry) => entry.status === "none")).toBe(true);
  });

  it("respects schedules and date bounds without treating an absent check-in as a miss", () => {
    const habits = [habit("weekly", { schedule_json: { frequency: "weekly", weekdays: [7] } }), habit("later", { start_date: "2026-10-12" }), habit("ended", { end_date: "2026-10-10" }), setHabitStatus(habit("paused"), "paused")];
    const result = buildHabitHeatmap(habits, [checkIn("paused", "2026-10-10"), checkIn("weekly", "2026-10-10")], "2026-10-11")!;
    expect(result.days[10]?.entries).toEqual([{ id: "weekly", name: "weekly", status: "none" }]);
    expect(result.days[9]?.entries.map((entry) => entry.id)).toContain("paused");
    expect(result.days[9]?.entries.map((entry) => entry.id)).toContain("weekly");
    expect(result.completed).toBe(2);
  });

  it("reflects corrected and revoked check-ins, independent of input order", () => {
    const original = checkIn("reading", "2026-10-11");
    const corrected = correctHabitCheckIn(original, { status: "unknown", valueJson: {}, reason: "撤销合成打卡", confirmedAt: "2026-10-11T01:00:00Z" });
    expect(buildHabitHeatmap([habit("reading")], [corrected, original], "2026-10-11")?.completed).toBe(0);
    expect(buildHabitHeatmap([habit("reading")], [original], "2026-10-11")?.days[10]?.level).toBe(4);
  });

  it("keeps each habit's status separate and can browse another month from the same records", () => {
    const result = buildHabitHeatmap([habit("reading"), habit("walking")], [checkIn("reading", "2026-09-01"), checkIn("reading", "2026-10-11"), checkIn("walking", "2026-09-01", "missed")], "2026-10-11", "2026-09")!;
    expect(result.days).toHaveLength(30);
    expect(result.completed).toBe(1);
    expect(result.rows.find((row) => row.habit.id === "reading")?.cells[0]?.status).toBe("completed");
    expect(result.rows.find((row) => row.habit.id === "walking")?.cells[0]?.status).toBe("missed");
    const current = buildHabitHeatmap([habit("reading", { start_date: "2026-10-10" })], [], "2026-10-11")!;
    expect(current.rows[0]?.cells[0]?.status).toBe("not_scheduled");
    expect(current.rows[0]?.cells[10]?.status).toBe("none");
    expect(current.rows[0]?.cells[11]?.status).toBe("future");
    expect(buildHabitHeatmap([], [], "2026-10-11", "2026-13")).toBeNull();
  });

  it("renders a separate row per habit and accessible day status controls", () => {
    const props = { connected: true, today: "2026-10-11", habits: [synced(habit("reading"))], checkIns: [synced(checkIn("reading", "2026-10-11"))], loading: false, error: "", onRefresh: vi.fn(), onOpenHabits: vi.fn() };
    const html = renderToStaticMarkup(createElement(HabitHeatmapWidget, props));
    expect(html).toContain('aria-label="阅读 · 2026-10-11 · 已完成"');
    expect(html).toContain('scope="row"');
    expect(html).toContain('data-status="completed"');
    expect(html).toContain('aria-label="上个月习惯打卡"');
    expect(html).toContain('data-today="true"');
    expect(html).toContain("阅读");
    expect(html).toContain("已完成");
    expect(html).toContain("刷新打卡");
    expect(renderToStaticMarkup(createElement(HabitHeatmapWidget, { ...props, error: "network failed" }))).toContain("重试读取");
    expect(renderToStaticMarkup(createElement(HabitHeatmapWidget, { ...props, connected: false }))).not.toContain("阅读");
    expect(renderToStaticMarkup(createElement(HabitHeatmapWidget, { ...props, habits: [], loading: true }))).toContain("正在读取");
    expect(renderToStaticMarkup(createElement(HabitHeatmapWidget, { ...props, habits: [] }))).toContain("去添加习惯");
  });
});
