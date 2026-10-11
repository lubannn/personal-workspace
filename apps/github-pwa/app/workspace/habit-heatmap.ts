import { activeHabits, type HabitRecord } from "../../../../src/lib/github-data/habits";
import type { HabitCheckInRecord, HabitCheckInStatus } from "../../../../src/lib/github-data/habit-check-ins";

export type HabitHeatmapEntry = { id: string; name: string; status: HabitCheckInStatus | "none" };
export type HabitHeatmapDay = { date: string; future: boolean; entries: HabitHeatmapEntry[]; completed: number; level: number };

/** A read-only projection of confirmed local-date check-ins, never inferred misses. */
export function buildHabitHeatmap(habits: HabitRecord[], checkIns: HabitCheckInRecord[], today: string, selectedMonth = today.slice(0, 7)) {
  const parsed = new Date(`${today}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(today) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== today) return null;
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(selectedMonth)) return null;
  const month = selectedMonth;
  const visible = activeHabits(habits);
  const ids = new Set(visible.map((habit) => habit.id));
  const latest = new Map<string, HabitCheckInRecord>();
  for (const record of checkIns) {
    if (record.deleted_at !== null || !ids.has(record.data.habit_id) || !record.data.local_date.startsWith(`${month}-`) || record.data.local_date > today) continue;
    const key = `${record.data.habit_id}:${record.data.local_date}`;
    const previous = latest.get(key);
    if (!previous || record.updated_at > previous.updated_at || (record.updated_at === previous.updated_at && record.id > previous.id)) latest.set(key, record);
  }
  const count = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
  const days: HabitHeatmapDay[] = Array.from({ length: count }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    const future = date > today;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
    const entries = future ? [] : visible.flatMap((habit) => {
      const record = latest.get(`${habit.id}:${date}`);
      const scheduled = habit.data.status === "active" && habit.data.start_date <= date && (habit.data.end_date === null || date <= habit.data.end_date)
        && (habit.data.schedule_json.frequency === "daily" || habit.data.schedule_json.weekdays.includes(weekday));
      return record || scheduled ? [{ id: habit.id, name: habit.data.name, status: record?.data.status ?? "none" as const }] : [];
    });
    const completed = entries.filter((entry) => entry.status === "completed").length;
    return { date, future, entries, completed, level: completed === 0 ? 0 : Math.ceil(completed / entries.length * 4) };
  });
  const rows = visible.map((habit) => ({ habit, cells: days.map((day) => ({ date: day.date,
    status: day.future ? "future" as const : day.entries.find((entry) => entry.id === habit.id)?.status ?? "not_scheduled" as const,
  })), completed: days.filter((day) => day.entries.some((entry) => entry.id === habit.id && entry.status === "completed")).length }));
  return { month, habits: visible, rows, days, offset: (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7,
    completed: days.reduce((sum, day) => sum + day.completed, 0) };
}
