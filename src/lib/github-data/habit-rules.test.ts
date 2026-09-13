import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord } from "./protocol";
import { activeHabitRule, createHabitRuleData, parseHabitRuleRecord } from "./habit-rules";

function rule(id: string, version: number, activeFrom: string, activeTo: string | null = null) {
  return createWorkspaceRecord({ entityType: "habit_rule", id, ownerId: "github_lubannn", timestamp: `${activeFrom}T00:00:00.000Z`, data: createHabitRuleData({ habit_id: "habit_sleep", rule_type: "time_threshold", rule_version: version, config_json: { latest_local_time: "23:30" }, active_from: activeFrom, active_to: activeTo, enabled: true }) });
}

describe("HabitRule canonical records", () => {
  it("keeps each rule version immutable and round-trippable", () => {
    const record = rule("habit_rule_sleep_v1", 1, "2026-09-01");
    expect(parseHabitRuleRecord(serializeRecord(record))).toEqual(record);
  });

  it("selects the latest applicable rule version for a local date", () => {
    const v1 = rule("habit_rule_sleep_v1", 1, "2026-09-01", "2026-09-14");
    const v2 = rule("habit_rule_sleep_v2", 2, "2026-09-15");
    expect(activeHabitRule([v2, v1], "habit_sleep", "2026-09-12")?.id).toBe(v1.id);
    expect(activeHabitRule([v1, v2], "habit_sleep", "2026-09-20")?.id).toBe(v2.id);
  });

  it("rejects mutable records, invalid ranges and ambiguous active versions", () => {
    const valid = rule("habit_rule_sleep_v1", 1, "2026-09-01");
    expect(() => parseHabitRuleRecord(serializeRecord({ ...valid, version: 2 }))).toThrow("INVALID_HABIT_RULE_RECORD");
    expect(() => createHabitRuleData({ ...valid.data, active_from: "2026-09-10", active_to: "2026-09-09" })).toThrow("INVALID_HABIT_RULE_DETAILS");
    const duplicate = rule("habit_rule_sleep_v1_duplicate", 1, "2026-09-01");
    expect(() => activeHabitRule([valid, duplicate], "habit_sleep", "2026-09-12")).toThrow("HABIT_RULE_VERSION_CONFLICT");
  });
});
