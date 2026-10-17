import type { HabitCheckInRecord, HabitCheckInStatus } from "../../../../src/lib/github-data/habit-check-ins";

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

export function habitYearCounts(statuses: Map<string, HabitCheckInStatus>, year: string, today: string) {
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}`;
    const days = [...statuses].filter(([date]) => date.startsWith(`${month}-`) && date <= today);
    return { month, completed: days.filter(([, status]) => status === "completed").length, missed: days.filter(([, status]) => status === "missed").length };
  });
}
