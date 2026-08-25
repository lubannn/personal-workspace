import { describe, expect, it, vi } from "vitest";

import { handleRequest, type Env } from "./index";

function createEnv(): Env {
  return {
    ASSETS: {
      fetch: vi.fn(async () => new Response("static shell", { status: 200 })),
    },
  };
}

describe("auth edge worker", () => {
  it("reports a no-secret healthy state", async () => {
    const response = await handleRequest(new Request("https://workspace.example/health"), createEnv());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      service: "personal-workspace-auth-edge",
      phase: "no-secret-feasibility",
      authConfigured: false,
    });
  });

  it("does not pretend authentication is configured", async () => {
    const response = await handleRequest(
      new Request("https://workspace.example/auth/login", { method: "POST" }),
      createEnv(),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "AUTH_NOT_CONFIGURED" });
  });

  it("passes app requests to the static asset binding", async () => {
    const env = createEnv();
    const request = new Request("https://workspace.example/");
    const response = await handleRequest(request, env);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("static shell");
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(request);
  });

  it("returns a private error response if an asset request fails", async () => {
    const env: Env = {
      ASSETS: {
        fetch: vi.fn(async () => {
          throw new Error("origin detail must stay private");
        }),
      },
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await handleRequest(new Request("https://workspace.example/missing"), env);

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The workspace edge service could not complete this request.",
    });
    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError.mock.calls[0]?.[0]).not.toContain("origin detail must stay private");
    consoleError.mockRestore();
  });
});
