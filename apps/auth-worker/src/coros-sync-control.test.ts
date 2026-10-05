import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticatedGitHubUser } from "./auth";
import { handleCorosConnectionRequest } from "./coros-connection";
import { initialSyncProgress } from "./coros-sync-state";
import { SYNC_TEST_NOW, SYNC_TEST_ORIGIN, SYNC_TEST_USER, syncTestDatabase } from "./coros-sync-test-helpers";

vi.mock("./auth", async importOriginal => ({ ...await importOriginal<typeof import("./auth")>(), authenticatedGitHubUser: vi.fn() }));
const headers = { cookie: "__Host-pw_csrf=test-csrf", origin: SYNC_TEST_ORIGIN, "x-pw-csrf": "test-csrf", "content-type": "application/json" };
function request(action: string, body?: unknown, overrides?: Record<string, string>) {
  return new Request(`${SYNC_TEST_ORIGIN}/coros/${action}`, { method: "POST", headers: { ...headers, ...overrides }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

describe("COROS synchronization controls", () => {
  let fixture: ReturnType<typeof syncTestDatabase>;
  function queueState() {
    return fixture.sqlite.prepare("SELECT request_seq, requested_through, daily_requested_date FROM coros_sync_jobs WHERE github_user_id = ?").get(SYNC_TEST_USER) as {
      request_seq: number; requested_through: string | null; daily_requested_date: string | null;
    } | undefined;
  }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SYNC_TEST_NOW); fixture = syncTestDatabase();
    vi.mocked(authenticatedGitHubUser).mockResolvedValue({ id: SYNC_TEST_USER, login: "example-owner" });
  });
  afterEach(() => { fixture.sqlite.close(); vi.useRealTimers(); vi.resetAllMocks(); });

  it("advertises history controls and the paused lease state for frontend capability guards", async () => {
    fixture.connection("paused"); fixture.job();
    const response = await handleCorosConnectionRequest(new Request(`${SYNC_TEST_ORIGIN}/coros/status`), fixture.env);
    expect(await response.json()).toMatchObject({ state: "paused", sync: { capabilities: { historyScope: true }, running: false } });
    fixture.sqlite.exec("UPDATE coros_sync_jobs SET lease_token = 'active', lease_until = '2024-02-01T04:10:00.000Z'");
    const leased = await handleCorosConnectionRequest(new Request(`${SYNC_TEST_ORIGIN}/coros/status`), fixture.env);
    expect(await leased.json()).toMatchObject({ state: "paused", sync: { running: true } });
  });

  it.each(["enable", "pause", "sync", "daily", "history"])("requires valid same-origin CSRF on %s", async action => {
    fixture.connection(); fixture.job();
    const before = fixture.saved();
    const response = await handleCorosConnectionRequest(request(action, { startDate: "2024-01-01" }, { origin: "https://other.example" }), fixture.env);
    expect(response.status).toBe(403); expect(fixture.saved()).toEqual(before);
    expect(fixture.sqlite.prepare("SELECT state FROM coros_connections").get()).toEqual({ state: "enabled" });
  });

  it("does not allow another authenticated account to start this account's background writer", async () => {
    fixture.connection("paused"); vi.mocked(authenticatedGitHubUser).mockResolvedValue({ id: "other-id", login: "another-owner" });
    const response = await handleCorosConnectionRequest(request("enable", { startDate: "2024-01-01" }), fixture.env);
    expect(response.status).toBe(409); expect(fixture.saved()).toBeNull();
  });

  it("requires background write configuration before enabling", async () => {
    fixture.connection("paused");
    const response = await handleCorosConnectionRequest(request("enable", { startDate: "2024-01-01" }), { ...fixture.env, GITHUB_APP_PRIVATE_KEY: undefined });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: "COROS_SYNC_NOT_CONFIGURED" });
    expect(fixture.saved()).toBeNull(); expect(fixture.sqlite.prepare("SELECT state FROM coros_connections").get()).toEqual({ state: "paused" });
  });

  it("enables a valid initial job and queues it without making synchronous COROS calls", async () => {
    fixture.connection("paused"); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    try {
      const response = await handleCorosConnectionRequest(request("enable", { startDate: "2024-01-01" }), fixture.env);
      expect(response.status).toBe(200); expect(await response.json()).toEqual({ state: "enabled", queued: true });
      expect(fixture.saved()?.progress).toMatchObject({ startDate: "2024-01-01", lastSuccessAt: null, domains: {
        sleep: { backfillNext: "2024-01-01", latestRecordDate: null }, workout: { backfillNext: "2024-01-01", latestRecordDate: null },
      } });
      expect(fixture.saved()?.next_run_at).toBe(SYNC_TEST_NOW); expect(fetcher).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it.each(["2024-02-30", "2024-02-02", "1999-12-31", "not-a-date"])("rejects an invalid or unsupported initial start date %s", async startDate => {
    fixture.connection("paused");
    const response = await handleCorosConnectionRequest(request("enable", { startDate }), fixture.env);
    expect(response.status).toBe(400); expect(fixture.saved()).toBeNull();
  });

  it("pauses even when writer configuration is missing, and invalidates the active lease", async () => {
    fixture.connection(); fixture.job();
    fixture.sqlite.exec("UPDATE coros_sync_jobs SET lease_token = 'active', lease_until = '2024-02-01T04:10:00.000Z'");
    const response = await handleCorosConnectionRequest(request("pause"), { ...fixture.env, GITHUB_APP_PRIVATE_KEY: undefined });
    expect(response.status).toBe(200); expect(fixture.saved()).toMatchObject({ lease_token: null, lease_until: null });
    expect(fixture.sqlite.prepare("SELECT state FROM coros_connections").get()).toEqual({ state: "paused" });
  });

  it("resumes with the saved start date and preserves all historical progress", async () => {
    const progress = initialSyncProgress("2024-01-01", "Asia/Shanghai");
    progress.domains.sleep.backfillNext = "2024-01-13"; progress.domains.sleep.backfillThrough = "2024-01-12";
    progress.domains.sleep.created = 8; progress.domains.sleep.latestRecordDate = "2024-01-31";
    fixture.connection("paused"); fixture.job(progress);
    const response = await handleCorosConnectionRequest(request("enable", { startDate: "2024-01-01" }), fixture.env);
    expect(response.status).toBe(200); expect(fixture.saved()?.progress).toEqual(progress);
    expect(fixture.saved()?.next_run_at).toBe(SYNC_TEST_NOW);
  });

  it("does not silently replace a saved history start date on resume", async () => {
    fixture.connection("paused"); fixture.job(); const before = fixture.saved();
    const response = await handleCorosConnectionRequest(request("enable", { startDate: "2023-01-01" }), fixture.env);
    expect(response.status).toBe(409); expect(fixture.saved()).toEqual(before);
  });

  it("explicitly extends paused history without queuing a write or erasing counters", async () => {
    const p = initialSyncProgress("2024-01-01", "Asia/Shanghai");
    p.domains.sleep.created = 10; p.domains.sleep.backfillThrough = "2024-01-31"; p.domains.sleep.backfillNext = "2024-02-01";
    fixture.connection("paused"); fixture.job(p);
    const before = queueState();
    const response = await handleCorosConnectionRequest(request("history", { startDate: "2023-01-01" }), fixture.env);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ state: "paused", historyStartDate: "2023-01-01", queued: false });
    expect(fixture.saved()?.progress).toMatchObject({ startDate: "2023-01-01", domains: { sleep: { created: 10, backfillNext: "2023-01-01", backfillThrough: null } } });
    expect(queueState()).toEqual(before);
    expect(fixture.sqlite.prepare("SELECT state FROM coros_connections").get()).toEqual({ state: "paused" });
  });

  it("rejects history edits while enabled, leased, or attempting to shrink the scope", async () => {
    fixture.connection(); fixture.job();
    expect((await handleCorosConnectionRequest(request("history", { startDate: "2023-01-01" }), fixture.env)).status).toBe(409);
    fixture.sqlite.exec("UPDATE coros_connections SET state = 'paused'; UPDATE coros_sync_jobs SET lease_token = 'active'");
    expect((await handleCorosConnectionRequest(request("history", { startDate: "2023-01-01" }), fixture.env)).status).toBe(409);
    fixture.sqlite.exec("UPDATE coros_sync_jobs SET lease_token = NULL");
    const before = fixture.saved();
    expect((await handleCorosConnectionRequest(request("history", { startDate: "2024-01-02" }), fixture.env)).status).toBe(400);
    expect(fixture.saved()).toEqual(before);
  });

  it("preserves blocked sources on scope save and resets only the explicitly selected paused source", async () => {
    const p = initialSyncProgress("2024-01-01", "Asia/Shanghai");
    p.health = { ...p.domains.sleep, bulk: {
      dailyHealth: { ...p.domains.sleep, blockedCode: "COROS_READ_RESULT_TOO_LARGE" },
      restingHeartRate: { ...p.domains.sleep, blockedCode: "COROS_SYNC_HEALTH_RANGE_UNCONFIRMED" },
    } };
    fixture.connection("paused"); fixture.job(p); const before = queueState();
    expect((await handleCorosConnectionRequest(request("history", { startDate: p.startDate }), fixture.env)).status).toBe(200);
    expect(fixture.saved()?.progress.health?.bulk?.dailyHealth.blockedCode).toBe("COROS_READ_RESULT_TOO_LARGE");
    expect((await handleCorosConnectionRequest(request("history", { startDate: p.startDate, retryBlockedSources: ["dailyHealth"] }), fixture.env)).status).toBe(200);
    expect(fixture.saved()?.progress.health?.bulk?.dailyHealth.blockedCode).toBeUndefined();
    expect(fixture.saved()?.progress.health?.bulk?.restingHeartRate.blockedCode).toBe("COROS_SYNC_HEALTH_RANGE_UNCONFIRMED");
    expect(queueState()).toEqual(before);
    expect(fixture.sqlite.prepare("SELECT state FROM coros_connections").get()).toEqual({ state: "paused" });
    fixture.sqlite.exec("UPDATE coros_sync_jobs SET lease_token = 'active'");
    expect((await handleCorosConnectionRequest(request("history", { startDate: p.startDate, retryBlockedSources: ["restingHeartRate"] }), fixture.env)).status).toBe(409);
  });

  it.each([{ retryBlockedSources: ["sleep"] }, { retryBlockedSources: ["dailyHealth", "dailyHealth"] }, { retryBlockedSources: "dailyHealth" }])("rejects invalid blocked-source reset selections %j", async ({ retryBlockedSources }) => {
    fixture.connection("paused"); fixture.job(); const before = fixture.saved();
    expect((await handleCorosConnectionRequest(request("history", { startDate: "2024-01-01", retryBlockedSources }), fixture.env)).status).toBe(400);
    expect(fixture.saved()).toEqual(before);
  });

  it("queues a requested refresh without rewriting any in-progress cursors", async () => {
    const progress = initialSyncProgress("2024-01-01", "Asia/Shanghai");
    for (const domain of ["sleep", "workout"] as const) {
      progress.domains[domain].lastRecentAt = SYNC_TEST_NOW; progress.domains[domain].recentNext = "2024-01-31";
      progress.domains[domain].retryAfter = "2024-02-01T06:00:00.000Z"; progress.domains[domain].backfillNext = "2024-01-13";
    }
    fixture.connection(); fixture.job(progress);
    fixture.sqlite.exec("UPDATE coros_sync_jobs SET next_run_at = '2024-02-01T06:00:00.000Z'");
    const before = fixture.saved()!.progress_json;
    const response = await handleCorosConnectionRequest(request("sync"), fixture.env);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ state: "enabled", queued: true });
    expect(fixture.saved()?.next_run_at).toBe(SYNC_TEST_NOW);
    expect(fixture.saved()!.progress_json).toBe(before);
    expect(queueState()).toMatchObject({ request_seq: 2, requested_through: "2024-02-01" });
  });

  it("accepts a new request while preserving an active worker's lease and progress", async () => {
    fixture.connection(); fixture.job();
    fixture.sqlite.exec("UPDATE coros_sync_jobs SET lease_token = 'active', lease_until = '2024-02-01T04:10:00.000Z'");
    const before = fixture.saved(); const response = await handleCorosConnectionRequest(request("sync"), fixture.env);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ state: "enabled", queued: true });
    expect(fixture.saved()?.progress_json).toBe(before!.progress_json);
    expect(fixture.saved()).toMatchObject({ lease_token: "active", lease_until: "2024-02-01T04:10:00.000Z" });
    expect(queueState()).toMatchObject({ request_seq: 2, requested_through: "2024-02-01" });
  });

  it("retains a refresh request if a worker concurrently claims the lease", async () => {
    fixture.connection(); fixture.job();
    fixture.sqlite.exec("UPDATE coros_sync_jobs SET next_run_at = '2024-02-01T06:00:00.000Z'");
    const original = fixture.db.prepare.bind(fixture.db);
    fixture.db.prepare = query => {
      const statement = original(query);
      if (query.startsWith("UPDATE coros_sync_jobs") && query.includes("request_seq")) {
        const run = statement.run.bind(statement);
        statement.run = async () => {
          fixture.sqlite.exec("UPDATE coros_sync_jobs SET lease_token = 'concurrent-worker', lease_until = '2024-02-01T04:10:00.000Z'");
          return run();
        };
      }
      return statement;
    };
    const before = fixture.saved()!; const response = await handleCorosConnectionRequest(request("sync"), fixture.env);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ queued: true });
    expect(fixture.saved()?.progress_json).toBe(before.progress_json);
    expect(fixture.saved()?.next_run_at).toBe(SYNC_TEST_NOW);
    expect(fixture.saved()?.lease_token).toBe("concurrent-worker");
    expect(queueState()).toMatchObject({ request_seq: 2, requested_through: "2024-02-01" });
  });

  it.each(["sync", "daily"])("does not turn a paused connection on through the %s route", async action => {
    fixture.connection("paused"); fixture.job(); const before = fixture.saved();
    const response = await handleCorosConnectionRequest(request(action), fixture.env);
    expect(response.status).toBe(409); expect(fixture.saved()).toEqual(before);
  });

  it("deduplicates concurrent first-login requests across devices on the server", async () => {
    fixture.connection(); fixture.job();
    const [first, second] = await Promise.all([
      handleCorosConnectionRequest(request("daily"), fixture.env),
      handleCorosConnectionRequest(request("daily"), fixture.env),
    ]);
    expect(first.status).toBe(200); expect(second.status).toBe(200);
    const bodies = await Promise.all([first.json(), second.json()]) as Array<{ queued: boolean }>;
    expect(bodies.filter((body) => body.queued)).toHaveLength(1);
    expect(queueState()).toEqual({ request_seq: 2, requested_through: "2024-02-01", daily_requested_date: "2024-02-01" });
    const third = await handleCorosConnectionRequest(request("daily"), fixture.env);
    expect(await third.json()).toMatchObject({ queued: false });
    expect(queueState()?.request_seq).toBe(2);
  });

  it("starts a new daily request at Shanghai midnight, not UTC midnight", async () => {
    fixture.connection(); fixture.job();
    vi.setSystemTime("2024-02-01T15:59:59.000Z");
    expect(await (await handleCorosConnectionRequest(request("daily"), fixture.env)).json()).toMatchObject({ queued: true });
    expect(queueState()?.daily_requested_date).toBe("2024-02-01");
    vi.setSystemTime("2024-02-01T16:00:00.000Z");
    expect(await (await handleCorosConnectionRequest(request("daily"), fixture.env)).json()).toMatchObject({ queued: true });
    expect(queueState()).toEqual({ request_seq: 3, requested_through: "2024-02-02", daily_requested_date: "2024-02-02" });
    vi.setSystemTime("2024-02-02T00:01:00.000Z");
    expect(await (await handleCorosConnectionRequest(request("daily"), fixture.env)).json()).toMatchObject({ queued: false });
    expect(queueState()?.request_seq).toBe(3);
  });

  it("queues the next daily target without disturbing the worker running yesterday's target", async () => {
    fixture.connection(); fixture.job();
    await handleCorosConnectionRequest(request("daily"), fixture.env);
    const before = fixture.saved()!;
    fixture.sqlite.exec("UPDATE coros_sync_jobs SET lease_token = 'worker-yesterday', lease_until = '2024-02-01T16:10:00.000Z'");
    vi.setSystemTime("2024-02-01T16:00:00.000Z");
    expect(await (await handleCorosConnectionRequest(request("daily"), fixture.env)).json()).toMatchObject({ queued: true });
    expect(queueState()).toMatchObject({ request_seq: 3, requested_through: "2024-02-02" });
    expect(fixture.saved()?.progress_json).toBe(before.progress_json);
    expect(fixture.saved()).toMatchObject({ lease_token: "worker-yesterday", lease_until: "2024-02-01T16:10:00.000Z" });
  });

  it("does not regress today's queue when yesterday's manual request arrives after midnight", async () => {
    fixture.connection(); fixture.job();
    let releaseOldRequest!: () => void;
    let oldRequestReachedQueue!: () => void;
    const delayedQueue = new Promise<void>(resolve => { releaseOldRequest = resolve; });
    const reachedQueue = new Promise<void>(resolve => { oldRequestReachedQueue = resolve; });
    const prepare = fixture.db.prepare.bind(fixture.db);
    let delayFirstQueue = true;
    fixture.db.prepare = query => {
      const statement = prepare(query);
      if (delayFirstQueue && query.startsWith("UPDATE coros_sync_jobs") && query.includes("request_seq")) {
        delayFirstQueue = false;
        const run = statement.run.bind(statement);
        statement.run = async () => {
          oldRequestReachedQueue();
          await delayedQueue;
          return run();
        };
      }
      return statement;
    };
    vi.setSystemTime("2024-02-01T15:59:59.000Z");
    const oldRequest = handleCorosConnectionRequest(request("sync"), fixture.env);
    await reachedQueue;
    try {
      vi.setSystemTime("2024-02-01T16:00:01.000Z");
      expect(await (await handleCorosConnectionRequest(request("daily"), fixture.env)).json()).toMatchObject({ queued: true });
      expect(queueState()).toEqual({ request_seq: 2, requested_through: "2024-02-02", daily_requested_date: "2024-02-02" });
    } finally { releaseOldRequest(); }
    expect(await (await oldRequest).json()).toMatchObject({ queued: true });
    expect(queueState()).toEqual({ request_seq: 3, requested_through: "2024-02-02", daily_requested_date: "2024-02-02" });
    expect(await (await handleCorosConnectionRequest(request("daily"), fixture.env)).json()).toMatchObject({ queued: false });
    expect(queueState()?.request_seq).toBe(3);
  });

  it("does not consume the daily trigger when synchronization is unconfigured", async () => {
    fixture.connection(); fixture.job(); const before = fixture.saved();
    const response = await handleCorosConnectionRequest(request("daily"), { ...fixture.env, GITHUB_APP_PRIVATE_KEY: undefined });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: "COROS_SYNC_NOT_CONFIGURED" });
    expect(fixture.saved()).toEqual(before);
  });

  it("guards against a pause between authorization read and daily queue update", async () => {
    fixture.connection(); fixture.job(); const before = fixture.saved();
    const prepare = fixture.db.prepare.bind(fixture.db);
    fixture.db.prepare = query => {
      const statement = prepare(query);
      if (query.startsWith("UPDATE coros_sync_jobs") && query.includes("request_seq")) {
        const run = statement.run.bind(statement);
        statement.run = async () => {
          fixture.sqlite.exec("UPDATE coros_connections SET state = 'paused'");
          return run();
        };
      }
      return statement;
    };
    const response = await handleCorosConnectionRequest(request("daily"), fixture.env);
    expect(response.status).toBeLessThan(500);
    expect(fixture.saved()).toEqual(before);
    expect(fixture.sqlite.prepare("SELECT state FROM coros_connections").get()).toEqual({ state: "paused" });
  });

  it("disconnect removes the credential and job so later invocations cannot continue", async () => {
    fixture.connection(); fixture.job();
    const response = await handleCorosConnectionRequest(request("disconnect"), fixture.env);
    expect(response.status).toBe(200); expect(fixture.saved()).toBeNull();
    expect(fixture.sqlite.prepare("SELECT count(*) AS count FROM coros_connections").get()).toEqual({ count: 0 });
  });
});
