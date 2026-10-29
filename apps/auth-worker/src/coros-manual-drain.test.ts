import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitHubInstallationConfig } from "./github-installation";
import { createCorosManualBudget, createCorosManualScope, runCorosManualDrain, COROS_MANUAL_BUDGET } from "./coros-manual-drain";
import { runCorosSync, type CorosSyncDependencies } from "./coros-sync";
import { initialSyncProgress } from "./coros-sync-state";
import { syncTestDatabase, SYNC_TEST_NOW } from "./coros-sync-test-helpers";

type Session = ReturnType<NonNullable<CorosSyncDependencies["session"]>>;
const config: GitHubInstallationConfig = { appId: "123", installationId: "456", privateKeyPem: "synthetic-key", owner: "example-owner", repository: "private-data" };
function dependencies() {
  const sessions: Session[] = [];
  const verifyPrivateRepository = vi.fn(async () => ({ fullName: "example-owner/private-data" }));
  const adapter = { verifyPrivateRepository } as unknown as Awaited<ReturnType<CorosSyncDependencies["adapter"]>>;
  const session = vi.fn<NonNullable<CorosSyncDependencies["session"]>>(() => {
    const value: Session = { read: vi.fn(async (name, args) => ({ format: "content" as const,
      payload: [{ type: "text", text: JSON.stringify(name === "querySportRecords"
        ? `No sport records found from ${String(args.startDate).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")} to ${String(args.endDate).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")}.`
        : "No sleep overview data found.") }] })), close: vi.fn(async () => {}) };
    sessions.push(value); return value;
  });
  const deps: CorosSyncDependencies = {
    refresh: vi.fn(async () => ({ githubUserId: "42", resourceUrl: "https://mcpcn.coros.com/mcp", accessToken: "synthetic-token" })),
    session, read: vi.fn(), adapter: vi.fn(async () => adapter), write: vi.fn(),
  };
  return { deps, sessions, verifyPrivateRepository };
}
const progress = () => { const p = initialSyncProgress("2024-01-01", "Asia/Shanghai"); p.request = { sequence: 1, through: "2024-02-01" }; return p; };
const batch = (domain: "sleep" | "workout") => ({ domain, from: "2024-01-30", through: "2024-02-01", created: 0, unchanged: 0, conflicts: 0 });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("bounded manual connection reuse", () => {
  it("shares setup within one invocation, verifies private visibility again, and closes each transport once", async () => {
    const f = dependencies(), scope = createCorosManualScope(f.deps);
    const first = scope.dependencies.session!("https://mcpcn.coros.com/mcp", "synthetic-token");
    const second = scope.dependencies.session!("https://mcpcn.coros.com/mcp", "synthetic-token");
    await first.read("querySleepOverview", {}); await first.close();
    await second.read("querySleepOverview", {}); await second.close();
    await scope.dependencies.adapter(config); await scope.dependencies.adapter({ ...config });
    expect(f.deps.session).toHaveBeenCalledTimes(1); expect(f.deps.adapter).toHaveBeenCalledTimes(1);
    expect(f.verifyPrivateRepository).toHaveBeenCalledTimes(1);
    expect(f.sessions[0].close).not.toHaveBeenCalled();
    await scope.close(); expect(f.sessions[0].close).toHaveBeenCalledTimes(1);
    const next = createCorosManualScope(f.deps);
    next.dependencies.session!("https://mcpcn.coros.com/mcp", "synthetic-token");
    expect(f.deps.session).toHaveBeenCalledTimes(2); await next.close();
  });
  it("does not share transports across refreshed tokens or origins", async () => {
    const f = dependencies(), scope = createCorosManualScope(f.deps);
    scope.dependencies.session!("https://mcpcn.coros.com/mcp", "token-one");
    scope.dependencies.session!("https://mcpcn.coros.com/mcp", "token-two");
    expect(f.deps.session).toHaveBeenCalledTimes(2); await scope.close();
    expect(f.sessions.every(session => vi.mocked(session.close).mock.calls.length === 1)).toBe(true);
  });
  it("rejects a repository that is no longer private before reusing its writer", async () => {
    const f = dependencies(), scope = createCorosManualScope(f.deps);
    await scope.dependencies.adapter(config);
    f.verifyPrivateRepository.mockRejectedValueOnce(new Error("GITHUB_REPOSITORY_NOT_PRIVATE"));
    await expect(scope.dependencies.adapter(config)).rejects.toThrow("GITHUB_REPOSITORY_NOT_PRIVATE");
    expect(f.deps.adapter).toHaveBeenCalledTimes(1); await scope.close();
  });
  it("runs two real SQLite-backed recent windows with one session, keeping historical cursors and releasing both leases", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SYNC_TEST_NOW);
    const db = syncTestDatabase(); db.connection(); db.job(); const f = dependencies();
    try {
      const result = await runCorosManualDrain(db.env, 2, f.deps);
      expect(result.completedBatches?.map(item => item.domain)).toEqual(["sleep", "workout"]);
      expect(f.deps.refresh).toHaveBeenCalledTimes(2); expect(f.deps.session).toHaveBeenCalledTimes(1);
      expect(f.sessions[0].close).toHaveBeenCalledTimes(1);
      expect(db.saved()).toMatchObject({ lease_token: null, progress: { domains: {
        sleep: { recentRequestSequence: 1, backfillNext: "2024-01-01" }, workout: { recentRequestSequence: 1, backfillNext: "2024-01-01" },
      } } });
    } finally { db.sqlite.close(); }
  });
  it("stops before another source when the connection is paused between committed windows", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SYNC_TEST_NOW);
    const db = syncTestDatabase(); db.connection(); db.job(); const f = dependencies();
    const runner: typeof runCorosSync = async (...args) => {
      const result = await runCorosSync(...args);
      if (result.status === "processed") db.sqlite.exec("UPDATE coros_connections SET state = 'paused'");
      return result;
    };
    try {
      const result = await runCorosManualDrain(db.env, 2, f.deps, runner);
      expect(result).toMatchObject({ status: "error", errorCode: "COROS_SYNC_PAUSED" });
      expect(result.completedBatches?.map(item => item.domain)).toEqual(["sleep"]);
      expect(f.deps.refresh).toHaveBeenCalledTimes(1); expect(db.saved()?.lease_token).toBeNull();
    } finally { db.sqlite.close(); }
  });
  it("does not adopt a newer queued observation between windows", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SYNC_TEST_NOW);
    const db = syncTestDatabase(); db.connection(); db.job(); const f = dependencies();
    const runner: typeof runCorosSync = async (...args) => {
      const result = await runCorosSync(...args);
      if (result.status === "processed") db.sqlite.exec("UPDATE coros_sync_jobs SET request_seq = 2");
      return result;
    };
    try {
      const result = await runCorosManualDrain(db.env, 2, f.deps, runner);
      expect(result.status).toBe("deferred"); expect(result.completedBatches).toHaveLength(1);
      expect(f.deps.refresh).toHaveBeenCalledTimes(1);
      expect(db.saved()).toMatchObject({ request_seq: 2, lease_token: null });
    } finally { db.sqlite.close(); }
  });
  it("does not lose committed updates if a later window throws", async () => {
    const f = dependencies(); const runner = vi.fn<typeof runCorosSync>()
      .mockResolvedValueOnce({ status: "processed", progress: progress(), batch: batch("sleep"), madeProgress: true })
      .mockRejectedValueOnce(new Error("synthetic database interruption"));
    const db = syncTestDatabase();
    try {
      expect(await runCorosManualDrain(db.env, 2, f.deps, runner)).toMatchObject({ status: "error", errorCode: "COROS_SYNC_FAILED", completedBatches: [batch("sleep")] });
      expect(runner.mock.calls[1][3]?.expectedRequest).toEqual({ sequence: 1, through: "2024-02-01" });
    } finally { db.sqlite.close(); }
  });
  it("continues a committed window immediately when the next window reaches the local budget", async () => {
    const f = dependencies(), p = progress();
    p.domains.sleep.recentRequestSequence = 1;
    const runner = vi.fn<typeof runCorosSync>()
      .mockResolvedValueOnce({ status: "processed", progress: p, batch: batch("sleep"), madeProgress: true })
      .mockResolvedValueOnce({ status: "deferred", progress: p, errorCode: "COROS_SYNC_BUDGET_EXHAUSTED" });
    const db = syncTestDatabase();
    try {
      const result = await runCorosManualDrain(db.env, 2, f.deps, runner);
      expect(result).toMatchObject({ status: "processed", batch: batch("sleep"), completedBatches: [batch("sleep")] });
      expect(result.progress?.domains.workout.recentRequestSequence).toBeUndefined();
      expect(result.progress?.failureCount).toBe(0);
    } finally { db.sqlite.close(); }
  });
});

