import { describe, expect, it } from "vitest";
import { journalAchievements } from "./journal-achievements";
import { journalWordCount, type JournalFileStatistics } from "./journal-statistics";

const file = (date: string, words = 1000, entries = 1, deleted = false): JournalFileStatistics => ({ blobSha: date, date, words, entries, deleted });
function range(start: string, length: number, words = 1000) {
  const time = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length }, (_, i) => file(new Date(time + i * 86_400_000).toISOString().slice(0, 10), words));
}
function series(result: NonNullable<ReturnType<typeof journalAchievements>>, id: string) {
  return result.series.find((item) => item.id === id)!;
}

describe("journal achievements from existing statistics", () => {
  it("aggregates same-date files and imported submission counts before measuring daily writing", () => {
    const result = journalAchievements([file("2026-10-03", 400, 2), file("2026-10-03", 600, 3), file("2026-10-04", 999), file("2026-10-01", 5000, 2, true)], "2026-10-04")!;
    expect(result.totals).toEqual({ days: 2, entries: 6, words: 1999, thousandDays: 1 });
    expect(series(result, "daily-writing").longest).toBe(1);
    expect(result.count).toBe(40);
  });

  it("uses the existing punctuation/English-word/whitespace rule without recounting prose", () => {
    const words = journalWordCount("* 今天 hello world，good!  ");
    expect(words).toBe(7);
    expect(journalAchievements([file("2026-10-04", words)], "2026-10-04")?.totals.words).toBe(7);
  });

  it("retains a streak until the current date passes, and remembers earned historical streaks", () => {
    const files = range("2025-01-01", 200, 999);
    const last = files.at(-1)!.date;
    expect(journalAchievements(files, last)?.daily).toEqual({ current: 200, longest: 200 });
    const nextDay = new Date(Date.parse(`${last}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect(journalAchievements(files, nextDay)?.daily.current).toBe(200);
    const result = journalAchievements(files, "2026-10-04")!;
    expect(result.daily).toEqual({ current: 0, longest: 200 });
    expect(series(result, "daily").badges.map((badge) => badge.earned)).toEqual([true, false, false, false]);
    expect(series(result, "daily-writing").badges[0].earned).toBe(false);
  });

  it("handles leap days, year boundaries and gaps by calendar dates", () => {
    expect(journalAchievements(range("2024-02-28", 3), "2024-03-01")?.daily.longest).toBe(3);
    expect(journalAchievements(range("2025-12-30", 4), "2026-01-02")?.daily.longest).toBe(4);
    expect(journalAchievements([file("2024-02-28"), file("2024-03-01")], "2024-03-01")?.daily.longest).toBe(1);
    expect(journalAchievements([file("2026-02-30"), file("2026-10-05"), file("2026-10-04", 1000, 0)], "2026-10-04")?.totals.days).toBe(0);
    expect(journalAchievements([], "invalid")).toBeNull();
  });

  it("uses Monday weeks and sums the whole week's writing before comparing its threshold", () => {
    const result = journalAchievements([file("2025-12-28", 5000), file("2025-12-29", 2500), file("2026-01-04", 2500), file("2026-01-05", 4999)], "2026-01-05")!;
    expect(result.weekly).toEqual({ current: 3, longest: 3 });
    expect(series(result, "weekly-writing")).toMatchObject({ current: 2, longest: 2 });
    expect(series(result, "monthly-writing").longest).toBe(0);
  });

  it("groups months across years and unlocks qualifying writing runs at the exact threshold", () => {
    const files = Array.from({ length: 12 }, (_, index) => file(`2025-${String(index + 1).padStart(2, "0")}-01`, 20000));
    const result = journalAchievements(files, "2026-01-04")!;
    expect(result.monthly).toEqual({ current: 12, longest: 12 });
    expect(series(result, "monthly").badges[0].earned).toBe(true);
    expect(series(result, "monthly-writing").badges[0].earned).toBe(true);
    expect(series(journalAchievements([...files.slice(0, -1), file("2025-12-01", 19999)], "2026-01-04")!, "monthly-writing").badges[0].earned).toBe(false);
    expect(series(journalAchievements(range("2026-09-21", 14), "2026-10-04")!, "daily-writing").badges[0].earned).toBe(true);
  });

  it("counts anniversary coverage across distinct years without requiring a leap day", () => {
    const oneYear = range("2024-01-01", 366);
    const result = journalAchievements([...oneYear, file("2025-01-01"), file("2025-01-01")], "2026-10-04")!;
    expect(series(result, "calendar").badges.map((badge) => [badge.value, badge.earned])).toEqual([[365, true], [1, false], [0, false], [0, false]]);
    expect(result.totals.days).toBe(367);
    expect(series(journalAchievements([...oneYear, ...range("2025-01-01", 365)], "2026-10-04")!, "calendar").badges[1].earned).toBe(true);
  });

  it("recomputes from changed or deleted summaries and includes only eligible historical dates", () => {
    const files = range("2024-01-01", 1000, 1000);
    const result = journalAchievements(files, "2026-10-04")!;
    expect(series(result, "record-days").badges[0].earned).toBe(true);
    expect(series(result, "words").badges[0].earned).toBe(true);
    expect(series(result, "thousand-days").badges[1].earned).toBe(true);
    const changed = journalAchievements([{ ...files[0], deleted: true }, ...files.slice(1)], "2026-10-04")!;
    expect(changed.totals.days).toBe(999);
    expect(series(changed, "record-days").badges[0].earned).toBe(false);
    expect(series(changed, "words").badges[0].earned).toBe(false);
    expect(files[0].deleted).toBe(false);
  });
});
