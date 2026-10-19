import { describe, expect, it } from "vitest";
import { supportsManualSleepStatus } from "./habit-manual-status";
import { createHabitData } from "../../../../src/lib/github-data/habits";
import { createSleepHabitRuleData } from "../../../../src/lib/github-data/sleep-habit-rules";
import { createWorkspaceRecord } from "../../../../src/lib/github-data/protocol";

const timestamp = "2026-10-19T06:00:00Z";
function habit(name: string) {
  return createWorkspaceRecord({ entityType: "habit", id: "habit_test", ownerId: "owner_test", timestamp,
    data: createHabitData({ name, description_markdown: "", schedule_json: { frequency: "daily", weekdays: [] }, timezone: "Asia/Shanghai", tracking_type: "boolean", target_json: { value: 1, unit: null }, automation_mode: "manual", start_date: "2026-10-19", end_date: null }) });
}
function rule(habitId = "habit_test") {
  return createWorkspaceRecord({ entityType: "habit_rule", id: "rule_test", ownerId: "owner_test", timestamp,
    data: createSleepHabitRuleData({ habitId, timezone: "Asia/Shanghai", activeFrom: "2026-10-19", fields: { rule_type: "wake_before", threshold_local_time: "07:00" } }) });
}
describe("manual sleep status scope", () => {
  it.each(["早起", "早睡"])("supports %s without sleep data or rules", name => {
    expect(supportsManualSleepStatus(habit(name), [])).toBe(true);
  });
  it.each(["阅读", "钢琴练习", "吃补剂", "早睡前阅读"])("keeps %s as a simple toggle", name => {
    expect(supportsManualSleepStatus(habit(name), [rule("another_habit")])).toBe(false);
  });
  it("retains the picker when a rule-assisted sleep habit is renamed, ignoring deleted rules", () => {
    const renamed = habit("按时起床"); const wakeRule = rule();
    expect(supportsManualSleepStatus(renamed, [wakeRule])).toBe(true);
    wakeRule.deleted_at = timestamp;
    expect(supportsManualSleepStatus(renamed, [wakeRule])).toBe(false);
  });
});
