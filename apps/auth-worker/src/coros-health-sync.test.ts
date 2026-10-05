import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapCorosDailyHealth, mapCorosRecovery, mapCorosRestingHeartRate, mapCorosSleepHrv } from "./coros-health-mapping";
import { collectCorosHealth, nextHealthSyncWindow } from "./coros-health-sync";
import { initializeBulkHealthProgress } from "./coros-health-history";
import { acceptSyncRequest, initialSyncProgress } from "./coros-sync-state";
import type { CorosReadResult } from "./coros-read-client";
import { runCorosSync, type CorosSyncDependencies } from "./coros-sync";
import { writeCorosHealthMetrics } from "./coros-health-writer";
import { SYNC_TEST_NOW, syncTestDatabase } from "./coros-sync-test-helpers";

// Synthetic values follow the independently observed response grammar, never an account export.
const text = (value: string): CorosReadResult => ({ format: "content", payload: [{ type: "text", text: JSON.stringify(value) }] });
const options = { startDate: "2024-01-01", endDate: "2024-02-01", timezone: "Asia/Shanghai", observedAt: SYNC_TEST_NOW };
const daily = text("Daily Health Data — Last 31 days | Resting HR: 51 bpm | HRV Baseline: 40 ms\nNote: sleep entries are dated by their wake-up day.\n\n--- 20240201 ---\nSteps: 1,234 | Calories: 123 kcal | Exercise: 0 min\nStress: Avg 10\nSleep Summary:\n  Total: 8h 0min");
const rhr = text("Resting Heart Rate — Last 31 days\n========================\n\n2024-02-01: 51 bpm");
const recovery = text("Recovery Status\n========================\n\nRecovery: 60%\nLevel: Rest recommended\nEstimated Full Recovery: 2h");
const hrv = (date = "2024-02-01") => text(`Sleep HRV — ${date}\n========================\nNote: dates are wake-up days (each value comes from the night that ended that morning).\n\nHRV Assessment — Last 1 days\n========================\n\n${date}:\n  HRV Avg: 38 ms — Normal\n  Normal Range: 30 - 50 ms\n  Baseline: 40 ms\n\nSleep HRV Time Series — Last 1 days\n========================\n\n${date}:\n  timestamp=1, timezone=32, hrv=999 ms, status=0, confidence=1000`);
const empty = (date: string) => text(`Sleep HRV — ${date}\n========================\nNote: dates are wake-up days (each value comes from the night that ended that morning).\n\nNo data found in the last 1 days.\n\nNo sleep HRV time series data found in the last 1 days.`);
function reader() { return vi.fn(async (name: string, args: Record<string, unknown>) => name === "queryDailyHealthData" ? daily
  : name === "queryRestingHeartRate" ? rhr : name === "queryRecoveryStatus" ? recovery : name === "querySportRecords" ? text(`No sport records found from ${String(args.startDate).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")} to ${String(args.endDate).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")}.`) : hrv(String(args.startDate).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"))); }

describe("bounded COROS health metric collection", () => {
  it("parses hour/minute exercise and preserves No data and absent RHR dates as holes", () => {
    const value = "Daily Health Data — Last 90 days | Resting HR: 51 bpm | HRV Baseline: 40 ms\nNote: sleep entries are dated by their wake-up day.\n\n--- 20240201 ---\nSteps: 1,234 | Calories: 456 kcal | Exercise: 2h 03min";
    expect(mapCorosDailyHealth(text(value), options).map(item => [item.candidate.metric_type, item.candidate.value])).toEqual([["steps", 1234], ["exercise_minutes", 123], ["active_calories", 456]]);
    expect(() => mapCorosDailyHealth(text(value.replace("2h 03min", "2h 60min")), options)).toThrow("FORMAT_UNSUPPORTED");
    expect(mapCorosRestingHeartRate(text("Resting Heart Rate — Last 90 days\n====\n\n2024-01-30: 49 bpm\n2024-02-01: No data"), options).map(item => [item.candidate.local_date, item.candidate.value])).toEqual([["2024-01-30", 49]]);
  });
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SYNC_TEST_NOW); });
  afterEach(() => vi.useRealTimers());
  it("maps only verified fields, preserves zero, and marks observation time without inventing completed days", () => {
    const items = mapCorosDailyHealth(daily, options);
    expect(items.map(item => [item.candidate.metric_type, item.candidate.value])).toEqual([["steps", 1234], ["exercise_minutes", 0], ["active_calories", 123]]);
    expect(items.every(item => item.dayComplete === undefined && item.measurementTimeKind === "observed_at")).toBe(true);
    expect(mapCorosRestingHeartRate(rhr, options)).toHaveLength(1);
    expect(mapCorosSleepHrv(hrv(), options).map(item => item.candidate.value)).toEqual([38, 30, 40]); // raw 999 never enters official averages
    expect(mapCorosRecovery(recovery, { ...options, startDate: "2023-01-01", endDate: "2023-01-01" })[0].candidate)
      .toMatchObject({ local_date: "2024-02-01", measured_at: SYNC_TEST_NOW, aggregation_period: "instant", value: 60 });
  });
  it("rejects wrong units, out-of-range/duplicate dates, unknown response layouts and invalid ranges", () => {
    expect(() => mapCorosRestingHeartRate(text("Resting Heart Rate — Last 1 days\n====\n\n2024-02-01: 51 ms"), options)).toThrow("FORMAT_UNSUPPORTED");
    expect(() => mapCorosSleepHrv(hrv("2025-01-01"), options)).toThrow("FORMAT_UNSUPPORTED");
    expect(() => mapCorosDailyHealth(text("Daily Health Data unknown layout"), options)).toThrow("FORMAT_UNSUPPORTED");
    expect(() => mapCorosRecovery(text("Recovery Status\n===\n\nRecovery: 101%\nLevel: x\nEstimated Full Recovery: 1h"), options)).toThrow("FORMAT_UNSUPPORTED");
    expect(() => mapCorosRestingHeartRate(rhr, { ...options, timezone: "UTC" })).toThrow("FORMAT_UNSUPPORTED");
  });
  it("reads recent tools once, queries HRV by a bounded absolute range, and verifies omitted days singly", async () => {
    const p = initialSyncProgress("2024-01-01", "Asia/Shanghai"); acceptSyncRequest(p, { request_seq: 1, requested_through: "2024-02-01" });
    const read = reader(); const active = vi.fn(async () => {}); const w = nextHealthSyncWindow(p, new Date())!;
    expect(w).toEqual({ domain: "health", recent: true, from: "2024-01-26", through: "2024-02-01" });
    const result = await collectCorosHealth(read, w, p, active);
    expect(read.mock.calls.map(call => call[0])).toEqual(["queryRecoveryStatus", "querySleepHrv", "querySleepHrv", "querySportRecords"]);
    expect(read.mock.calls[0][1]).toEqual({}); expect(result.through).toBe("2024-01-26"); expect(result.items).toHaveLength(6);
    p.health!.recentDataThrough = "2024-01-31";
    read.mockClear(); await collectCorosHealth(read, { ...w, from: "2024-02-01" }, p, active);
    expect(read.mock.calls[0][0]).toBe("queryRecoveryStatus");
    read.mockClear(); p.health!.recentNext = "2024-02-01";
    await collectCorosHealth(read, { ...w, from: "2024-02-01" }, p, active);
    expect(read.mock.calls.map(call => call[0])).toEqual(["querySleepHrv", "querySportRecords"]);
  });
  it("does no work without a request; resumes historical HRV only and never reads current recovery for old days", async () => {
    const p = initialSyncProgress("2024-01-01", "Asia/Shanghai"); expect(nextHealthSyncWindow(p, new Date())).toBeNull();
    acceptSyncRequest(p, { request_seq: 1, requested_through: "2024-02-01" }); nextHealthSyncWindow(p, new Date());
    p.health!.recentRequestSequence = 1;
    for (const source of Object.values(initializeBulkHealthProgress(p))) { source.recentRequestSequence = 1; source.backfillNext = "2024-02-02"; }
    const read = reader(); read.mockImplementation(async (name) => name === "querySportRecords" ? text(`No sport records found from 2023-12-31 to 2024-01-02.`) : empty("2024-01-01"));
    const result = await collectCorosHealth(read, nextHealthSyncWindow(p, new Date())!, p, async () => {});
    expect(result).toMatchObject({ through: "2024-01-01", items: expect.arrayContaining([expect.objectContaining({ candidate: expect.objectContaining({ value: 0, metric_type: "training_load" }) })]) }); expect(read.mock.calls.map(call => call[0])).toEqual(["querySleepHrv", "querySleepHrv", "querySportRecords"]);
    p.health!.backfillNext = "2024-02-02"; expect(nextHealthSyncWindow(p, new Date())).toBeNull();
    acceptSyncRequest(p, { request_seq: 2, requested_through: "2024-02-02" }); expect(nextHealthSyncWindow(p, new Date())?.recent).toBe(true);
  });
  it("cancels after each read and retains incomplete/error windows", async () => {
    const p = initialSyncProgress("2024-01-01", "Asia/Shanghai"); acceptSyncRequest(p, { request_seq: 1, requested_through: "2024-02-01" });
    const w = nextHealthSyncWindow(p, new Date())!; const read = reader();
    await expect(collectCorosHealth(read, w, p, async () => { throw new Error("COROS_SYNC_CANCELLED"); })).rejects.toThrow("CANCELLED");
    expect(read).toHaveBeenCalledTimes(1); expect(p.health!.backfillNext).toBe("2024-01-01");
  });
  it("keeps verified physiological and bulk metrics when activity evidence is unavailable", async () => {
    const p = initialSyncProgress("2024-01-01", "Asia/Shanghai"); acceptSyncRequest(p, { request_seq: 1, requested_through: "2024-02-01" });
    const read = reader(), base = read.getMockImplementation()!;
    read.mockImplementation(async (name, args) => {
      if (name === "querySportRecords") throw new Error("COROS_READ_TOOL_UNAVAILABLE");
      return base(name, args);
    });
    const result = await collectCorosHealth(read, nextHealthSyncWindow(p, new Date())!, p, async () => {});
    expect(result.activityError).toBe("COROS_READ_TOOL_UNAVAILABLE");
    expect(result.items).toHaveLength(4); expect(result.items.some(item => item.candidate.metric_type === "sleep_hrv_avg")).toBe(true);
    expect(p.health!.backfillNext).toBe("2024-01-01");
  });
  it("integrates into the existing lease and request lifecycle without a new credential or scope", async () => {
    const fixture = syncTestDatabase(); fixture.connection(); const p = initialSyncProgress("2024-01-01", "Asia/Shanghai");
    p.domains.sleep.recentRequestSequence = 1; p.domains.workout.recentRequestSequence = 1; fixture.job(p);
    const read = reader(); const write = vi.fn<typeof writeCorosHealthMetrics>().mockResolvedValue({ created: 8, updated: 0, unchanged: 0 });
    const deps: CorosSyncDependencies = { refresh: vi.fn().mockResolvedValue({ resourceUrl: "https://mcpcn.coros.com/mcp", accessToken: "synthetic-token", githubUserId: "42" }),
      read: vi.fn(async (_resource, _token, name, args) => read(name, args)), adapter: vi.fn().mockResolvedValue({ readText: async () => ({ text: JSON.stringify({ schema_version: 1, workspace_id: "test-workspace", owner_id: "test-owner", owner_login: "example-owner", locale: "zh-CN", timezone: "Asia/Shanghai" }) }) }),
      write: vi.fn(), health: collectCorosHealth, writeMetrics: write };
    try {
      expect(await runCorosSync(fixture.env, new Date(), deps, { forceDue: true })).toMatchObject({ status: "processed", batch: { domain: "health", through: "2024-01-26", created: 8 } });
      expect(fixture.saved()?.progress.health).toMatchObject({ backfillNext: "2024-01-01", recentNext: "2024-01-27", recentDataThrough: "2024-02-01" });
      expect(fixture.saved()?.lease_token).toBeNull(); expect(deps.write).not.toHaveBeenCalled();
      read.mockImplementation(async () => { throw new Error("COROS_READ_TOOL_UNAVAILABLE"); });
      expect(await runCorosSync(fixture.env, new Date(), deps, { forceDue: true })).toMatchObject({ status: "error", errorCode: "COROS_READ_TOOL_UNAVAILABLE" });
      expect(fixture.saved()?.progress.health).toMatchObject({ recentNext: "2024-01-27", retryAfter: null,
        lastAttemptSource: "dailyHealth", bulk: { dailyHealth: { retryAfter: "2024-02-01T04:20:00.000Z" } } });
      expect(write).toHaveBeenCalledTimes(1);
    } finally { fixture.sqlite.close(); }
  });
  it("atomically saves known metrics but holds coverage when activity details are pending", async () => {
    const fixture = syncTestDatabase(); fixture.connection(); const p = initialSyncProgress("2024-01-01", "Asia/Shanghai");
    p.domains.sleep.recentRequestSequence = 1; p.domains.workout.recentRequestSequence = 1; fixture.job(p);
    const read = reader(), base = read.getMockImplementation()!;
    read.mockImplementation(async (name, args) => { if (name === "querySportRecords") throw new Error("COROS_READ_TOOL_UNAVAILABLE"); return base(name, args); });
    const write = vi.fn<typeof writeCorosHealthMetrics>().mockResolvedValue({ created: 8, updated: 0, unchanged: 0 });
    const deps: CorosSyncDependencies = { refresh: vi.fn().mockResolvedValue({ resourceUrl: "https://mcpcn.coros.com/mcp", accessToken: "synthetic-token", githubUserId: "42" }),
      read: vi.fn(async (_resource, _token, name, args) => read(name, args)), adapter: vi.fn().mockResolvedValue({ readText: async () => ({ text: JSON.stringify({ schema_version: 1, workspace_id: "test-workspace", owner_id: "test-owner", owner_login: "example-owner", locale: "zh-CN", timezone: "Asia/Shanghai" }) }) }),
      write: vi.fn(), health: collectCorosHealth, writeMetrics: write };
    try {
      expect(await runCorosSync(fixture.env, new Date(), deps, { forceDue: true })).toMatchObject({ status: "processed", progress: { lastErrorCode: "COROS_READ_TOOL_UNAVAILABLE" } });
      expect(write.mock.calls[0][1].items).toHaveLength(4);
      expect(fixture.saved()?.progress.health).toMatchObject({ backfillNext: "2024-01-01", backfillThrough: null, recentNext: "2024-01-26", recentDataThrough: "2024-02-01", retryAfter: "2024-02-01T04:10:00.000Z" });
      expect(fixture.saved()?.lease_token).toBeNull();
    } finally { fixture.sqlite.close(); }
  });
});
