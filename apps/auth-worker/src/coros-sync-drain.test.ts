import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticatedGitHubUser } from "./auth";
import { handleCorosConnectionRequest } from "./coros-connection";
import { runCorosSync } from "./coros-sync";
import { SYNC_TEST_NOW, SYNC_TEST_ORIGIN, SYNC_TEST_USER, syncTestDatabase } from "./coros-sync-test-helpers";

vi.mock("./auth", async importOriginal => ({ ...await importOriginal<typeof import("./auth")>(), authenticatedGitHubUser: vi.fn() }));
vi.mock("./coros-sync", () => ({ runCorosSync: vi.fn() }));
function request(method = "POST", origin = SYNC_TEST_ORIGIN) {
  return new Request(`${SYNC_TEST_ORIGIN}/coros/drain`, { method, headers: {
    cookie: "__Host-pw_csrf=synthetic-csrf", origin, "x-pw-csrf": "synthetic-csrf",
  } });
}

describe("authenticated COROS drain route", () => {
  let fixture: ReturnType<typeof syncTestDatabase>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SYNC_TEST_NOW); fixture = syncTestDatabase();
    vi.mocked(authenticatedGitHubUser).mockResolvedValue({ id: SYNC_TEST_USER, login: "example-owner" });
    vi.mocked(runCorosSync).mockResolvedValue({ status: "processed", batch: { domain: "sleep", from: "2024-01-01", through: "2024-01-03", created: 0, unchanged: 0, conflicts: 0 } });
  });
  afterEach(() => { fixture.sqlite.close(); vi.useRealTimers(); vi.resetAllMocks(); });

  it("runs exactly one forced-due window for the authenticated configured owner", async () => {
    const response = await handleCorosConnectionRequest(request(), fixture.env);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ status: "processed", batch: { domain: "sleep" } });
    expect(runCorosSync).toHaveBeenCalledExactlyOnceWith(fixture.env, new Date(SYNC_TEST_NOW), undefined, { forceDue: true });
    expect(fixture.saved()).toBeNull();
  });

  it("rejects anonymous requests without invoking the worker", async () => {
    vi.mocked(authenticatedGitHubUser).mockResolvedValue(null);
    expect((await handleCorosConnectionRequest(request(), fixture.env)).status).toBe(401);
    expect(runCorosSync).not.toHaveBeenCalled();
  });

  it("requires POST, same-origin CSRF, and the fixed account", async () => {
    expect((await handleCorosConnectionRequest(request("GET"), fixture.env)).status).toBe(405);
    expect((await handleCorosConnectionRequest(request("POST", "https://other.example"), fixture.env)).status).toBe(403);
    vi.mocked(authenticatedGitHubUser).mockResolvedValue({ id: "another-account", login: "another-owner" });
    expect((await handleCorosConnectionRequest(request(), fixture.env)).status).toBe(409);
    expect(runCorosSync).not.toHaveBeenCalled();
  });

  it.each(["busy", "complete", "deferred", "error"] as const)("returns the safe %s result without starting another window", async status => {
    vi.mocked(runCorosSync).mockResolvedValue({ status, ...(status === "error" ? { errorCode: "COROS_SYNC_PAUSED" } : {}) });
    const response = await handleCorosConnectionRequest(request(), fixture.env);
    expect(await response.json()).toMatchObject({ status });
    expect(runCorosSync).toHaveBeenCalledTimes(1);
  });
});
