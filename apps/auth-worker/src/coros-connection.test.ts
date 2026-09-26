import { describe, expect, it, vi } from "vitest";
import { handleCorosConnectionRequest, type CorosConnectionEnv } from "./coros-connection";
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
});
