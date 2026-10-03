import { afterEach, describe, expect, it, vi } from "vitest";

import { handleRequest } from "./index";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("auth edge worker", () => {
  it("reports an auth foundation that is not yet configured", async () => {
    const response = await handleRequest(new Request("https://workspace.example/health"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      service: "personal-workspace-auth-edge",
      phase: "auth-foundation-ready",
      authConfigured: false,
    });
  });

  it("reports the explicit pre-secret authentication state", async () => {
    const response = await handleRequest(new Request("https://workspace.example/auth/status"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      configured: false,
      authenticated: false,
      phase: "awaiting-github-app-secrets",
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
    const upstreamFetch = vi.fn(async (request: Request) => {
      void request;
      return new Response("static shell", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await handleRequest(new Request("https://workspace.example/"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("static shell");
    const upstreamRequest = upstreamFetch.mock.calls[0]?.[0];
    expect(upstreamRequest).toBeInstanceOf(Request);
    expect((upstreamRequest as Request).url).toBe("https://personal-workspace-app.pages.dev/");
    expect((upstreamRequest as Request).headers.has("authorization")).toBe(false);
  });

  it("maps the legacy app base path to the Cloudflare static origin", async () => {
    const upstreamFetch = vi.fn(async (request: Request) => {
      void request;
      return new Response("asset");
    });
    vi.stubGlobal("fetch", upstreamFetch);

    await handleRequest(
      new Request("https://workspace.example/personal-workspace/_next/static/app.js?v=1"),
    );

    const upstreamRequest = upstreamFetch.mock.calls[0]?.[0] as Request;
    expect(upstreamRequest.url).toBe(
      "https://personal-workspace-app.pages.dev/_next/static/app.js?v=1",
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

describe("public app proxy origin guard", () => {
  const publicOrigin = "https://personal-workspace-app.pages.dev";
  const workerOrigin = "https://workspace.example";
  const redirectStatuses = [301, 302, 303, 307, 308] as const;

  it.each([
    "//example.invalid/payload",
    "///example.invalid/payload",
    "/personal-workspace//example.invalid/payload",
    "/\\example.invalid/payload",
    "/personal-workspace/\\example.invalid/payload",
  ])("rejects an ambiguous public path before any upstream request: %s", async (path) => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await handleRequest(new Request(workerOrigin + path));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("location")).toBe(false);
    expect(await response.text()).not.toContain("example.invalid");
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["/", "/"],
    ["/personal-workspace", "/"],
    ["/personal-workspace/", "/"],
    ["/_next/static/app.js?v=1", "/_next/static/app.js?v=1"],
    ["/%2f%2fexample.invalid/payload", "/%2f%2fexample.invalid/payload"],
    ["/personal-workspace/%2F%2Fexample.invalid/payload", "/%2F%2Fexample.invalid/payload"],
    ["/%5cexample.invalid/payload", "/%5cexample.invalid/payload"],
  ])("keeps normal and encoded paths on the fixed upstream origin: %s", async (path, expectedPath) => {
    const upstreamFetch = vi.fn<(request: Request) => Promise<Response>>(async () => new Response("public asset"));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await handleRequest(new Request(workerOrigin + path));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("public asset");
    expect(upstreamFetch).toHaveBeenCalledOnce();
    const request = upstreamFetch.mock.calls[0][0];
    expect(request.url).toBe(publicOrigin + expectedPath);
    expect(new URL(request.url).origin).toBe(publicOrigin);
    expect(request.redirect).toBe("manual");
  });

  it.each(redirectStatuses)("follows relative and absolute same-origin HTTP %s redirects manually", async (status) => {
    const locations = ["./next?step=1", `${publicOrigin}/final?step=2`];
    const upstreamFetch = vi.fn<(request: Request) => Promise<Response>>(async () => {
      const location = locations.shift();
      return location ? new Response(null, { status, headers: { location, "set-cookie": "upstream=discard" } })
        : new Response("final app", { headers: { "content-type": "text/html" } });
    });
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await handleRequest(new Request(`${workerOrigin}/start/index.html`));

    expect(await response.text()).toBe("final app");
    expect(response.status).toBe(200);
    expect(response.headers.has("location")).toBe(false);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(upstreamFetch.mock.calls.map(([request]) => request.url)).toEqual([
      `${publicOrigin}/start/index.html`, `${publicOrigin}/start/next?step=1`, `${publicOrigin}/final?step=2`,
    ]);
    for (const [request] of upstreamFetch.mock.calls) {
      expect(request.redirect).toBe("manual");
      expect(request.method).toBe("GET");
    }
  });

  it.each([
    "https://example.invalid/redirect-secret",
    "//example.invalid/redirect-secret",
    "/\\example.invalid/redirect-secret",
    "http://personal-workspace-app.pages.dev/redirect-secret",
    "https://personal-workspace-app.pages.dev.example.invalid/redirect-secret",
    "https://personal-workspace-app.pages.dev:444/redirect-secret",
    "https://user:redirect-secret@personal-workspace-app.pages.dev/",
    "https://redirect-secret@personal-workspace-app.pages.dev/",
    "https://personal-workspace-app.pages.dev//example.invalid/redirect-secret",
    "https://[invalid/redirect-secret",
    "javascript:redirect-secret",
    "data:text/html,redirect-secret",
    "",
    null,
  ])("rejects an unsafe or missing redirect without fetching or exposing its target: %s", async (location) => {
    const upstreamFetch = vi.fn<(request: Request) => Promise<Response>>(async () => new Response(null, {
      status: 302,
      headers: location === null ? {} : { location },
    }));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await handleRequest(new Request(`${workerOrigin}/`));

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("location")).toBe(false);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ error: "INVALID_UPSTREAM_REDIRECT" });
    expect(body).not.toMatch(/example\.invalid|redirect-secret|\[invalid/u);
    expect(upstreamFetch).toHaveBeenCalledOnce();
    expect(upstreamFetch.mock.calls[0][0].url).toBe(publicOrigin + "/");
  });

  it("revalidates every hop after an initially safe redirect", async () => {
    const locations = ["/safe-hop", "https://example.invalid/redirect-secret"];
    const upstreamFetch = vi.fn<(request: Request) => Promise<Response>>(async () => new Response(null, { status: 307, headers: { location: locations.shift()! } }));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await handleRequest(new Request(`${workerOrigin}/`));

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "INVALID_UPSTREAM_REDIRECT" });
    expect(response.headers.has("location")).toBe(false);
    expect(upstreamFetch.mock.calls.map(([request]) => request.url)).toEqual([`${publicOrigin}/`, `${publicOrigin}/safe-hop`]);
  });

  it.each([300, 305])("rejects unsupported HTTP %s even when Location stays on the public origin", async (status) => {
    const upstreamFetch = vi.fn<(request: Request) => Promise<Response>>(async () => new Response(null, {
      status, headers: { location: `${publicOrigin}/unsupported-redirect` },
    }));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await handleRequest(new Request(`${workerOrigin}/`));

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "INVALID_UPSTREAM_REDIRECT" });
    expect(response.headers.has("location")).toBe(false);
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it("allows five redirects and the sixth final response", async () => {
    let calls = 0;
    const upstreamFetch = vi.fn<(request: Request) => Promise<Response>>(async () => ++calls <= 5
      ? new Response(null, { status: 308, headers: { location: `/hop-${calls}` } }) : new Response("final sixth response"));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await handleRequest(new Request(`${workerOrigin}/`));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("final sixth response");
    expect(upstreamFetch).toHaveBeenCalledTimes(6);
  });

  it("stops a same-origin redirect loop after at most six upstream fetches", async () => {
    const upstreamFetch = vi.fn<(request: Request) => Promise<Response>>(async () => new Response(null, { status: 301, headers: { location: "/loop" } }));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await handleRequest(new Request(`${workerOrigin}/loop`));

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "INVALID_UPSTREAM_REDIRECT" });
    expect(response.headers.has("location")).toBe(false);
    expect(upstreamFetch).toHaveBeenCalledTimes(6);
    expect(upstreamFetch.mock.calls.every(([request]) => request.redirect === "manual")).toBe(true);
  });

  it("keeps HEAD across a 303 redirect and returns no body", async () => {
    let calls = 0;
    const upstreamFetch = vi.fn<(request: Request) => Promise<Response>>(async () => ++calls === 1
      ? new Response(null, { status: 303, headers: { location: "/final" } })
      : new Response("upstream body is discarded", { headers: { etag: '"head-version"', "content-type": "text/html" } }));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await handleRequest(new Request(`${workerOrigin}/`, { method: "HEAD" }));

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(await response.text()).toBe("");
    expect(response.headers.get("etag")).toBe('"head-version"');
    expect(upstreamFetch.mock.calls.map(([request]) => request.method)).toEqual(["HEAD", "HEAD"]);
    expect(upstreamFetch.mock.calls.every(([request]) => request.redirect === "manual")).toBe(true);
  });

  it("preserves only the public header allowlist across redirects and strips upstream cookies", async () => {
    const publicHeaders = {
      accept: "text/html", "accept-language": "zh-CN", "if-none-match": '"browser-version"',
      "if-modified-since": "Sun, 04 Oct 2026 00:00:00 GMT", range: "bytes=0-100",
    };
    let calls = 0;
    const upstreamFetch = vi.fn<(request: Request) => Promise<Response>>(async () => ++calls === 1
      ? new Response(null, { status: 302, headers: { location: "/final" } })
      : new Response("asset", { headers: { "cache-control": "public, max-age=60", etag: '"current-version"',
        "set-cookie": "upstream=discard; Secure", "content-type": "text/html" } }));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await handleRequest(new Request(`${workerOrigin}/`, { headers: {
      ...publicHeaders, cookie: "__Host-session=private", authorization: "Bearer private", "x-pw-csrf": "private",
      referer: "https://example.invalid/private", origin: "https://example.invalid", "x-private-header": "private",
    } }));

    expect(upstreamFetch).toHaveBeenCalledTimes(2);
    for (const [request] of upstreamFetch.mock.calls) expect(Object.fromEntries(request.headers)).toEqual(publicHeaders);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("etag")).toBe('"current-version"');
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("preserves a conditional 304 as the final response rather than following its Location", async () => {
    const upstreamFetch = vi.fn<(request: Request) => Promise<Response>>(async () => new Response(null, { status: 304,
      headers: { etag: '"cached-version"', "cache-control": "public, max-age=60", location: "/not-a-redirect", "set-cookie": "discard=true" },
    }));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await handleRequest(new Request(`${workerOrigin}/`, { headers: { "if-none-match": '"cached-version"' } }));

    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
    expect(response.headers.get("etag")).toBe('"cached-version"');
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it("keeps health, auth, COROS and non-public methods outside the static proxy", async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstreamFetch);

    expect((await handleRequest(new Request(`${workerOrigin}/health`))).status).toBe(200);
    const head = await handleRequest(new Request(`${workerOrigin}/health`, { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    expect((await handleRequest(new Request(`${workerOrigin}/auth/status`))).status).toBe(200);
    expect((await handleRequest(new Request(`${workerOrigin}/coros/status`))).status).toBe(503);
    expect((await handleRequest(new Request(`${workerOrigin}/`, { method: "POST", body: "not-forwarded" }))).status).toBe(405);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
