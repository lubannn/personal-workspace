import { describe, expect, it } from "vitest";
import { buildTodayExercise } from "./today-exercise";
import type { SleepRecordRow, WorkoutRecordRow } from "./health-records";

const today = "2026-10-01", timezone = "Asia/Shanghai";
function workout(id: string, startAt: string, durationSeconds = 1800): WorkoutRecordRow {
  return { id, startAt, endAt: new Date(Date.parse(startAt) + durationSeconds * 1000).toISOString(), timezone,
    source: { kind: "coros_mcp", label: "COROS" }, activity: "跑步", durationSeconds, distanceMetres: null };
}
function sleep(overrides: Partial<SleepRecordRow> = {}): SleepRecordRow {
  return { id: "sleep_test", startAt: "2026-09-30T15:00:00Z", endAt: "2026-09-30T23:00:00Z", timezone, recordDate: today,
    source: { kind: "coros_mcp", label: "COROS" }, category: "夜间睡眠", durationSeconds: 28800,
    asleepSeconds: 27000, awakeSeconds: 1800, score: 84, dateCorrection: null, ...overrides };
}

describe("today exercise from recorded health facts", () => {
  it("includes the local date across UTC and month boundaries, deduplicates records, excludes old and future days", () => {
    const one = workout("one", "2026-09-30T16:30:00Z");
    const result = buildTodayExercise(today, timezone, [], [one, one, workout("old", "2026-09-23T16:30:00Z"), workout("future", "2026-10-01T16:30:00Z"), workout("recent", "2026-09-24T16:30:00Z")]);
    expect(result.todayWorkouts.map(row => row.id)).toEqual(["one"]);
    expect(result.todaySeconds).toBe(1800);
    expect(result.recentSeconds).toBe(3600);
    expect(result.recentCount).toBe(2);
    expect(result.advice.mode).toBe("done");
  });
  it("does not interpret missing or stale sleep as recovery and excludes unverified sources", () => {
    const unknown = { ...sleep(), source: { kind: "unknown" as const, label: "unknown" } };
    const result = buildTodayExercise(today, timezone, [sleep({ recordDate: "2026-09-30" }), unknown], [ { ...workout("bad", "2026-09-30T17:00:00Z"), source: { kind: "unknown", label: "unknown" } }]);
    expect(result.sleep).toBeUndefined();
    expect(result.todaySeconds).toBe(0); expect(result.advice.mode).toBe("gentle");
    expect(result.advice.reason).toContain("不足");
  });
  it("prioritizes poor sleep even after an activity was recorded", () => {
    const result = buildTodayExercise(today, timezone, [sleep({ score: 60 })], [workout("one", "2026-09-30T17:00:00Z")]);
    expect(result.advice.mode).toBe("recovery"); expect(result.advice.reason).toContain("60");
  });
  it("uses only complete actual sleep totals for the short-sleep branch", () => {
    expect(buildTodayExercise(today, timezone, [sleep({ score: null, asleepSeconds: 5 * 3600 })], []).advice.mode).toBe("recovery");
    expect(buildTodayExercise(today, timezone, [sleep({ score: null, asleepSeconds: null, durationSeconds: 5 * 3600 })], []).advice.mode).toBe("gentle");
    const result = buildTodayExercise(today, timezone, [sleep({ score: null, asleepSeconds: 5 * 3600 }), sleep({ id: "nap", category: "小睡", startAt: "2026-10-01T03:00:00Z", endAt: "2026-10-01T04:00:00Z", asleepSeconds: null })], []);
    expect(result.sleep!.hasIncompleteDuration).toBe(true); expect(result.advice.mode).toBe("gentle");
  });
  it("does not count overlapping sleep episodes as a proven sleep total", () => {
    const result = buildTodayExercise(today, timezone, [sleep({ score: null }), sleep({ id: "overlap", score: null })], []);
    expect(result.sleep!.asleepSeconds).toBeNull(); expect(result.advice.mode).toBe("gentle");
  });
  it("never labels yesterday's duration as measured high intensity", () => {
    const result = buildTodayExercise(today, timezone, [sleep()], [workout("yesterday", "2026-09-30T01:00:00Z", 3600)]);
    expect(result.advice.mode).toBe("gentle"); expect(result.advice.reason).toContain("时长不代表强度");
  });
  it("suggests a modest starting activity when a current sleep record is available", () => {
    const result = buildTodayExercise(today, timezone, [sleep()], []);
    expect(result.advice.mode).toBe("regular"); expect(result.advice.suggestion).toContain("20–30");
  });
});
