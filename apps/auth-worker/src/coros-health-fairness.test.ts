import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectCorosHealth, nextHealthSyncWindow } from "./coros-health-sync";
import { initializeBulkHealthProgress } from "./coros-health-history";
import { initialSyncProgress } from "./coros-sync-state";
import { runCorosSync, type CorosSyncDependencies } from "./coros-sync";
import { SYNC_TEST_NOW, syncTestDatabase } from "./coros-sync-test-helpers";

describe("independent health sources during pending activity detail batches", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SYNC_TEST_NOW); });
  afterEach(() => vi.useRealTimers());

  it("persists the accepted request and source before I/O, so an interrupted lease yields a bulk turn without advancing coverage", async () => {
    const fixture = syncTestDatabase(); fixture.connection();
    const p = initialSyncProgress("2024-01-01", "Asia/Shanghai");
    p.domains.sleep.recentRequestSequence = 1; p.domains.workout.recentRequestSequence = 1;
    fixture.job(p);
    const refresh = vi.fn().mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue({ resourceUrl: "https://mcpcn.coros.com/mcp", accessToken: "synthetic-token" });
    const health = vi.fn<typeof collectCorosHealth>().mockImplementation(async (_read, window) => {
      const result = { items: [], through: window.through, observedAt: new Date().toISOString(), limitations: [], activityError: undefined,
        observedDates: [], unconfirmedZeroDates: [] };
      return window.source ? { ...result, bulkSource: window.source } : { ...result, bulkSource: undefined };
    });
    const deps: CorosSyncDependencies = { refresh, read: vi.fn(), write: vi.fn(), health, writeMetrics: vi.fn(),
      adapter: vi.fn().mockResolvedValue({ readText: async () => ({ text: JSON.stringify({ schema_version: 1,
        workspace_id: "synthetic", owner_id: "test-owner", owner_login: "example-owner", locale: "zh-CN", timezone: "Asia/Shanghai" }) }) }) };
    try {
      // A suspended invocation models runtime termination: its finally never runs.
      void runCorosSync(fixture.env, new Date(), deps);
      for (let turn = 0; turn < 30 && !refresh.mock.calls.length; turn++) await Promise.resolve();
      expect(refresh).toHaveBeenCalledTimes(1);
      const started = fixture.saved()!;
      expect(started.lease_token).toBeTruthy();
      expect(started.progress.lastAttemptAt).toBe(SYNC_TEST_NOW);
      expect(started.progress.health).toMatchObject({ lastAttemptSource: "hrvActivity", backfillNext: "2024-01-01", backfillThrough: null });
      expect(started.progress.health?.bulk?.dailyHealth.backfillNext).toBe("2024-01-01");
      expect(started.progress.lastSuccessAt).toBeNull();
      vi.setSystemTime(Date.parse(SYNC_TEST_NOW) + 600_000);
      expect((await runCorosSync(fixture.env, new Date(), deps)).status).toBe("processed");
      expect(health.mock.calls[0][1].source).toBe("dailyHealth");
      expect(fixture.saved()?.progress.health?.backfillThrough).toBeNull();
    } finally { fixture.sqlite.close(); }
  });

  it("lets daily health and RHR progress even when common recent details are pending at every cron tick", async () => {
    const fixture = syncTestDatabase(); fixture.connection();
    const p = initialSyncProgress("2024-01-01", "Asia/Shanghai");
    p.domains.sleep.recentRequestSequence = 1; p.domains.workout.recentRequestSequence = 1;
    fixture.job(p);
    const sources: string[] = [];
    const health = vi.fn<typeof collectCorosHealth>().mockImplementation(async (_read, window) => {
      sources.push(window.source ?? "hrvActivity");
      const result = { items: [], through: window.through, observedAt: new Date().toISOString(), limitations: [],
        observedDates: [], unconfirmedZeroDates: [] };
      return window.source ? { ...result, bulkSource: window.source, activityError: undefined }
        : { ...result, bulkSource: undefined, activityError: "COROS_SYNC_ACTIVITY_DETAILS_PENDING" };
    });
    const deps: CorosSyncDependencies = {
      refresh: vi.fn().mockResolvedValue({ resourceUrl: "https://mcpcn.coros.com/mcp", accessToken: "synthetic-token" }),
      read: vi.fn(), write: vi.fn(), health, writeMetrics: vi.fn(),
      adapter: vi.fn().mockResolvedValue({ readText: async () => ({ text: JSON.stringify({ schema_version: 1, workspace_id: "synthetic", owner_id: "test-owner", owner_login: "example-owner", locale: "zh-CN", timezone: "Asia/Shanghai" }) }) }),
    };
    try {
      for (let tick = 0; tick < 6; tick++) {
        vi.setSystemTime(Date.parse(SYNC_TEST_NOW) + tick * 600_000);
        expect((await runCorosSync(fixture.env, new Date(), deps)).status).toBe("processed");
        expect(fixture.saved()?.lease_token).toBeNull();
      }
      expect(sources).toEqual(["hrvActivity", "dailyHealth", "hrvActivity", "restingHeartRate", "hrvActivity", "dailyHealth"]);
      const saved = fixture.saved()!.progress;
      expect(saved.health?.backfillNext).toBe("2024-01-01"); // Pending details never become coverage.
      expect(saved.health?.bulk?.dailyHealth.backfillThrough).toBe("2024-01-28");
      expect(saved.health?.bulk?.restingHeartRate.recentRequestSequence).toBe(1);
      expect(saved.health?.lastAttemptSource).toBe("dailyHealth");
      expect(deps.read).not.toHaveBeenCalled(); expect(deps.writeMetrics).not.toHaveBeenCalled();
    } finally { fixture.sqlite.close(); }
  });

  it("respects source backoff and blocked capacity while preserving an independent common window", () => {
    const p = initialSyncProgress("2024-01-01", "Asia/Shanghai");
    p.request = { sequence: 1, through: "2024-02-01" };
    nextHealthSyncWindow(p, new Date());
    p.health!.lastAttemptSource = "hrvActivity";
    const bulk = initializeBulkHealthProgress(p);
    bulk.dailyHealth.blockedCode = "COROS_READ_RESULT_TOO_LARGE";
    bulk.restingHeartRate.retryAfter = "2024-02-01T04:10:00.000Z";
    expect(nextHealthSyncWindow(p, new Date())).toMatchObject({ domain: "health", recent: true });
    expect(nextHealthSyncWindow(p, new Date())?.source).toBeUndefined();
    vi.setSystemTime("2024-02-01T04:10:00.000Z");
    expect(nextHealthSyncWindow(p, new Date())).toMatchObject({ source: "restingHeartRate" });
    expect(bulk.dailyHealth.blockedCode).toBe("COROS_READ_RESULT_TOO_LARGE");
  });

  it("yields an available RHR turn even when a failed daily window becomes due again alongside cron", () => {
    const p = initialSyncProgress("2024-01-01", "Asia/Shanghai");
    p.request = { sequence: 1, through: "2024-02-01" };
    nextHealthSyncWindow(p, new Date());
    p.health!.lastAttemptSource = "hrvActivity";
    p.health!.lastBulkAttemptSource = "dailyHealth";
    p.health!.bulk!.dailyHealth.retryAfter = "2024-02-01T04:20:00.000Z";
    vi.setSystemTime("2024-02-01T04:20:00.000Z");
    expect(nextHealthSyncWindow(p, new Date())).toMatchObject({ source: "restingHeartRate", recent: true });
    p.health!.lastAttemptSource = "restingHeartRate";
    p.health!.lastBulkAttemptSource = "restingHeartRate";
    expect(nextHealthSyncWindow(p, new Date())?.source).toBeUndefined();
    p.health!.lastAttemptSource = "hrvActivity";
    expect(nextHealthSyncWindow(p, new Date())).toMatchObject({ source: "dailyHealth" });
  });
});
