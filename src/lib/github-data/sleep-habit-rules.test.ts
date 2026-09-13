import { describe, expect, it } from "vitest";

import { createWorkspaceRecord } from "./protocol";
import { createConfirmedSleepSessionData } from "./sleep-sessions";
import { createSleepHabitRuleData, evaluateSleepHabitRule } from "./sleep-habit-rules";

const timestamp = "2026-09-13T00:00:00.000Z";
function session(startAt: string, endAt: string) {
  const duration = Math.round((Date.parse(endAt) - Date.parse(startAt)) / 60_000);
  return createWorkspaceRecord({ entityType: "sleep_session", id: `sleep_${startAt.replaceAll(/\D/g, "")}`, ownerId: "github_lubannn", timestamp, data: createConfirmedSleepSessionData({ start_at: startAt, end_at: endAt, local_date: "2026-09-12", timezone: "Asia/Shanghai", session_type: "main_sleep", duration_minutes: duration }, "health_staging_1") });
}

describe("sleep-assisted Habit rules", () => {
  it("attributes bedtime to the sleep start date and explains completion", () => {
    const rule = createWorkspaceRecord({ entityType: "habit_rule", id: "rule_bedtime", ownerId: "github_lubannn", timestamp, data: createSleepHabitRuleData({ habitId: "habit_bedtime", timezone: "Asia/Shanghai", activeFrom: "2026-09-01", fields: { rule_type: "sleep_start_before", threshold_local_time: "23:30" } }) });
    expect(evaluateSleepHabitRule(rule, session("2026-09-12T15:10:00.000Z", "2026-09-12T23:00:00.000Z"))).toMatchObject({ local_date: "2026-09-12", observed_local_time: "23:10", status: "completed" });
  });

  it("attributes wake-up to the end date and explains misses", () => {
    const rule = createWorkspaceRecord({ entityType: "habit_rule", id: "rule_wake", ownerId: "github_lubannn", timestamp, data: createSleepHabitRuleData({ habitId: "habit_wake", timezone: "Asia/Shanghai", activeFrom: "2026-09-01", fields: { rule_type: "wake_before", threshold_local_time: "06:30" } }) });
    expect(evaluateSleepHabitRule(rule, session("2026-09-12T15:10:00.000Z", "2026-09-12T23:00:00.000Z"))).toMatchObject({ local_date: "2026-09-13", observed_local_time: "07:00", status: "missed" });
  });

  it("rejects naps and invalid thresholds", () => {
    expect(() => createSleepHabitRuleData({ habitId: "habit_sleep", timezone: "Asia/Shanghai", activeFrom: "2026-09-01", fields: { rule_type: "sleep_start_before", threshold_local_time: "25:00" } })).toThrow("INVALID_SLEEP_HABIT_TIME");
    const rule = createWorkspaceRecord({ entityType: "habit_rule", id: "rule_bedtime", ownerId: "github_lubannn", timestamp, data: createSleepHabitRuleData({ habitId: "habit_bedtime", timezone: "Asia/Shanghai", activeFrom: "2026-09-01", fields: { rule_type: "sleep_start_before", threshold_local_time: "23:30" } }) });
    const nap = session("2026-09-12T05:00:00.000Z", "2026-09-12T06:00:00.000Z");
    nap.data.session_type = "nap";
    expect(() => evaluateSleepHabitRule(rule, nap)).toThrow("SLEEP_SESSION_NOT_ELIGIBLE");
  });
});
