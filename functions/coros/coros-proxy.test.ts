import { describe, expect, it, vi } from "vitest";
import { onRequest } from "./[[path]]";

describe("COROS Pages service forwarding", () => {
  it("preserves the same-origin request and private response", async () => {
    const request = new Request("https://personal-workspace-app.pages.dev/coros/enable", {
      method: "POST", headers: { origin: "https://personal-workspace-app.pages.dev", "x-pw-csrf": "test-csrf" },
      body: JSON.stringify({ startDate: "2024-01-01" }),
    });
    const response = Response.json({ queued: true }, { headers: { "cache-control": "no-store" } });
    const fetch = vi.fn().mockResolvedValue(response);
    expect(await onRequest({ request, env: { AUTH: { fetch } } })).toBe(response);
    expect(fetch).toHaveBeenCalledWith(request);
  });
  it("never forwards preview origins or unrelated paths", async () => {
    const fetch = vi.fn();
    for (const url of ["https://preview.pages.dev/coros/status", "https://personal-workspace-app.pages.dev/auth/status"]) {
      expect((await onRequest({ request: new Request(url), env: { AUTH: { fetch } } })).status).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not cache configuration or upstream failures", async () => {
    const request = new Request("https://personal-workspace-app.pages.dev/coros/status");
    expect((await onRequest({ request, env: {} })).status).toBe(503);
    const response = await onRequest({ request, env: { AUTH: { fetch: async () => { throw new Error("private-body"); } } } });
    expect(response.status).toBe(502); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("private-body");
  });
});
