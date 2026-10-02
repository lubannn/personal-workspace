import { describe, expect, it } from "vitest";

import { createWorkspaceRecord } from "./protocol";
import { createAutomaticSleepSessionData, createConfirmedSleepSessionData } from "./sleep-sessions";
import { createSleepHabitRuleData, evaluateSleepHabitRule } from "./sleep-habit-rules";

const timestamp = "2026-09-13T00:00:00.000Z";
function session(startAt: string, endAt: string) {
  const duration = Math.round((Date.parse(endAt) - Date.parse(startAt)) / 60_000);
  return createWorkspaceRecord({ entityType: "sleep_session", id: `sleep_${startAt.replaceAll(/\D/g, "")}`, ownerId: "github_lubannn", timestamp, data: createConfirmedSleepSessionData({ start_at: startAt, end_at: endAt, local_date: "2026-09-12", timezone: "Asia/Shanghai", session_type: "main_sleep", duration_minutes: duration }, "health_staging_1") });
}

describe("sleep-assisted Habit rules", () => {
  it("accepts validated automatic main sleep as evidence without claiming user confirmation", () => {
    const data = createAutomaticSleepSessionData({ start_at: "2024-02-01T15:00:00.000Z", end_at: "2024-02-01T23:00:00.000Z", local_date: "2024-02-01", timezone: "Asia/Shanghai", session_type: "main_sleep", duration_minutes: 480 }, { kind: "coros_mcp", source_id: "synthetic-sleep", source_sha256: "a".repeat(64), mapping_version: 1, retrieved_at: timestamp }, { asleep_minutes: 460, awake_minutes: 20, score: 80, wake_date: "2024-02-02" });
    const automatic = createWorkspaceRecord({ entityType: "sleep_session", id: "sleep_automatic", ownerId: "github_fixture", timestamp, data });
    const rule = createWorkspaceRecord({ entityType: "habit_rule", id: "rule_wake", ownerId: "github_fixture", timestamp, data: createSleepHabitRuleData({ habitId: "habit_wake", timezone: "Asia/Shanghai", activeFrom: "2024-01-01", fields: { rule_type: "wake_before", threshold_local_time: "07:30" } }) });
    expect(evaluateSleepHabitRule(rule, automatic)).toMatchObject({ local_date: "2024-02-02", status: "completed", observed_local_time: "07:00" });
    expect(automatic.data).not.toHaveProperty("confirmation_status");
  });

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
