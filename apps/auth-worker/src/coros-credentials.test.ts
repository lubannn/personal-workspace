import { describe, expect, it, vi } from "vitest";
import type { D1DatabaseLike, D1PreparedStatementLike } from "./auth";
import { refreshEnabledCorosConnection, refreshPausedCorosConnectionForPreview } from "./coros-credentials";
import { decryptRefreshToken, encryptRefreshToken } from "./security";

const resource = "https://mcpcn.coros.com/mcp";
const origin = "https://mcpcn.coros.com";
const key = Buffer.alloc(32, 7).toString("base64url");

function fakeDatabase(row: Record<string, unknown> | null, changes = 1) {
  const queries: Array<{ sql: string; bindings: unknown[] }> = [];
  const db: D1DatabaseLike = {
    prepare(sql) {
      const query = { sql, bindings: [] as unknown[] };
      queries.push(query);
      const statement: D1PreparedStatementLike = {
        bind(...values) { query.bindings = values; return statement; },
        async first<T>() { return row as T | null; },
        async run() {
          if (changes === 1 && row && sql.startsWith("UPDATE coros_connections SET encrypted_refresh_token")) {
            row.encrypted_refresh_token = query.bindings[0];
            row.scope = query.bindings[1];
            row.updated_at = query.bindings[2];
          }
          return { success: true, meta: { changes } };
        },
      };
      return statement;
    },
  };
  return { db, queries };
}

