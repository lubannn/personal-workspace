import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord } from "./protocol";
import { checkInsForMonth, correctHabitCheckIn, createAutomaticHabitCheckInData, createManualHabitCheckInData, parseHabitCheckInRecord } from "./habit-check-ins";

const confirmedAt = "2026-09-12T12:00:00.000Z";

describe("HabitCheckIn canonical records", () => {
  it("round-trips a manual daily check-in", () => {
    const data = createManualHabitCheckInData({ habitId: "habit_reading", localDate: "2026-09-12", timezone: "Asia/Shanghai", status: "completed", valueJson: { minutes: 35 }, confirmedAt });
    const record = createWorkspaceRecord({ entityType: "habit_check_in", id: "habit_check_in_reading_20260912", ownerId: "github_lubannn", timestamp: confirmedAt, data });
    expect(parseHabitCheckInRecord(serializeRecord(record))).toEqual(record);
  });

  it("requires explainable evidence and a versioned rule for automatic check-ins", () => {
    const data = createAutomaticHabitCheckInData({ habitId: "habit_sleep", localDate: "2026-09-12", timezone: "Asia/Shanghai", status: "completed", valueJson: { local_time: "23:10" }, evidenceType: "health_sleep_session", evidenceId: "sleep_session_1", ruleId: "habit_rule_sleep_v1", ruleVersion: 1, evaluatedAt: "2026-09-13T00:00:00.000Z", confirmedAt });
    expect(data).toMatchObject({ entry_method: "automatic", evidence_id: "sleep_session_1", rule_version: 1 });
    expect(() => createAutomaticHabitCheckInData({ habitId: "habit_sleep", localDate: "2026-09-12", timezone: "Asia/Shanghai", status: "completed", evidenceType: "health_sleep_session", evidenceId: "", ruleId: "habit_rule_sleep_v1", ruleVersion: 1, evaluatedAt: confirmedAt, confirmedAt })).toThrow("INVALID_HABIT_CHECK_IN_DETAILS");
  });

  it("preserves automatic provenance when a user corrects the result", () => {
    const automatic = createWorkspaceRecord({ entityType: "habit_check_in", id: "habit_check_in_sleep_20260912", ownerId: "github_lubannn", timestamp: confirmedAt, data: createAutomaticHabitCheckInData({ habitId: "habit_sleep", localDate: "2026-09-12", timezone: "Asia/Shanghai", status: "completed", evidenceType: "health_sleep_session", evidenceId: "sleep_session_1", ruleId: "habit_rule_sleep_v1", ruleVersion: 1, evaluatedAt: confirmedAt, confirmedAt }) });
    const corrected = correctHabitCheckIn(automatic, { status: "missed", valueJson: { local_time: "23:50" }, reason: "睡眠开始时间识别有误", confirmedAt: "2026-09-13T01:00:00.000Z" });
    expect(corrected).toMatchObject({ version: 2, data: { entry_method: "corrected", status: "missed", evidence_id: "sleep_session_1", rule_id: "habit_rule_sleep_v1", correction_reason: "睡眠开始时间识别有误" } });
  });

  it("derives a stable monthly heatmap source without storing a projection", () => {
    const make = (id: string, date: string) => createWorkspaceRecord({ entityType: "habit_check_in" as const, id, ownerId: "github_lubannn", timestamp: confirmedAt, data: createManualHabitCheckInData({ habitId: "habit_reading", localDate: date, timezone: "Asia/Shanghai", status: "completed", confirmedAt }) });
    const records = [make("check_2", "2026-09-20"), make("check_1", "2026-09-02"), make("check_old", "2026-08-31")];
    expect(checkInsForMonth(records, "habit_reading", "2026-09").map((record) => record.data.local_date)).toEqual(["2026-09-02", "2026-09-20"]);
  });
});
