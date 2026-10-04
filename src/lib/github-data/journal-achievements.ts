import type { JournalFileStatistics } from "./journal-statistics";

const DAY = 86_400_000;
const LEVELS = ["I", "II", "III", "IV"] as const;

type Streak = { current: number; longest: number };
export type JournalAchievement = {
  id: string; series: string; level: string; name: string; requirement: string;
  target: number; value: number; unit: string; earned: boolean;
  basis: "streak" | "total" | "calendar";
};
export type JournalAchievementSeries = {
  id: string; name: string; current?: number; longest?: number; unit: string;
  badges: JournalAchievement[];
};

// Date keys already belong to the workspace timezone. UTC is used only for
// arithmetic, never to reinterpret an imported date or its submission time.
function dayNumber(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return null;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return null;
  return timestamp / DAY;
}

function streak(periods: Iterable<number>, currentPeriod: number): Streak {
  const sorted = [...new Set(periods)].sort((a, b) => a - b);
  let run = 0;
  let longest = 0;
  let previous = -Infinity;
  for (const period of sorted) {
    run = period === previous + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = period;
  }
  // A period still in progress does not break a streak ending yesterday,
  // last week or last month. Historical awards use the longest achieved run.
  return { current: previous >= currentPeriod - 1 ? run : 0, longest };
}

export function journalAchievements(files: JournalFileStatistics[], todayDate: string) {
  const today = dayNumber(todayDate);
  if (today === null) return null;
  const dates = new Map<string, { day: number; entries: number; words: number }>();
  for (const file of files) {
    const day = dayNumber(file.date);
    if (file.deleted || file.entries === 0 || day === null || day > today) continue;
    const existing = dates.get(file.date) ?? { day, entries: 0, words: 0 };
    existing.entries += file.entries;
    existing.words += file.words;
    dates.set(file.date, existing);
  }
  const weeks = new Map<number, number>();
  const months = new Map<number, number>();
  const calendar = new Map<string, Set<string>>();
  let entries = 0;
  let words = 0;
  const thousandDays: number[] = [];
  for (const [date, value] of dates) {
    const week = Math.floor((value.day + 3) / 7); // Monday starts the week.
    const month = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
    weeks.set(week, (weeks.get(week) ?? 0) + value.words);
    months.set(month, (months.get(month) ?? 0) + value.words);
    entries += value.entries;
    words += value.words;
    if (value.words >= 1000) thousandDays.push(value.day);
    const anniversary = date.slice(5);
    if (anniversary !== "02-29") {
      const years = calendar.get(anniversary) ?? new Set<string>();
      years.add(date.slice(0, 4));
      calendar.set(anniversary, years);
    }
  }
  const thisWeek = Math.floor((today + 3) / 7);
  const thisMonth = Number(todayDate.slice(0, 4)) * 12 + Number(todayDate.slice(5, 7)) - 1;
  const daily = streak([...dates.values()].map((value) => value.day), today);
  const weekly = streak(weeks.keys(), thisWeek);
  const monthly = streak(months.keys(), thisMonth);
  const dailyWriting = streak(thousandDays, today);
  const weeklyWriting = streak([...weeks].filter(([, count]) => count >= 5000).map(([period]) => period), thisWeek);
  const monthlyWriting = streak([...months].filter(([, count]) => count >= 20000).map(([period]) => period), thisMonth);
  const series: JournalAchievementSeries[] = [];

  function add(id: string, name: string, targets: number[], unit: string, requirement: (target: number) => string, names: string[], value: number, run?: Streak) {
    series.push({ id, name, unit, current: run?.current, longest: run?.longest,
      badges: targets.map((target, index) => ({ id: `${id}-${index + 1}`, series: id, level: LEVELS[index], name: names[index], requirement: requirement(target), target, value, unit, earned: value >= target, basis: run ? "streak" : "total" })) });
  }
  const format = (value: number) => value.toLocaleString("zh-CN");
  add("daily", "日日有记", [365, 730, 1095, 1460], "天", (n) => `连续 ${n / 365} 年（${format(n)} 天），每天有记录`, ["一年不辍", "两年不辍", "三年不辍", "四年不辍"], daily.longest, daily);
  add("weekly", "周周相见", [52, 104, 260, 520], "周", (n) => `连续 ${n / 52} 年（${format(n)} 周），每周有记录`, ["一年相见", "两年相伴", "五年同行", "十年如约"], weekly.longest, weekly);
  add("monthly", "月月留痕", [12, 24, 60, 120], "月", (n) => `连续 ${n / 12} 年（${n} 个月），每月有记录`, ["一年留痕", "两年留痕", "五年留痕", "十年留痕"], monthly.longest, monthly);
  add("daily-writing", "每日千字", [14, 30, 60, 100], "天", (n) => `连续 ${n} 天，每天至少 1,000 字`, ["两周笔耕", "一月成习", "六十日深写", "百日长文"], dailyWriting.longest, dailyWriting);
  add("weekly-writing", "每周五千", [26, 52, 104, 156], "周", (n) => `连续 ${n} 周，每周至少 5,000 字`, ["半年笔耕", "一年丰笺", "两年积墨", "三年文集"], weeklyWriting.longest, weeklyWriting);
  add("monthly-writing", "每月两万", [12, 24, 36, 48], "月", (n) => `连续 ${n} 个月，每月至少 20,000 字`, ["一载长篇", "两载成册", "三载成集", "四载成藏"], monthlyWriting.longest, monthlyWriting);
  add("thousand-days", "千字日积", [500, 1000, 1500, 2000], "天", (n) => `累计 ${format(n)} 天，每天至少 1,000 字`, ["五百丰日", "千日笔耕", "千五丰日", "两千丰日"], thousandDays.length);
  add("record-days", "岁月有记", [1000, 2000, 5000, 10000], "天", (n) => `累计记录 ${format(n)} 天`, ["千日留痕", "两千日藏", "五千日记", "万日长藏"], dates.size);
  add("words", "积字成书", [1_000_000, 2_000_000, 3_000_000, 4_000_000], "字", (n) => `累计写作 ${format(n)} 字`, ["百万字笺", "两百万字集", "三百万字藏", "四百万字海"], words);
  series.push({ id: "calendar", name: "四季相逢", unit: "日", badges: [1, 2, 5, 10].map((years, index) => {
    const level = LEVELS[index];
    const value = [...calendar.values()].filter((recordedYears) => recordedYears.size >= years).length;
    return { id: `calendar-${years}`, series: "calendar", level, name: ["一年相逢", "两年重访", "五年相伴", "十年长藏"][index], requirement: `365 个月日，每个在至少 ${years} 个不同年份有记录（不含 2 月 29 日）`, target: 365, value, unit: "日", earned: value === 365, basis: "calendar" };
  }) });
  const badges = series.flatMap((group) => group.badges);
  return { totals: { days: dates.size, entries, words, thousandDays: thousandDays.length }, daily, weekly, monthly, series, earned: badges.filter((badge) => badge.earned), count: badges.length };
}
