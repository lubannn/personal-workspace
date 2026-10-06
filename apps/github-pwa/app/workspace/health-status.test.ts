import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createAutomaticHealthMetricData, parseHealthMetricRecord } from "../../../../src/lib/github-data/health-metrics";
import { createWorkspaceRecord, recordPath, serializeRecord } from "../../../../src/lib/github-data/protocol";
import type { SyncedHealthMetric } from "./page-model";
import { buildHealthBaseline, buildHealthStatusDays, classifyHealthDay, healthBaselineRange, healthQuantile, type HealthStatusDay } from "./health-status";
import { buildSleepCalendarDays } from "./sleep-calendar";
import { SleepCalendarSection } from "./sleep-calendar-section";
import type { SleepRecordRow } from "./health-records";

const timestamp = "2024-03-03T00:00:00Z";
const source = { kind: "coros_mcp" as const, source_id: "synthetic", source_sha256: "a".repeat(64), mapping_version: 1 as const, retrieved_at: timestamp };
const knownSleep = buildSleepCalendarDays([{ id: "known_sleep", startAt: "2024-02-01T15:00:00Z", endAt: "2024-02-01T23:00:00Z", recordDate: "2024-02-02",
  timezone: "Asia/Shanghai", source: { kind: "coros_mcp", label: "COROS" }, category: "夜间睡眠", durationSeconds: 28800,
  asleepSeconds: 25200, awakeSeconds: 3600, score: 90, dateCorrection: null }])[0];
export function syntheticMetric(id: string, type: string, value: number, unit: string, date = "2024-02-02", complete?: boolean): SyncedHealthMetric {
  const record = createWorkspaceRecord({ entityType: "health_metric", id, ownerId: "synthetic_owner", timestamp,
    data: createAutomaticHealthMetricData({ metric_type: type, value, unit, local_date: date, measured_at: timestamp, timezone: "Asia/Shanghai", aggregation_period: "daily" }, source, complete) });
  return { record, path: recordPath("health_metric", id), blobSha: "a".repeat(40) };
}
const day = (patch: Partial<HealthStatusDay> = {}): HealthStatusDay => ({ date: "2024-02-02", dayComplete: true, sleep: knownSleep, sleepScore: 90,
  steps: 2000, exerciseMinutes: 20, activeCalories: 200, elevationGainMeters: 10, trainingLoad: 10, recoveryPct: 90, hrvMs: 40, hrvBaselineMs: 40, hrvNormalRangeLowMs: 30, restingBpm: 50, ...patch });
const baseDays = Array.from({ length: 21 }, (_, index) => day({ date: `2024-01-${String(index + 1).padStart(2, "0")}`, steps: 1000 + index * 100, exerciseMinutes: 10 + index, activeCalories: 100 + index * 10, elevationGainMeters: index, trainingLoad: index }));
const baseline = buildHealthBaseline(baseDays);
const grade = (patch: Partial<HealthStatusDay> = {}) => classifyHealthDay(day(patch), baseline);

