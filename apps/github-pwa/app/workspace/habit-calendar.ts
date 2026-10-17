import type { HabitCheckInRecord } from "../../../../src/lib/github-data/habit-check-ins";

export function habitMonthDays(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
  const [year, number] = month.split("-").map(Number);
  const leap = year! % 4 === 0 && (year! % 100 !== 0 || year! % 400 === 0);
  const count = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][number! - 1]!;
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

export function shiftHabitMonth(month: string, offset: number) {
  const [year, number] = month.split("-").map(Number);
  const index = year! * 12 + number! - 1 + offset;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}`;
}

/** One current, non-deleted result per habit and calendar day. */
export function habitDayStatuses(records: HabitCheckInRecord[], habitId: string) {
  const latest = new Map<string, HabitCheckInRecord>();
  for (const record of records) {
    if (record.deleted_at !== null || record.data.habit_id !== habitId) continue;
    const previous = latest.get(record.data.local_date);
    if (!previous || `${record.updated_at}:${record.id}` > `${previous.updated_at}:${previous.id}`) latest.set(record.data.local_date, record);
  }
  return new Map([...latest].map(([date, record]) => [date, record.data.status]));
}

/** Monday-first week columns, padded only outside the selected calendar year. */
export function habitYearWeeks(year: string) {
  if (!/^\d{4}$/.test(year) || Number(year) < 1) return [];
  const dates = Array.from({ length: 12 }, (_, i) => habitMonthDays(`${year}-${String(i + 1).padStart(2, "0")}`)).flat();
  const offset = (new Date(`${year}-01-01T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells: Array<string | null> = [...Array<string | null>(offset).fill(null), ...dates];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, index) => {
    const days = cells.slice(index * 7, index * 7 + 7);
    const start = days.find(date => date?.endsWith("-01"));
    return { days, monthLabel: start ? `${Number(start.slice(5, 7))}月` : null };
  });
}
