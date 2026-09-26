import { describe, expect, it, vi } from "vitest";

import { handleAuthRequest, type AuthEnv } from "../../apps/auth-worker/src/auth";
import { onRequest } from "../../functions/auth/[[path]]";

describe("Pages same-origin auth bridge", () => {
  it("forwards the original Pages request and preserves OAuth redirects and cookies", async () => {
    const request = new Request("https://personal-workspace-app.pages.dev/auth/login");
    const response = new Response(null, { status: 302, headers: { location: "https://github.com/login/oauth/authorize", "set-cookie": "__Host-pw_oauth_state=test; Path=/; Secure; HttpOnly" } });
    const fetch = vi.fn(async () => response);
    expect(await onRequest({ request, env: { AUTH: { fetch } } })).toBe(response);
    expect(fetch).toHaveBeenCalledWith(request);
    expect(response.headers.get("set-cookie")).toContain("__Host-pw_oauth_state");
  });

  it("fails closed for preview hosts and missing bindings", async () => {
    const fetch = vi.fn(async () => new Response("unexpected"));
    const preview = await onRequest({ request: new Request("https://preview.personal-workspace-app.pages.dev/auth/status"), env: { AUTH: { fetch } } });
    expect(preview.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
    const missing = await onRequest({ request: new Request("https://personal-workspace-app.pages.dev/auth/status"), env: {} });
    expect(missing.status).toBe(503);
    expect(missing.headers.get("cache-control")).toBe("no-store");
  });

  it("uses the Pages origin for the GitHub callback without copying Worker secrets", async () => {
    const env: AuthEnv = {
      DB: { prepare() { throw new Error("Login must not read D1"); } },
      GITHUB_CLIENT_ID: "Iv1.test-client-id",
      GITHUB_CLIENT_SECRET: "test-only",
      TOKEN_ENCRYPTION_KEY: "test-only",
      SESSION_HMAC_KEY: "test-only",
      ALLOWED_GITHUB_LOGIN: "lubannn",
      ALLOWED_REPO_OWNER: "lubannn",
      ALLOWED_REPO_NAME: "personal-workspace-data",
    };
    const response = await onRequest({
      request: new Request("https://personal-workspace-app.pages.dev/auth/login"),
      env: { AUTH: { fetch: (request) => handleAuthRequest(request, env) } },
    });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("redirect_uri")).toBe("https://personal-workspace-app.pages.dev/auth/callback");
    expect(response.headers.get("set-cookie")).toContain("__Host-pw_oauth_state=");
  });
});
