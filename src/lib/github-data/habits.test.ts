import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord, setWorkspaceRecordDeleted } from "./protocol";
import { activeHabits, archivedHabits, createHabitData, parseHabitRecord, setHabitStatus, trashedHabits, updateHabitDetails, type HabitFields } from "./habits";

const baseFields: HabitFields = {
  name: "阅读",
  description_markdown: "每天读一点",
  schedule_json: { frequency: "daily", weekdays: [] },
  timezone: "Asia/Shanghai",
  tracking_type: "duration",
  target_json: { value: 30, unit: "minutes" },
  automation_mode: "manual",
  start_date: "2026-09-12",
  end_date: null,
};

function habit(id: string, name = "阅读") {
  return createWorkspaceRecord({ entityType: "habit", id, ownerId: "github_lubannn", timestamp: "2026-09-12T12:00:00.000Z", data: createHabitData({ ...baseFields, name }) });
}

describe("Habit canonical records", () => {
  it("round-trips a user-defined habit without hard-coded habit names", () => {
    const record = habit("habit_reading");
    expect(parseHabitRecord(serializeRecord(record))).toEqual(record);
    expect(record.data).toMatchObject({ tracking_type: "duration", target_json: { value: 30, unit: "minutes" }, status: "active" });
  });

  it("normalizes weekly schedules and versions details and lifecycle changes", () => {
    const edited = updateHabitDetails(habit("habit_music", "钢琴"), {
      ...baseFields,
      name: "古典钢琴",
      schedule_json: { frequency: "weekly", weekdays: [5, 1, 5, 3] },
      tracking_type: "count",
      target_json: { value: 4, unit: "sessions" },
    }, "2026-09-12T13:00:00.000Z");
    const paused = setHabitStatus(edited, "paused", "2026-09-12T14:00:00.000Z");
    expect(paused).toMatchObject({ version: 3, data: { name: "古典钢琴", schedule_json: { frequency: "weekly", weekdays: [1, 3, 5] }, status: "paused" } });
  });

  it("separates active, archived and trashed views", () => {
    const active = habit("habit_a", "韩语");
    const paused = setHabitStatus(habit("habit_b", "钢琴"), "paused", "2026-09-12T13:00:00.000Z");
    const archived = setHabitStatus(habit("habit_c", "早睡"), "archived", "2026-09-12T13:00:00.000Z");
    const trashed = setWorkspaceRecordDeleted(habit("habit_d", "早起"), "2026-09-12T14:00:00.000Z", "2026-09-12T14:00:00.000Z");
    expect(activeHabits([archived, trashed, paused, active]).map((record) => record.id).sort()).toEqual(["habit_a", "habit_b"]);
    expect(archivedHabits([active, archived])).toEqual([archived]);
    expect(trashedHabits([active, trashed])).toEqual([trashed]);
  });

  it("requires explicit targets, valid schedules, dates and IANA timezones", () => {
    expect(() => createHabitData({ ...baseFields, name: " " })).toThrow("INVALID_HABIT_DETAILS");
    expect(() => createHabitData({ ...baseFields, timezone: "Mars/Base" })).toThrow("INVALID_HABIT_DETAILS");
    expect(() => createHabitData({ ...baseFields, schedule_json: { frequency: "weekly", weekdays: [] } })).toThrow("INVALID_HABIT_DETAILS");
    expect(() => createHabitData({ ...baseFields, tracking_type: "boolean", target_json: { value: 2, unit: null } })).toThrow("INVALID_HABIT_DETAILS");
    expect(() => createHabitData({ ...baseFields, end_date: "2026-09-11" })).toThrow("INVALID_HABIT_DETAILS");
  });

  it("rejects unknown fields instead of silently accepting schema drift", () => {
    const record = habit("habit_invalid");
    const invalid = { ...record, data: { ...record.data, surprise: true } };
    expect(() => parseHabitRecord(serializeRecord(invalid))).toThrow("INVALID_HABIT_RECORD");
  });
});
