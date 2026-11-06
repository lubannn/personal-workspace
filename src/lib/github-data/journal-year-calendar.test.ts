import { describe, expect, it } from "vitest";
import { journalYearCalendar } from "./journal-year-calendar";
import { journalMonthDays } from "./journal-entries";
const stats = (date: string, deleted = false) => ({ blobSha: date, date, deleted, words: 1000, entries: 5 });
describe("all-years journal calendar", () => {
  it("counts distinct dates rather than submissions, segments or word counts", () => {
    const model = journalYearCalendar([stats("2026-11-01"), stats("2026-11-01"), stats("2026-11-02"), stats("2026-11-03", true), stats("2013-06-07")], "2026");
    expect(model.total).toBe(3); expect(model.yearDays["2026"]).toBe(2); expect(model.monthDays["2026-11"]).toBe(2);
    expect(model.yearDays["2013"]).toBe(1); expect(model.years).toHaveLength(14); expect(model.yearDays["2025"]).toBe(0);
    expect(model.dates.has("2026-11-03")).toBe(false);
  });
  it("uses verified dates instead of stale filename hints after a date correction or deletion", () => {
    const hints = new Set(["2026-10-04", "2026-10-06"]);
    const model = journalYearCalendar([stats("2026-10-05")], "2026", hints, true);
    expect([...model.dates]).toEqual(["2026-10-05"]);
    expect(journalYearCalendar([stats("2026-10-05")], "2026", hints, false).total).toBe(3);
  });
  it("renders real Gregorian month lengths including leap days and Monday-first alignment", () => {
    expect(journalMonthDays("2024-02").filter(Boolean)).toHaveLength(29);
    expect(journalMonthDays("2026-02").filter(Boolean)).toHaveLength(28);
    expect(journalMonthDays("2026-11")[6]).toBe("2026-11-01");
    expect(journalYearCalendar([], "2026").yearDays).toEqual({ "2026": 0 });
  });
});
