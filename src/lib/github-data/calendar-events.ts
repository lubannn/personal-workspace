import { parseRecord, type WorkspaceRecord } from "./protocol";

export type CalendarEventType = "event" | "time_block";

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
};

export type CalendarEventRecord = WorkspaceRecord<CalendarEventData>;

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
  );
}

export function parseCalendarEventRecord(value: string): CalendarEventRecord {
  const record = parseRecord(value);
  if (record.entity_type !== "calendar_event" || !isValidData(record.data)) {
    throw new Error("INVALID_CALENDAR_EVENT_RECORD");
  }
  return record as CalendarEventRecord;
}

export function createCalendarEventData(input: {
  title: string;
  eventType: CalendarEventType;
  startAt: string;
  endAt: string;
  timezone: string;
  localDate: string;
  linkedTaskId?: string | null;
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
  };
  if (!isValidData(data)) throw new Error("INVALID_CALENDAR_EVENT_DETAILS");
  return data;
}

export function calendarEventsForDate(records: CalendarEventRecord[], localDate: string) {
  return records
    .filter((record) => record.deleted_at === null && record.data.status !== "cancelled" && record.data.local_start_date <= localDate && record.data.local_end_date >= localDate)
    .sort((left, right) => left.data.start_at.localeCompare(right.data.start_at) || left.created_at.localeCompare(right.created_at));
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
