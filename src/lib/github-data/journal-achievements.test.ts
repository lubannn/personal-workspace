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
    const files = range("2025-01-01", 365, 999);
    const last = files.at(-1)!.date;
    expect(journalAchievements(files, last)?.daily).toEqual({ current: 365, longest: 365 });
    const nextDay = new Date(Date.parse(`${last}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect(journalAchievements(files, nextDay)?.daily.current).toBe(365);
    const result = journalAchievements(files, "2026-10-04")!;
    expect(result.daily).toEqual({ current: 0, longest: 365 });
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

  it("uses the requested four levels and leaves the other five series unchanged", () => {
    const result = journalAchievements([], "2026-10-04")!;
    for (const [id, targets] of Object.entries({ daily: [365, 730, 1095, 1460], weekly: [52, 104, 260, 520], monthly: [12, 24, 60, 120], "record-days": [1000, 2000, 5000, 10000], "daily-writing": [14, 30, 60, 100], "weekly-writing": [26, 52, 104, 156], "monthly-writing": [12, 24, 36, 48], "thousand-days": [500, 1000, 1500, 2000], words: [1_000_000, 2_000_000, 3_000_000, 4_000_000] })) {
      expect(series(result, id).badges.map((badge) => badge.target)).toEqual(targets);
      expect(series(result, id).badges.map((badge) => badge.level)).toEqual(["I", "II", "III", "IV"]);
    }
    expect(series(result, "calendar").name).toBe("四季相逢");
    expect(series(result, "calendar").badges.map((badge) => badge.id)).toEqual(["calendar-1", "calendar-2", "calendar-5", "calendar-10"]);
    expect(series(journalAchievements(range("2025-01-01", 200), "2026-10-04")!, "daily").badges.every((badge) => !badge.earned)).toBe(true);
    expect(result.count).toBe(40);
  });

  it.each([
    ...[365, 730, 1095, 1460].map((target, index) => ({ id: "daily", target, index })),
    ...[52, 104, 260, 520].map((target, index) => ({ id: "weekly", target, index })),
    ...[12, 24, 60, 120].map((target, index) => ({ id: "monthly", target, index })),
    ...[1000, 2000, 5000, 10000].map((target, index) => ({ id: "record-days", target, index })),
  ])("unlocks $id level $index only at its exact $target threshold", ({ id, target, index }) => {
    const files = id === "weekly" ? Array.from({ length: target }, (_, i) => file(new Date(Date.UTC(2010, 0, 4 + i * 7)).toISOString().slice(0, 10), 1))
      : id === "monthly" ? Array.from({ length: target }, (_, i) => file(new Date(Date.UTC(2010, i, 1)).toISOString().slice(0, 10), 1))
        : range("1990-01-01", target, 1);
    const before = series(journalAchievements(files.slice(0, -1), "2026-10-04")!, id).badges[index];
    const at = series(journalAchievements([...files, { ...files[0], entries: 3 }], "2026-10-04")!, id).badges[index];
    expect(before).toMatchObject({ value: target - 1, earned: false });
    expect(at).toMatchObject({ value: target, earned: true });
    expect(at.name).not.toMatch(/两百|千五日记|两千五百/u);
    if (id !== "record-days") expect(at.requirement).toContain(`${target / (id === "weekly" ? 52 : id === "monthly" ? 12 : 365)} 年`);
  });

  it.each([1, 2, 5, 10])("requires all 365 month-days in %s distinct years for anniversary coverage", (years) => {
    const files = Array.from({ length: years }, (_, index) => range(`${2010 + index * 2}-01-01`, 366, 1).filter((item) => item.date.startsWith(`${2010 + index * 2}-`) && !item.date.endsWith("02-29"))).flat();
    const result = journalAchievements(files, "2030-10-04")!;
    const badge = series(result, "calendar").badges.find((item) => item.id === `calendar-${years}`)!;
    expect(badge).toMatchObject({ target: 365, value: 365, earned: true });
    expect(badge.requirement).toContain(`至少 ${years} 个不同年份`);
    const missingDay = series(journalAchievements(files.slice(0, -1), "2030-10-04")!, "calendar").badges.find((item) => item.id === badge.id)!;
    expect(missingDay).toMatchObject({ value: 364, earned: false });
    const duplicateYear = series(journalAchievements([...files.slice(0, -1), ...files.slice(0, 364)], "2030-10-04")!, "calendar").badges.find((item) => item.id === badge.id)!;
    expect(duplicateYear.earned).toBe(false);
  });
});
