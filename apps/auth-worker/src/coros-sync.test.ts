import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubContentsAdapter } from "../../../src/lib/github-data/github-contents";
import { runCorosSync, type CorosSyncDependencies } from "./coros-sync";
import type { CorosReadResult } from "./coros-read-client";
import { initialSyncProgress, shiftDate } from "./coros-sync-state";
import { SYNC_TEST_NOW, SYNC_TEST_USER, syncTestDatabase } from "./coros-sync-test-helpers";

function readResult(args: Record<string, unknown>, sleep = true): CorosReadResult {
  const date = (value: unknown) => String(value).replace(/^(\d{4})(\d{2})(\d{2})$/u, "$1-$2-$3");
  const start = date(args.startDate); const end = date(args.endDate);
  if (!sleep) return { format: "content", payload: [{ type: "text", text: `No sport records found from ${start} to ${end}.` }] };
  const days: string[] = [];
  for (let d = start; d <= end; d = shiftDate(d, 1)) days.push(`${d}\nSleep detail for this day is not available yet.`);
  return { format: "content", payload: [{ type: "text", text: `Sleep Overview\n========================\nNote: each record below is dated by its wake-up day.\n\n${days.join("\n\n")}` }] };
}
function cappedWorkouts(args: Record<string, unknown>): CorosReadResult {
  const format = (value: unknown) => String(value).replace(/^(\d{4})(\d{2})(\d{2})$/u, "$1-$2-$3");
  const start = format(args.startDate); const end = format(args.endDate);
  const timestamp = Date.parse(`${start}T08:00:00Z`) / 1000;
  const rows = Array.from({ length: 20 }, (_, index) => `${index + 1}. Indoor Run — ${start}\n   Time Window: startTimestamp=${timestamp + index * 600} | endTimestamp=${timestamp + (index + 1) * 600}\n   Duration: 10:00\n   LabelId: ${9000 + index} | SportType: 101`);
  return { format: "content", payload: [{ type: "text", text: `Sport Records — ${start} to ${end} (20 records)\n========================\n\n${rows.join("\n\n")}` }] };
}
function dependencies() {
  const adapter = new GitHubContentsAdapter({ owner: "example-owner", repository: "private-data", token: "test" }, vi.fn());
  vi.spyOn(adapter, "readText").mockResolvedValue({ path: "workspace.json", blobSha: "descriptor-sha", sizeBytes: 100, text: JSON.stringify({
    schema_version: 1, workspace_id: "test-workspace", owner_id: "test-owner", owner_login: "example-owner", locale: "zh-CN", timezone: "Asia/Shanghai",
  }) });
  const deps = {
    refresh: vi.fn<CorosSyncDependencies["refresh"]>().mockResolvedValue({ resourceUrl: "https://mcpcn.coros.com/mcp", accessToken: "test-access", githubUserId: SYNC_TEST_USER }),
    read: vi.fn<CorosSyncDependencies["read"]>().mockImplementation(async (_resource, _token, tool, args) => readResult(args, tool !== "querySportRecords")),
    adapter: vi.fn<CorosSyncDependencies["adapter"]>().mockResolvedValue(adapter),
    write: vi.fn<CorosSyncDependencies["write"]>().mockResolvedValue({ created: 0, unchanged: 0, conflicts: 0, totalPendingConflicts: 0,
      conflictDetails: [], latestSleepDate: null, latestWorkoutDate: null }),
  };
  return { deps, adapter };
}