describe("reviewed COROS health status rules", () => {
  it("matches the historical recovery exception while retaining HRV pressure and never treating training load as recovery", () => {
    const historical = (patch: Partial<HealthStatusDay>) => classifyHealthDay(day({ recoveryPct: undefined, ...patch }), baseline, "2024-02-03");
    expect(historical({ sleepScore: 96, hrvMs: 45 })).toMatchObject({ status: "good", recoveryNotIncluded: true });
    expect(historical({ sleepScore: 97, hrvMs: 25 })).toMatchObject({ status: "rest", recoveryNotIncluded: true });
    expect(historical({ sleepScore: 96, hrvMs: undefined, trainingLoad: 12 })).toMatchObject({ status: "good", limited: true, missing: expect.arrayContaining(["HRV"]) });
    expect(classifyHealthDay(day({ recoveryPct: undefined, trainingLoad: 12 }), baseline, "2024-02-02").missing).toContain("恢复");
  });
  it("omits absent historical measurements while preserving evidence and priority", () => {
    const historical = (patch: Partial<HealthStatusDay> = {}) => classifyHealthDay(day({ recoveryPct: undefined, ...patch }), baseline, "2024-02-03");
    expect(historical()).toMatchObject({ status: "good", missing: [], recoveryNotIncluded: true, reasons: expect.arrayContaining(["未纳入恢复数据"]) });
    expect(historical().reasons.join(" ")).not.toContain("睡眠与恢复均");
    expect(historical({ sleepScore: 80 }).status).toBe("steady");
    expect(historical({ hrvMs: undefined })).toMatchObject({ status: "good", missing: expect.arrayContaining(["HRV"]) });
    expect(historical({ restingBpm: undefined }).missing).toContain("静息心率");
    expect(classifyHealthDay(day({ recoveryPct: undefined }), buildHealthBaseline(baseDays.slice(0, 20)), "2024-02-03").missing).toContain("静息心率基线（20/21）");
    expect(historical({ sleepScore: 69, steps: 2800 }).status).toBe("rest");
    expect(historical({ steps: 2800, hrvMs: 20 }).status).toBe("active");
    expect(historical({ hrvMs: 20 }).status).toBe("rest");
    expect(historical({ recoveryPct: 60 })).toMatchObject({ status: "rest" });
    expect(historical({ recoveryPct: 80 }).status).toBe("steady");
    expect(historical({ partialSignals: ["recoveryPct"] }).missing).toContain("恢复尚未完整");
    expect(classifyHealthDay(day({ recoveryPct: undefined }), baseline, "2024-02-02").missing).toContain("恢复");
  });
  it("uses 90 local dates across a month boundary and an explicit historical cutoff", () => {
    expect(healthBaselineRange("2024-03", "2024-03-01")).toEqual({ start: "2023-12-03", end: "2024-03-01" });
    expect(healthBaselineRange("2024-01", "2024-03-01")).toEqual({ start: "2023-11-03", end: "2024-01-31" });
    const crossMonth = baseDays.map((item, index) => ({ ...item, date: new Date(Date.parse("2024-02-09") + index * 86400_000).toISOString().slice(0, 10) }));
    expect(buildHealthBaseline(crossMonth, healthBaselineRange("2024-03", "2024-03-01")).restingBpm.count).toBe(21);
  });
  it("uses official HRV assessment without 21 HRV samples and preserves other metric samples", () => {
    const reference = buildHealthBaseline(baseDays.map(item => ({ ...item, hrvMs: undefined, trainingLoad: undefined, partialSignals: ["steps"] })));
    expect(reference.hrvMs.count).toBe(0); expect(reference.steps.count).toBe(0);
    expect(reference.restingBpm.count).toBe(21); expect(reference.exerciseMinutes.count).toBe(21);
    expect(classifyHealthDay(day({ hrvMs: 29 }), reference).status).toBe("rest");
    expect(classifyHealthDay(day(), reference).status).toBe("good");
    expect(classifyHealthDay(day({ hrvBaselineMs: undefined, hrvMs: 35 }), reference).status).toBe("steady");
  });
  it("ports strict sleep/recovery boundaries, including zero, and positive rating requires both", () => {
    expect([0, 69, 69.99, 70, 89.99, 90, 100].map(sleepScore => grade({ sleepScore }).status)).toEqual(["rest", "rest", "rest", "steady", "steady", "good", "good"]);
    expect([0, 69, 70, 89, 90, 100].map(recoveryPct => grade({ recoveryPct }).status)).toEqual(["rest", "rest", "steady", "steady", "good", "good"]);
    for (const absent of [null, undefined, NaN, Infinity, -1, 101]) expect(grade({ sleepScore: absent }).status).toBe("insufficient");
    expect(grade({ recoveryPct: undefined }).status).toBe("insufficient");
  });
  it("uses COROS HRV range before fallback p20, strict lower boundary and observed personal baseline", () => {
    expect(grade({ hrvMs: 29.9 }).status).toBe("rest");
    expect(grade({ hrvMs: 30 }).status).toBe("steady");
    expect(grade({ hrvMs: 39.9 }).status).toBe("steady");
    expect(grade({ hrvNormalRangeLowMs: undefined, hrvMs: 39.9 }).status).toBe("rest");
    expect(grade({ hrvNormalRangeLowMs: undefined, hrvMs: 40 }).status).toBe("good");
    expect(grade({ hrvNormalRangeLowMs: 30, hrvMs: 35 }).status).toBe("steady");
    expect(grade({ hrvMs: undefined }).status).toBe("insufficient");
  });
  it("uses max(p80, median+5) for rest and median+2 for good, inclusive boundaries", () => {
    expect([50, 52, 52.01, 54.99, 55].map(restingBpm => grade({ restingBpm }).status)).toEqual(["good", "good", "steady", "steady", "rest"]);
    const varied = buildHealthBaseline(baseDays.map((item, i) => ({ ...item, restingBpm: 40 + i })));
    expect(classifyHealthDay(day({ restingBpm: 55 }), varied).status).toBe("steady");
    expect(classifyHealthDay(day({ restingBpm: 56 }), varied).status).toBe("rest");
  });
  it("uses per-metric 21 complete days, linear percentiles, and never substitutes missing activity with zero", () => {
    expect(healthQuantile([0, 10, 20, 30], .2)).toBeCloseTo(6);
    const insufficient = buildHealthBaseline([...baseDays.slice(0, 20), day({ dayComplete: false })]);
    expect(insufficient.restingBpm.count).toBe(20);
    expect(classifyHealthDay(day({ restingBpm: 150 }), insufficient).status).toBe("insufficient");
    expect(baseline.steps.p80).toBe(2600);
    expect(baseline.steps.p90).toBe(2800);
    expect(grade({ steps: 2600 }).status).toBe("good");
    expect(grade({ steps: 2600, exerciseMinutes: 26 }).status).toBe("active");
    expect(grade({ steps: 2800 }).status).toBe("active");
    expect(grade({ steps: 2800, dayComplete: false }).status).toBe("insufficient");
    expect(buildHealthBaseline([day({ trainingLoad: undefined })]).trainingLoad.count).toBe(0);
    const constant = buildHealthBaseline(baseDays.map(item => ({ ...item, steps: 0 })));
    expect(classifyHealthDay(day({ steps: 0 }), constant).status).toBe("good");
  });
  it("keeps independent activity branches from imposing unrelated positive-rating gates", () => {
    expect(grade({ sleepScore: 80, steps: undefined })).toMatchObject({ status: "steady", unavailable: expect.arrayContaining(["步数"]) });
    expect(grade({ trainingLoad: undefined }).status).toBe("good");
    const sparse = buildHealthBaseline(baseDays.map((item, i) => ({ ...item, steps: i === 0 ? undefined : item.steps })));
    expect(classifyHealthDay(day(), sparse)).toMatchObject({ status: "good", unavailable: expect.arrayContaining(["步数基线（20/21）"]) });
    expect(grade({ sleepScore: 69, steps: undefined }).status).toBe("rest");
    expect(grade({ steps: 2800, trainingLoad: undefined, hrvMs: 20 }).status).toBe("active");
  });
  it("restricts personal baselines to the requested date range instead of borrowing other months", () => {
    expect(buildHealthBaseline(baseDays, { start: "2024-02-01", end: "2024-02-29" }).restingBpm.count).toBe(0);
    const window = buildHealthBaseline([...baseDays, ...baseDays.map(item => ({ ...item, date: item.date.replace("01-", "02-"), restingBpm: 80 }))],
      { start: "2024-01-01", end: "2024-01-31" });
    expect(window.restingBpm).toMatchObject({ count: 21, median: 50 });
    expect(classifyHealthDay(day({ restingBpm: 55 }), window).status).toBe("rest");
  });
  it("preserves the source priority: low sleep/recovery, activity, physiological pressure, good, steady", () => {
    expect(grade({ sleepScore: 69, steps: 2800, hrvMs: 20 }).status).toBe("rest");
    expect(grade({ steps: 2800, hrvMs: 20 }).status).toBe("active");
    expect(grade({ hrvMs: 20 }).status).toBe("rest");
    expect(grade({ sleepScore: 80 }).status).toBe("steady");
  });
  it("grades today provisionally from current observations and recomputes after updates", () => {
    const current = (patch: Partial<HealthStatusDay> = {}) => day({ dayComplete: false, partialReason: "today", ...patch });
    const rate = (patch: Partial<HealthStatusDay> = {}) => classifyHealthDay(current(patch), baseline, "2024-02-02");
    expect(rate({ sleepScore: 84 })).toMatchObject({ status: "steady", provisional: true, missing: [],
      reasons: expect.arrayContaining(["当天暂定评级，后续数据更新时重算"]) });
    expect(rate({ sleepScore: 96 }).status).toBe("good");
    expect(rate({ sleepScore: 60, steps: 5000 }).status).toBe("rest");
    expect(rate({ steps: 3000, partialSignals: ["steps"] })).toMatchObject({ status: "active", provisional: true, used: expect.arrayContaining(["步数"]) });
    expect(rate({ recoveryPct: undefined })).toMatchObject({ status: "good", missing: ["恢复"], limited: true });
    expect(rate({ partialReason: "source", partialSignals: ["steps"], steps: 5000 }).status).toBe("good");
    expect(buildHealthBaseline([...baseDays, current({ restingBpm: 200, steps: 50000 })]).restingBpm).toEqual(baseline.restingBpm);
    expect(buildHealthBaseline([...baseDays, current({ restingBpm: 200, steps: 50000 })]).steps).toEqual(baseline.steps);
    const tomorrow = classifyHealthDay(day(), baseline, "2024-02-03");
    expect(tomorrow.provisional).toBe(false);
    expect(tomorrow.reasons).not.toContain("当天暂定评级，后续数据更新时重算");
  });
  it("does not turn sleep-only, nap-only, or entirely absent signals into a combined positive label", () => {
    const empty = buildHealthBaseline([]);
    expect(classifyHealthDay({ date: "2024-02-02", dayComplete: false, partialReason: "today", sleep: knownSleep, sleepScore: 95 }, empty)).toMatchObject({ status: "insufficient", missing: expect.arrayContaining(["恢复", "HRV", "静息心率", "当天尚未结束"]) });
    expect(classifyHealthDay({ date: "2024-02-02", dayComplete: false, sleepScore: 60 }, empty).status).toBe("rest");
    expect(classifyHealthDay({ date: "2024-02-02", dayComplete: false }, empty).status).toBe("rest");
  });
});

