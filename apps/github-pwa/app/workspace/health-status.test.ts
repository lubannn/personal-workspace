import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createAutomaticHealthMetricData, parseHealthMetricRecord } from "../../../../src/lib/github-data/health-metrics";
import { createWorkspaceRecord, recordPath, serializeRecord } from "../../../../src/lib/github-data/protocol";
import type { SyncedHealthMetric } from "./page-model";
import { buildHealthBaseline, buildHealthStatusDays, classifyHealthDay, healthQuantile, type HealthStatusDay } from "./health-status";
import { buildSleepCalendarDays } from "./sleep-calendar";
import { SleepCalendarSection } from "./sleep-calendar-section";
import type { SleepRecordRow } from "./health-records";

const timestamp = "2024-03-03T00:00:00Z";
const source = { kind: "coros_mcp" as const, source_id: "synthetic", source_sha256: "a".repeat(64), mapping_version: 1 as const, retrieved_at: timestamp };
export function syntheticMetric(id: string, type: string, value: number, unit: string, date = "2024-02-02", complete?: boolean): SyncedHealthMetric {
  const record = createWorkspaceRecord({ entityType: "health_metric", id, ownerId: "synthetic_owner", timestamp,
    data: createAutomaticHealthMetricData({ metric_type: type, value, unit, local_date: date, measured_at: timestamp, timezone: "Asia/Shanghai", aggregation_period: "daily" }, source, complete) });
  return { record, path: recordPath("health_metric", id), blobSha: "a".repeat(40) };
}
const day = (patch: Partial<HealthStatusDay> = {}): HealthStatusDay => ({ date: "2024-02-02", dayComplete: true, sleepScore: 90,
  steps: 2000, exerciseMinutes: 20, activeCalories: 200, elevationGainMeters: 10, trainingLoad: 10, recoveryPct: 90, hrvMs: 40, hrvBaselineMs: 40, hrvNormalRangeLowMs: 30, restingBpm: 50, ...patch });
const baseDays = Array.from({ length: 21 }, (_, index) => day({ date: `2024-01-${String(index + 1).padStart(2, "0")}`, steps: 1000 + index * 100, exerciseMinutes: 10 + index, activeCalories: 100 + index * 10, elevationGainMeters: index, trainingLoad: index }));
const baseline = buildHealthBaseline(baseDays);
const grade = (patch: Partial<HealthStatusDay> = {}) => classifyHealthDay(day(patch), baseline);

describe("reviewed COROS health status rules", () => {
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
  it("does not hide absent activity or insufficient activity baselines under steady/good", () => {
    expect(grade({ sleepScore: 80, steps: undefined })).toMatchObject({ status: "insufficient", missing: expect.arrayContaining(["步数"]) });
    expect(grade({ trainingLoad: undefined }).status).toBe("insufficient");
    const sparse = buildHealthBaseline(baseDays.map((item, i) => ({ ...item, steps: i === 0 ? undefined : item.steps })));
    expect(classifyHealthDay(day(), sparse)).toMatchObject({ status: "insufficient", missing: expect.arrayContaining(["步数基线"]) });
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
  it("does not turn sleep-only, nap-only, or entirely absent signals into a combined positive label", () => {
    const empty = buildHealthBaseline([]);
    expect(classifyHealthDay({ date: "2024-02-02", dayComplete: false, sleepScore: 95 }, empty)).toMatchObject({ status: "insufficient", missing: expect.arrayContaining(["恢复", "HRV", "静息心率", "步数", "训练负荷", "完整日活动证据"]) });
    expect(classifyHealthDay({ date: "2024-02-02", dayComplete: false, sleepScore: 60 }, empty).status).toBe("rest");
    expect(classifyHealthDay({ date: "2024-02-02", dayComplete: false }, empty).status).toBe("insufficient");
  });
});

describe("health metric adaptation and calendar", () => {
  const episode = (patch: Partial<SleepRecordRow> = {}): SleepRecordRow => ({ id: "synthetic_sleep", startAt: "2024-02-01T15:00:00Z", endAt: "2024-02-01T23:00:00Z", recordDate: "2024-02-02",
    timezone: "Asia/Shanghai", source: { kind: "coros_mcp", label: "COROS" }, category: "夜间睡眠", durationSeconds: 28800, asleepSeconds: 25200, awakeSeconds: 3600, score: 95, dateCorrection: null, ...patch });
  it("deduplicates daily totals, rejects wrong units/manual/instant/deleted/future values and retains zero", () => {
    const steps = syntheticMetric("steps", "steps", 0, "steps", "2024-02-02", true);
    const older = syntheticMetric("older", "steps", 1000, "steps", "2024-02-02", true); older.record.data.measured_at = "2024-03-02T00:00:00Z";
    const bad = syntheticMetric("bad", "recovery_percentage", 99, "bpm");
    const removed = syntheticMetric("removed", "sleep_hrv_avg", 99, "ms"); removed.record.deleted_at = timestamp;
    const instant = syntheticMetric("instant", "sleep_hrv_avg", 99, "ms"); instant.record.data.aggregation_period = "instant";
    const manual = { ...steps, record: { ...steps.record, data: { ...steps.record.data, health_metric_version: 1 } } } as unknown as SyncedHealthMetric;
    const result = buildHealthStatusDays([], [steps, steps, older, bad, removed, instant, manual, syntheticMetric("future", "steps", 999, "steps", "2025-01-01")], "2024-03-03");
    expect(result).toEqual([{ date: "2024-02-02", dayComplete: true, steps: 0 }]);
    expect(buildHealthStatusDays([], [syntheticMetric("unknown", "steps", 1, "steps")], "2024-03-03")[0].dayComplete).toBe(false);
    expect(buildHealthStatusDays([], [steps], "2024-02-02")[0].dayComplete).toBe(false);
    const conflict = syntheticMetric("conflict", "steps", 100, "steps", "2024-02-02", true);
    expect(buildHealthStatusDays([], [steps, conflict], "2024-03-03")[0]).toEqual({ date: "2024-02-02", dayComplete: false });
    conflict.record.data.measured_at = "2024-03-03T08:00:00+08:00";
    expect(buildHealthStatusDays([], [steps, conflict], "2024-03-03")[0]).toEqual({ date: "2024-02-02", dayComplete: false });
  });
  it("preserves recovery observation risk with its true date and excludes archived metric revisions", () => {
    const recovery = syntheticMetric("point", "recovery_percentage", 60, "%", "2024-03-03");
    if (recovery.record.data.health_metric_version !== 2) throw new Error();
    recovery.record.data.aggregation_period = "instant"; recovery.record.data.measurement_time_kind = "observed_at";
    const archived = syntheticMetric("archived", "recovery_percentage", 1, "%", "2024-03-03");
    if (archived.record.data.health_metric_version !== 2) throw new Error(); archived.record.data.revision_of = "point";
    const days = buildHealthStatusDays([], [recovery, archived], "2024-03-03");
    expect(days).toHaveLength(1); expect(days[0]).toMatchObject({ date: "2024-03-03", dayComplete: false, recoveryPct: 60, recoveryObservedAt: timestamp });
    expect(classifyHealthDay(days[0], buildHealthBaseline([]))).toMatchObject({ status: "rest", reasons: ["同步观测时恢复低于 70%"], recoveryObservedAt: timestamp });
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
});