describe("COROS scheduled synchronization", () => {
  let fixture: ReturnType<typeof syncTestDatabase>;
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SYNC_TEST_NOW); fixture = syncTestDatabase(); });
  afterEach(() => { fixture.sqlite.close(); vi.useRealTimers(); });

  it("does nothing without configuration or an enabled connection", async () => {
    const { deps } = dependencies();
    await runCorosSync(fixture.env, new Date(), deps);
    fixture.connection("paused"); fixture.job();
    await runCorosSync(fixture.env, new Date(), deps);
    fixture.sqlite.exec("UPDATE coros_connections SET state = 'enabled'");
    await runCorosSync({ ...fixture.env, GITHUB_APP_PRIVATE_KEY: undefined }, new Date(), deps);
    await runCorosSync({ ...fixture.env, TOKEN_ENCRYPTION_KEY: undefined }, new Date(), deps);
    expect(deps.refresh).not.toHaveBeenCalled(); expect(deps.read).not.toHaveBeenCalled(); expect(deps.write).not.toHaveBeenCalled();
    expect(fixture.saved()?.lease_token).toBeNull();
  });

  it("claims one lease before refresh-token rotation even when scheduler invocations overlap", async () => {
    fixture.connection(); fixture.job(); const { deps } = dependencies();
    let entered!: () => void; const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    deps.refresh.mockImplementation(async () => { entered(); await wait; return { resourceUrl: "https://mcpcn.coros.com/mcp", accessToken: "test-access", githubUserId: SYNC_TEST_USER }; });
    const first = runCorosSync(fixture.env, new Date(), deps); await enteredPromise;
    await runCorosSync(fixture.env, new Date(), deps);
    expect(deps.refresh).toHaveBeenCalledTimes(1); expect(fixture.saved()?.lease_token).toBeTruthy();
    release(); await first;
    expect(deps.write).toHaveBeenCalledTimes(1); expect(fixture.saved()?.lease_token).toBeNull();
  });

  it("reads recent sleep and workouts first, then advances bounded historical coverage", async () => {
    fixture.connection(); fixture.job(); const { deps } = dependencies();
    await runCorosSync(fixture.env, new Date(), deps);
    expect(deps.read).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), "querySleepOverview", { startDate: "20240130", endDate: "20240201" });
    expect(fixture.saved()?.progress.domains.sleep).toMatchObject({ recentThrough: "2024-02-01", backfillNext: "2024-01-01", backfillThrough: null });
    vi.setSystemTime("2024-02-01T04:10:00.000Z"); await runCorosSync(fixture.env, new Date(), deps);
    expect(deps.read).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), "querySportRecords", expect.objectContaining({ startDate: "20240126", endDate: "20240201", limit: 100 }));
    vi.setSystemTime("2024-02-01T04:20:00.000Z"); await runCorosSync(fixture.env, new Date(), deps);
    expect(fixture.saved()?.progress.domains.sleep).toMatchObject({ backfillNext: "2024-01-04", backfillThrough: "2024-01-03" });
    expect(fixture.saved()?.progress.domains.workout.backfillThrough).toBeNull();
    expect(fixture.saved()?.next_run_at).toBe("2024-02-01T04:30:00.000Z");
  });

  it("persists counts and canonical latest dates from a successful writer result", async () => {
    fixture.connection(); fixture.job(); const { deps } = dependencies();
    deps.write.mockResolvedValue({ created: 2, unchanged: 3, conflicts: 1, totalPendingConflicts: 1, conflictDetails: [], latestSleepDate: "2024-02-01", latestWorkoutDate: null });
    await runCorosSync(fixture.env, new Date(), deps);
    expect(fixture.saved()?.progress).toMatchObject({ lastSuccessAt: SYNC_TEST_NOW, failureCount: 0, conflicts: 1,
      domains: { sleep: { created: 2, latestRecordDate: "2024-02-01" } }, lastBatch: { domain: "sleep", created: 2, unchanged: 3, conflicts: 1 } });
    expect(fixture.sqlite.prepare("SELECT last_sync_at FROM coros_connections").get()).toEqual({ last_sync_at: SYNC_TEST_NOW });
  });

  it("does not advance a failed window and backs off without persisting private exception text", async () => {
    fixture.connection(); fixture.job(); const { deps } = dependencies();
    deps.read.mockRejectedValue(new Error("private response and token must never be persisted"));
    await runCorosSync(fixture.env, new Date(), deps);
    let saved = fixture.saved()!;
    expect(saved.progress.domains.sleep).toMatchObject({ backfillNext: "2024-01-01", recentThrough: null, lastRecentAt: null });
    expect(saved.progress).toMatchObject({ lastSuccessAt: null, failureCount: 1, lastErrorCode: "COROS_SYNC_FAILED" });
    expect(saved.next_run_at).toBe("2024-02-01T04:10:00.000Z");
    expect(saved.progress.domains.sleep.retryAfter).toBe("2024-02-01T04:20:00.000Z");
    expect(saved.progress_json).not.toMatch(/private response|token must/u); expect(deps.write).not.toHaveBeenCalled();
    vi.setSystemTime("2024-02-01T04:10:00.000Z"); await runCorosSync(fixture.env, new Date(), deps);
    expect(deps.read).toHaveBeenCalledTimes(2);
    expect(deps.read.mock.calls[1][2]).toBe("querySportRecords");
    expect(fixture.saved()?.progress.domains.sleep.retryAfter).toBe("2024-02-01T04:20:00.000Z");
    vi.setSystemTime("2024-02-01T04:20:00.000Z"); await runCorosSync(fixture.env, new Date(), deps);
    saved = fixture.saved()!; expect(saved.progress.failureCount).toBe(3); expect(saved.next_run_at).toBe("2024-02-01T04:30:00.000Z");
    expect(saved.progress.domains.sleep.retryAfter).toBe("2024-02-01T05:40:00.000Z");
  });

  it.each(["pause", "disconnect"] as const)("a %s during the read prevents writing its late result", async action => {
    fixture.connection(); fixture.job(); const { deps } = dependencies();
    deps.read.mockImplementation(async (_resource, _token, _tool, args) => {
      if (action === "pause") fixture.sqlite.exec("UPDATE coros_connections SET state = 'paused'; UPDATE coros_sync_jobs SET lease_token = NULL, lease_until = NULL");
      else fixture.sqlite.exec("DELETE FROM coros_connections; DELETE FROM coros_sync_jobs");
      return readResult(args);
    });
    await runCorosSync(fixture.env, new Date(), deps);
    expect(deps.adapter).not.toHaveBeenCalled(); expect(deps.write).not.toHaveBeenCalled();
    if (action === "pause") expect(fixture.saved()?.progress.lastSuccessAt).toBeNull(); else expect(fixture.saved()).toBeNull();
  });

  it("hands the writer a final lease check that blocks a pause before commit", async () => {
    fixture.connection(); fixture.job(); const { deps } = dependencies(); let committed = false;
    deps.write.mockImplementation(async (_adapter, input) => {
      fixture.sqlite.exec("UPDATE coros_connections SET state = 'paused'; UPDATE coros_sync_jobs SET lease_token = NULL, lease_until = NULL");
      await input.beforeCommit?.(); committed = true;
      return { created: 0, unchanged: 0, conflicts: 0, totalPendingConflicts: 0, conflictDetails: [], latestSleepDate: null, latestWorkoutDate: null };
    });
    await runCorosSync(fixture.env, new Date(), deps);
    expect(committed).toBe(false); expect(fixture.saved()?.progress.lastSuccessAt).toBeNull();
  });

  it("cannot write a result fetched under an older authorization after reconnect", async () => {
    fixture.connection(); fixture.job(); const { deps } = dependencies();
    deps.read.mockImplementation(async (_resource, _token, _tool, args) => {
      fixture.sqlite.exec("UPDATE coros_connections SET connected_at = '2024-02-01T04:01:00.000Z'");
      return readResult(args);
    });
    await runCorosSync(fixture.env, new Date(), deps);
    expect(deps.write).not.toHaveBeenCalled(); expect(fixture.saved()?.progress.lastSuccessAt).toBeNull();
  });

  it("pauses and releases the lease when persisted progress cannot be parsed", async () => {
    fixture.connection(); fixture.job(); const { deps } = dependencies();
    fixture.sqlite.exec("UPDATE coros_sync_jobs SET progress_json = '{broken' ");
    await runCorosSync(fixture.env, new Date(), deps);
    expect(deps.refresh).not.toHaveBeenCalled();
    expect(fixture.sqlite.prepare("SELECT state, last_error_code FROM coros_connections").get()).toEqual({ state: "paused", last_error_code: "COROS_SYNC_STATE_INVALID" });
    expect(fixture.sqlite.prepare("SELECT lease_token, lease_until FROM coros_sync_jobs").get()).toEqual({ lease_token: null, lease_until: null });
  });

  it("uses the legacy sleep tool only when the preferred tool is unavailable", async () => {
    fixture.connection(); fixture.job(); const { deps } = dependencies();
    deps.read.mockRejectedValueOnce(new Error("COROS_READ_TOOL_UNAVAILABLE"));
    await runCorosSync(fixture.env, new Date(), deps);
    expect(deps.read.mock.calls.map(call => call[2])).toEqual(["querySleepOverview", "querySleepData"]);
    expect(fixture.saved()?.progress.lastSuccessAt).toBe(SYNC_TEST_NOW);
  });

  it("never writes through an installation whose workspace owner differs", async () => {
    fixture.connection(); fixture.job(); const { deps, adapter } = dependencies();
    vi.mocked(adapter.readText).mockResolvedValue({ path: "workspace.json", blobSha: "descriptor-sha", sizeBytes: 100, text: JSON.stringify({ schema_version: 1,
      workspace_id: "wrong-workspace", owner_id: "wrong-owner", owner_login: "wrong-login", locale: "zh-CN", timezone: "Asia/Shanghai" }) });
    await runCorosSync(fixture.env, new Date(), deps);
    expect(deps.write).not.toHaveBeenCalled(); expect(fixture.saved()?.progress.lastErrorCode).toBe("COROS_SYNC_WORKSPACE_MISMATCH");
  });

  it("does not advance coverage when COROS silently returns fewer requested sleep days", async () => {
    fixture.connection(); fixture.job(); const { deps } = dependencies();
    deps.read.mockImplementation(async (_resource, _token, _tool, args) => readResult({ ...args, startDate: args.endDate }));
    await runCorosSync(fixture.env, new Date(), deps);
    expect(deps.write).not.toHaveBeenCalled();
    expect(fixture.saved()?.progress.domains.sleep).toMatchObject({ lastRecentAt: null, recentThrough: null, backfillNext: "2024-01-01", lastErrorCode: "COROS_SYNC_FORMAT_UNSUPPORTED" });
  });

  it("shrinks a capped workout window and resumes its unprocessed remainder", async () => {
    const progress = initialSyncProgress("2024-01-01", "Asia/Shanghai"); progress.domains.sleep.lastRecentAt = SYNC_TEST_NOW;
    fixture.connection(); fixture.job(progress); const { deps } = dependencies();
    deps.read.mockImplementationOnce(async (_resource, _token, _tool, args) => cappedWorkouts(args));
    await runCorosSync(fixture.env, new Date(), deps);
    expect(deps.read.mock.calls.map(call => call[3].endDate)).toEqual(["20240201", "20240129"]);
    expect(fixture.saved()?.progress.domains.workout).toMatchObject({ recentThrough: "2024-01-29", recentNext: "2024-01-30", lastRecentAt: null, backfillNext: "2024-01-01" });
    expect(deps.write).toHaveBeenCalledTimes(1);
    vi.setSystemTime("2024-02-01T04:10:00.000Z"); await runCorosSync(fixture.env, new Date(), deps);
    expect(deps.read).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), "querySportRecords", expect.objectContaining({ startDate: "20240130", endDate: "20240201" }));
    expect(fixture.saved()?.progress.domains.workout).toMatchObject({ recentNext: null, recentThrough: "2024-02-01", lastRecentAt: "2024-02-01T04:10:00.000Z" });
  });

  it("does not advance a single workout day that still reaches the result cap", async () => {
    const progress = initialSyncProgress("2024-01-01", "Asia/Shanghai"); progress.domains.sleep.lastRecentAt = SYNC_TEST_NOW;
    fixture.connection(); fixture.job(progress); const { deps } = dependencies();
    deps.read.mockImplementation(async (_resource, _token, _tool, args) => cappedWorkouts(args));
    await runCorosSync(fixture.env, new Date(), deps);
    expect(deps.read.mock.calls.map(call => call[3].endDate)).toEqual(["20240201", "20240129", "20240127", "20240126"]);
    expect(deps.write).not.toHaveBeenCalled();
    expect(fixture.saved()?.progress.domains.workout).toMatchObject({ recentThrough: null, backfillNext: "2024-01-01", lastErrorCode: "COROS_SYNC_WINDOW_TRUNCATED" });
  });

  it("waits without refreshing credentials when all selected history and recent reads are current", async () => {
    const progress = initialSyncProgress("2024-01-01", "Asia/Shanghai");
    for (const domain of ["sleep", "workout"] as const) { progress.domains[domain].lastRecentAt = SYNC_TEST_NOW; progress.domains[domain].backfillNext = "2024-02-02"; }
    fixture.connection(); fixture.job(progress); const { deps } = dependencies();
    await runCorosSync(fixture.env, new Date(), deps);
    expect(deps.refresh).not.toHaveBeenCalled(); expect(fixture.saved()?.next_run_at).toBe("2024-02-01T04:30:00.000Z");
  });
});
