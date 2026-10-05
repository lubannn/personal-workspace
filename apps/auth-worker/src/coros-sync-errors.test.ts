import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubConflictError, GitHubDataError } from "../../../src/lib/github-data/github-contents";
import type { collectCorosHealth } from "./coros-health-sync";
import { runCorosSync, type CorosSyncDependencies } from "./coros-sync";
import { initialSyncProgress } from "./coros-sync-state";
import { SYNC_TEST_NOW, syncTestDatabase } from "./coros-sync-test-helpers";

describe("bounded synchronization error diagnostics", () => {
  let fixture: ReturnType<typeof syncTestDatabase>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SYNC_TEST_NOW);
    fixture = syncTestDatabase(); fixture.connection();
    const p = initialSyncProgress("2024-01-01", "Asia/Shanghai");
    p.domains.sleep.recentRequestSequence = 1; p.domains.workout.recentRequestSequence = 1;
    fixture.job(p);
  });
  afterEach(() => { fixture.sqlite.close(); vi.useRealTimers(); });

  function dependencies() {
    const health = vi.fn<typeof collectCorosHealth>().mockImplementation(async (_read, window) => ({
      items: [], through: window.through, observedAt: SYNC_TEST_NOW, limitations: [],
      activityError: undefined, bulkSource: undefined, observedDates: [], unconfirmedZeroDates: [],
    }));
    const readText = vi.fn().mockResolvedValue({ text: JSON.stringify({ schema_version: 1, workspace_id: "synthetic",
      owner_id: "test-owner", owner_login: "example-owner", locale: "zh-CN", timezone: "Asia/Shanghai" }) });
    const deps: CorosSyncDependencies = { refresh: vi.fn().mockResolvedValue({ resourceUrl: "https://mcpcn.coros.com/mcp", accessToken: "synthetic-token" }),
      read: vi.fn(), health, write: vi.fn(), writeMetrics: vi.fn(), adapter: vi.fn().mockResolvedValue({ readText }) };
    return { deps, health, readText };
  }

  it.each([[401, "GITHUB_UNAUTHORIZED"], [403, "GITHUB_FORBIDDEN"], [429, "GITHUB_RATE_LIMITED"],
    [404, "GITHUB_NOT_FOUND"], [500, "GITHUB_UNAVAILABLE"], [500, "GITHUB_INVALID_RESPONSE"]] as const)
  ("preserves the adapter's safe code for status %s without storing its message", async (status, code) => {
    const { deps, readText } = dependencies();
    readText.mockRejectedValue(new GitHubDataError("synthetic-private-body-and-token", status, code));
    expect(await runCorosSync(fixture.env, new Date(), deps)).toMatchObject({ status: "error", errorCode: code,
      progress: { lastErrorStage: "workspace_read", health: { backfillThrough: null } } });
    expect(fixture.saved()).toMatchObject({ lease_token: null, progress: { lastErrorCode: code, lastErrorStage: "workspace_read" } });
    expect(JSON.stringify(fixture.saved())).not.toContain("synthetic-private-body-and-token");
    expect(deps.writeMetrics).not.toHaveBeenCalled();
  });

  it.each(["COROS_READ_TIMEOUT", "synthetic-private-network-body"])("records the exact failed read tool for %s", async message => {
    const { deps, health } = dependencies();
    health.mockImplementation(async read => { await read("querySleepHrv", { days: 1 }); throw new Error("unreachable"); });
    vi.mocked(deps.read).mockRejectedValue(new Error(message));
    const code = message === "COROS_READ_TIMEOUT" ? message : "COROS_SYNC_FAILED";
    expect(await runCorosSync(fixture.env, new Date(), deps)).toMatchObject({ status: "error", errorCode: code,
      progress: { lastErrorStage: "querySleepHrv", health: { backfillNext: "2024-01-01", backfillThrough: null } } });
    expect(JSON.stringify(fixture.saved())).not.toContain("synthetic-private-network-body");
    expect(deps.adapter).not.toHaveBeenCalled();
  });

  it("does not trust an arbitrary upstream object's code or store its payload", async () => {
    const { deps } = dependencies();
    vi.mocked(deps.refresh).mockRejectedValue({ code: "GITHUB_RATE_LIMITED", message: "synthetic-private-auth-payload" });
    expect(await runCorosSync(fixture.env, new Date(), deps)).toMatchObject({ status: "error", errorCode: "COROS_SYNC_FAILED",
      progress: { lastErrorStage: "credentials_refresh" } });
    expect(JSON.stringify(fixture.saved())).not.toContain("synthetic-private-auth-payload");
  });

  it("rejects an unknown typed GitHub code even when it resembles an internal code", async () => {
    const { deps, readText } = dependencies();
    readText.mockRejectedValue(new GitHubDataError("synthetic-private-body", 500, "GITHUB_SYNTHETIC_PRIVATE_CANARY"));
    expect(await runCorosSync(fixture.env, new Date(), deps)).toMatchObject({ status: "error", errorCode: "COROS_SYNC_FAILED",
      progress: { lastErrorStage: "workspace_read" } });
    expect(JSON.stringify(fixture.saved())).not.toContain("PRIVATE_CANARY");
  });

  it("distinguishes a typed Git conflict at the health writer without advancing coverage", async () => {
    const { deps, health } = dependencies();
    health.mockImplementation(async (_read, window) => ({ through: window.through, observedAt: SYNC_TEST_NOW, limitations: [],
      activityError: undefined, bulkSource: undefined, observedDates: [], unconfirmedZeroDates: [],
      items: [{ sourceId: "health:2024-02-01:steps:daily", measurementTimeKind: "observed_at", candidate: {
        metric_type: "steps", value: 100, unit: "steps", local_date: "2024-02-01", timezone: "Asia/Shanghai", measured_at: SYNC_TEST_NOW, aggregation_period: "daily" } }] }));
    vi.mocked(deps.writeMetrics!).mockRejectedValue(new GitHubConflictError("synthetic-private-conflict-detail"));
    expect(await runCorosSync(fixture.env, new Date(), deps)).toMatchObject({ status: "error", errorCode: "GITHUB_SYNC_CONFLICT",
      progress: { lastErrorStage: "health_write", health: { backfillThrough: null } } });
    expect(JSON.stringify(fixture.saved())).not.toContain("synthetic-private-conflict-detail");
  });


  it.each(["COROS_OAUTH_REFRESH_TRANSPORT_FAILED_PRIVATE_CANARY", "COROS_OAUTH_REFRESH_HTTP_400_PRIVATE_CANARY", "COROS_OAUTH_AUTH_METADATA_HTTP_600"])
  ("rejects forged OAuth classifications %s without persisting payloads", async code => {
    const { deps } = dependencies(); vi.mocked(deps.refresh).mockRejectedValue(new Error(code));
    expect(await runCorosSync(fixture.env, new Date(), deps)).toMatchObject({ status: "error", errorCode: "COROS_SYNC_FAILED" });
    expect(fixture.saved()?.lease_token).toBeNull(); expect(JSON.stringify(fixture.saved())).not.toContain(code);
  });

  it("clears an earlier failed stage on a subsequent successful batch", async () => {
    const { deps } = dependencies();
    const saved = fixture.saved()!.progress;
    saved.lastErrorStage = "querySleepHrv"; saved.lastErrorCode = "COROS_SYNC_FAILED";
    fixture.saveProgress(saved);
    expect(await runCorosSync(fixture.env, new Date(), deps)).toMatchObject({ status: "processed", progress: { lastErrorCode: null, lastErrorStage: null } });
  });

  it("retains a common-source diagnostic while an independent bulk source succeeds", async () => {
    const { deps, health } = dependencies();
    const progress = fixture.saved()!.progress;
    for (const d of Object.values(progress.domains)) d.backfillNext = "2024-02-01";
    fixture.saveProgress(progress);
    health.mockImplementationOnce(async read => { await read("querySleepHrv", { days: 1 }); throw new Error("unreachable"); });
    vi.mocked(deps.read).mockRejectedValue(new Error("synthetic-private-read-failure"));
    expect((await runCorosSync(fixture.env, new Date(), deps)).status).toBe("error");
    health.mockImplementation(async (_read, window) => {
      const result = { items: [], through: window.through, observedAt: SYNC_TEST_NOW, limitations: [], activityError: undefined,
        observedDates: [], unconfirmedZeroDates: [] };
      return window.source ? { ...result, bulkSource: window.source } : { ...result, bulkSource: undefined };
    });
    expect((await runCorosSync(fixture.env, new Date(), deps, { forceDue: true })).status).toBe("processed");
    expect(fixture.saved()?.progress).toMatchObject({ lastErrorCode: null, lastErrorStage: null,
      health: { lastErrorCode: "COROS_SYNC_FAILED", lastErrorStage: "querySleepHrv", bulk: { dailyHealth: { lastErrorCode: null, lastErrorStage: null } } } });
  });
});
