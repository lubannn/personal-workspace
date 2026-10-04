import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SleepRecordRow } from "./health-records";
import { SleepCalendarSection } from "./sleep-calendar-section";
import { buildSleepCalendarDays, formatSleepTime, shiftSleepMonth, sleepCalendarMonths, sleepGrade, sleepMonthCells, summarizeSleepDays } from "./sleep-calendar";

function episode(id: string, patch: Partial<SleepRecordRow> = {}): SleepRecordRow {
  return { id, startAt: "2024-02-01T15:00:00Z", endAt: "2024-02-01T23:00:00Z", recordDate: "2024-02-02",
    timezone: "Asia/Shanghai", source: { kind: "coros_mcp", label: "COROS" }, category: "夜间睡眠",
    durationSeconds: 8 * 3600, asleepSeconds: 7 * 3600, awakeSeconds: 3600, score: 84, dateCorrection: null, ...patch };
}

describe("monthly sleep calendar", () => {
  it("uses the official COROS score bands, including zero, without inferring missing scores", () => {
    expect([0, 59, 60, 64, 65, 74, 75, 85, 86, 100, null, -1, 101, NaN].map(sleepGrade))
      .toEqual(["poor", "poor", "poor", "poor", "fair", "fair", "good", "good", "excellent", "excellent", "unscored", "unscored", "unscored", "unscored"]);
  });

  it("adds actual main sleep and naps to the wake day and retains the updated main-sleep score", () => {
    const main = episode("main", { asleepSeconds: 4 * 3600 + 42 * 60 });
    const nap = episode("nap", { category: "小睡", startAt: "2024-02-02T05:00:00Z", endAt: "2024-02-02T07:40:00Z",
      durationSeconds: 160 * 60, asleepSeconds: 145 * 60, score: null });
    const [day] = buildSleepCalendarDays([nap, main]);
    expect(day).toMatchObject({ date: "2024-02-02", asleepSeconds: 427 * 60, mainSeconds: 282 * 60,
      napSeconds: 145 * 60, score: 84, grade: "good", napCount: 1, hasIncompleteDuration: false });
    expect(formatSleepTime(day.asleepSeconds)).toBe("7时07分");
    expect(formatSleepTime(day.asleepSeconds, false, true)).toBe("7:07");
    expect(summarizeSleepDays([day]).count).toBe(1);
  });
  it("uses COROS's daily total for legacy and multiple-nap days without double-counting or inventing breakdowns", () => {
    const main = episode("legacy", { asleepSeconds: null, dailySleepSeconds: 475 * 60 });
    const nap = episode("nap", { category: "小睡", asleepSeconds: null, score: null });
    const [day] = buildSleepCalendarDays([main, nap]);
    expect(day).toMatchObject({ asleepSeconds: 475 * 60, mainSeconds: null, napSeconds: null,
      usesCorosDailyTotal: true, hasIncompleteDuration: false });
    expect(summarizeSleepDays([day])).toMatchObject({ averageSeconds: 475 * 60, completeDays: 1 });
    const napOnly = buildSleepCalendarDays([{ ...nap, dailySleepSeconds: 50 * 60 }, { ...nap, id: "second" }])[0];
    expect(napOnly).toMatchObject({ asleepSeconds: 50 * 60, grade: "unscored", napCount: 2, hasIncompleteDuration: false });
    expect(buildSleepCalendarDays([main, { ...nap, dailySleepSeconds: 475 * 60 }])[0].asleepSeconds).toBe(475 * 60);
  });

  it("does not count a repeated ID or an overlapping manual copy, but preserves separate manual episodes", () => {
    const main = episode("main");
    const manual = episode("manual", { recordDate: undefined, source: { kind: "manual", label: "手工录入" }, asleepSeconds: null, score: null });
    const separate = episode("separate", { ...manual, id: "separate", category: "小睡", startAt: "2024-02-02T05:00:00Z", endAt: "2024-02-02T06:00:00Z" });
    expect(buildSleepCalendarDays([main, main, manual])[0]).toMatchObject({ asleepSeconds: 25200, hasIncompleteDuration: false });
    expect(buildSleepCalendarDays([main, manual, separate])[0]).toMatchObject({ asleepSeconds: 25200, hasIncompleteDuration: true, napCount: 1 });
  });

  it("marks unknown actual duration as partial instead of adding elapsed time or corrupting averages", () => {
    const main = episode("main");
    const legacy = episode("legacy", { category: "小睡", startAt: "2024-02-02T05:00:00Z", endAt: "2024-02-02T06:00:00Z",
      durationSeconds: 3600, asleepSeconds: null, score: null, dateCorrection: { reason: "coros_legacy_nap_year_1982",
        original_start_at: "1982-02-02T05:00:00Z", original_end_at: "1982-02-02T06:00:00Z" } });
    const complete = episode("complete", { recordDate: "2024-02-03", asleepSeconds: 28800 });
    const days = buildSleepCalendarDays([main, legacy, complete]);
    expect(days[0]).toMatchObject({ asleepSeconds: 25200, hasIncompleteDuration: true, hasDateCorrection: true });
    expect(formatSleepTime(days[0].asleepSeconds, true)).toBe("≥7时00分");
    expect(formatSleepTime(days[0].asleepSeconds, true, true)).toBe("≥7:00");
    expect(summarizeSleepDays(days)).toMatchObject({ count: 2, averageSeconds: 28800, completeDays: 1 });
    const unknown = buildSleepCalendarDays([legacy])[0];
    expect(unknown).toMatchObject({ asleepSeconds: null, grade: "unscored", score: null });
    expect(formatSleepTime(unknown.asleepSeconds, true)).toBe("时长缺失");
    expect(summarizeSleepDays([unknown]).averageSeconds).toBeNull();
  });

  it("uses the local wake date for manual nights and allows nap-only unscored days", () => {
    const manual = episode("manual", { recordDate: undefined, source: { kind: "manual", label: "手工录入" }, score: null });
    expect(buildSleepCalendarDays([manual])[0]).toMatchObject({ date: "2024-02-02", grade: "unscored" });
    expect(buildSleepCalendarDays([episode("nap", { category: "小睡", score: 90 })])[0].grade).toBe("unscored");
    expect(buildSleepCalendarDays([])).toEqual([]);
  });

  it("aligns Monday-first calendar cells across leap years and year boundaries, independent of host timezone", () => {
    const cells = sleepMonthCells("2024-02");
    expect(cells.slice(0, 4)).toEqual([null, null, null, "2024-02-01"]);
    expect(cells.filter(Boolean)).toHaveLength(29);
    expect(cells.at(-4)).toBe("2024-02-29");
    expect(cells.length % 7).toBe(0);
    expect(sleepMonthCells("2025-02").filter(Boolean)).toHaveLength(28);
    expect(sleepMonthCells("2024-01")[0]).toBe("2024-01-01");
    expect(shiftSleepMonth("2024-01", -1)).toBe("2023-12");
    expect(shiftSleepMonth("2023-12", 1)).toBe("2024-01");
    const days = buildSleepCalendarDays([episode("first", { recordDate: "2023-12-01" }), episode("last", { recordDate: "2024-02-01" })]);
    expect(sleepCalendarMonths(days)).toEqual(["2023-12", "2024-01", "2024-02"]);
    expect(sleepCalendarMonths([])).toEqual([]);
  });

  it("renders only the selected latest month with daily labels and totals, and distinguishes absent days from poor sleep", () => {
    const rows = [episode("older", { recordDate: "2024-01-31", score: 59 }), episode("recent")];
    const html = renderToStaticMarkup(createElement(SleepCalendarSection, { rows, timezone: "Asia/Shanghai" }));
    expect(html).toContain("2024年1月"); // Older months remain selectable.
    expect(html).not.toContain("2024年1月睡眠月历");
    expect(html).toContain("2024年2月睡眠月历");
    expect(html).toContain("2024年2月");
    expect(html).toContain("2024-02-02，良好，84分，实际睡眠7时00分");
    expect(html).toContain("2024-02-03，无记录");
    expect(html).toContain("sleep-grade-poor");
    expect(html).toContain("sleep-grade-excellent");
    expect(html).toContain("aria-label=\"查看下一个月份\" disabled");
    expect(html).not.toContain("完整列表");
  });
  it("shows available legacy periods with an explicit marker instead of a blank or invented actual duration", () => {
    const html = renderToStaticMarkup(createElement(SleepCalendarSection, { rows: [episode("legacy", { asleepSeconds: null })], timezone: "Asia/Shanghai" }));
    expect(html).toContain("8:00†");
    expect(html).toContain("记录时段8时00分（含清醒）");
    expect(html).not.toContain("平均睡眠");
  });
});
