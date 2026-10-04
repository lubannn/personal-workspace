import type { CalendarRangeView } from "../../../../src/lib/github-data/calendar-events";

export function shiftCalendarDate(localDate: string, view: CalendarRangeView, direction: -1 | 1) {
  const date = new Date(`${localDate}T12:00:00Z`);
  if (view === "month") {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + direction);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  } else date.setUTCDate(date.getUTCDate() + direction * (view === "week" ? 7 : 1));
  return date.toISOString().slice(0, 10);
}

export function formatCalendarTime(startAt: string, endAt: string, timezone: string) {
  const time = new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const start = new Date(startAt), end = new Date(endAt);
  const crossedDay = day.format(start) !== day.format(end);
  return `${time.format(start)}–${crossedDay ? "次日 " : ""}${time.format(end)}`;
}
