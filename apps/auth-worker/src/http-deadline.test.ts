import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeadlineFetch, readHttpResponseBytes, withHttpDeadline } from "./http-deadline";

afterEach(() => vi.useRealTimers());

describe("Worker HTTP deadline", () => {
  it("bounds a fetch that never resolves or observes cancellation", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    const request = withHttpDeadline(fetcher, "https://example.com", undefined,
      async () => "unreachable", "TEST_TIMEOUT");
    const result = expect(request).rejects.toMatchObject({ name: "AbortError", message: "TEST_TIMEOUT", code: "TEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the same deadline for delayed headers and a body that never ends", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const fetcher = vi.fn<typeof fetch>(() => new Promise((resolve) => {
      setTimeout(() => resolve(new Response(new ReadableStream({ cancel }))), 20_000);
    }));
    const request = createDeadlineFetch(fetcher, "TEST_TIMEOUT")("https://example.com");
    const result = expect(request).rejects.toThrow("TEST_TIMEOUT");
    await vi.advanceTimersByTimeAsync(29_999);
    expect(cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves caller cancellation and removes its deadline", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    const request = createDeadlineFetch(fetcher, "TEST_TIMEOUT")("https://example.com", { signal: caller.signal });
    const result = expect(request).rejects.toMatchObject({ name: "AbortError" });
    caller.abort();
    await result;
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves null bodies and response status and headers", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204, headers: { "x-test": "retained" } }));
    const response = await createDeadlineFetch(fetcher, "TEST_TIMEOUT")("https://example.com");
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(response.headers.get("x-test")).toBe("retained");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels an over-limit stream before retaining the oversized chunk", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65_537)); }, cancel });
    await expect(readHttpResponseBytes(new Response(body), new AbortController().signal,
      { maxBytes: 65_536, errorCode: "TOO_LARGE" })).rejects.toThrow("TOO_LARGE");
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
