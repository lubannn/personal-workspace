import type { JournalFileStatistics } from "./journal-statistics";

export function journalYearCalendar(statistics: readonly JournalFileStatistics[], currentYear: string, knownDates: Iterable<string> = [], complete = true) {
  const dates = new Set(statistics.filter((file) => !file.deleted).map((file) => file.date));
  // Filename hints are only provisional. A fully verified summary is authoritative.
  if (!complete) for (const date of knownDates) dates.add(date);
  const valid = [...dates].filter((date) => /^\d{4}-\d{2}-\d{2}$/u.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date);
  const yearsWithDates = valid.map((date) => Number(date.slice(0, 4)));
  const current = /^\d{4}$/u.test(currentYear) ? Number(currentYear) : yearsWithDates.length ? Math.max(...yearsWithDates) : 1;
  const first = Math.max(1, Math.min(current, ...yearsWithDates));
  const last = Math.min(9999, Math.max(current, ...yearsWithDates));
  const years = Array.from({ length: last - first + 1 }, (_, index) => String(last - index).padStart(4, "0"));
  return { dates: new Set(valid), years, total: valid.length,
    yearDays: Object.fromEntries(years.map((year) => [year, valid.filter((date) => date.startsWith(`${year}-`)).length])),
    monthDays: Object.fromEntries(valid.reduce((counts, date) => counts.set(date.slice(0, 7), (counts.get(date.slice(0, 7)) ?? 0) + 1), new Map<string, number>())) };
}
