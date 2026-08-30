import { parseRecord, updateWorkspaceRecord, type WorkspaceRecord } from "./protocol";

export type CalendarEventType = "event" | "time_block";
export type CalendarRangeView = "day" | "week" | "month";
export const CALENDAR_REMINDER_OFFSETS = [0, 5, 10, 15, 30, 60, 1440] as const;
export type CalendarReminderOffset = typeof CALENDAR_REMINDER_OFFSETS[number];

export type CalendarEventData = {
  calendar_id: "internal-default";
  title: string;
  description_markdown: string;
  event_type: CalendarEventType;
  start_at: string;
  end_at: string;
  timezone: string;
  all_day: boolean;
  local_start_date: string;
  local_end_date: string;
  location: string;
  status: "confirmed" | "cancelled";
  linked_entity_type: "task" | null;
  linked_entity_id: string | null;
  external_uid: null;
  external_etag: null;
  sync_status: "internal";
  recurrence_rule: null;
  recurrence_timezone: null;
  reminder_offsets_minutes: CalendarReminderOffset[];
  reminder_delivery: "foreground_notification";
};

export type CalendarEventRecord = WorkspaceRecord<CalendarEventData>;
export type CalendarEventEditableFields = {
  title: string;
  eventType: CalendarEventType;
  startAt: string;
  endAt: string;
  timezone: string;
  localDate: string;
  linkedTaskId: string | null;
  reminderOffsetsMinutes?: CalendarReminderOffset[];
};

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
}

