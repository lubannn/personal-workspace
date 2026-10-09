import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAuthRequest, type AuthEnv, type D1DatabaseLike } from "./auth";
import { decryptRefreshToken, hmacSha256Base64Url, randomToken } from "./security";

const origin = "https://workspace.example";
const now = "2026-10-09T12:00:00.000Z";
let db: DatabaseSync;
let env: AuthEnv;
let currentHash: string;

function request(path = "/auth/sessions", rawCookie: string | null = "current", method = "GET") {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      ...(rawCookie ? { cookie: `__Host-pw_session=${rawCookie}; __Host-pw_csrf=synthetic-csrf` } : {}),
      origin, "x-pw-csrf": "synthetic-csrf",
    },
  });
}

const macChrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
const iphoneSafari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

function responseCookies(response: Response) {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

async function beginLogin() {
  const response = await handleAuthRequest(new Request(`${origin}/auth/login`, { headers: { "user-agent": macChrome } }), env);
  const state = new URL(response.headers.get("location")!).searchParams.get("state")!;
  return { cookie: responseCookies(response), state };
}

function mockGitHub(login = "user-a", privateRepo = true) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (url === "https://github.com/login/oauth/access_token") return Response.json({
      access_token: "synthetic-access-token", refresh_token: "synthetic-refresh-token",
      expires_in: 3600, refresh_token_expires_in: 86400 * 30,
    });
    if (url === "https://api.github.com/user") return Response.json({ id: 313, login });
    if (url === "https://api.github.com/repos/user-a/synthetic-data") return Response.json({ name: "synthetic-data", private: privateRepo, owner: { login: "user-a" } });
    throw new Error("Unexpected provider request");
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

async function finishLogin(ua: string | null, flow: { cookie: string; state: string }) {
  return handleAuthRequest(new Request(`${origin}/auth/callback?code=synthetic-code&state=${flow.state}`, {
    headers: { cookie: flow.cookie, ...(ua === null ? {} : { "user-agent": ua }),
      "x-forwarded-for": "192.0.2.1", "sec-ch-ua-model": "MUST-NOT-USE-HARDWARE", "x-device-name": "MUST-NOT-USE-NAME" },
  }), env);
}

async function seed(raw: string, user = "user-a", overrides: Record<string, string | null> = {}) {
  const hash = await hmacSha256Base64Url(raw, env.SESSION_HMAC_KEY!);
  const row = {
    session_id_hash: hash, github_user_id: user, github_login: user,
    encrypted_refresh_token: "synthetic-encrypted-secret", access_token_expires_at: null,
    created_at: "2026-10-01T00:00:00.000Z", last_used_at: "2026-10-08T00:00:00.000Z",
    expires_at: "2026-11-01T00:00:00.000Z", revoked_at: null, device_name: null,
    ...overrides,
  };
  db.prepare(`INSERT INTO auth_sessions (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  return hash;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  // Actual SQLite with the committed schema, only synthetic sessions in memory.
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_auth_sessions.sql", import.meta.url), "utf8"));
  const adapter: D1DatabaseLike = {
    prepare(query) {
      const statement = db.prepare(query);
      let params: Record<string, string | number | null> = {};
      return {
        bind(...values) {
          params = Object.fromEntries(values.map((value, i) => [String(i + 1), value])) as typeof params;
          return this;
        },
        async first<T>() { return (statement.get(params) ?? null) as T | null; },
        async run() { return { success: true, meta: { changes: Number(statement.run(params).changes) } }; },
      };
    },
  };
  env = {
    DB: adapter, GITHUB_CLIENT_ID: "synthetic-client", GITHUB_CLIENT_SECRET: "synthetic-secret",
    TOKEN_ENCRYPTION_KEY: randomToken(32), SESSION_HMAC_KEY: randomToken(32),
    ALLOWED_GITHUB_LOGIN: "user-a", ALLOWED_REPO_OWNER: "user-a", ALLOWED_REPO_NAME: "synthetic-data",
  };
  currentHash = await seed("current");
});

describe("new-session device name persistence through OAuth", () => {
  it.each([
    [macChrome, "Mac－Chrome"], [iphoneSafari, "iPhone－Safari"],
    [null, "未知系统－未知浏览器"], ["<script>private-device</script>", "未知系统－未知浏览器"],
  ])("names only the new callback session from its own browser: %s", async (ua, expectedName) => {
    const oldSession = db.prepare("SELECT * FROM auth_sessions WHERE session_id_hash = ?").get(currentHash);
    const legacyHash = await seed("legacy-for-login-user", "313");
    const legacySession = db.prepare("SELECT * FROM auth_sessions WHERE session_id_hash = ?").get(legacyHash);
    const flow = await beginLogin();
    const fetcher = mockGitHub();
    const response = await finishLogin(ua, flow);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${origin}/?auth=connected`);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    const cookie = responseCookies(response);
    const rawSession = /__Host-pw_session=([^;]+)/.exec(cookie)![1];
    const hash = await hmacSha256Base64Url(rawSession, env.SESSION_HMAC_KEY!);
    const row = db.prepare("SELECT * FROM auth_sessions WHERE session_id_hash = ?").get(hash)!;
    expect(row.device_name).toBe(expectedName);
    expect(row.github_user_id).toBe("313");
    expect(await decryptRefreshToken(row.encrypted_refresh_token as string, env.TOKEN_ENCRYPTION_KEY!)).toBe("synthetic-refresh-token");
    expect(db.prepare("SELECT * FROM auth_sessions WHERE session_id_hash = ?").get(currentHash)).toEqual(oldSession);
    expect(db.prepare("SELECT * FROM auth_sessions WHERE session_id_hash = ?").get(legacyHash)).toEqual(legacySession);
    expect(JSON.stringify(row)).not.toMatch(/Mozilla|AppleWebKit|MUST-NOT-USE|192\.0\.2\.1|private-device/);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const exchange = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(exchange.code_verifier).toBe(/__Host-pw_pkce_verifier=([^;]+)/.exec(flow.cookie)![1]);
    expect(exchange.redirect_uri).toBe(`${origin}/auth/callback`);
    expect(Object.keys(exchange).sort()).toEqual(["client_id", "client_secret", "code", "code_verifier", "redirect_uri"]);

    const list = await handleAuthRequest(new Request(`${origin}/auth/sessions?userId=user-a`, { headers: { cookie } }), env);
    expect(await list.json()).toEqual({ sessions: [
      { deviceName: expectedName, createdAt: now, lastUsedAt: now, current: true },
      { deviceName: null, createdAt: "2026-10-01T00:00:00.000Z", lastUsedAt: "2026-10-08T00:00:00.000Z", current: false },
    ] });
    expect((await handleAuthRequest(new Request(`${origin}/auth/sessions`), env)).status).toBe(401);

    // Refreshing later from a different UA preserves the original login label.
    const csrf = /__Host-pw_csrf=([^;]+)/.exec(cookie)![1];
    const refreshed = await handleAuthRequest(new Request(`${origin}/auth/token`, {
      method: "POST", headers: { cookie, origin, "x-pw-csrf": csrf, "user-agent": "different-browser" },
    }), env);
    expect(refreshed.status).toBe(200);
    expect(db.prepare("SELECT device_name FROM auth_sessions WHERE session_id_hash = ?").get(hash)?.device_name).toBe(expectedName);
  });

  it("rejects a callback in another cookie jar instead of borrowing the initiator's label", async () => {
    const flow = await beginLogin();
    const fetcher = mockGitHub();
    const response = await finishLogin(iphoneSafari, { ...flow, cookie: "" });
    expect(response.headers.get("location")).toBe(`${origin}/?auth=denied`);
    expect(db.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get()?.count).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves state validation before naming or creating a session", async () => {
    const flow = await beginLogin();
    const fetcher = mockGitHub();
    const response = await finishLogin(macChrome, { ...flow, state: "wrong" });
    expect(response.headers.get("location")).toBe(`${origin}/?auth=failed`);
    expect(db.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get()?.count).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([["other-login", true, "GitHubUserNotAllowed"], ["user-a", false, "GitHubRepositoryNotAllowed"]])("preserves user/repository allowlist denial: %s", async (login, privateRepo, error) => {
    const flow = await beginLogin();
    mockGitHub(login as string, privateRepo as boolean);
    await expect(finishLogin(macChrome, flow)).rejects.toThrow(error as string);
    expect(db.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get()?.count).toBe(1);
  });

  it("bounds untrusted existing names in list responses without updating stored rows", async () => {
    const name = "<img src=x onerror=alert(1)>" + "x".repeat(100);
    await seed("long-name", "user-a", { device_name: name });
    const response = await handleAuthRequest(request(), env);
    const body = await response.json() as { sessions: Array<{ deviceName: string | null }> };
    expect(body.sessions[1].deviceName).toBe(name.slice(0, 64));
    expect(db.prepare("SELECT device_name FROM auth_sessions WHERE device_name = ?").get(name)?.device_name).toBe(name);
  });
});

