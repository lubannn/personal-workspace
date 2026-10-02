import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleCorosConnectionRequest, type CorosConnectionEnv } from "./coros-connection";
import { refreshPausedCorosConnectionForPreview } from "./coros-credentials";
import { callCorosReadTool } from "./coros-read-client";
import { randomToken } from "./security";

vi.mock("./coros-credentials", () => ({ refreshPausedCorosConnectionForPreview: vi.fn() }));
vi.mock("./coros-read-client", () => ({ callCorosReadTool: vi.fn() }));

const origin = "https://nexus.lubannn.workers.dev";
const session = { github_user_id: "12345", github_login: "lubannn", expires_at: "2099-01-01T00:00:00.000Z" };
const env: CorosConnectionEnv = {
  DB: { prepare() { return { bind() { return this; }, async first<T>() { return session as T; },
    async run() { throw new Error("Preview must not write D1 except token rotation"); } }; } },
  GITHUB_CLIENT_ID: "test-client", GITHUB_CLIENT_SECRET: "test-secret",
  TOKEN_ENCRYPTION_KEY: randomToken(32), SESSION_HMAC_KEY: randomToken(32),
  ALLOWED_GITHUB_LOGIN: "lubannn", ALLOWED_REPO_OWNER: "lubannn", ALLOWED_REPO_NAME: "personal-workspace-data",
  COROS_MCP_RESOURCE_URL: "https://mcpcn.coros.com/mcp", COROS_CALLBACK_ORIGIN: origin,
};
const headers = { cookie: "__Host-pw_session=test-session; __Host-pw_csrf=csrf", origin, "x-pw-csrf": "csrf" };

describe("paused COROS one-day preview", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("returns only schema hints, not a health value or access token", async () => {
    vi.mocked(refreshPausedCorosConnectionForPreview).mockResolvedValue({
      githubUserId: "12345", resourceUrl: "https://mcpcn.coros.com/mcp", accessToken: "secret-access-token",
    });
    vi.mocked(callCorosReadTool).mockResolvedValue({ format: "structured", payload: {
      date: "2026-09-25", steps: 12345, heartRate: { average: 61, unit: "bpm" },
    } });
    const response = await handleCorosConnectionRequest(new Request(`${origin}/coros/preview`, { method: "POST", headers }), env);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("heartRate.average");
    expect(body).not.toMatch(/2026-09-25|12345|\b61\b|secret-access-token/u);
    expect(callCorosReadTool).toHaveBeenCalledWith("https://mcpcn.coros.com/mcp", "secret-access-token", "queryDailyHealthData", { days: 1 });
  });

  it("never refreshes a credential without same-origin CSRF proof", async () => {
    const response = await handleCorosConnectionRequest(new Request(`${origin}/coros/preview`, {
      method: "POST", headers: { ...headers, origin: "https://attacker.example" },
    }), env);
    expect(response.status).toBe(403);
    expect(refreshPausedCorosConnectionForPreview).not.toHaveBeenCalled();
  });
});
