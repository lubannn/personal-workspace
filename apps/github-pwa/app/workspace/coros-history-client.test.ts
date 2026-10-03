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
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(run).resolves.toMatchObject({ status: "busy" });
    expect(fetcher).toHaveBeenCalledTimes(8);
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
});
