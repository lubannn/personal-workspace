import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestCorosDailySync, useGitHubAppBootstrap } from "./use-github-app-bootstrap";
import { openPrivateRepository, readCookie } from "./page-model";

const hook = vi.hoisted(() => ({ effect: null as (() => void) | null }));
vi.mock("react", () => ({
  useEffect: (effect: () => void) => { hook.effect = effect; },
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("./page-model", () => ({
  DEFAULT_OWNER: "example-owner", DEFAULT_REPOSITORY: "private-data",
  friendlyError: () => "friendly-error", openPrivateRepository: vi.fn(), readCookie: vi.fn(),
}));

const callbacks = () => ({ adapterRef: { current: null }, setConnection: vi.fn(), setConnectionMethod: vi.fn(),
  setAuthAvailability: vi.fn(), setConnecting: vi.fn(), setErrorMessage: vi.fn(), setStatusMessage: vi.fn() });
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers(); vi.mocked(readCookie).mockReturnValue("test-csrf");
  vi.stubGlobal("window", { location: { search: "", pathname: "/", hash: "" }, history: { replaceState: vi.fn() } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks(); hook.effect = null; });

describe("daily COROS update request", () => {
  it("uses the same-origin CSRF-protected route without requiring a successful COROS response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    await expect(requestCorosDailySync("test-csrf", fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith("/coros/daily", expect.objectContaining({ method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { accept: "application/json", "x-pw-csrf": "test-csrf" }, signal: expect.any(AbortSignal) }));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not send a mutation without CSRF proof", async () => {
    const fetcher = vi.fn<typeof fetch>(); await requestCorosDailySync("", fetcher); expect(fetcher).not.toHaveBeenCalled();
  });
  it("aborts a stalled request after ten seconds and consumes its rejection", async () => {
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      signal = init?.signal ?? undefined;
      signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    }));
    const request = requestCorosDailySync("test-csrf", fetcher);
    await vi.advanceTimersByTimeAsync(9_999); expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await expect(request).resolves.toBeUndefined(); expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("workspace login and COROS daily update", () => {
  it("only requests an update after the repository has opened, without delaying successful login", async () => {
    const options = callbacks(); const opened = { adapter: { test: true }, connection: { owner: "example-owner" } };
    let finishOpen!: (value: unknown) => void;
    vi.mocked(openPrivateRepository).mockImplementation(() => new Promise(resolve => { finishOpen = resolve as (value: unknown) => void; }));
    let finishDaily!: () => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => {
      if (input === "/auth/status") return Response.json({ configured: true, authenticated: true, login: "example-owner" });
      if (input === "/auth/token") return Response.json({ accessToken: "test-access" });
      if (input === "/coros/daily") return new Promise(resolve => { finishDaily = () => resolve(new Response(null, { status: 202 })); });
      throw new Error("Unexpected route");
    });
    vi.stubGlobal("fetch", fetcher); useGitHubAppBootstrap(options); hook.effect?.(); await tick();
    expect(openPrivateRepository).toHaveBeenCalled(); expect(fetcher.mock.calls.map(call => call[0])).not.toContain("/coros/daily");
    finishOpen(opened); await tick();
    expect(options.setConnection).toHaveBeenCalledWith(opened.connection); expect(options.setConnectionMethod).toHaveBeenCalledWith("github-app");
    expect(options.setConnecting).toHaveBeenLastCalledWith(false); expect(fetcher.mock.calls.map(call => call[0])).toEqual(["/auth/status", "/auth/token", "/coros/daily"]);
    expect(options.setErrorMessage).not.toHaveBeenCalled(); finishDaily(); await tick();
  });
  it("a failed daily update does not undo the authenticated repository", async () => {
    const options = callbacks();
    vi.mocked(openPrivateRepository).mockResolvedValue({ adapter: {}, connection: {} } as Awaited<ReturnType<typeof openPrivateRepository>>);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async input => {
      if (input === "/auth/status") return Response.json({ configured: true, authenticated: true });
      if (input === "/auth/token") return Response.json({ accessToken: "test-access" });
      throw new Error("Offline");
    }));
    useGitHubAppBootstrap(options); hook.effect?.(); await tick();
    expect(options.setConnectionMethod).toHaveBeenLastCalledWith("github-app"); expect(options.setErrorMessage).not.toHaveBeenCalled();
    expect(options.setConnecting).toHaveBeenLastCalledWith(false);
  });
  it("does not request a daily update for an unauthenticated visit or a failed repository open", async () => {
    const options = callbacks();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ configured: true, authenticated: false }));
    vi.stubGlobal("fetch", fetcher); useGitHubAppBootstrap(options); hook.effect?.(); await tick();
    expect(fetcher).toHaveBeenCalledTimes(1); expect(openPrivateRepository).not.toHaveBeenCalled();
    fetcher.mockReset().mockImplementation(async input => input === "/auth/status"
      ? Response.json({ configured: true, authenticated: true }) : Response.json({ accessToken: "test-access" }));
    vi.mocked(openPrivateRepository).mockRejectedValue(new Error("Repository unavailable"));
    useGitHubAppBootstrap(options); hook.effect?.(); await tick();
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(["/auth/status", "/auth/token"]);
    expect(options.setConnectionMethod).toHaveBeenLastCalledWith(null);
  });
});
