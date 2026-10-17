import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HabitsSection } from "./habits-section";
import { createHabitData } from "../../../../src/lib/github-data/habits";
import { createSleepHabitRuleData } from "../../../../src/lib/github-data/sleep-habit-rules";
import { createConfirmedSleepSessionData } from "../../../../src/lib/github-data/sleep-sessions";
import { createWorkspaceRecord } from "../../../../src/lib/github-data/protocol";

const timestamp = "2026-10-17T05:00:00Z";
const habits = ["早起", "早睡"].map((name, index) => ({ path: "", blobSha: "", record: createWorkspaceRecord({ entityType: "habit", id: `habit_${index}`, ownerId: "owner_test", timestamp,
  data: createHabitData({ name, description_markdown: "", schedule_json: { frequency: "daily", weekdays: [] }, timezone: "Asia/Shanghai", tracking_type: "boolean", target_json: { value: 1, unit: null }, automation_mode: "rule_assisted", start_date: "2026-10-09", end_date: null }) }) }));
const rules = habits.map((habit, i) => ({ path: "", blobSha: "", record: createWorkspaceRecord({ entityType: "habit_rule", id: `rule_${i}`, ownerId: "owner_test", timestamp,
  data: createSleepHabitRuleData({ habitId: habit.record.id, timezone: "Asia/Shanghai", activeFrom: "2026-10-09", fields: { rule_type: i === 0 ? "wake_before" : "sleep_start_before", threshold_local_time: i === 0 ? "07:00" : "23:30" } }) }) }));
const session = { path: "", blobSha: "", record: createWorkspaceRecord({ entityType: "sleep_session", id: "sleep_today", ownerId: "owner_test", timestamp,
  data: createConfirmedSleepSessionData({ start_at: "2026-10-16T18:00:00Z", end_at: "2026-10-17T04:20:00Z", local_date: "2026-10-17", timezone: "Asia/Shanghai", session_type: "main_sleep", duration_minutes: 620 }, "staging_test") }) };
function render(sessions = [session], sleepError = "", sleepLoading = false) {
  return renderToStaticMarkup(createElement(HabitsSection, {
    connection: { ownerId: "owner_test", ownerLogin: "test", repository: "test/data", timezone: "Asia/Shanghai" }, online: true, todayDate: "2026-10-17",
    habits, rules, checkIns: [], sleepSessions: sessions, sleepError, sleepLoading, loading: false, saving: false, savingId: null,
    onCreate: async () => true, onRename: async () => true, onMove: async () => {}, onStatusChange: () => {}, onDeletionChange: () => {}, onCheckIn: async () => true, onConfirmSleepSuggestion: async () => true, onRefresh: () => {},
  }));
}
describe("habit sleep evidence feedback", () => {
  it("shows both pending missed judgements for a 02:00 bedtime and 12:20 wake-up", () => {
    const html = render();
    expect(html).toContain("待确认的睡眠判定 · 2 条");
    expect(html).toContain("起床 12:20");
    expect(html).toContain("入睡 02:00");
    expect(html.match(/建议：未完成/g)).toHaveLength(2);
    expect(html).toContain('<details open=""');
  });
  it("distinguishes missing evidence, loading and read failure", () => {
    expect(render([])).toContain("尚无今天的夜间睡眠记录");
    expect(render([], "网络错误")).toContain("网络错误；请点击刷新重试");
    expect(render([], "", true)).toContain("正在读取最近的睡眠记录");
    expect(render([])).not.toContain("待确认的睡眠判定");
  });
});
