import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverCorosOAuth, exchangeCorosCode, refreshCorosToken, registerCorosOAuthClient } from "./coros-oauth";
import { COROS_OAUTH_ERROR_VALUES, COROS_OAUTH_PHASES, parseCorosOAuthFailure, type CorosOAuthPhase } from "./coros-oauth-errors";

const origin = "https://mcpcn.coros.com", resource = `${origin}/mcp`;
const protectedMetadata = { resource, authorization_servers: [origin], scopes_supported: ["mcp.tools", "offline_access"] };
const endpoints = { resource, issuer: origin, authorize: `${origin}/oauth2/authorize`, token: `${origin}/oauth2/token`, register: `${origin}/connect/register` };
const client = { clientId: "synthetic-client", redirectUri: "https://workspace.example/coros/callback" };
const privateValue = "synthetic-private-canary";
function request(phase: CorosOAuthPhase, failure: () => Promise<Response>) {
  const fetcher = vi.fn<typeof fetch>(async input => {
    if (phase === "AUTH_METADATA" && String(input).includes("protected-resource")) return Response.json(protectedMetadata);
    return failure();
  });
  const promise = phase === "RESOURCE_METADATA" || phase === "AUTH_METADATA" ? discoverCorosOAuth(resource, fetcher)
    : phase === "REGISTRATION" ? registerCorosOAuthClient(endpoints, client.redirectUri, fetcher)
      : phase === "EXCHANGE" ? exchangeCorosCode(endpoints, client, privateValue, privateValue, fetcher)
        : refreshCorosToken(endpoints, client, privateValue, "mcp.tools", fetcher);
  return { promise, fetcher };
}
async function code(promise: Promise<unknown>) {
  try { await promise; throw new Error("expected rejection"); }
  catch (error) {
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).not.toContain(privateValue);
    expect(parseCorosOAuthFailure(message)).not.toBeNull();
    return message;
  }
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("safe OAuth classifications from existing requests", () => {
  it.each(COROS_OAUTH_PHASES)("distinguishes the %s request and trusted HTTP statuses without extra requests", async phase => {
    for (const status of [301, 307, 400, 401, 403, 404, 429, 500, 503, 599]) {
      const r = request(phase, async () => Response.json({ error: privateValue, error_description: privateValue,
        refresh_token: privateValue, access_token: privateValue }, { status, headers: { location: `https://example.com/${privateValue}` } }));
      expect(await code(r.promise)).toBe(`COROS_OAUTH_${phase}_HTTP_${status}`);
      expect(r.fetcher).toHaveBeenCalledTimes(phase === "AUTH_METADATA" ? 2 : 1);
    }
  });

  it.each(COROS_OAUTH_PHASES)("distinguishes a missing %s body from an empty/invalid JSON body", async phase => {
    for (const status of [200, 204, 401, 503]) {
      expect(await code(request(phase, async () => new Response(null, { status })).promise)).toBe(`COROS_OAUTH_${phase}_HTTP_${status}_BODY_MISSING`);
    }
    expect(await code(request(phase, async () => new Response("", { status: 200 })).promise)).toBe(`COROS_OAUTH_${phase}_HTTP_200_JSON_INVALID`);
    expect(await code(request(phase, async () => new Response(privateValue, { status: 200 })).promise)).toBe(`COROS_OAUTH_${phase}_HTTP_200_JSON_INVALID`);
  });

  it.each(["REFRESH", "EXCHANGE", "REGISTRATION"] as const)("only accepts exact OAuth whitelist values for %s", async phase => {
    for (const error of COROS_OAUTH_ERROR_VALUES) {
      expect(await code(request(phase, async () => Response.json({ error, error_description: privateValue, refresh_token: privateValue }, { status: 400 })).promise))
        .toBe(`COROS_OAUTH_${phase}_HTTP_400_${error.toUpperCase()}`);
    }
    for (const error of [null, 1, {}, ["invalid_grant"], "INVALID_GRANT", `invalid_grant${privateValue}`, `invalid_grant\n${privateValue}`]) {
      expect(await code(request(phase, async () => Response.json({ error }, { status: 400 })).promise)).toBe(`COROS_OAUTH_${phase}_HTTP_400`);
    }
    for (const body of ["not-json", "null", '[]', '"invalid_grant"']) {
      expect(await code(request(phase, async () => new Response(body, { status: 400 })).promise)).toBe(`COROS_OAUTH_${phase}_HTTP_400`);
    }
  });

  it.each(["RESOURCE_METADATA", "AUTH_METADATA"] as const)("discards %s failure bodies without treating their content as a grant error", async phase => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ error: "invalid_grant", error_description: privateValue }))); }, cancel });
    expect(await code(request(phase, async () => new Response(body, { status: 403 })).promise)).toBe(`COROS_OAUTH_${phase}_HTTP_403`);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each(COROS_OAUTH_PHASES)("distinguishes %s network, body-read and timeout failures without exception payloads", async phase => {
    expect(await code(request(phase, async () => { throw new TypeError(privateValue, { cause: { refresh_token: privateValue } }); }).promise))
      .toBe(`COROS_OAUTH_${phase}_TRANSPORT_FAILED`);
    const body = new ReadableStream({ start(controller) { controller.error(new Error(privateValue)); } });
    expect(await code(request(phase, async () => new Response(body)).promise)).toBe(`COROS_OAUTH_${phase}_HTTP_200_BODY_READ_FAILED`);
    vi.useFakeTimers();
    const r = request(phase, () => new Promise(() => {}));
    const result = code(r.promise);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toBe(`COROS_OAUTH_${phase}_TIMEOUT`);
    expect(r.fetcher).toHaveBeenCalledTimes(phase === "AUTH_METADATA" ? 2 : 1);
    vi.useRealTimers();
  });

  it.each(["REFRESH", "EXCHANGE", "REGISTRATION"] as const)("retains known %s HTTP failure when its body stalls, exceeds the bound or fails", async phase => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stalled = request(phase, async () => new Response(new ReadableStream({ cancel }), { status: 401 }));
    const result = code(stalled.promise);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toBe(`COROS_OAUTH_${phase}_HTTP_401`);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(await code(request(phase, async () => new Response("x".repeat(65_537), { status: 500 })).promise)).toBe(`COROS_OAUTH_${phase}_HTTP_500`);
    const failed = new ReadableStream({ start(controller) { controller.error(new Error(privateValue)); } });
    expect(await code(request(phase, async () => new Response(failed, { status: 429 })).promise)).toBe(`COROS_OAUTH_${phase}_HTTP_429`);
  });

  it.each(COROS_OAUTH_PHASES)("passes a denied %s budget through without disguising it as an auth failure", async phase => {
    const r = request(phase, async () => { throw new Error("COROS_SYNC_BUDGET_EXHAUSTED"); });
    await expect(r.promise).rejects.toThrow("COROS_SYNC_BUDGET_EXHAUSTED");
    expect(r.fetcher).toHaveBeenCalledTimes(phase === "AUTH_METADATA" ? 2 : 1);
  });

  it("rejects untrusted statuses and unsafe or impossible code suffixes", async () => {
    expect(await code(request("REFRESH", async () => Response.error()).promise)).toBe("COROS_OAUTH_REFRESH_RESPONSE_INVALID");
    for (const value of [null, {}, "COROS_OAUTH_REFRESH_HTTP_600", "COROS_OAUTH_REFRESH_HTTP_400_PRIVATE_CANARY",
      "COROS_OAUTH_RESOURCE_METADATA_HTTP_400_INVALID_GRANT", "COROS_OAUTH_REFRESH_HTTP_200_INVALID_GRANT",
      "COROS_OAUTH_REFRESH_HTTP_400_INVALID_GRANT\n", "COROS_OAUTH_REFRESH_HTTP_400?token=private"]) expect(parseCorosOAuthFailure(value)).toBeNull();
  });
});