function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidInstant(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isValidTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function isValidData(data: Record<string, unknown>): data is CalendarEventData {
  const reminderOffsets = data.reminder_offsets_minutes ?? [];
  const reminderDelivery = data.reminder_delivery ?? "foreground_notification";
  const linkedPairValid = (
    (data.linked_entity_type === null && data.linked_entity_id === null)
    || (data.linked_entity_type === "task" && isStableId(data.linked_entity_id))
  );
  return (
    data.calendar_id === "internal-default"
    && typeof data.title === "string"
    && Boolean(data.title.trim())
    && data.title.length <= 300
    && typeof data.description_markdown === "string"
    && data.description_markdown.length <= 100_000
    && (data.event_type === "event" || data.event_type === "time_block")
    && isValidInstant(data.start_at)
    && isValidInstant(data.end_at)
    && Date.parse(data.end_at) > Date.parse(data.start_at)
    && isValidTimezone(data.timezone)
    && typeof data.all_day === "boolean"
    && isValidDateOnly(data.local_start_date)
    && isValidDateOnly(data.local_end_date)
    && data.local_end_date >= data.local_start_date
    && typeof data.location === "string"
    && data.location.length <= 1_000
    && (data.status === "confirmed" || data.status === "cancelled")
    && linkedPairValid
    && data.external_uid === null
    && data.external_etag === null
    && data.sync_status === "internal"
    && data.recurrence_rule === null
    && data.recurrence_timezone === null
    && Array.isArray(reminderOffsets)
    && reminderOffsets.length <= CALENDAR_REMINDER_OFFSETS.length
    && reminderOffsets.every((offset) => CALENDAR_REMINDER_OFFSETS.includes(offset as CalendarReminderOffset))
    && new Set(reminderOffsets).size === reminderOffsets.length
    && reminderDelivery === "foreground_notification"
  );
}

export function parseCalendarEventRecord(value: string): CalendarEventRecord {
  const record = parseRecord(value);
  if (record.entity_type !== "calendar_event" || !isValidData(record.data)) {
    throw new Error("INVALID_CALENDAR_EVENT_RECORD");
  }
  return {
    ...record,
    data: {
      ...record.data,
      reminder_offsets_minutes: [...((record.data.reminder_offsets_minutes ?? []) as CalendarReminderOffset[])].sort((left, right) => left - right),
      reminder_delivery: "foreground_notification",
    },
  } as CalendarEventRecord;
}

export function createCalendarEventData(input: {
  title: string;
  eventType: CalendarEventType;
  startAt: string;
  endAt: string;
  timezone: string;
  localDate: string;
  linkedTaskId?: string | null;
  reminderOffsetsMinutes?: CalendarReminderOffset[];
}): CalendarEventData {
  const linkedTaskId = input.linkedTaskId || null;
  const data: CalendarEventData = {
    calendar_id: "internal-default",
    title: input.title.trim(),
    description_markdown: "",
    event_type: input.eventType,
    start_at: input.startAt,
    end_at: input.endAt,
    timezone: input.timezone,
    all_day: false,
    local_start_date: input.localDate,
    local_end_date: input.localDate,
    location: "",
    status: "confirmed",
    linked_entity_type: linkedTaskId ? "task" : null,
    linked_entity_id: linkedTaskId,
    external_uid: null,
    external_etag: null,
    sync_status: "internal",
    recurrence_rule: null,
    recurrence_timezone: null,
    reminder_offsets_minutes: normalizeReminderOffsets(input.reminderOffsetsMinutes ?? []),
    reminder_delivery: "foreground_notification",
  };
  if (!isValidData(data)) throw new Error("INVALID_CALENDAR_EVENT_DETAILS");
  return data;
}

export function updateCalendarEventDetails(
  current: CalendarEventRecord,
  fields: CalendarEventEditableFields,
  timestamp = new Date().toISOString(),
) {
  if (Number.isNaN(Date.parse(timestamp))) throw new Error("INVALID_CALENDAR_EVENT_DETAILS");
  const linkedTaskId = fields.linkedTaskId || null;
  const data: CalendarEventData = {
    ...current.data,
    title: fields.title.trim(),
    event_type: fields.eventType,
    start_at: fields.startAt,
    end_at: fields.endAt,
    timezone: fields.timezone,
    all_day: false,
    local_start_date: fields.localDate,
    local_end_date: fields.localDate,
    linked_entity_type: linkedTaskId ? "task" : null,
    linked_entity_id: linkedTaskId,
    reminder_offsets_minutes: normalizeReminderOffsets(fields.reminderOffsetsMinutes ?? current.data.reminder_offsets_minutes),
    reminder_delivery: "foreground_notification",
  };
  if (!isValidData(data)) throw new Error("INVALID_CALENDAR_EVENT_DETAILS");
  return updateWorkspaceRecord(current, data, timestamp);
}

function normalizeReminderOffsets(offsets: readonly CalendarReminderOffset[]) {
  const normalized = [...new Set(offsets)].sort((left, right) => left - right);
  if (normalized.some((offset) => !CALENDAR_REMINDER_OFFSETS.includes(offset))) {
    throw new Error("INVALID_CALENDAR_EVENT_DETAILS");
  }
  return normalized;
}

export type DueCalendarReminder = {
  event: CalendarEventRecord;
  offsetMinutes: CalendarReminderOffset;
  triggerAt: string;
  deliveryKey: string;
};

export function dueCalendarReminders(
  records: CalendarEventRecord[],
  now = new Date().toISOString(),
  graceMinutes = 5,
): DueCalendarReminder[] {
  const nowValue = Date.parse(now);
  if (Number.isNaN(nowValue) || !Number.isFinite(graceMinutes) || graceMinutes < 0 || graceMinutes > 60) {
    throw new Error("INVALID_CALENDAR_REMINDER_WINDOW");
  }
  return records.flatMap((event) => {
    if (event.deleted_at !== null || event.data.status !== "confirmed") return [];
    return event.data.reminder_offsets_minutes.flatMap((offsetMinutes) => {
      const triggerValue = Date.parse(event.data.start_at) - offsetMinutes * 60_000;
      if (triggerValue > nowValue || triggerValue + graceMinutes * 60_000 < nowValue) return [];
      return [{
        event,
        offsetMinutes,
        triggerAt: new Date(triggerValue).toISOString(),
        deliveryKey: `${event.id}:${event.version}:${offsetMinutes}`,
      }];
    });
  }).sort((left, right) => left.triggerAt.localeCompare(right.triggerAt) || left.deliveryKey.localeCompare(right.deliveryKey));
}

export function setCalendarEventStatus(
  current: CalendarEventRecord,
  status: CalendarEventData["status"],
  timestamp = new Date().toISOString(),
) {
  if (Number.isNaN(Date.parse(timestamp))) throw new Error("INVALID_CALENDAR_EVENT_STATUS");
  return updateWorkspaceRecord(current, { ...current.data, status }, timestamp);
}

export function calendarEventsForDate(records: CalendarEventRecord[], localDate: string) {
  return calendarEventsForRange(records, localDate, localDate);
}

export function cancelledCalendarEventsForDate(records: CalendarEventRecord[], localDate: string) {
  return cancelledCalendarEventsForRange(records, localDate, localDate);
}

export function trashedCalendarEventsForDate(records: CalendarEventRecord[], localDate: string) {
  return trashedCalendarEventsForRange(records, localDate, localDate);
}

export function calendarEventsForRange(records: CalendarEventRecord[], startDate: string, endDate: string) {
  return eventsForRange(records, startDate, endDate, (record) => record.deleted_at === null && record.data.status === "confirmed");
}

export function cancelledCalendarEventsForRange(records: CalendarEventRecord[], startDate: string, endDate: string) {
  return eventsForRange(records, startDate, endDate, (record) => record.deleted_at === null && record.data.status === "cancelled");
}

export function trashedCalendarEventsForRange(records: CalendarEventRecord[], startDate: string, endDate: string) {
  return eventsForRange(records, startDate, endDate, (record) => record.deleted_at !== null);
}

export function calendarDateRange(localDate: string, view: CalendarRangeView) {
  if (!isValidDateOnly(localDate)) throw new Error("INVALID_CALENDAR_DATE_RANGE");
  if (view === "day") return { startDate: localDate, endDate: localDate };
  const anchor = new Date(`${localDate}T00:00:00Z`);
  if (view === "week") {
    const mondayOffset = (anchor.getUTCDay() + 6) % 7;
    return {
      startDate: shiftLocalDate(anchor, -mondayOffset),
      endDate: shiftLocalDate(anchor, 6 - mondayOffset),
    };
  }
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  return {
    startDate: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    endDate: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
  };
}

function eventsForRange(
  records: CalendarEventRecord[],
  startDate: string,
  endDate: string,
  predicate: (record: CalendarEventRecord) => boolean,
) {
  if (!isValidDateOnly(startDate) || !isValidDateOnly(endDate) || endDate < startDate) {
    throw new Error("INVALID_CALENDAR_DATE_RANGE");
  }
  return records
    .filter((record) => predicate(record) && record.data.local_start_date <= endDate && record.data.local_end_date >= startDate)
    .sort((left, right) => left.data.start_at.localeCompare(right.data.start_at) || left.created_at.localeCompare(right.created_at));
}

function shiftLocalDate(value: Date, days: number) {
  return new Date(value.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function timezoneOffsetMilliseconds(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second")) - value.getTime();
}

export function localDateTimeToIso(localDate: string, localTime: string, timezone: string) {
  if (!isValidDateOnly(localDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime) || !isValidTimezone(timezone)) {
    throw new Error("INVALID_CALENDAR_LOCAL_TIME");
  }
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute] = localTime.split(":").map(Number);
  const desired = Date.UTC(year!, month! - 1, day!, hour!, minute!, 0);
  let instant = desired;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    instant = desired - timezoneOffsetMilliseconds(new Date(instant), timezone);
  }
  const result = new Date(instant);
  const roundTrip = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(result);
  const read = (type: Intl.DateTimeFormatPartTypes) => roundTrip.find((item) => item.type === type)?.value;
  if (`${read("year")}-${read("month")}-${read("day")}` !== localDate || `${read("hour")}:${read("minute")}` !== localTime) {
    throw new Error("INVALID_CALENDAR_LOCAL_TIME");
  }
  return result.toISOString();
}