describe("health metric adaptation and calendar", () => {
  it("does not demand a true flag for historical data or let an instant observation exclude daily samples", () => {
    const metrics = baseDays.flatMap((item, index) => [syntheticMetric(`rhr_${index}`, "resting_heart_rate", 50, "bpm", item.date),
      ...(index === 0 ? [] : [syntheticMetric(`steps_${index}`, "steps", 1000, "steps", item.date)])]);
    const observed = syntheticMetric("recovery_observation", "recovery_percentage", 80, "%", "2024-01-01");
    observed.record.data.aggregation_period = "instant"; observed.record.data.measured_at = "2024-01-01T04:00:00Z";
    if (observed.record.data.health_metric_version === 2) observed.record.data.measurement_time_kind = "observed_at";
    const days = buildHealthStatusDays([], [...metrics, observed], "2024-02-02");
    expect(days.every(item => item.dayComplete)).toBe(true);
    expect(buildHealthBaseline(days).restingBpm.count).toBe(21); expect(buildHealthBaseline(days).steps.count).toBe(20);
    expect(days[0].recoveryObservedAt).toBe("2024-01-01T04:00:00Z");
    const explicitPartial = buildHealthStatusDays([], [...metrics, syntheticMetric("partial", "steps", 100, "steps", "2024-01-01", false)], "2024-02-02");
    expect(explicitPartial[0]).toMatchObject({ dayComplete: false, partialReason: "source" });
    expect(buildHealthBaseline(explicitPartial).restingBpm.count).toBe(21);
    expect(buildHealthBaseline(explicitPartial).steps.count).toBe(20);
  });
  const episode = (patch: Partial<SleepRecordRow> = {}): SleepRecordRow => ({ id: "synthetic_sleep", startAt: "2024-02-01T15:00:00Z", endAt: "2024-02-01T23:00:00Z", recordDate: "2024-02-02",
    timezone: "Asia/Shanghai", source: { kind: "coros_mcp", label: "COROS" }, category: "夜间睡眠", durationSeconds: 28800, asleepSeconds: 25200, awakeSeconds: 3600, score: 95, dateCorrection: null, ...patch });
  it("renders today's current rating and recomputes its visible status when the sleep record changes", () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2024-02-02T04:00:00Z");
    try {
      const render = (score: number) => renderToStaticMarkup(createElement(SleepCalendarSection, { rows: [episode({ score })], timezone: "Asia/Shanghai" }));
      const before = render(84);
      expect(before).toContain("平稳·暂定</strong>");
      expect(before).toContain("2024-02-02，平稳（暂定）");
      expect(before).not.toContain("待补指标</strong>");
      const after = render(65);
      expect(after).toContain("需休息·暂定</strong>");
      expect(after).toContain("当天暂定评级，后续数据更新时重算");
    } finally { vi.useRealTimers(); }
  });
  it("prioritizes confirmed sleep below three hours without a main onset across months and on today", () => {
    for (const date of ["2024-02-02", "2024-03-02", "2024-03-03"]) {
      const sleep = buildSleepCalendarDays([episode({ recordDate: date, category: "小睡", asleepSeconds: 10799, score: null })])[0];
      const adapted = buildHealthStatusDays([sleep], [], "2024-03-03")[0];
      const rating = classifyHealthDay({ ...adapted, steps: 10000 }, baseline, "2024-03-03");
      expect(rating).toMatchObject({ status: "rest", used: expect.arrayContaining(["总睡眠时长"]),
        reasons: expect.arrayContaining(["总睡眠低于 3 小时且主睡眠入睡时间缺失"]) });
    }
  });
  it("rates an unavailable total as zero only for the user rule, retaining source missingness", () => {
    const nap = buildSleepCalendarDays([episode({ category: "小睡", asleepSeconds: 10799, score: null })])[0];
    const check = (sleep: typeof nap) => classifyHealthDay(day({ sleep, steps: 10000 }), baseline, "2024-03-03");
    for (const sleep of [
      { ...nap, asleepSeconds: 10800 },
      { ...nap, mainStartAt: timestamp, mainTimezone: "Asia/Shanghai" },
    ]) expect(check(sleep).status).toBe("active");
    for (const sleep of [
      { ...nap, asleepSeconds: null, recordedPeriodSeconds: 1800 },
      { ...nap, hasIncompleteDuration: true },
      { ...nap, hasConflictingDailyTotals: true },
      { ...nap, asleepSeconds: NaN },
      { ...nap, asleepSeconds: -1 },
    ]) {
      expect(check(sleep)).toMatchObject({ status: "rest", reasons: expect.arrayContaining(["总睡眠数据不可用，按用户规则视为 0 小时，且主睡眠入睡时间缺失"]) });
      expect(check(sleep).used).not.toContain("总睡眠时长");
      expect(check({ ...sleep, mainStartAt: timestamp, mainTimezone: "Asia/Shanghai" }).status).toBe("active");
    }
    expect(classifyHealthDay(day({ sleep: undefined, steps: 10000 }), baseline, "2024-03-03").status).toBe("rest");
    expect(nap.asleepSeconds).toBe(10799);
    expect(check({ ...nap, asleepSeconds: 0 }).status).toBe("rest");
    // A COROS daily total is valid even when individual nap durations are absent.
    const dailyTotal = buildSleepCalendarDays([episode({ category: "小睡", asleepSeconds: null, dailySleepSeconds: 1800, score: null })])[0];
    expect(check(dailyTotal).status).toBe("rest");
  });
  it("deduplicates daily totals, rejects wrong units/manual/instant/deleted/future values and retains zero", () => {
    const steps = syntheticMetric("steps", "steps", 0, "steps", "2024-02-02", true);
    const older = syntheticMetric("older", "steps", 1000, "steps", "2024-02-02", true); older.record.data.measured_at = "2024-03-02T00:00:00Z";
    const bad = syntheticMetric("bad", "recovery_percentage", 99, "bpm");
    const removed = syntheticMetric("removed", "sleep_hrv_avg", 99, "ms"); removed.record.deleted_at = timestamp;
    const instant = syntheticMetric("instant", "sleep_hrv_avg", 99, "ms"); instant.record.data.aggregation_period = "instant";
    const manual = { ...steps, record: { ...steps.record, data: { ...steps.record.data, health_metric_version: 1 } } } as unknown as SyncedHealthMetric;
    const result = buildHealthStatusDays([], [steps, steps, older, bad, removed, instant, manual, syntheticMetric("future", "steps", 999, "steps", "2025-01-01")], "2024-03-03");
    expect(result).toEqual([{ date: "2024-02-02", dayComplete: true, steps: 0 }]);
    expect(buildHealthStatusDays([], [syntheticMetric("unknown", "steps", 1, "steps")], "2024-03-03")[0].dayComplete).toBe(true);
    const todayDays = buildHealthStatusDays([], [steps], "2024-02-02");
    expect(todayDays[0]).toMatchObject({ dayComplete: false, partialReason: "today" }); // source cannot close local today
    expect(buildHealthBaseline(todayDays).steps.count).toBe(0);
    expect(buildHealthStatusDays([], [syntheticMetric("today_unknown", "steps", 10, "steps")], "2024-02-02")[0]).toMatchObject({ dayComplete: false, partialReason: "today" });
    const conflict = syntheticMetric("conflict", "steps", 100, "steps", "2024-02-02", true);
    expect(buildHealthStatusDays([], [steps, conflict], "2024-03-03")[0]).toEqual({ date: "2024-02-02", dayComplete: true });
    conflict.record.data.measured_at = "2024-03-03T08:00:00+08:00";
    expect(buildHealthStatusDays([], [steps, conflict], "2024-03-03")[0]).toEqual({ date: "2024-02-02", dayComplete: true });
  });
  it("preserves recovery observation risk with its true date and excludes archived metric revisions", () => {
    const recovery = syntheticMetric("point", "recovery_percentage", 60, "%", "2024-03-03");
    if (recovery.record.data.health_metric_version !== 2) throw new Error();
    recovery.record.data.aggregation_period = "instant"; recovery.record.data.measurement_time_kind = "observed_at";
    const archived = syntheticMetric("archived", "recovery_percentage", 1, "%", "2024-03-03");
    if (archived.record.data.health_metric_version !== 2) throw new Error(); archived.record.data.revision_of = "point";
    const days = buildHealthStatusDays([], [recovery, archived], "2024-03-03");
    expect(days).toHaveLength(1); expect(days[0]).toMatchObject({ date: "2024-03-03", dayComplete: false, recoveryPct: 60, recoveryObservedAt: timestamp });
    expect(classifyHealthDay(days[0], buildHealthBaseline([]))).toMatchObject({ status: "rest", reasons: expect.arrayContaining(["同步观测时恢复低于 70%"]), recoveryObservedAt: timestamp });
    recovery.record.data.local_date = "2024-03-02"; expect(buildHealthStatusDays([], [recovery], "2024-03-03")).toEqual([]);
  });
  it("keeps completeness evidence optional and rejects it on instant records", () => {
    const legacy = syntheticMetric("old", "steps", 10, "steps");
    expect(parseHealthMetricRecord(serializeRecord(legacy.record)).data).not.toHaveProperty("day_complete");
    const complete = syntheticMetric("complete", "steps", 10, "steps", "2024-02-02", true);
    expect(parseHealthMetricRecord(serializeRecord(complete.record)).data).toHaveProperty("day_complete", true);
    complete.record.data.aggregation_period = "instant";
    expect(() => parseHealthMetricRecord(serializeRecord(complete.record))).toThrow("INVALID_HEALTH_METRIC_RECORD");
  });
  it("preserves wake-date, naps, explicit daily totals and partial duration independently from the rating", () => {
    const main = episode({ asleepSeconds: 282 * 60 });
    const nap = episode({ id: "nap", category: "小睡", startAt: "2024-02-02T05:00:00Z", endAt: "2024-02-02T07:40:00Z", durationSeconds: 9600, asleepSeconds: 145 * 60, score: null });
    const sleep = buildSleepCalendarDays([main, nap]);
    expect(buildHealthStatusDays(sleep, [], "2024-03-03")[0].sleep).toMatchObject({ date: "2024-02-02", asleepSeconds: 427 * 60, napCount: 1 });
    const daily = buildSleepCalendarDays([episode({ dailySleepSeconds: 475 * 60, asleepSeconds: null }), { ...nap, asleepSeconds: null }]);
    expect(buildHealthStatusDays(daily, [], "2024-03-03")[0].sleep).toMatchObject({ asleepSeconds: 475 * 60, hasIncompleteDuration: false, usesCorosDailyTotal: true });
  });
  it("renders composite labels and total duration, shows known adverse evidence and metric-only days", () => {
    const html = renderToStaticMarkup(createElement(SleepCalendarSection, { rows: [episode()], timezone: "Asia/Shanghai", healthMetrics: [syntheticMetric("low", "recovery_percentage", 60, "%")] }));
    expect(html).toContain("综合健康月历"); expect(html).toContain("health-status-rest");
    expect(html).toContain("2024-02-02，需要休息，总睡眠7时00分，主睡眠入睡 2024-02-01 23:00（Asia/Shanghai），COROS 睡眠95分");
    expect(html).toContain("7:00"); expect(html).toContain("不作医学诊断");
    const noSleep = renderToStaticMarkup(createElement(SleepCalendarSection, { rows: [], timezone: "Asia/Shanghai", healthMetrics: [syntheticMetric("low", "recovery_percentage", 60, "%")] }));
    expect(noSleep).toContain("总睡眠时长缺失"); expect(noSleep).toContain("需休息");
  });
  it("renders a positive historical rating with the recovery omission disclosed", () => {
    const metrics = [...baseDays.map((item, index) => syntheticMetric(`baseline_rhr_${index}`, "resting_heart_rate", 50, "bpm", item.date)),
      syntheticMetric("day_rhr", "resting_heart_rate", 50, "bpm"), syntheticMetric("day_hrv", "sleep_hrv_avg", 40, "ms"),
      syntheticMetric("day_hrv_reference", "sleep_hrv_baseline", 40, "ms")];
    const html = renderToStaticMarkup(createElement(SleepCalendarSection, { rows: [episode()], timezone: "Asia/Shanghai", healthMetrics: metrics, selectedMonth: "2024-02" }));
    expect(html).toContain("2024-02-02，状态不错");
    expect(html).toContain("缺测项已跳过，按已有有效指标评级");
    expect(html).toContain("已有睡眠或生理指标符合状态不错条件；缺测及参照不足的项已跳过；未纳入恢复数据");
    expect(html).not.toContain("；缺少恢复");
  });
});

