import type { CorosSyncRunResult } from "../../../auth-worker/src/coros-sync";

export type CorosHistoryResult = CorosSyncRunResult | { status: "limit" };
type Options = {
  csrf: string;
  signal: AbortSignal;
  onUpdate: (result: CorosSyncRunResult, processed: number) => void;
  fetcher?: typeof fetch;
  /** Extra update reads recent records and health metrics only; never drains the history backlog. */
  recentOnly?: boolean;
};

const MAX_WINDOWS = 2_000;
export const COROS_BUSY_POLL_MS = 5_000;
const MAX_BUSY_WAIT_MS = 11 * 60_000;
const MAX_TRANSPORT_RETRIES = 3;

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, milliseconds);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

/** User-started continuation. Every request awaits one guarded server batch. */
export async function drainCorosHistory({ csrf, signal, onUpdate, fetcher = fetch, recentOnly = false }: Options): Promise<CorosHistoryResult> {
  if (!csrf) throw new Error("COROS_AUTH_REQUIRED");
  async function post(path: "/coros/sync" | "/coros/daily" | "/coros/drain") {
    for (let attempt = 0; ; attempt += 1) {
      signal.throwIfAborted();
      const canRetry = path === "/coros/drain" && attempt < MAX_TRANSPORT_RETRIES;
      let response: Response;
      try {
        response = await fetcher(path, { method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { accept: "application/json", "x-pw-csrf": csrf, ...(path === "/coros/drain" && recentOnly ? { "content-type": "application/json" } : {}) },
          ...(path === "/coros/drain" && recentOnly ? { body: JSON.stringify({ recentOnly: true }) } : {}), signal });
      } catch (error) {
        signal.throwIfAborted();
        if (!canRetry) throw error;
        await abortableDelay(1_000 * 2 ** attempt, signal);
        continue;
      }
      const body: unknown = await response.json().catch(() => null);
      signal.throwIfAborted();
      const result = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
      if (!response.ok) {
        const errorCode = result?.error ?? result?.errorCode;
        const unavailableProxy = response.status === 502 && errorCode === "AUTH_UPSTREAM_UNAVAILABLE";
        // This Pages proxy error is transport-only. COROS semantic failures still stop.
        if (typeof errorCode === "string" && !unavailableProxy) throw new Error(/^[A-Z][A-Z0-9_]{0,99}$/u.test(errorCode) ? errorCode : "COROS_SYNC_REQUEST_FAILED");
        if (canRetry && [502, 503, 504].includes(response.status)) {
          await abortableDelay(1_000 * 2 ** attempt, signal);
          continue;
        }
        throw new Error("COROS_SYNC_REQUEST_FAILED");
      }
      if (!result) throw new Error("COROS_SYNC_RESPONSE_INVALID");
      return result;
    }
  }
  // Continuation reuses today's queued request; only extra update requests a fresh observation.
  await post(recentOnly ? "/coros/sync" : "/coros/daily");
  let processed = 0;
  let busySince: number | null = null;
  const maxWindows = recentOnly ? 12 : MAX_WINDOWS;
  const maxBusyWait = recentOnly ? 30_000 : MAX_BUSY_WAIT_MS;
  while (processed < maxWindows) {
    const result = await post("/coros/drain");
    if (!["processed", "busy", "complete", "deferred", "error"].includes(String(result.status))) throw new Error("COROS_SYNC_RESPONSE_INVALID");
    const update = result as CorosSyncRunResult;
    if (update.status === "processed") processed += 1;
    onUpdate(update, processed);
    if (recentOnly && update.status === "processed" && update.progress?.request && (["sleep", "workout"] as const).every(domain =>
      update.progress!.domains[domain].recentRequestSequence === update.progress!.request!.sequence)
      && (!update.progress.health || (update.progress.health.recentRequestSequence === update.progress.request.sequence
        && update.progress.health.bulk && Object.values(update.progress.health.bulk).every(source => source.recentRequestSequence === update.progress!.request!.sequence)))) {
      return { status: "complete", retryAt: null, progress: update.progress };
    }
    if (update.status === "processed") {
      busySince = null;
      if (processed < maxWindows) await abortableDelay(250, signal);
    } else if (update.status === "busy") {
      busySince ??= Date.now();
      const remaining = maxBusyWait - (Date.now() - busySince);
      if (remaining <= 0) return update;
      const retryAt = update.retryAt ? Date.parse(update.retryAt) : NaN;
      // lease_until bounds ownership; it is not an instruction to sleep until
      // expiry. The owner can finish early, so recheck without stealing its lease.
      const delay = Number.isFinite(retryAt) ? Math.max(1_000, retryAt - Date.now()) : COROS_BUSY_POLL_MS;
      await abortableDelay(Math.min(remaining, COROS_BUSY_POLL_MS, delay), signal);
    } else return update;
  }
  return { status: "limit" };
}
