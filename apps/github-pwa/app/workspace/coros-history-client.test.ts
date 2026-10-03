import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drainCorosHistory } from "./coros-history-client";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const response = (status: string) => Response.json({ status });
const options = (fetcher: typeof fetch) => ({ csrf: "test-csrf", signal: new AbortController().signal, onUpdate: vi.fn(), fetcher });

describe("explicit COROS history continuation", () => {
  it("requests an update once and serially drains completed windows with CSRF protection", async () => {
    let finishFirst!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("requested"))
      .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
      .mockResolvedValueOnce(response("processed")).mockResolvedValueOnce(response("complete"));
    const input = options(fetcher);
    const run = drainCorosHistory(input);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(["/coros/sync", "/coros/drain"]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    finishFirst(response("processed"));
    await vi.advanceTimersByTimeAsync(249);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(251);
    await expect(run).resolves.toMatchObject({ status: "complete" });
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(["/coros/sync", "/coros/drain", "/coros/drain", "/coros/drain"]);
    expect(input.onUpdate.mock.calls.map(call => call[1])).toEqual([1, 2, 2]);
    for (const [, init] of fetcher.mock.calls) expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { accept: "application/json", "x-pw-csrf": "test-csrf" }, signal: input.signal });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries an occupied lease only for a bounded period", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("requested")).mockImplementation(async () => response("busy"));
    const run = drainCorosHistory(options(fetcher));
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    await expect(run).resolves.toMatchObject({ status: "busy" });
    expect(fetcher).toHaveBeenCalledTimes(46);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["deferred", "error"])("stops on %s without issuing another request", async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("requested"))
      .mockResolvedValueOnce(Response.json({ status, retryAt: "2030-01-01T01:00:00Z", errorCode: "COROS_READ_RATE_LIMIT" }));
    await expect(drainCorosHistory(options(fetcher))).resolves.toMatchObject({ status });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a pending delay on unmount and never starts another window", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("requested")).mockResolvedValueOnce(response("processed"));
    const run = drainCorosHistory({ ...options(fetcher), signal: controller.signal });
    const rejected = expect(run).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not continue after CSRF or authentication rejection", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "COROS_AUTH_REQUIRED" }, { status: 401 }));
    await expect(drainCorosHistory(options(fetcher))).rejects.toThrow("COROS_AUTH_REQUIRED");
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockClear();
    await expect(drainCorosHistory({ ...options(fetcher), csrf: "" })).rejects.toThrow("COROS_AUTH_REQUIRED");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects an unknown successful status instead of looping indefinitely", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("requested")).mockResolvedValueOnce(response("unexpected"));
    await expect(drainCorosHistory(options(fetcher))).rejects.toThrow("COROS_SYNC_RESPONSE_INVALID");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries a transient network error and gateway failure without requesting sync again", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("requested"))
      .mockRejectedValueOnce(new TypeError("Network unavailable"))
      .mockResolvedValueOnce(new Response("Gateway unavailable", { status: 502 }))
      .mockResolvedValueOnce(response("processed")).mockResolvedValueOnce(response("complete"));
    const input = options(fetcher);
    const run = drainCorosHistory(input);
    await vi.advanceTimersByTimeAsync(3_250);
    await expect(run).resolves.toMatchObject({ status: "complete" });
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(["/coros/sync", "/coros/drain", "/coros/drain", "/coros/drain", "/coros/drain"]);
    expect(input.onUpdate.mock.calls.map(call => call[1])).toEqual([1, 1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([503, 504])("bounds transient HTTP %s retries", async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("requested"))
      .mockImplementation(async () => new Response("Gateway unavailable", { status }));
    const run = drainCorosHistory(options(fetcher));
    const failed = expect(run).rejects.toThrow("COROS_SYNC_REQUEST_FAILED");
    await vi.advanceTimersByTimeAsync(7_000);
    await failed;
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry an explicit application error returned with a gateway status", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("requested"))
      .mockResolvedValueOnce(Response.json({ error: "COROS_SYNC_NOT_CONFIGURED" }, { status: 503 }));
    await expect(drainCorosHistory(options(fetcher))).rejects.toThrow("COROS_SYNC_NOT_CONFIGURED");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers from the known Pages proxy failure and waits for an abandoned lease without another sync request", async () => {
    const now = new Date("2030-01-01T00:00:00Z"); vi.setSystemTime(now);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("requested"))
      .mockResolvedValueOnce(Response.json({ error: "AUTH_UPSTREAM_UNAVAILABLE" }, { status: 502 }))
      .mockResolvedValueOnce(Response.json({ status: "busy", retryAt: "2030-01-01T00:10:00Z" }))
      .mockResolvedValueOnce(response("processed")).mockResolvedValueOnce(response("complete"));
    const input = options(fetcher);
    const run = drainCorosHistory(input);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(input.onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: "busy" }), 0);
    await vi.advanceTimersByTimeAsync(598_999);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(251);
    await expect(run).resolves.toMatchObject({ status: "complete" });
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(["/coros/sync", "/coros/drain", "/coros/drain", "/coros/drain", "/coros/drain"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("caps a distant retry time at the total busy budget", async () => {
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("requested"))
      .mockImplementation(async () => Response.json({ status: "busy", retryAt: "2030-01-01T01:00:00Z" }));
    const run = drainCorosHistory(options(fetcher));
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    await expect(run).resolves.toMatchObject({ status: "busy" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a long lease wait immediately", async () => {
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response("requested"))
      .mockResolvedValueOnce(Response.json({ status: "busy", retryAt: "2030-01-01T00:10:00Z" }));
    const run = drainCorosHistory({ ...options(fetcher), signal: controller.signal });
    const failed = expect(run).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await failed;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never retries the initial sync request after an uncertain network result", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Network unavailable"));
    await expect(drainCorosHistory(options(fetcher))).rejects.toThrow("Network unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
