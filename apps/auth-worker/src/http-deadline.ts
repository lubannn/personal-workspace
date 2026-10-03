const HTTP_DEADLINE_MS = 30_000;

/** Worker-only requests share one deadline across headers and body consumption. */
export async function withHttpDeadline<T>(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  consume: (response: Response, signal: AbortSignal) => Promise<T>,
  timeoutCode: string,
): Promise<T> {
  const controller = new AbortController();
  const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const timeoutError = Object.assign(new Error(timeoutCode), { name: "AbortError", code: timeoutCode });
  let rejectAborted!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAborted = reject; });
  const abort = (reason: unknown) => {
    // Reject first so a fetch implementation's abort error cannot hide our code.
    rejectAborted(reason);
    controller.abort(reason);
  };
  const onCallerAbort = () => abort(callerSignal?.reason ?? new DOMException("Aborted", "AbortError"));
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(() => abort(timeoutError), HTTP_DEADLINE_MS);
  if (callerSignal?.aborted) onCallerAbort();
  try {
    const operation = (async () => {
      controller.signal.throwIfAborted();
      const response = await fetcher(input, { ...init, signal: controller.signal });
      if (controller.signal.aborted) {
        void response.body?.cancel(controller.signal.reason).catch(() => undefined);
        controller.signal.throwIfAborted();
      }
      return consume(response, controller.signal);
    })();
    // A custom transport may ignore AbortSignal; racing keeps callers bounded too.
    return await Promise.race([operation, aborted]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}

export async function readHttpResponseBytes(
  response: Response,
  signal: AbortSignal,
  limit?: { maxBytes: number; errorCode: string },
): Promise<Uint8Array<ArrayBuffer>> {
  signal.throwIfAborted();
  const length = Number(response.headers.get("content-length"));
  if (limit && Number.isFinite(length) && length > limit.maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error(limit.errorCode);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (limit && total > limit.maxBytes) {
        cancel();
        throw new Error(limit.errorCode);
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Return a buffered response so later adapter.json() calls cannot hang on I/O. */
export function createDeadlineFetch(fetcher: typeof fetch, timeoutCode: string): typeof fetch {
  return (input, init) => withHttpDeadline(fetcher, input, init, async (response, signal) => {
    const bytes = response.body ? await readHttpResponseBytes(response, signal) : null;
    return new Response(bytes, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }, timeoutCode);
}
