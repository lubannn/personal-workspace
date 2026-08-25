import { afterEach, describe, expect, it, vi } from "vitest";

import { handleRequest } from "./index";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("auth edge worker", () => {
  it("reports a no-secret healthy state", async () => {
    const response = await handleRequest(new Request("https://workspace.example/health"));

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
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "AUTH_NOT_CONFIGURED" });
  });

  it("streams the complete app shell from the public fallback", async () => {
    const upstreamFetch = vi.fn(async () =>
      new Response("static shell", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await handleRequest(new Request("https://workspace.example/"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("static shell");
    const upstreamRequest = upstreamFetch.mock.calls[0]?.[0];
    expect(upstreamRequest).toBeInstanceOf(Request);
    expect((upstreamRequest as Request).url).toBe("https://personal-workspace-static.pages.dev/");
    expect((upstreamRequest as Request).headers.has("authorization")).toBe(false);
  });

  it("maps the legacy app base path to the Cloudflare static origin", async () => {
    const upstreamFetch = vi.fn(async () => new Response("asset"));
    vi.stubGlobal("fetch", upstreamFetch);

    await handleRequest(
      new Request("https://workspace.example/personal-workspace/_next/static/app.js?v=1"),
    );

    const upstreamRequest = upstreamFetch.mock.calls[0]?.[0] as Request;
    expect(upstreamRequest.url).toBe(
      "https://personal-workspace-static.pages.dev/_next/static/app.js?v=1",
    );
  });

  it("returns a private error response if the public fallback fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("origin detail must stay private");
      }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await handleRequest(new Request("https://workspace.example/missing"));

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The workspace edge service could not complete this request.",
    });
    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError.mock.calls[0]?.[0]).not.toContain("origin detail must stay private");
  });
});
