import { describe, expect, it } from "vitest";
import { createAutomaticHabitCheckInData, createManualHabitCheckInData, correctHabitCheckIn, parseHabitCheckInRecord } from "./habit-check-ins";
import { createSleepHabitRuleData } from "./sleep-habit-rules";
import { createWorkspaceRecord, serializeRecord } from "./protocol";
import { correctLegacySleepHabitDate, planSleepHabitDateCorrections } from "./sleep-habit-date-corrections";
const timestamp = "2026-10-22T06:00:00Z";
const rule = createWorkspaceRecord({ entityType: "habit_rule", id: "rule_test", ownerId: "owner_test", timestamp,
  data: createSleepHabitRuleData({ habitId: "habit_test", timezone: "Asia/Shanghai", activeFrom: "2026-10-01", fields: { rule_type: "sleep_start_before", threshold_local_time: "23:30" } }) });
function legacy(date: string, time = "02:00") {
  return createWorkspaceRecord({ entityType: "habit_check_in", id: `check_${date.replaceAll("-", "")}`, ownerId: "owner_test", timestamp,
    data: createAutomaticHabitCheckInData({ habitId: "habit_test", localDate: date, timezone: "Asia/Shanghai", status: "missed", valueJson: { rule_type: "sleep_start_before", observed_local_time: time, threshold_local_time: "23:30", session_type: "main_sleep", duration_minutes: 480 }, evidenceType: "health_sleep_session", evidenceId: `sleep_${date.replaceAll("-", "")}`, ruleId: rule.id, ruleVersion: 1, evaluatedAt: timestamp, confirmedAt: timestamp }) });
}
describe("legacy bedtime date corrections", () => {
  it("moves consecutive nights oldest first and preserves evidence and results without moving a second time", () => {
    const a = legacy("2026-10-21"); const b = legacy("2026-10-22");
    expect(planSleepHabitDateCorrections([b, a], [rule]).changes).toEqual([
      { id: a.id, from: "2026-10-21", to: "2026-10-20" }, { id: b.id, from: "2026-10-22", to: "2026-10-21" },
    ]);
    const corrected = correctLegacySleepHabitDate(b, "2026-10-22T07:00:00Z");
    expect(corrected.data).toMatchObject({ local_date: "2026-10-21", status: "missed", entry_method: "automatic", evidence_id: b.data.evidence_id, confirmed_at: timestamp, value_json: { observed_local_date: "2026-10-22", bedtime_date_version: 2 } });
    expect(parseHabitCheckInRecord(serializeRecord(corrected))).toEqual(corrected);
    expect(planSleepHabitDateCorrections([corrected], [rule]).changes).toHaveLength(0);
  });
  it("protects manual results and propagates destination conflicts through a date chain", () => {
    const manual = createWorkspaceRecord({ entityType: "habit_check_in", id: "manual", ownerId: "owner_test", timestamp,
      data: createManualHabitCheckInData({ habitId: "habit_test", localDate: "2026-10-20", timezone: "Asia/Shanghai", status: "completed", confirmedAt: timestamp }) });
    const plan = planSleepHabitDateCorrections([manual, legacy("2026-10-21"), legacy("2026-10-22")], [rule]);
    expect(plan.changes).toEqual([]); expect(plan.blocked).toHaveLength(2);
    expect(manual.data.local_date).toBe("2026-10-20");
  });
  it("leaves manual corrections, wake-up results, daytime sleep and inactive rule dates alone", () => {
    const base = legacy("2026-10-22");
    const manualCorrection = correctHabitCheckIn(base, { status: "completed", valueJson: base.data.value_json, reason: "manual override", confirmedAt: timestamp });
    const wake = legacy("2026-10-23"); wake.data.value_json.rule_type = "wake_before";
    expect(planSleepHabitDateCorrections([manualCorrection, wake, legacy("2026-10-24", "09:00")], [rule]).changes).toEqual([]);
    const beforeActivation = planSleepHabitDateCorrections([legacy("2026-10-01")], [rule]);
    expect(beforeActivation.changes).toEqual([]); expect(beforeActivation.blocked).toHaveLength(1);
  });
});
