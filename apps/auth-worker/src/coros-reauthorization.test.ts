import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCorosConnectionRequest } from "./coros-connection";
import { syncTestDatabase, SYNC_TEST_ORIGIN, SYNC_TEST_USER } from "./coros-sync-test-helpers";
import { initialSyncProgress } from "./coros-sync-state";
import { nextHealthSyncWindow } from "./coros-health-sync";
import { initializeBulkHealthProgress } from "./coros-health-history";
import { decryptRefreshToken, randomToken } from "./security";

vi.mock("./auth", async importOriginal => ({ ...await importOriginal<typeof import("./auth")>(),
  authenticatedGitHubUser: async () => ({ id: "42", login: "example-owner" }) }));
afterEach(() => vi.unstubAllGlobals());
const origin = "https://mcpcn.coros.com";
const headers = { origin: SYNC_TEST_ORIGIN, cookie: "__Host-pw_csrf=synthetic-csrf", "x-pw-csrf": "synthetic-csrf" };
function fixture() {
  const database = syncTestDatabase(); database.env.TOKEN_ENCRYPTION_KEY = randomToken(32); database.connection("paused");
  const progress = initialSyncProgress("2024-01-01", "Asia/Shanghai");
  progress.request = { sequence: 1, through: "2024-02-01" }; progress.backfillEnd = "2024-02-01";
  nextHealthSyncWindow(progress, new Date("2024-02-01T04:00:00Z")); initializeBulkHealthProgress(progress);
  progress.lastErrorCode = "COROS_OAUTH_REFRESH_HTTP_400_INVALID_GRANT"; progress.failureCount = 4;
  progress.lastSuccessAt = "2024-01-29T00:00:00.000Z";
  progress.domains.workout.backfillNext = "2024-01-08";
  progress.domains.workout.checkedRanges = [{ from: "2024-01-01", through: "2024-01-07" }, { from: "2024-01-22", through: "2024-01-28" }];
  progress.domains.workout.retryAfter = "2099-01-01T00:00:00.000Z";
  progress.health!.encryptedActivityCache = "opaque-synthetic-cache";
  progress.health!.bulk!.dailyHealth.backfillNext = "2024-01-22";
  progress.health!.bulk!.restingHeartRate.blockedCode = "COROS_READ_RESULT_TOO_LARGE";
  database.job(progress);
  database.sqlite.prepare("UPDATE coros_sync_jobs SET lease_token = 'synthetic-lease', lease_until = '2099-01-01T00:00:00.000Z'").run();
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === `${origin}/.well-known/oauth-protected-resource/mcp`) return Response.json({
      resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ["mcp.tools", "offline_access"],
    });
    if (url === `${origin}/.well-known/oauth-authorization-server`) return Response.json({
      issuer: origin, authorization_endpoint: `${origin}/oauth2/authorize`, token_endpoint: `${origin}/oauth2/token`,
      registration_endpoint: `${origin}/connect/register`, code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"],
    });
    if (url === `${origin}/connect/register`) return Response.json({ client_id: "synthetic-new-client",
      redirect_uris: [`${SYNC_TEST_ORIGIN}/coros/callback`], token_endpoint_auth_method: "none" }, { status: 201 });
    if (url === `${origin}/oauth2/token`) {
      expect(new URLSearchParams(String(init?.body)).get("grant_type")).toBe("authorization_code");
      return Response.json({ access_token: "synthetic-access", refresh_token: "synthetic-new-refresh",
        token_type: "Bearer", expires_in: 3600, scope: "mcp.tools offline_access" });
    }
    throw new Error("Unexpected outbound request");
  });
  vi.stubGlobal("fetch", fetcher);
  const request = (path: string, body?: unknown) => handleCorosConnectionRequest(new Request(`${SYNC_TEST_ORIGIN}${path}`, {
    method: path.startsWith("/coros/callback") || path === "/coros/status" ? "GET" : "POST", headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), database.env);
  const connection = () => database.sqlite.prepare("SELECT * FROM coros_connections WHERE github_user_id = ?").get(SYNC_TEST_USER) as Record<string, unknown>;
  async function start() {
    const response = await request("/coros/start"); expect(response.status).toBe(200);
    const body = await response.json() as { authorizationUrl: string };
    return new URL(body.authorizationUrl).searchParams.get("state")!;
  }
  return { ...database, fetcher, request, connection, start };
}

