import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticatedGitHubUser } from "./auth";
import { handleRequest } from "./index";
import { nextHealthSyncWindow } from "./coros-health-sync";
import { corosSyncDependenciesWithFetch, runCorosSync } from "./coros-sync";
import { COROS_SYNC_SOURCES, initialSyncProgress } from "./coros-sync-state";
import { encryptRefreshToken } from "./security";
import { SYNC_TEST_NOW, SYNC_TEST_ORIGIN, syncTestDatabase } from "./coros-sync-test-helpers";
import type { CorosOAuthPhase } from "./coros-oauth-errors";

vi.mock("./auth", async importOriginal => ({ ...await importOriginal<typeof import("./auth")>(), authenticatedGitHubUser: vi.fn() }));
const origin = "https://mcpcn.coros.com", resource = `${origin}/mcp`;
const privateValue = "synthetic-private-canary";
const key = Buffer.alloc(32, 7).toString("base64url");
function responses(phase: CorosOAuthPhase, status: number, error?: string) {
  return vi.fn<typeof fetch>(async input => {
    const url = String(input);
    const current = url.includes("protected-resource") ? "RESOURCE_METADATA" : url.includes("authorization-server") ? "AUTH_METADATA" : "REFRESH";
    if (current === phase) return Response.json({ error: error ?? privateValue, error_description: privateValue, refresh_token: privateValue,
      access_token: privateValue }, { status, headers: { location: `https://example.com/${privateValue}` } });
    if (current === "RESOURCE_METADATA") return Response.json({ resource, authorization_servers: [origin], scopes_supported: ["mcp.tools", "offline_access"] });
    return Response.json({ issuer: origin, authorization_endpoint: `${origin}/oauth2/authorize`, token_endpoint: `${origin}/oauth2/token`,
      registration_endpoint: `${origin}/connect/register`, code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"] });
  });
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SYNC_TEST_NOW);
  vi.mocked(authenticatedGitHubUser).mockResolvedValue({ id: "42", login: "example-owner" }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("OAuth classification through real refresh, persistence and HTTP responses", () => {
  it.each(COROS_SYNC_SOURCES)("preserves %s coverage and its existing backoff while persisting exact safe OAuth codes", async source => {
    for (const [phase, status, error] of [["RESOURCE_METADATA", 307], ["AUTH_METADATA", 401], ["REFRESH", 400, "invalid_grant"]] as const) {
      let f = syncTestDatabase(); f.connection(); f.env.TOKEN_ENCRYPTION_KEY = key;
      try {
        const p = initialSyncProgress("2024-01-01", "Asia/Shanghai"); p.request = { sequence: 1, through: "2024-02-01" };
        nextHealthSyncWindow(p, new Date());
        for (const d of [...Object.values(p.domains), p.health!, ...Object.values(p.health!.bulk!)]) { d.recentRequestSequence = 1; d.backfillNext = "2024-02-01"; }
        const target = source === "sleep" || source === "workout" ? p.domains[source] : source === "hrvActivity" ? p.health! : p.health!.bulk![source];
        target.backfillNext = "2024-01-01"; f.job(p);
        const encrypted = await encryptRefreshToken(privateValue, key);
        f.sqlite.prepare("UPDATE coros_connections SET encrypted_refresh_token = ?").run(encrypted);
        const fetcher = responses(phase, status, error);
        const expected = `COROS_OAUTH_${phase}_HTTP_${status}${error ? "_INVALID_GRANT" : ""}`;
        const result = await runCorosSync(f.env, new Date(), corosSyncDependenciesWithFetch(fetcher), { budgetExhausted: () => true });
        expect(result).toMatchObject({ status: "error", errorCode: expected, retryAt: "2024-02-01T04:20:00.000Z",
          progress: { lastErrorCode: expected, lastErrorStage: "credentials_refresh", failureCount: 1 } });
        expect(f.saved()?.lease_token).toBeNull(); expect(JSON.stringify(result)).not.toContain(privateValue);
        expect(f.sqlite.prepare("SELECT last_error_code, encrypted_refresh_token FROM coros_connections").get()).toEqual({ last_error_code: expected, encrypted_refresh_token: encrypted });
        expect(fetcher).toHaveBeenCalledTimes(phase === "RESOURCE_METADATA" ? 1 : phase === "AUTH_METADATA" ? 2 : 3);
        const snapshot = f.sqlite.serialize(); f.sqlite.close(); f = syncTestDatabase(snapshot); f.env.TOKEN_ENCRYPTION_KEY = key;
        const saved = f.saved()!.progress;
        const restored = source === "sleep" || source === "workout" ? saved.domains[source] : source === "hrvActivity" ? saved.health! : saved.health!.bulk![source];
        expect(restored).toMatchObject({ backfillNext: "2024-01-01", backfillThrough: null, lastErrorCode: expected,
          lastErrorStage: "credentials_refresh", retryAfter: "2024-02-01T04:20:00.000Z" });
        expect(saved.request).toEqual(p.request);
      } finally { f.sqlite.close(); }
    }
  });

  it.each(["RESOURCE_METADATA", "AUTH_METADATA", "REFRESH"] as const)("returns the same %s classification on a normal authenticated preview without logging payloads", async phase => {
    const f = syncTestDatabase(); f.connection("paused"); f.env.TOKEN_ENCRYPTION_KEY = key;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      f.sqlite.prepare("UPDATE coros_connections SET encrypted_refresh_token = ?").run(await encryptRefreshToken(privateValue, key));
      const fetcher = responses(phase, 400, "invalid_grant"); vi.stubGlobal("fetch", fetcher);
      const r = await handleRequest(new Request(`${SYNC_TEST_ORIGIN}/coros/preview`, { method: "POST", headers: {
        origin: SYNC_TEST_ORIGIN, cookie: "__Host-pw_csrf=synthetic-csrf", "x-pw-csrf": "synthetic-csrf" } }), f.env);
      expect(r.status).toBe(502); expect(r.headers.get("cache-control")).toBe("no-store");
      expect(await r.json()).toEqual({ error: `COROS_OAUTH_${phase}_HTTP_400${phase === "REFRESH" ? "_INVALID_GRANT" : ""}` });
      expect(log).not.toHaveBeenCalled(); expect(f.saved()).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(phase === "RESOURCE_METADATA" ? 1 : phase === "AUTH_METADATA" ? 2 : 3);
    } finally { f.sqlite.close(); }
  });
});
