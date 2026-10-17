import { describe, expect, it } from "vitest";
import { habitDayStatuses, habitMonthDays, habitYearWeeks, shiftHabitMonth } from "./habit-calendar";
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
  it("keeps one latest status per date and excludes deleted and other-habit entries", () => {
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
    expect(statuses.get("2026-01-01")).toBe("unknown");
    expect(statuses.get("2026-10-16")).toBe("completed");
    expect(statuses.get("2026-10-17")).toBe("missed");
    expect(statuses.has("2026-01-02")).toBe(false);
    expect(statuses.has("2026-10-15")).toBe(false);
    expect(statuses.size).toBe(4);
  });
  it.each([["2026", 365], ["2024", 366], ["2012", 366], ["2100", 365]])("lays out every day of %s once in Monday-first weeks", (year, count) => {
    const weeks = habitYearWeeks(String(year));
    const dates = weeks.flatMap(week => week.days).filter((date): date is string => date !== null);
    expect(dates).toHaveLength(Number(count));
    expect(new Set(dates).size).toBe(count);
    expect(dates[0]).toBe(`${year}-01-01`);
    expect(dates.at(-1)).toBe(`${year}-12-31`);
    expect(weeks.flatMap(week => week.monthLabel ? [week.monthLabel] : [])).toEqual(Array.from({ length: 12 }, (_, i) => `${i + 1}月`));
    for (const week of weeks) week.days.forEach((date, index) => {
      if (date) expect((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7).toBe(index);
    });
  });
});
