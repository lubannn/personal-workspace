import { describe, expect, it } from "vitest";
import { formatCalendarTime, shiftCalendarDate } from "./calendar-presentation";
import { captureScheduleWindow } from "../../../../src/lib/github-data/capture-routing";

describe("calendar navigation and schedule windows", () => {
  it("moves local dates across year boundaries and leap months", () => {
    expect(shiftCalendarDate("2026-12-31", "day", 1)).toBe("2027-01-01");
    expect(shiftCalendarDate("2026-01-03", "week", -1)).toBe("2025-12-27");
    expect(shiftCalendarDate("2028-01-31", "month", 1)).toBe("2028-02-29");
    expect(shiftCalendarDate("2026-03-31", "month", -1)).toBe("2026-02-28");
  });
  it("shows a next-day marker in the event's timezone", () => {
    expect(formatCalendarTime("2026-10-04T15:00:00Z", "2026-10-04T17:00:00Z", "Asia/Shanghai")).toBe("23:00–次日 01:00");
    expect(formatCalendarTime("2026-10-04T09:00:00Z", "2026-10-04T10:00:00Z", "UTC")).toBe("09:00–10:00");
  });
  it("reuses existing all-day and overnight semantics without task mutations", () => {
    expect(captureScheduleWindow("2026-10-04", null, null, "Asia/Shanghai")).toEqual({ startAt: "2026-10-03T16:00:00.000Z", endAt: "2026-10-04T16:00:00.000Z", allDay: true, localEndDate: "2026-10-04" });
    const overnight = captureScheduleWindow("2026-10-04", "23:00", "01:00", "Asia/Shanghai");
    expect(overnight.localEndDate).toBe("2026-10-05");
    expect(Date.parse(overnight.endAt) - Date.parse(overnight.startAt)).toBe(7200000);
    expect(() => captureScheduleWindow("2026-10-04", "09:00", "09:00", "UTC")).toThrow("CAPTURE_RANGE_INVALID");
  });
});