afterEach(() => { db.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("read-only authenticated session list", () => {
  it.each([null, "unknown", "expired", "revoked"])("rejects unauthenticated cookie %s", async (cookie) => {
    await seed("expired", "user-a", { expires_at: now });
    await seed("revoked", "user-a", { revoked_at: now });
    const response = await handleAuthRequest(request("/auth/sessions?userId=user-a", cookie), env);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "AUTHENTICATION_REQUIRED" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("uses server identity, filters expiry/revocation and exposes exactly four fields", async () => {
    await seed("old-unnamed");
    await seed("browser-one", "user-a", { device_name: "Synthetic laptop", last_used_at: "2026-10-09T10:00:00.000Z" });
    await seed("browser-two", "user-a", { device_name: "Synthetic laptop" });
    await seed("other-account", "user-b", { device_name: "MUST NOT RETURN" });
    await seed("expired", "user-a", { expires_at: now });
    await seed("revoked", "user-a", { revoked_at: now });
    const fetcher = vi.fn(() => { throw new Error("Must not refresh credentials or contact providers"); });
    vi.stubGlobal("fetch", fetcher);
    const before = db.prepare("SELECT * FROM auth_sessions ORDER BY session_id_hash").all();
    const response = await handleAuthRequest(request("/auth/sessions?github_user_id=user-b&userId=user-b"), env);
    const body = await response.json() as { sessions: Array<Record<string, unknown>> };
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(body.sessions).toHaveLength(4);
    expect(body.sessions[0]).toEqual({ deviceName: null, createdAt: "2026-10-01T00:00:00.000Z", lastUsedAt: "2026-10-08T00:00:00.000Z", current: true });
    expect(body.sessions.filter((s) => s.current)).toHaveLength(1);
    expect(body.sessions.filter((s) => s.deviceName === "Synthetic laptop")).toHaveLength(2);
    expect(body.sessions.filter((s) => s.deviceName === null)).toHaveLength(2);
    for (const session of body.sessions) expect(Object.keys(session).sort()).toEqual(["createdAt", "current", "deviceName", "lastUsedAt"]);
    expect(JSON.stringify(body)).not.toContain(currentHash);
    expect(JSON.stringify(body)).not.toMatch(/token|cookie|hash|user-b|MUST NOT RETURN/i);
    expect(db.prepare("SELECT * FROM auth_sessions ORDER BY session_id_hash").all()).toEqual(before);
    expect(fetcher).not.toHaveBeenCalled();
    const other = await handleAuthRequest(request("/auth/sessions?userId=user-a", "other-account"), env);
    expect(await other.json()).toMatchObject({ sessions: [{ deviceName: "MUST NOT RETURN", current: true }] });
  });

  it("rejects unsupported methods and missing configuration", async () => {
    expect((await handleAuthRequest(request("/auth/sessions", "current", "POST"), env)).status).toBe(405);
    expect((await handleAuthRequest(request(), {})).status).toBe(503);
  });

  it.each(["/auth/logout", "/auth/logout-all"])("preserves %s boundaries and invalidates listing", async (path) => {
    await seed("second");
    await seed("other", "user-b");
    const response = await handleAuthRequest(request(path, "current", "POST"), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await handleAuthRequest(request(), env)).status).toBe(401);
    const second = await handleAuthRequest(request("/auth/sessions", "second"), env);
    expect(second.status).toBe(path === "/auth/logout-all" ? 401 : 200);
    expect((await handleAuthRequest(request("/auth/sessions", "other"), env)).status).toBe(200);
  });

  it.each(["/auth/logout", "/auth/logout-all"])("continues to require CSRF for %s", async (path) => {
    const response = await handleAuthRequest(new Request(`${origin}${path}`, { method: "POST", headers: { cookie: "__Host-pw_session=current" } }), env);
    expect(response.status).toBe(403);
    expect((await handleAuthRequest(request(), env)).status).toBe(200);
  });
});