describe("manual transport budget", () => {
  it("counts HTTP hops, blocks excess calls and rejects automatic redirects", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({})); const budget = createCorosManualBudget(fetcher);
    try {
      for (let i = 0; i < COROS_MANUAL_BUDGET.fetches; i++) await budget.fetch("https://mcpcn.coros.com/mcp");
      await expect(budget.fetch("https://mcpcn.coros.com/mcp")).rejects.toThrow("COROS_SYNC_BUDGET_EXHAUSTED");
      expect(fetcher).toHaveBeenCalledTimes(48); expect(budget.denied()).toBe(true);
      expect(fetcher.mock.calls[0][1]?.redirect).toBe("manual");
    } finally { budget.close(); }
  });
  it("cancels an ongoing request at the overall deadline and clears timers", async () => {
    vi.useFakeTimers();
    const fetcher: typeof fetch = async (_input, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
    const budget = createCorosManualBudget(fetcher);
    const result = expect(budget.fetch("https://mcpcn.coros.com/mcp")).rejects.toThrow("COROS_SYNC_BUDGET_EXHAUSTED");
    await vi.advanceTimersByTimeAsync(COROS_MANUAL_BUDGET.wallTimeMs); await result;
    expect(budget.denied()).toBe(true); budget.close(); expect(vi.getTimerCount()).toBe(0);
  });
});
