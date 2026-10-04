import { healthLocalParts, type WorkoutRecordRow } from "./health-records";
import { shiftSleepMonth } from "./sleep-calendar";

// Assign colors by the exact displayed name, independent of month, order or frequency.
const ACTIVITY_HUES: Record<string, number> = {
  "徒步": 145, "室内跑步": 190, "爬坡": 30, "步行": 85, "跳绳": 275,
  "室内有氧": 355, "羽毛球": 220, "户外跑步": 120, "户外骑行": 55,
  "超慢跑": 315, "室内骑行": 175, "力量训练": 15, "爬楼": 250,
  "跑步": 105, "骑行": 65, "游泳": 200,
};
export function workoutActivityColor(activity: string) {
  let hash = 2166136261;
  for (const char of activity) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619) >>> 0;
  const hue = ACTIVITY_HUES[activity] ?? hash % 360;
  const saturation = ACTIVITY_HUES[activity] !== undefined ? 46 : 36 + (hash >>> 9) % 20;
  return { backgroundColor: `hsl(${hue} ${saturation}% 91%)`, borderColor: `hsl(${hue} ${saturation}% 75%)`, color: `hsl(${hue} 40% 27%)` };
}
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
      tone: activities.size > 1 ? "mixed" : "single" };
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
