import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createHabitData } from "../../../../src/lib/github-data/habits";
import { createManualHabitCheckInData } from "../../../../src/lib/github-data/habit-check-ins";
import { createWorkspaceRecord } from "../../../../src/lib/github-data/protocol";
import { HabitsSection } from "./habits-section";

function render(today: string, options: { start?: string; paused?: boolean; completedDate?: string } = {}) {
  const timestamp = "2026-01-01T00:00:00Z";
  const record = createWorkspaceRecord({ entityType: "habit", id: "habit_test", ownerId: "owner_test", timestamp,
    data: createHabitData({ name: "阅读", description_markdown: "", schedule_json: { frequency: "daily", weekdays: [] },
      timezone: "Asia/Shanghai", tracking_type: "boolean", target_json: { value: 1, unit: null }, automation_mode: "manual", start_date: options.start ?? "2025-01-01", end_date: null }) });
  if (options.paused) record.data.status = "paused";
  const checkIns = options.completedDate ? [{ path: "", blobSha: "", record: createWorkspaceRecord({ entityType: "habit_check_in", id: "check_test", ownerId: "owner_test", timestamp,
    data: createManualHabitCheckInData({ habitId: record.id, localDate: options.completedDate, timezone: "Asia/Shanghai", status: "completed", confirmedAt: timestamp }) }) }] : [];
  return renderToStaticMarkup(createElement(HabitsSection, {
    connection: { ownerId: "owner_test", ownerLogin: "test", repository: "test/data", timezone: "Asia/Shanghai" }, online: true,
    todayDate: today, habits: [{ record, path: "", blobSha: "" }], checkIns, rules: [], sleepSessions: [], loading: false, saving: false, savingId: null,
    onCreate: async () => true, onRename: async () => true, onMove: async () => {}, onStatusChange: () => {}, onDeletionChange: () => {}, onCheckIn: async () => true,
    onConfirmSleepSuggestion: async () => true, onRefresh: () => {},
  }));
}

function dateButtons(html: string) { return [...html.matchAll(/<button[^>]*aria-label="阅读 · (\d{4}-\d{2}-\d{2})[^>]*>/gu)].map((match) => ({ date: match[1], tag: match[0] })); }

describe("Habit calendar recent-day editing", () => {
  it("makes only the day before yesterday, yesterday and today interactive", () => {
    expect(dateButtons(render("2026-10-11")).map((button) => button.date)).toEqual(["2026-10-09", "2026-10-10", "2026-10-11"]);
  });
  it("shows previous-month dates and their existing check-ins at the year boundary", () => {
    const html = render("2026-01-01", { completedDate: "2025-12-31" });
    const buttons = dateButtons(html);
    expect(buttons.map((button) => button.date)).toEqual(["2025-12-30", "2025-12-31", "2026-01-01"]);
    expect(buttons[1]!.tag).toContain("已完成，撤销打卡");
    expect(buttons[1]!.tag).toContain('aria-pressed="true"');
    expect(html).toContain("12/31");
  });
  it("preserves habit start-date and paused-state restrictions for backdated entries", () => {
    const buttons = dateButtons(render("2026-10-11", { start: "2026-10-10" }));
    expect(buttons[0]!.tag).toContain('disabled=""');
    expect(buttons[1]!.tag).not.toContain('disabled=""');
    expect(dateButtons(render("2026-10-11", { paused: true })).every((button) => button.tag.includes('disabled=""'))).toBe(true);
  });
});
