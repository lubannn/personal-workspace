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
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SYNC_TEST_NOW); fixture = syncTestDatabase();
    vi.mocked(authenticatedGitHubUser).mockResolvedValue({ id: SYNC_TEST_USER, login: "example-owner" });
  });
  afterEach(() => { fixture.sqlite.close(); vi.useRealTimers(); vi.resetAllMocks(); });

  it.each(["enable", "pause", "sync"])("requires valid same-origin CSRF on %s", async action => {
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

  it("queues a requested recent refresh without resetting historical cursors", async () => {
    const progress = initialSyncProgress("2024-01-01", "Asia/Shanghai");
    for (const domain of ["sleep", "workout"] as const) {
      progress.domains[domain].lastRecentAt = SYNC_TEST_NOW; progress.domains[domain].recentNext = "2024-01-31";
      progress.domains[domain].retryAfter = "2024-02-01T06:00:00.000Z"; progress.domains[domain].backfillNext = "2024-01-13";
    }
    fixture.connection(); fixture.job(progress);
    fixture.sqlite.exec("UPDATE coros_sync_jobs SET next_run_at = '2024-02-01T06:00:00.000Z'");
    const response = await handleCorosConnectionRequest(request("sync"), fixture.env);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ state: "enabled", queued: true });
    expect(fixture.saved()?.next_run_at).toBe(SYNC_TEST_NOW);
    for (const domain of ["sleep", "workout"] as const) expect(fixture.saved()?.progress.domains[domain]).toMatchObject({
      backfillNext: "2024-01-13", lastRecentAt: null, recentNext: null, retryAfter: null,
    });
  });

  it("does not replace progress while an active worker owns a lease", async () => {
    fixture.connection(); fixture.job();
    fixture.sqlite.exec("UPDATE coros_sync_jobs SET lease_token = 'active', lease_until = '2024-02-01T04:10:00.000Z'");
    const before = fixture.saved(); const response = await handleCorosConnectionRequest(request("sync"), fixture.env);
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "COROS_SYNC_BUSY" }); expect(fixture.saved()).toEqual(before);
  });

  it("loses a refresh request safely if a worker claims the lease after the status read", async () => {
    fixture.connection(); fixture.job();
    fixture.sqlite.exec("UPDATE coros_sync_jobs SET next_run_at = '2024-02-01T06:00:00.000Z'");
    const original = fixture.db.prepare.bind(fixture.db);
    fixture.db.prepare = query => {
      const statement = original(query);
      if (query.startsWith("UPDATE coros_sync_jobs SET progress_json = ?1, next_run_at = ?3")) {
        const run = statement.run.bind(statement);
        statement.run = async () => {
          fixture.sqlite.exec("UPDATE coros_sync_jobs SET lease_token = 'concurrent-worker', lease_until = '2024-02-01T04:10:00.000Z'");
          return run();
        };
      }
      return statement;
    };
    const before = fixture.saved()!; const response = await handleCorosConnectionRequest(request("sync"), fixture.env);
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "COROS_SYNC_BUSY" });
    expect(fixture.saved()?.progress_json).toBe(before.progress_json);
    expect(fixture.saved()?.next_run_at).toBe(before.next_run_at);
    expect(fixture.saved()?.lease_token).toBe("concurrent-worker");
  });

  it("does not turn a paused connection on through the request-update route", async () => {
    fixture.connection("paused"); fixture.job(); const before = fixture.saved();
    const response = await handleCorosConnectionRequest(request("sync"), fixture.env);
    expect(response.status).toBe(409); expect(fixture.saved()).toEqual(before);
  });

  it("disconnect removes the credential and job so later invocations cannot continue", async () => {
    fixture.connection(); fixture.job();
    const response = await handleCorosConnectionRequest(request("disconnect"), fixture.env);
    expect(response.status).toBe(200); expect(fixture.saved()).toBeNull();
    expect(fixture.sqlite.prepare("SELECT count(*) AS count FROM coros_connections").get()).toEqual({ count: 0 });
  });
});
