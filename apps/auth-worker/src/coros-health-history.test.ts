import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectBulkHealthHistory, initializeBulkHealthProgress, nextBulkHealthWindow } from "./coros-health-history";
import { nextHealthSyncWindow } from "./coros-health-sync";
import { acceptSyncRequest, extendSyncHistory, initialSyncProgress, parseSyncProgress, shiftDate } from "./coros-sync-state";
import { runCorosSync, type CorosSyncDependencies } from "./coros-sync";
import { collectCorosHealth } from "./coros-health-sync";
import { writeCorosHealthMetrics } from "./coros-health-writer";
import { SYNC_TEST_NOW, syncTestDatabase } from "./coros-sync-test-helpers";
import type { CorosReadResult, CorosReadTool } from "./coros-read-client";

// Synthetic sparse source, with one old value and one newer value outside the window.
const text = (value: string): CorosReadResult => ({ format: "content", payload: [{ type: "text", text: JSON.stringify(value) }] });
const daily = (days: number) => text(`Daily Health Data — Last ${days} days | Resting HR: 50 bpm | HRV Baseline: 40 ms
Note: sleep entries are dated by their wake-up day.

--- 20240131 ---
Steps: 500 | Calories: 80 kcal | Exercise: 5 min

--- 20231001 ---
Steps: 1,200 | Calories: 150 kcal | Exercise: 12 min

--- 20231002 ---
Steps: 0 | Calories: 0 kcal | Exercise: 0 min
Stress: Avg 0`);
const rhr = (days: number) => text(`Resting Heart Rate — Last ${days} days\n====\n\n2024-01-31: 50 bpm\n2023-10-01: 49 bpm`);
const read = () => vi.fn(async (name: CorosReadTool, args: Record<string, unknown>) => name === "queryDailyHealthData" ? daily(Number(args.days)) : rhr(Number(args.days)));
function progress() {
  const p = initialSyncProgress("2023-10-01", "Asia/Shanghai");
  acceptSyncRequest(p, { request_seq: 1, requested_through: "2024-02-01" });
  nextHealthSyncWindow(p, new Date(SYNC_TEST_NOW));
  p.health!.recentRequestSequence = 1; p.health!.activity!.recentRequestSequence = 1;
  const bulk = initializeBulkHealthProgress(p);
  for (const source of Object.values(bulk)) source.recentRequestSequence = 1;
  return p;
}

