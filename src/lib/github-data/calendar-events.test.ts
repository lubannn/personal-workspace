import { describe, expect, it } from "vitest";

import { calendarEventsForDate, cancelledCalendarEventsForDate, createCalendarEventData, localDateTimeToIso, parseCalendarEventRecord, setCalendarEventStatus, trashedCalendarEventsForDate, updateCalendarEventDetails } from "./calendar-events";
import { createWorkspaceRecord, serializeRecord, setWorkspaceRecordDeleted } from "./protocol";

function event(id: string, localDate = "2026-08-29", startTime = "09:00") {
  const startAt = localDateTimeToIso(localDate, startTime, "Asia/Shanghai");
  const endAt = localDateTimeToIso(localDate, startTime === "09:00" ? "10:00" : "12:00", "Asia/Shanghai");
  return createWorkspaceRecord({
    entityType: "calendar_event",
    id,
    ownerId: "github_lubannn",
    timestamp: startAt,
    data: createCalendarEventData({
      title: "  深度工作  ",
      eventType: "time_block",
      startAt,
      endAt,
      timezone: "Asia/Shanghai",
      localDate,
      linkedTaskId: "task_pwa",
    }),
  });
}

describe("GitHub calendar event records", () => {
  it("creates a canonical internal time block without mutating its linked Task", () => {
    expect(parseCalendarEventRecord(serializeRecord(event("calendar_event_one")))).toMatchObject({
      entity_type: "calendar_event",
      data: {
        title: "深度工作",
        event_type: "time_block",
        timezone: "Asia/Shanghai",
        linked_entity_type: "task",
        linked_entity_id: "task_pwa",
      },
    });
  });

  it("converts local wall time with the declared timezone", () => {
    expect(localDateTimeToIso("2026-08-29", "09:30", "Asia/Shanghai")).toBe("2026-08-29T01:30:00.000Z");
    expect(() => localDateTimeToIso("2026-03-08", "02:30", "America/New_York")).toThrow("INVALID_CALENDAR_LOCAL_TIME");
  });

  it("lists only visible events for the selected local date in start order", () => {
    expect(calendarEventsForDate([
      event("calendar_event_late", "2026-08-29", "11:00"),
      event("calendar_event_other", "2026-08-30", "09:00"),
      event("calendar_event_early", "2026-08-29", "09:00"),
    ], "2026-08-29").map((record) => record.id)).toEqual(["calendar_event_early", "calendar_event_late"]);
  });

  it("edits canonical facts with a versioned update", () => {
    const updated = updateCalendarEventDetails(event("calendar_event_edit"), {
      title: "  评审会议  ",
      eventType: "event",
      startAt: localDateTimeToIso("2026-08-30", "14:00", "Asia/Shanghai"),
      endAt: localDateTimeToIso("2026-08-30", "15:30", "Asia/Shanghai"),
      timezone: "Asia/Shanghai",
      localDate: "2026-08-30",
      linkedTaskId: null,
    }, "2026-08-29T08:00:00.000Z");
    expect(updated).toMatchObject({
      version: 2,
      data: { title: "评审会议", event_type: "event", local_start_date: "2026-08-30", linked_entity_type: null },
    });
  });

  it("separates confirmed, cancelled and trashed day views", () => {
    const confirmed = event("calendar_event_confirmed");
    const cancelled = setCalendarEventStatus(event("calendar_event_cancelled"), "cancelled", "2026-08-29T08:00:00.000Z");
    const trashed = setWorkspaceRecordDeleted(event("calendar_event_trashed"), "2026-08-29T09:00:00.000Z", "2026-08-29T09:00:00.000Z");
    const records = [cancelled, trashed, confirmed];
    expect(calendarEventsForDate(records, "2026-08-29").map((record) => record.id)).toEqual(["calendar_event_confirmed"]);
    expect(cancelledCalendarEventsForDate(records, "2026-08-29").map((record) => record.id)).toEqual(["calendar_event_cancelled"]);
    expect(trashedCalendarEventsForDate(records, "2026-08-29").map((record) => record.id)).toEqual(["calendar_event_trashed"]);
  });

  it("rejects invalid ranges and unstable linked Task IDs", () => {
    expect(() => createCalendarEventData({
      title: "错误时段",
      eventType: "event",
      startAt: "2026-08-29T02:00:00.000Z",
      endAt: "2026-08-29T01:00:00.000Z",
      timezone: "Asia/Shanghai",
      localDate: "2026-08-29",
    })).toThrow("INVALID_CALENDAR_EVENT_DETAILS");
    expect(() => createCalendarEventData({
      title: "错误关联",
      eventType: "event",
      startAt: "2026-08-29T01:00:00.000Z",
      endAt: "2026-08-29T02:00:00.000Z",
      timezone: "Asia/Shanghai",
      localDate: "2026-08-29",
      linkedTaskId: "bad id",
    })).toThrow("INVALID_CALENDAR_EVENT_DETAILS");
  });
});