describe("existing COROS connection reauthorization", () => {
  it("preserves all progress and backoff through start, encrypted callback, restart and resume", async () => {
    const f = fixture();
    try {
      const before = f.saved()!; const oldConnection = f.connection();
      const state = await f.start();
      expect(f.saved()).toEqual(before); expect(f.connection()).toEqual(oldConnection);
      const returned = await f.request(`/coros/callback?state=${state}&code=synthetic-code`);
      expect(returned.status).toBe(303); expect(returned.headers.get("location")).toBe(`${SYNC_TEST_ORIGIN}/?coros=connected`);
      expect(f.connection().state).toBe("paused");
      expect(f.connection().encrypted_refresh_token).not.toBe(oldConnection.encrypted_refresh_token);
      expect(await decryptRefreshToken(String(f.connection().encrypted_refresh_token), f.env.TOKEN_ENCRYPTION_KEY!)).toBe("synthetic-new-refresh");
      expect(f.saved()).toEqual({ ...before, lease_token: null, lease_until: null });
      const restarted = syncTestDatabase(f.sqlite.serialize());
      try { expect(restarted.saved()?.progress_json).toBe(before.progress_json); } finally { restarted.sqlite.close(); }
      const statusResponse = await f.request("/coros/status");
      expect(await statusResponse.json()).toMatchObject({ connected: true, state: "paused", sync: { progress: before.progress } });
      expect((await f.request("/coros/enable", { startDate: "2024-01-02" })).status).toBe(409);
      expect(f.saved()?.progress_json).toBe(before.progress_json);
      expect((await f.request("/coros/enable", { startDate: before.progress.startDate })).status).toBe(200);
      expect(f.connection().state).toBe("enabled");
      expect(f.saved()?.progress_json).toBe(before.progress_json);
      expect(f.saved()?.request_seq).toBe(before.request_seq + 1);
      // These routes never fetch Git or read/write workspace records.
      expect(f.fetcher.mock.calls.every(([url]) => String(url).startsWith(origin + "/"))).toBe(true);
    } finally { f.sqlite.close(); }
  });

  it("clears only rejected credential gates on successful callback, preserving retry/coverage/cache for other failures", async () => {
    const f = fixture();
    try {
      const p = f.saved()!.progress;
      p.lastErrorStage = "credentials_refresh";
      for (const d of [p.health!, p.health!.bulk!.dailyHealth]) Object.assign(d, {
        lastErrorCode: p.lastErrorCode, lastErrorStage: "credentials_refresh", retryAfter: "2099-01-01T00:00:00.000Z",
      });
      Object.assign(p.domains.workout, { lastErrorCode: "COROS_OAUTH_REFRESH_HTTP_429", lastErrorStage: "credentials_refresh" });
      f.saveProgress(p);
      const expected = structuredClone(p); expected.lastErrorCode = null; expected.lastErrorStage = null;
      for (const d of [expected.health!, expected.health!.bulk!.dailyHealth]) {
        d.lastErrorCode = null; d.lastErrorStage = null; d.retryAfter = null;
      }
      const state = await f.start();
      expect((await f.request(`/coros/callback?state=${state}&code=synthetic-code`)).status).toBe(303);
      expect(f.connection().state).toBe("paused");
      expect(f.saved()!.progress).toEqual(expected);
      const restarted = syncTestDatabase(f.sqlite.serialize());
      try { expect(restarted.saved()!.progress).toEqual(expected); } finally { restarted.sqlite.close(); }
    } finally { f.sqlite.close(); }
  });

  it("does not overwrite a concurrent progress change during callback recovery", async () => {
    const f = fixture();
    try {
      const p = f.saved()!.progress; p.lastErrorStage = "credentials_refresh"; f.saveProgress(p);
      const raced = structuredClone(p); raced.domains.workout.latestRecordDate = "2024-01-31";
      const original = f.db.prepare.bind(f.db);
      f.db.prepare = query => {
        if (query.includes("UPDATE coros_sync_jobs SET progress_json = ?1")) f.saveProgress(raced);
        return original(query);
      };
      const state = await f.start();
      expect((await f.request(`/coros/callback?state=${state}&code=synthetic-code`)).status).toBe(303);
      expect(f.saved()!.progress).toEqual(raced); expect(f.connection().state).toBe("paused");
    } finally { f.sqlite.close(); }
  });

  it("keeps the previous credentials, data cursors and retry gates when authorization is cancelled", async () => {
    const f = fixture();
    try {
      const before = f.saved(); const connection = f.connection(); const state = await f.start();
      expect((await f.request(`/coros/callback?state=${state}&error=access_denied`)).status).toBe(400);
      expect(f.saved()).toEqual(before); expect(f.connection()).toEqual(connection);
      expect(f.fetcher).toHaveBeenCalledTimes(3);
    } finally { f.sqlite.close(); }
  });

  it("keeps the previous connection and progress on code exchange failure", async () => {
    const f = fixture();
    try {
      const before = f.saved(); const connection = f.connection(); const state = await f.start();
      const previous = f.fetcher.getMockImplementation()!;
      f.fetcher.mockImplementation((input, init) => String(input).endsWith("/oauth2/token")
        ? Promise.resolve(Response.json({ error: "invalid_grant" }, { status: 400 })) : previous(input, init));
      await expect(f.request(`/coros/callback?state=${state}&code=synthetic-code`)).rejects.toThrow("COROS_OAUTH_EXCHANGE_HTTP_400_INVALID_GRANT");
      expect(f.saved()).toEqual(before); expect(f.connection()).toEqual(connection);
    } finally { f.sqlite.close(); }
  });

  it("retains the start route's same-origin CSRF enforcement", async () => {
    const f = fixture();
    try {
      const before = f.saved(); const connection = f.connection();
      const response = await handleCorosConnectionRequest(new Request(`${SYNC_TEST_ORIGIN}/coros/start`, {
        method: "POST", headers: { ...headers, "x-pw-csrf": "different" },
      }), f.env);
      expect(response.status).toBe(403); expect(f.fetcher).not.toHaveBeenCalled();
      expect(f.saved()).toEqual(before); expect(f.connection()).toEqual(connection);
    } finally { f.sqlite.close(); }
  });
});