describe("resumable full-scope relative COROS health history", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SYNC_TEST_NOW); });
  afterEach(() => vi.useRealTimers());

  it("excludes today from all historical source planners but permits recent observations", () => {
    const p = progress();
    p.health!.backfillNext = "2024-02-01"; p.health!.activity!.backfillNext = "2024-02-01";
    for (const d of Object.values(p.health!.bulk!)) d.backfillNext = "2024-02-01";
    expect(nextHealthSyncWindow(p, new Date())).toBeNull();
    expect(nextBulkHealthWindow(p, new Date())).toBeNull();
    acceptSyncRequest(p, { request_seq: 2, requested_through: "2024-02-01" }, new Date());
    expect(nextHealthSyncWindow(p, new Date())).toMatchObject({ recent: true, through: "2024-02-01" });
    expect(nextBulkHealthWindow(p, new Date())).toMatchObject({ recent: true, through: "2024-02-01" });
  });

  it("requests past 90 dates and commits only the selected source's bounded old window", async () => {
    const p = progress(), reader = read();
    const window = nextBulkHealthWindow(p, new Date())!;
    expect(window).toMatchObject({ source: "dailyHealth", from: "2023-10-01", through: "2023-10-28", recent: false });
    const result = await collectBulkHealthHistory(reader, window, p, async () => {}, new Date());
    expect(reader.mock.calls).toEqual([["queryDailyHealthData", { days: 124 }]]);
    expect(result.items.map(item => [item.candidate.local_date, item.candidate.metric_type, item.candidate.value]))
      .toEqual([["2023-10-01", "steps", 1200], ["2023-10-01", "exercise_minutes", 12], ["2023-10-01", "active_calories", 150]]);
    expect(result.bulkSource).toBe("dailyHealth");
    expect(result.observedDates).toEqual(["2023-10-01"]);
    expect(result.unconfirmedZeroDates).toEqual(["2023-10-02"]);
    expect(p.health!.bulk!.dailyHealth.backfillNext).toBe("2023-10-01"); // reads cannot advance persisted coverage
    expect(JSON.stringify(p)).not.toMatch(/1200|raw_text|time_series/);
  });

  it("checks every scoped interval through sparse/empty windows and retains independent per-source cursors", async () => {
    const p = progress();
    p.health!.bulk!.dailyHealth.backfillNext = "2023-10-29";
    expect(nextBulkHealthWindow(p, new Date())?.source).toBe("restingHeartRate");
    p.health!.bulk!.restingHeartRate.backfillNext = "2023-10-29";
    const window = nextBulkHealthWindow(p, new Date())!;
    const emptyReader = vi.fn(async (_name: CorosReadTool, args: Record<string, unknown>) => text(`Daily Health Data — Last ${args.days} days | Resting HR: 50 bpm | HRV Baseline: 40 ms\nNote: sleep entries are dated by their wake-up day.\n\n--- 20240131 ---\nSteps: 500 | Calories: 80 kcal | Exercise: 5 min`));
    const result = await collectBulkHealthHistory(emptyReader, window, p, async () => {}, new Date());
    expect(result.items).toEqual([]);
    p.health!.bulk!.dailyHealth.backfillNext = shiftDate(result.through, 1);
    expect(nextBulkHealthWindow(p, new Date())).not.toBeNull();
    expect(nextBulkHealthWindow(p, new Date())?.source).toBe("restingHeartRate");
  });

  it("keeps a failed source on its cursor, rejects clamped headers, and lets another source continue", async () => {
    const p = progress(), window = nextBulkHealthWindow(p, new Date())!;
    await expect(collectBulkHealthHistory(async () => daily(90), window, p, async () => {}, new Date())).rejects.toThrow("RANGE_UNCONFIRMED");
    expect(p.health!.bulk!.dailyHealth.backfillNext).toBe("2023-10-01");
    p.health!.bulk!.dailyHealth.retryAfter = "2024-02-01T05:00:00.000Z";
    expect(nextBulkHealthWindow(p, new Date())?.source).toBe("restingHeartRate");
    const reader = read();
    await expect(collectBulkHealthHistory(reader, window, p, async () => { throw new Error("COROS_SYNC_CANCELLED"); }, new Date())).rejects.toThrow("CANCELLED");
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("does not reread an oversized relative prefix on automatic retries or mark blocked history complete", async () => {
    const fixture = syncTestDatabase(); fixture.connection(); const p = progress();
    for (const domain of Object.values(p.domains)) { domain.recentRequestSequence = 1; domain.backfillNext = "2024-02-02"; }
    p.health!.backfillNext = "2024-02-02"; p.health!.activity!.backfillNext = "2024-02-02"; p.health!.bulk!.restingHeartRate.backfillNext = "2024-02-02";
    fixture.job(p);
    const reader = vi.fn(async () => { throw new Error("COROS_READ_RESULT_TOO_LARGE"); });
    const deps: CorosSyncDependencies = {
      refresh: vi.fn().mockResolvedValue({ resourceUrl: "https://mcpcn.coros.com/mcp", accessToken: "synthetic-token" }),
      read: reader, adapter: vi.fn(), write: vi.fn(), health: collectCorosHealth, writeMetrics: vi.fn(),
    };
    try {
      expect(await runCorosSync(fixture.env, new Date(), deps, { forceDue: true })).toMatchObject({ status: "error", errorCode: "COROS_READ_RESULT_TOO_LARGE" });
      expect(fixture.saved()?.progress.health?.bulk?.dailyHealth).toMatchObject({ backfillNext: "2023-10-01", blockedCode: "COROS_READ_RESULT_TOO_LARGE", retryAfter: null });
      expect(await runCorosSync(fixture.env, new Date(), deps, { forceDue: true })).toMatchObject({ status: "error", errorCode: "COROS_READ_RESULT_TOO_LARGE", retryAt: null });
      expect(reader).toHaveBeenCalledTimes(1); expect(deps.adapter).not.toHaveBeenCalled();
      const saved = fixture.saved()!.progress;
      acceptSyncRequest(saved, { request_seq: 2, requested_through: "2024-02-01" });
      expect(saved.health?.bulk?.dailyHealth.blockedCode).toBe("COROS_READ_RESULT_TOO_LARGE");
      extendSyncHistory(saved, saved.startDate);
      expect(saved.health?.bulk?.dailyHealth.blockedCode).toBe("COROS_READ_RESULT_TOO_LARGE");
      extendSyncHistory(saved, saved.startDate, ["dailyHealth"]);
      expect(saved.health?.bulk?.dailyHealth.blockedCode).toBeUndefined();
      // The newly accepted request gives the other bulk source a turn first;
      // clearing a block does not remove source fairness.
      expect(nextBulkHealthWindow(saved, new Date())?.source).toBe("restingHeartRate");
      saved.health!.lastBulkAttemptSource = "restingHeartRate";
      expect(nextBulkHealthWindow(saved, new Date())?.source).toBe("dailyHealth");
    } finally { fixture.sqlite.close(); }
  });

  it("resumes migrated progress and subsequent requests without restarting completed history", () => {
    const p = progress();
    delete p.health!.bulk;
    const migrated = parseSyncProgress(JSON.stringify(p));
    const bulk = initializeBulkHealthProgress(migrated);
    expect(bulk.dailyHealth.backfillNext).toBe("2023-10-01");
    for (const source of Object.values(bulk)) {
      source.backfillNext = "2024-02-02"; source.backfillThrough = "2024-02-01"; source.recentRequestSequence = 1;
    }
    expect(nextBulkHealthWindow(migrated, new Date())).toBeNull();
    acceptSyncRequest(migrated, { request_seq: 2, requested_through: "2024-02-02" });
    expect(nextBulkHealthWindow(migrated, new Date())).toMatchObject({ recent: true, from: "2024-01-27", through: "2024-02-02" });
    expect(bulk.dailyHealth.backfillNext).toBe("2024-02-02");
    expect(bulk.restingHeartRate.backfillNext).toBe("2024-02-02");
    extendSyncHistory(migrated, "2023-01-01");
    expect(bulk.dailyHealth).toMatchObject({ backfillNext: "2023-01-01", backfillThrough: null, recentRequestSequence: 1 });
    expect(migrated.startDate).toBe("2023-01-01");
  });

  it("advances only the committed source; failed private persistence leaves the cursor for replay", async () => {
    const fixture = syncTestDatabase(); fixture.connection();
    const p = progress();
    p.domains.sleep.recentRequestSequence = 1; p.domains.workout.recentRequestSequence = 1;
    p.health!.backfillNext = "2024-02-02"; p.health!.activity!.backfillNext = "2024-02-02";
    for (const d of Object.values(p.domains)) d.backfillNext = "2024-02-01";
    fixture.job(p);
    const reader = read(), write = vi.fn<typeof writeCorosHealthMetrics>().mockResolvedValue({ created: 3, updated: 0, unchanged: 0 });
    const deps: CorosSyncDependencies = {
      refresh: vi.fn().mockResolvedValue({ resourceUrl: "https://mcpcn.coros.com/mcp", accessToken: "synthetic-token" }),
      read: vi.fn(async (_resource, _token, name, args) => reader(name, args)),
      adapter: vi.fn().mockResolvedValue({ readText: async () => ({ text: JSON.stringify({ schema_version: 1, workspace_id: "test-workspace", owner_id: "test-owner", owner_login: "example-owner", locale: "zh-CN", timezone: "Asia/Shanghai" }) }) }),
      write: vi.fn(), health: collectCorosHealth, writeMetrics: write,
    };
    try {
      expect(await runCorosSync(fixture.env, new Date(), deps, { forceDue: true })).toMatchObject({ status: "processed" });
      expect(fixture.saved()?.progress.health?.bulk).toMatchObject({ dailyHealth: { backfillNext: "2023-10-29", backfillThrough: "2023-10-28", observedDates: ["2023-10-01"], unconfirmedZeroDates: ["2023-10-02"] }, restingHeartRate: { backfillNext: "2023-10-01" } });
      expect(fixture.saved()?.progress.health?.bulk?.dailyHealth.checkedRanges).toEqual([{ from: "2023-10-01", through: "2023-10-28" }]);
      write.mockRejectedValueOnce(new Error("GITHUB_WRITE_FAILED"));
      expect(await runCorosSync(fixture.env, new Date(), deps, { forceDue: true })).toMatchObject({ status: "error", errorCode: "GITHUB_WRITE_FAILED" });
      expect(fixture.saved()?.progress.health?.bulk?.restingHeartRate).toMatchObject({ backfillNext: "2023-10-01", backfillThrough: null, retryAfter: "2024-02-01T04:20:00.000Z" });
      expect(fixture.saved()?.progress.health?.bulk?.restingHeartRate.checkedRanges).toBeUndefined();
      expect(fixture.saved()?.lease_token).toBeNull();
      expect(deps.write).not.toHaveBeenCalled();
      expect(reader.mock.calls.map(call => call[0])).toEqual(["queryDailyHealthData", "queryRestingHeartRate"]);
      // Once persistence succeeds, RHR records its own checked range, independent of sparse value dates.
      vi.setSystemTime("2024-02-01T04:20:00.000Z");
      const saved = fixture.saved()!.progress;
      saved.health!.bulk!.dailyHealth.backfillNext = "2024-02-02";
      fixture.saveProgress(saved);
      expect(await runCorosSync(fixture.env, new Date(), deps, { forceDue: true })).toMatchObject({ status: "processed" });
      expect(fixture.saved()?.progress.health?.bulk?.restingHeartRate.checkedRanges).toEqual([{ from: "2023-10-01", through: "2023-10-28" }]);
    } finally { fixture.sqlite.close(); }
  });
});
