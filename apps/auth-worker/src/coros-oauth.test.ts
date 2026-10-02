import { describe, expect, it, vi } from "vitest";
import {
  createCorosAuthorization,
  discoverCorosOAuth,
  exchangeCorosCode,
  refreshCorosToken,
  registerCorosOAuthClient,
} from "./coros-oauth";

const origin = "https://mcpcn.coros.com";
const resource = `${origin}/mcp`;
const callback = "https://nexus.lubannn.workers.dev/coros/callback";
const protectedMetadata = { resource, authorization_servers: [origin], scopes_supported: ["openid", "mcp.tools", "offline_access"] };
const authMetadata = {
  issuer: origin,
  authorization_endpoint: `${origin}/oauth2/authorize`,
  token_endpoint: `${origin}/oauth2/token`,
  registration_endpoint: `${origin}/connect/register`,
  code_challenge_methods_supported: ["S256"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  token_endpoint_auth_methods_supported: ["none"],
};

describe("COROS OAuth boundary", () => {
  it("discovers only same-origin metadata with PKCE and refresh support", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => Response.json(
      String(input).includes("protected-resource") ? protectedMetadata : authMetadata,
    ));
    const endpoints = await discoverCorosOAuth(resource, fetcher);
    expect(endpoints).toEqual({ resource, issuer: origin, authorize: authMetadata.authorization_endpoint,
      token: authMetadata.token_endpoint, register: authMetadata.registration_endpoint });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(discoverCorosOAuth("https://example.com/mcp", fetcher)).rejects.toThrow("COROS_RESOURCE_NOT_ALLOWED");
  });

  it("rejects cross-origin OAuth endpoints", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => Response.json(
      String(input).includes("protected-resource") ? protectedMetadata : { ...authMetadata, token_endpoint: "https://example.com/steal" },
    ));
    await expect(discoverCorosOAuth(resource, fetcher)).rejects.toThrow("COROS_OAUTH_ORIGIN_MISMATCH");
  });

  it("registers a public PKCE client and never accepts a client secret", async () => {
    const endpoints = { resource, issuer: origin, authorize: authMetadata.authorization_endpoint, token: authMetadata.token_endpoint, register: authMetadata.registration_endpoint };
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ redirect_uris: [callback], token_endpoint_auth_method: "none" });
      return Response.json({ client_id: "client-1", redirect_uris: [callback], token_endpoint_auth_method: "none" }, { status: 201 });
    });
    const client = await registerCorosOAuthClient(endpoints, callback, fetcher);
    const auth = await createCorosAuthorization(endpoints, client);
    const url = new URL(auth.url);
    expect(url.searchParams.get("resource")).toBe(resource);
    expect(url.searchParams.get("scope")).toBe("openid mcp.tools offline_access");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.state).not.toBe(auth.verifier);
  });

  it("exchanges and refreshes only valid bearer tokens", async () => {
    const endpoints = { resource, issuer: origin, authorize: authMetadata.authorization_endpoint, token: authMetadata.token_endpoint, register: authMetadata.registration_endpoint };
    const client = { clientId: "client-1", redirectUri: callback };
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("client_id")).toBe(client.clientId);
      expect(body.get("resource")).toBe(resource);
      return Response.json({ access_token: "access", refresh_token: "refresh-next", expires_in: 3600,
        token_type: "Bearer", scope: "openid mcp.tools offline_access" });
    });
    expect(await exchangeCorosCode(endpoints, client, "code", "verifier", fetcher)).toMatchObject({ refreshToken: "refresh-next" });
    expect(await refreshCorosToken(endpoints, client, "refresh-old", "openid mcp.tools offline_access", fetcher)).toMatchObject({ accessToken: "access" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
