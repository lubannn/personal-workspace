import { describe, expect, it } from "vitest";

import { handleAuthRequest, type AuthEnv, type D1DatabaseLike } from "./auth";
import { randomToken } from "./security";

const unusedDatabase: D1DatabaseLike = {
  prepare() {
    throw new Error("The database should not be used in this test.");
  },
};

function configuredEnv(): AuthEnv {
  return {
    DB: unusedDatabase,
    GITHUB_CLIENT_ID: "Iv1.test-client-id",
    GITHUB_CLIENT_SECRET: "test-client-secret",
    TOKEN_ENCRYPTION_KEY: randomToken(32),
    SESSION_HMAC_KEY: randomToken(32),
    ALLOWED_GITHUB_LOGIN: "lubannn",
    ALLOWED_REPO_OWNER: "lubannn",
    ALLOWED_REPO_NAME: "personal-workspace-data",
  };
}

describe("GitHub App auth routes", () => {
  it("fails closed before credentials are configured", async () => {
    const response = await handleAuthRequest(
      new Request("https://nexus.lubannn.workers.dev/auth/token", { method: "POST" }),
      {},
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "AUTH_NOT_CONFIGURED" });
  });

  it("starts a PKCE-protected GitHub web flow", async () => {
    const response = await handleAuthRequest(
      new Request("https://nexus.lubannn.workers.dev/auth/login"),
      configuredEnv(),
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://github.com");
    expect(location.pathname).toBe("/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("Iv1.test-client-id");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://nexus.lubannn.workers.dev/auth/callback",
    );
    expect(location.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(location.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(response.headers.get("set-cookie")).toContain("__Host-pw_oauth_state=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("does not read D1 while reporting an anonymous configured state", async () => {
    const response = await handleAuthRequest(
      new Request("https://nexus.lubannn.workers.dev/auth/status"),
      configuredEnv(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      configured: true,
      authenticated: false,
      login: null,
    });
  });

  it("rejects token issuance without same-origin CSRF proof", async () => {
    const response = await handleAuthRequest(
      new Request("https://nexus.lubannn.workers.dev/auth/token", {
        method: "POST",
        headers: {
          cookie: "__Host-pw_csrf=csrf-token",
          origin: "https://attacker.example",
          "x-pw-csrf": "csrf-token",
        },
      }),
      configuredEnv(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "CSRF_VALIDATION_FAILED" });
  });

  it("aborts a callback whose state does not match its cookie", async () => {
    const response = await handleAuthRequest(
      new Request(
        "https://nexus.lubannn.workers.dev/auth/callback?code=temporary-code&state=wrong",
        {
          headers: {
            cookie:
              "__Host-pw_oauth_state=expected; __Host-pw_pkce_verifier=verifier-verifier-verifier",
          },
        },
      ),
      configuredEnv(),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://nexus.lubannn.workers.dev/?auth=failed",
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