describe("COROS background credential rotation", () => {
  it("does not fetch data or rotate credentials while paused", async () => {
    const { db, queries } = fakeDatabase({ github_user_id: "1", state: "paused" });
    const fetcher = vi.fn<typeof fetch>();
    expect(await refreshEnabledCorosConnection(db, "1", key, fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(queries).toHaveLength(1);
  });

  it("rotates encrypted credentials before returning an access token", async () => {
    const encrypted = await encryptRefreshToken("old-refresh", key);
    const { db, queries } = fakeDatabase({ github_user_id: "1", client_id: "client-1",
      redirect_uri: "https://nexus.lubannn.workers.dev/coros/callback", resource_url: resource,
      encrypted_refresh_token: encrypted, scope: "openid mcp.tools offline_access", state: "enabled" });
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("protected-resource")) return Response.json({ resource, authorization_servers: [origin], scopes_supported: ["mcp.tools", "offline_access"] });
      if (url.includes("authorization-server")) return Response.json({ issuer: origin,
        authorization_endpoint: `${origin}/oauth2/authorize`, token_endpoint: `${origin}/oauth2/token`,
        registration_endpoint: `${origin}/connect/register`, code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"] });
      return Response.json({ access_token: "short-lived-access", refresh_token: "new-refresh",
        expires_in: 3600, token_type: "Bearer" });
    });
    expect(await refreshEnabledCorosConnection(db, "1", key, fetcher)).toEqual({
      resourceUrl: resource, accessToken: "short-lived-access", githubUserId: "1",
    });
    expect(await decryptRefreshToken(String(queries[1].bindings[0]), key)).toBe("new-refresh");
    expect(queries[1].bindings[4]).toBe(encrypted);
    expect(queries[1].bindings).toHaveLength(5);
    expect(queries[2].sql).toBe("SELECT state FROM coros_connections WHERE github_user_id = ?1");
    expect(queries[2].bindings).toEqual(["1"]);
  });

  it("permits explicit preview while paused without enabling background sync", async () => {
    const encrypted = await encryptRefreshToken("old-refresh", key);
    const { db, queries } = fakeDatabase({ github_user_id: "1", client_id: "client-1",
      redirect_uri: "https://nexus.lubannn.workers.dev/coros/callback", resource_url: resource,
      encrypted_refresh_token: encrypted, scope: "mcp.tools offline_access", state: "paused" });
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("protected-resource")) return Response.json({ resource, authorization_servers: [origin], scopes_supported: ["mcp.tools", "offline_access"] });
      if (url.includes("authorization-server")) return Response.json({ issuer: origin,
        authorization_endpoint: `${origin}/oauth2/authorize`, token_endpoint: `${origin}/oauth2/token`,
        registration_endpoint: `${origin}/connect/register`, code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"] });
      return Response.json({ access_token: "short-lived-access", refresh_token: "new-refresh",
        expires_in: 3600, token_type: "Bearer", scope: "mcp.tools offline_access" });
    });
    expect(await refreshPausedCorosConnectionForPreview(db, "1", key, fetcher)).toMatchObject({ accessToken: "short-lived-access" });
    expect(queries[1].bindings).toHaveLength(5);
    expect(queries[2].sql).toBe("SELECT state FROM coros_connections WHERE github_user_id = ?1");
  });

  it.each(["background", "preview"] as const)("retains the rotated refresh token but returns no access token when %s permission changes during refresh", async mode => {
    const encrypted = await encryptRefreshToken("old-refresh", key);
    const row: Record<string, unknown> = { github_user_id: "1", client_id: "client-1",
      redirect_uri: "https://nexus.lubannn.workers.dev/coros/callback", resource_url: resource,
      encrypted_refresh_token: encrypted, scope: "mcp.tools offline_access", state: mode === "background" ? "enabled" : "paused" };
    const { db, queries } = fakeDatabase(row);
    const fetcher = vi.fn<typeof fetch>(async input => {
      const url = String(input);
      if (url.includes("protected-resource")) return Response.json({ resource, authorization_servers: [origin], scopes_supported: ["mcp.tools", "offline_access"] });
      if (url.includes("authorization-server")) return Response.json({ issuer: origin,
        authorization_endpoint: `${origin}/oauth2/authorize`, token_endpoint: `${origin}/oauth2/token`,
        registration_endpoint: `${origin}/connect/register`, code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"] });
      // The remote server has consumed the old refresh token while the user changes permission.
      row.state = mode === "background" ? "paused" : "enabled";
      return Response.json({ access_token: "access-must-not-escape", refresh_token: "rotated-refresh",
        expires_in: 3600, token_type: "Bearer", scope: "mcp.tools offline_access" });
    });
    const refresh = mode === "background" ? refreshEnabledCorosConnection : refreshPausedCorosConnectionForPreview;
    expect(await refresh(db, "1", key, fetcher)).toBeNull();
    expect(row.state).toBe(mode === "background" ? "paused" : "enabled");
    expect(row.encrypted_refresh_token).not.toBe(encrypted);
    expect(String(row.encrypted_refresh_token)).not.toContain("rotated-refresh");
    expect(await decryptRefreshToken(String(row.encrypted_refresh_token), key)).toBe("rotated-refresh");
    expect(queries[1].bindings[4]).toBe(encrypted);
  });

  it("fails closed after losing a refresh-token race", async () => {
    const encrypted = await encryptRefreshToken("old-refresh", key);
    const row = { github_user_id: "1", client_id: "client-1",
      redirect_uri: "https://nexus.lubannn.workers.dev/coros/callback", resource_url: resource,
      encrypted_refresh_token: encrypted, scope: "mcp.tools offline_access", state: "enabled" };
    const { db, queries } = fakeDatabase(row, 0);
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("protected-resource")) return Response.json({ resource, authorization_servers: [origin], scopes_supported: ["mcp.tools", "offline_access"] });
      if (url.includes("authorization-server")) return Response.json({ issuer: origin,
        authorization_endpoint: `${origin}/oauth2/authorize`, token_endpoint: `${origin}/oauth2/token`,
        registration_endpoint: `${origin}/connect/register`, code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"] });
      return Response.json({ access_token: "short-lived-access", refresh_token: "new-refresh",
        expires_in: 3600, token_type: "Bearer", scope: "mcp.tools offline_access" });
    });
    await expect(refreshEnabledCorosConnection(db, "1", key, fetcher)).rejects.toThrow("COROS_TOKEN_ROTATION_CONFLICT");
    expect(row.encrypted_refresh_token).toBe(encrypted);
    expect(queries).toHaveLength(2);
  });
});
