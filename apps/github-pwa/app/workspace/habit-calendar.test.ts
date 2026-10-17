import { describe, expect, it } from "vitest";
import { habitDayStatuses, habitMonthDays, habitYearCounts, shiftHabitMonth } from "./habit-calendar";
import { createWorkspaceRecord } from "../../../../src/lib/github-data/protocol";
import { createManualHabitCheckInData } from "../../../../src/lib/github-data/habit-check-ins";

function checkIn(id: string, date: string, status: "completed" | "missed" | "unknown", timestamp = "2026-10-17T05:00:00Z", habitId = "habit_test") {
  return createWorkspaceRecord({ entityType: "habit_check_in", id, ownerId: "owner_test", timestamp,
    data: createManualHabitCheckInData({ habitId, localDate: date, timezone: "Asia/Shanghai", status, confirmedAt: timestamp }) });
}

describe("habit history calendar", () => {
  it("moves across year boundaries in either direction", () => {
    expect(shiftHabitMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftHabitMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftHabitMonth("2026-10", -12)).toBe("2025-10");
  });
  it("handles leap years, century exceptions, and 30-day months", () => {
    expect(habitMonthDays("2024-02")).toHaveLength(29);
    expect(habitMonthDays("2100-02")).toHaveLength(28);
    expect(habitMonthDays("2000-02")).toHaveLength(29);
    expect(habitMonthDays("2026-09").at(-1)).toBe("2026-09-30");
    expect(habitMonthDays("")).toEqual([]);
  });
  it("counts completed calendar days once, reflects corrections, and excludes deleted, other-habit and future entries", () => {
    const deleted = checkIn("deleted", "2026-01-02", "completed"); deleted.deleted_at = "2026-10-17T05:00:00Z";
    const statuses = habitDayStatuses([
      checkIn("initial", "2026-01-01", "completed"),
      checkIn("corrected", "2026-01-01", "unknown", "2026-10-17T06:00:00Z"),
      checkIn("completed", "2026-10-16", "completed"),
      checkIn("duplicate", "2026-10-16", "completed"),
      checkIn("missed", "2026-10-17", "missed"),
      checkIn("future", "2026-11-01", "completed"),
      checkIn("other", "2026-10-15", "completed", undefined, "habit_other"), deleted,
    ], "habit_test");
    const months = habitYearCounts(statuses, "2026", "2026-10-17");
    expect(months).toHaveLength(12);
    expect(months[0]).toMatchObject({ completed: 0, missed: 0 });
    expect(months[9]).toEqual({ month: "2026-10", completed: 1, missed: 1 });
    expect(months[10]).toMatchObject({ completed: 0 });
    expect(habitYearCounts(statuses, "2025", "2026-10-17").every(month => month.completed === 0)).toBe(true);
  });
});
