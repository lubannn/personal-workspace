import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord, setWorkspaceRecordDeleted } from "./protocol";
import { activeHabits, archivedHabits, createHabitData, moveHabit, nextHabitSortOrder, parseHabitRecord, setHabitStatus, trashedHabits, updateHabitDetails, type HabitFields } from "./habits";

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

  it("persists manual ordering for legacy records through reloads and subsequent moves", () => {
    let records = [habit("habit_c", "C"), habit("habit_a", "A"), habit("habit_b", "B")];
    const original = records.map((record) => serializeRecord(record));
    const changed = moveHabit(records, "habit_b", "up", "2026-09-13T12:00:00.000Z");
    expect(records.map((record) => serializeRecord(record))).toEqual(original);
    records = records.map((record) => parseHabitRecord(serializeRecord(changed.find((item) => item.id === record.id) ?? record)));
    expect(activeHabits(records).map((record) => record.data.name)).toEqual(["B", "A", "C"]);
    expect(changed.every((record) => record.version === 2)).toBe(true);
    const moved = moveHabit(records, "habit_b", "down");
    expect(moved).toHaveLength(2);
    records = records.map((record) => moved.find((item) => item.id === record.id) ?? record);
    expect(activeHabits(records).map((record) => record.data.name)).toEqual(["A", "B", "C"]);
    const edited = updateHabitDetails(records.find((record) => record.id === "habit_b")!, { ...baseFields, name: "Z" });
    expect(edited.data.sort_order).toBe(1);
    expect(setHabitStatus(edited, "paused").data.sort_order).toBe(1);
  });

  it("keeps boundary moves unchanged and excludes archived and deleted habits", () => {
    const archived = setHabitStatus(habit("habit_archived"), "archived");
    const trashed = setWorkspaceRecordDeleted(habit("habit_trashed"), "2026-09-13T12:00:00.000Z");
    const records = [habit("habit_a", "A"), habit("habit_b", "B"), archived, trashed];
    expect(moveHabit(records, "habit_a", "up")).toEqual([]);
    expect(moveHabit(records, "habit_b", "down")).toEqual([]);
    expect(moveHabit(records, "habit_archived", "up")).toEqual([]);
    expect(moveHabit(records, "missing", "down")).toEqual([]);
    expect(moveHabit(records, "habit_b", "up").map((record) => record.id)).toEqual(["habit_b", "habit_a"]);
  });

  it("appends new habits after saved positions, accepts legacy records and validates ordering", () => {
    expect(nextHabitSortOrder([])).toBe(0);
    const record = habit("habit_a", "A");
    const ordered = { ...record, data: createHabitData(baseFields, 10) };
    expect(nextHabitSortOrder([record, ordered])).toBe(11);
    const newRecord = { ...habit("habit_new", "0"), data: createHabitData({ ...baseFields, name: "0" }, nextHabitSortOrder([ordered])) };
    expect(activeHabits([newRecord, ordered]).map((item) => item.id)).toEqual(["habit_a", "habit_new"]);
    expect(parseHabitRecord(serializeRecord(ordered)).data.sort_order).toBe(10);
    for (const sortOrder of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createHabitData(baseFields, sortOrder)).toThrow("INVALID_HABIT_DETAILS");
    }
    expect(parseHabitRecord(serializeRecord(record)).data.sort_order).toBeUndefined();
  });
});
