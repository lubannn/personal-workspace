import { describe, expect, it, vi } from "vitest";
import { handleCorosConnectionRequest, type CorosConnectionEnv } from "./coros-connection";
import type { D1DatabaseLike } from "./auth";
import { randomToken } from "./security";

const baseUrl = "https://nexus.lubannn.workers.dev";

function configuredEnv(): CorosConnectionEnv {
  return {
    DB: { prepare() { throw new Error("Anonymous request must not query D1"); } },
    GITHUB_CLIENT_ID: "test-client",
    GITHUB_CLIENT_SECRET: "test-secret",
    TOKEN_ENCRYPTION_KEY: randomToken(32),
    SESSION_HMAC_KEY: randomToken(32),
    ALLOWED_GITHUB_LOGIN: "lubannn",
    ALLOWED_REPO_OWNER: "lubannn",
    ALLOWED_REPO_NAME: "personal-workspace-data",
    COROS_MCP_RESOURCE_URL: "https://mcpcn.coros.com/mcp",
    COROS_CALLBACK_ORIGIN: baseUrl,
  };
}

describe("COROS connection routes", () => {
  it("fails closed without configured bindings", async () => {
    const response = await handleCorosConnectionRequest(new Request(`${baseUrl}/coros/status`), {});
    expect(response.status).toBe(503);
  });

  it("never registers an OAuth client for an anonymous caller", async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    try {
      const response = await handleCorosConnectionRequest(new Request(`${baseUrl}/coros/start`, { method: "POST" }), configuredEnv());
      expect(response.status).toBe(401);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects a callback on an unexpected host", async () => {
    const response = await handleCorosConnectionRequest(
      new Request("https://attacker.example/coros/callback?code=stolen&state=forged"),
      configuredEnv(),
    );
    expect(response.status).toBe(503);
  });

  it("stores only an encrypted paused connection after a one-time OAuth callback", async () => {
    const resource = "https://mcpcn.coros.com/mcp";
    const corosOrigin = "https://mcpcn.coros.com";
    const callback = `${baseUrl}/coros/callback`;
    const session = {
      session_id_hash: "hash", github_user_id: "12345", github_login: "lubannn",
      encrypted_refresh_token: "github-ciphertext", access_token_expires_at: null,
      created_at: "2026-09-26T00:00:00.000Z", last_used_at: "2026-09-26T00:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z", revoked_at: null,
    };
    const dbState: { attempt: Record<string, unknown> | null; connection: Record<string, unknown> | null } = {
      attempt: null, connection: null,
    };
    const database: D1DatabaseLike = {
      prepare(query) {
        let values: unknown[] = [];
        return {
          bind(...next) { values = next; return this; },
          async first<T>() {
            if (query.includes("FROM auth_sessions")) return session as T;
            if (query.includes("FROM coros_oauth_attempts")) return dbState.attempt as T | null;
            if (query.includes("FROM coros_connections")) return dbState.connection as T | null;
            throw new Error(`Unexpected SELECT: ${query}`);
          },
          async run() {
            if (query.startsWith("INSERT INTO coros_oauth_attempts")) {
              dbState.attempt = { state_hash: values[0], github_user_id: values[1], client_id: values[2],
                encrypted_verifier: values[3], redirect_uri: values[4], resource_url: values[5],
                expires_at: values[7] };
              return { success: true, meta: { changes: 1 } };
            }
            if (query.startsWith("DELETE FROM coros_oauth_attempts WHERE state_hash")) {
              const changes = dbState.attempt?.state_hash === values[0] ? 1 : 0;
              dbState.attempt = null;
              return { success: true, meta: { changes } };
            }
            if (query.startsWith("DELETE FROM coros_oauth_attempts")) return { success: true, meta: { changes: 0 } };
            if (query.startsWith("INSERT INTO coros_connections")) {
              dbState.connection = { github_user_id: values[0], client_id: values[1], redirect_uri: values[2],
                resource_url: values[3], encrypted_refresh_token: values[4], scope: values[5],
                state: "paused", connected_at: values[6], last_sync_at: null, last_error_code: null };
              return { success: true, meta: { changes: 1 } };
            }
            if (query.startsWith("DELETE FROM coros_connections")) {
              dbState.connection = null;
              return { success: true, meta: { changes: 1 } };
            }
            throw new Error(`Unexpected mutation: ${query}`);
          },
        };
      },
    };
    const env = { ...configuredEnv(), DB: database };
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/.well-known/oauth-protected-resource/mcp")) {
        return Response.json({ resource, authorization_servers: [corosOrigin],
          scopes_supported: ["openid", "mcp.tools", "offline_access"] });
      }
      if (url.endsWith("/.well-known/oauth-authorization-server")) {
        return Response.json({ issuer: corosOrigin, authorization_endpoint: `${corosOrigin}/oauth2/authorize`,
          token_endpoint: `${corosOrigin}/oauth2/token`, registration_endpoint: `${corosOrigin}/connect/register`,
          code_challenge_methods_supported: ["S256"], grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"] });
      }
      if (url.endsWith("/connect/register")) {
        return Response.json({ client_id: "coros-test-client", redirect_uris: [callback], token_endpoint_auth_method: "none" }, { status: 201 });
      }
      if (url.endsWith("/oauth2/token")) {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("grant_type")).toBe("authorization_code");
        return Response.json({ access_token: "temporary-access", refresh_token: "highly-sensitive-refresh",
          token_type: "Bearer", expires_in: 3600, scope: "openid mcp.tools offline_access" });
      }
      throw new Error(`Unexpected COROS request: ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      const headers = { cookie: "__Host-pw_session=test-session; __Host-pw_csrf=csrf", origin: baseUrl,
        "x-pw-csrf": "csrf" };
      const started = await handleCorosConnectionRequest(new Request(`${baseUrl}/coros/start`, { method: "POST", headers }), env);
      expect(started.status).toBe(200);
      const { authorizationUrl } = await started.json() as { authorizationUrl: string };
      const state = new URL(authorizationUrl).searchParams.get("state");
      expect(state).toBeTruthy();
      expect(dbState.attempt?.encrypted_verifier).not.toContain("test-session");

      const returned = await handleCorosConnectionRequest(new Request(`${callback}?code=temporary-code&state=${state}`, { headers }), env);
      expect(returned.status).toBe(303);
      expect(dbState.connection?.state).toBe("paused");
      expect(dbState.connection?.encrypted_refresh_token).not.toContain("highly-sensitive-refresh");
      const repeated = await handleCorosConnectionRequest(new Request(`${callback}?code=temporary-code&state=${state}`, { headers }), env);
      expect(repeated.status).toBe(400);
      expect(fetcher).toHaveBeenCalledTimes(6);

      const status = await handleCorosConnectionRequest(new Request(`${baseUrl}/coros/status`, { headers }), env);
      expect(await status.json()).toMatchObject({ connected: true, state: "paused", lastSyncAt: null });
      const forbiddenPreview = await handleCorosConnectionRequest(new Request(`${baseUrl}/coros/preview`, {
        method: "POST", headers: { cookie: headers.cookie, origin: "https://attacker.example", "x-pw-csrf": "csrf" },
      }), env);
      expect(forbiddenPreview.status).toBe(403);
      expect(fetcher).toHaveBeenCalledTimes(6);
      const disconnected = await handleCorosConnectionRequest(new Request(`${baseUrl}/coros/disconnect`, { method: "POST", headers }), env);
      expect(await disconnected.json()).toEqual({ disconnected: true, remoteAuthorizationRevoked: false });
      expect(dbState.connection).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
