import { healthLocalParts, type SleepRecordRow } from "./health-records";

export const SLEEP_GRADES = {
  excellent: { label: "优秀", range: "86–100" },
  good: { label: "良好", range: "75–85" },
  fair: { label: "一般", range: "65–74" },
  poor: { label: "欠佳", range: "0–64" },
  unscored: { label: "未评分", range: "" },
} as const;
export type SleepGrade = keyof typeof SLEEP_GRADES;
export type SleepCalendarDay = {
  date: string;
  score: number | null;
  grade: SleepGrade;
  asleepSeconds: number | null;
  mainSeconds: number | null;
  napSeconds: number | null;
  hasIncompleteDuration: boolean;
  hasDateCorrection: boolean;
  napCount: number;
  usesCorosDailyTotal: boolean;
  recordedPeriodSeconds: number;
  hasOverlappingEpisodes: boolean;
  hasConflictingDailyTotals: boolean;
  mainStartAt: string | null;
  mainTimezone: string | null;
};

export function sleepGrade(score: number | null): SleepGrade {
  if (score === null || !Number.isFinite(score) || score < 0 || score > 100) return "unscored";
  return score >= 86 ? "excellent" : score >= 75 ? "good" : score >= 65 ? "fair" : "poor";
}

export function buildSleepCalendarDays(rows: SleepRecordRow[]): SleepCalendarDay[] {
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  const coros = unique.filter((row) => row.source.kind === "coros_mcp");
  // A manual copy of an automatically synced episode must not inflate daily totals.
  const included = unique.filter((row) => row.source.kind === "coros_mcp" || !coros.some((automatic) =>
    Date.parse(row.startAt) < Date.parse(automatic.endAt) && Date.parse(row.endAt) > Date.parse(automatic.startAt)));
  const groups = new Map<string, SleepRecordRow[]>();
  for (const row of included) {
    const date = row.recordDate ?? healthLocalParts(row.endAt, row.timezone).date;
    groups.set(date, [...(groups.get(date) ?? []), row]);
  }
  const sum = (items: SleepRecordRow[]) => {
    if (overlaps(items)) return null;
    const values = items.flatMap((row) => row.asleepSeconds !== null && Number.isFinite(row.asleepSeconds) && row.asleepSeconds >= 0 ? [row.asleepSeconds] : []);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  const overlaps = (items: SleepRecordRow[]) => {
    const ordered = [...items].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
    return ordered.some((row, index) => index > 0 && Date.parse(row.startAt) < Math.max(...ordered.slice(0, index).map(item => Date.parse(item.endAt))));
  };
  return [...groups].map(([date, items]) => {
    const main = items.filter((row) => row.category === "夜间睡眠");
    const naps = items.filter((row) => row.category === "小睡");
    // The current COROS main-sleep score already incorporates naps; never average episode scores.
    const scored = main.filter((row) => row.source.kind === "coros_mcp" && sleepGrade(row.score) !== "unscored")
      .sort((a, b) => Date.parse(b.endAt) - Date.parse(a.endAt) || a.id.localeCompare(b.id));
    const score = scored[0]?.score ?? null;
    const primaryMain = scored[0] ?? [...main].sort((a, b) =>
      Number(b.source.kind === "coros_mcp") - Number(a.source.kind === "coros_mcp")
      || Date.parse(b.endAt) - Date.parse(a.endAt) || a.id.localeCompare(b.id))[0];
    const dailyTotals = items.filter(row => row.source.kind === "coros_mcp" && row.dailySleepSeconds !== null && row.dailySleepSeconds !== undefined)
      .map(row => row.dailySleepSeconds!).filter(value => Number.isFinite(value) && value >= 0);
    const dailyTotal = dailyTotals.length && new Set(dailyTotals).size === 1 ? dailyTotals[0] : null;
    const hasConflictingDailyTotals = new Set(dailyTotals).size > 1;
    const hasOverlappingEpisodes = overlaps(items);
    return { date, score, grade: sleepGrade(score), asleepSeconds: hasConflictingDailyTotals ? null : dailyTotal ?? sum(items), mainSeconds: sum(main), napSeconds: sum(naps),
      usesCorosDailyTotal: dailyTotal !== null,
      recordedPeriodSeconds: items.reduce((total, row) => total + row.durationSeconds, 0),
      hasIncompleteDuration: hasConflictingDailyTotals || (dailyTotal === null && (hasOverlappingEpisodes || items.some((row) => row.asleepSeconds === null || !Number.isFinite(row.asleepSeconds) || row.asleepSeconds < 0))),
      hasOverlappingEpisodes, hasConflictingDailyTotals,
      mainStartAt: primaryMain?.startAt ?? null, mainTimezone: primaryMain?.timezone ?? null,
      hasDateCorrection: items.some((row) => Boolean(row.dateCorrection)), napCount: naps.length };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

/** Keep the stored sleep day and source timezone; details retain the actual local date. */
export function formatMainSleepStart(day?: SleepCalendarDay, compact = false): string {
  if (!day?.mainStartAt || !day.mainTimezone) return compact ? "入睡—" : "主睡眠入睡时间缺失";
  const local = healthLocalParts(day.mainStartAt, day.mainTimezone);
  if (!compact) return `主睡眠入睡 ${local.date} ${local.time}（${day.mainTimezone}）`;
  return `入睡${local.time}`;
}

export function summarizeSleepDays(days: SleepCalendarDay[]) {
  const grades = { excellent: 0, good: 0, fair: 0, poor: 0, unscored: 0 };
  for (const day of days) grades[day.grade]++;
  const complete = days.filter((day) => !day.hasIncompleteDuration && day.asleepSeconds !== null);
  return { count: days.length, grades, completeDays: complete.length,
    averageSeconds: complete.length ? complete.reduce((total, day) => total + day.asleepSeconds!, 0) / complete.length : null };
}

export function formatSleepTime(seconds: number | null, incomplete = false, compact = false): string {
  if (seconds === null) return compact ? "—" : "时长缺失";
  const minutes = Math.round(seconds / 60);
  if (compact) return `${incomplete ? "≥" : ""}${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
  return `${incomplete ? "≥" : ""}${Math.floor(minutes / 60)}时${String(minutes % 60).padStart(2, "0")}分`;
}

export function shiftSleepMonth(month: string, offset: number): string {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

export function sleepCalendarMonths(days: SleepCalendarDay[]): string[] {
  if (!days.length) return [];
  const months: string[] = [];
  const sorted = days.map((day) => day.date.slice(0, 7)).sort();
  for (let month = sorted[0]; month <= sorted.at(-1)!; month = shiftSleepMonth(month, 1)) months.push(month);
  return months;
}

export function sleepMonthCells(month: string): (string | null)[] {
  const [year, number] = month.split("-").map(Number);
  const offset = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: offset }, () => null);
  for (let day = 1; day <= length; day++) cells.push(`${month}-${String(day).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}
