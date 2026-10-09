import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAuthRequest, type AuthEnv, type D1DatabaseLike } from "./auth";
import { hmacSha256Base64Url, randomToken } from "./security";

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
