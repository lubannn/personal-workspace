import { describe, expect, it, vi } from "vitest";
import type { D1DatabaseLike, D1PreparedStatementLike } from "./auth";
import { refreshEnabledCorosConnection } from "./coros-credentials";
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
        async run() { return { success: true, meta: { changes } }; },
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
  });

  it("fails closed after losing a refresh-token race", async () => {
    const encrypted = await encryptRefreshToken("old-refresh", key);
    const { db } = fakeDatabase({ github_user_id: "1", client_id: "client-1",
      redirect_uri: "https://nexus.lubannn.workers.dev/coros/callback", resource_url: resource,
      encrypted_refresh_token: encrypted, scope: "mcp.tools offline_access", state: "enabled" }, 0);
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
  });
});