describe("available historical indicators", () => {
  const historical = (patch: Partial<HealthStatusDay>) => classifyHealthDay({ date: "2024-02-02", dayComplete: true, sleep: { ...knownSleep, mainStartAt: null, mainTimezone: null }, ...patch }, baseline, "2024-02-03");
  it("grades nap-only dates from measured activity without manufacturing sleep or physiology", () => {
    expect(historical({ steps: 2000, trainingLoad: 0 })).toMatchObject({ status: "steady", used: ["步数", "训练负荷"], limited: true,
      missing: expect.arrayContaining(["睡眠评分", "HRV", "静息心率"]), reasons: expect.arrayContaining(["仅依据已有活动指标，未触发高活动条件；不代表睡眠或生理状态正常"]) });
    expect(historical({ steps: 2800 }).status).toBe("active");
    expect(historical({ trainingLoad: 0, elevationGainMeters: 0 }).status).toBe("steady");
  });
  it("uses sleep, HRV, and resting heart rate independently and keeps adverse priority", () => {
    expect(historical({ sleepScore: 95 }).status).toBe("good");
    expect(historical({ hrvMs: 45, hrvBaselineMs: 40 }).status).toBe("good");
    expect(historical({ restingBpm: 50 }).status).toBe("good");
    expect(historical({ sleepScore: 80 }).status).toBe("steady");
    expect(historical({ sleepScore: 65, steps: 2800 }).status).toBe("rest");
    expect(historical({ hrvMs: 25, hrvNormalRangeLowMs: 30 }).status).toBe("rest");
    expect(historical({ restingBpm: 55 }).status).toBe("rest");
    expect(historical({ sleepScore: 95, hrvMs: 35, hrvBaselineMs: 40, hrvNormalRangeLowMs: 30 }).status).toBe("steady");
  });
  it("skips unsupported references and partial source fields, using other complete measurements", () => {
    const sparse = buildHealthBaseline([]);
    expect(classifyHealthDay({ date: "2024-02-02", dayComplete: true, sleep: knownSleep, sleepScore: 95, restingBpm: 50 }, sparse, "2024-02-03"))
      .toMatchObject({ status: "good", missing: expect.arrayContaining(["静息心率基线（0/21）"]) });
    expect(historical({ dayComplete: false, partialReason: "source", partialSignals: ["steps", "hrvMs"], steps: 5000, hrvMs: 10, sleepScore: 95 }))
      .toMatchObject({ status: "good", used: ["睡眠评分"], unavailable: expect.arrayContaining(["步数尚未完整"]) });
    expect(historical({ dayComplete: false, partialReason: "source", partialSignals: ["steps"], steps: 5000, trainingLoad: 20 }).status).toBe("active");
  });
  it("distinguishes no usable data from an unfinished current date", () => {
    expect(historical({})).toMatchObject({ status: "empty", used: [] });
    expect(historical({ partialSignals: ["steps"], steps: 3000 }).status).toBe("empty");
    expect(historical({ sleep: undefined })).toMatchObject({ status: "rest", used: [] });
    expect(classifyHealthDay({ date: "2024-02-03", dayComplete: false, partialReason: "today", sleep: knownSleep, steps: 3000 }, baseline, "2024-02-03"))
      .toMatchObject({ status: "active", provisional: true });
  });
});
