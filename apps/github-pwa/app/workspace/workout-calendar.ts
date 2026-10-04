import { healthLocalParts, type WorkoutRecordRow } from "./health-records";
import { shiftSleepMonth } from "./sleep-calendar";

export const WORKOUT_COLORS = {
  跑步: "run", 骑行: "ride", 游泳: "swim", 步行: "walk", 徒步: "walk", 力量训练: "strength",
} as const;
export type WorkoutCalendarDay = { date: string; workouts: WorkoutRecordRow[]; totalSeconds: number; tone: string };

export function buildWorkoutCalendarDays(rows: WorkoutRecordRow[], timezone: string): WorkoutCalendarDay[] {
  const groups = new Map<string, WorkoutRecordRow[]>();
  for (const row of new Map(rows.map(row => [row.id, row])).values()) {
    const date = healthLocalParts(row.startAt, timezone).date;
    const group = groups.get(date) ?? [];
    group.push(row); groups.set(date, group);
  }
  return [...groups].map(([date, workouts]) => {
    workouts.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.id.localeCompare(b.id));
    const activities = new Set(workouts.map(row => row.activity));
    return { date, workouts, totalSeconds: workouts.reduce((total, row) => total + row.durationSeconds, 0),
      tone: activities.size > 1 ? "mixed" : WORKOUT_COLORS[workouts[0].activity as keyof typeof WORKOUT_COLORS] ?? "other" };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

/** Include empty intermediate months and months present in only one calendar. */
export function healthCalendarMonths(sleep: { date: string }[], workouts: { date: string }[]): string[] {
  const dates = [...sleep, ...workouts].map(day => day.date.slice(0, 7)).sort();
  if (!dates.length) return [];
  const months: string[] = [];
  for (let month = dates[0]; month <= dates.at(-1)!; month = shiftSleepMonth(month, 1)) months.push(month);
  return months;
}

export function formatWorkoutCalendarTime(seconds: number): string {
  const total = Math.round(seconds);
  if (total < 60) return `${total}秒`;
  const minutes = Math.round(total / 60);
  return minutes < 60 ? `${minutes}分` : `${Math.floor(minutes / 60)}时${minutes % 60 ? `${minutes % 60}分` : ""}`;
}
