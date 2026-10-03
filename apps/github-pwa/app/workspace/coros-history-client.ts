import type { CorosSyncRunResult } from "../../../auth-worker/src/coros-sync";

export type CorosHistoryResult = CorosSyncRunResult | { status: "limit" };
type Options = {
  csrf: string;
  signal: AbortSignal;
  onUpdate: (result: CorosSyncRunResult, processed: number) => void;
  fetcher?: typeof fetch;
};

const MAX_WINDOWS = 2_000;
const MAX_BUSY_RETRIES = 6;

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, milliseconds);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

/** User-started continuation. Every request awaits one guarded server batch. */
export async function drainCorosHistory({ csrf, signal, onUpdate, fetcher = fetch }: Options): Promise<CorosHistoryResult> {
  if (!csrf) throw new Error("COROS_AUTH_REQUIRED");
  async function post(path: "/coros/sync" | "/coros/drain") {
    signal.throwIfAborted();
    const response = await fetcher(path, { method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { accept: "application/json", "x-pw-csrf": csrf }, signal });
    const result = await response.json() as Record<string, unknown>;
    signal.throwIfAborted();
    if (!response.ok) {
      const code = typeof result.error === "string" && /^[A-Z][A-Z0-9_]{0,99}$/u.test(result.error) ? result.error : "COROS_SYNC_REQUEST_FAILED";
      throw new Error(code);
    }
    return result;
  }
  // One explicit request also clears retry state from a previously failed parser.
  await post("/coros/sync");
  let processed = 0;
  let busyRetries = 0;
  while (processed < MAX_WINDOWS) {
    const result = await post("/coros/drain");
    if (!["processed", "busy", "complete", "deferred", "error"].includes(String(result.status))) throw new Error("COROS_SYNC_RESPONSE_INVALID");
    const update = result as CorosSyncRunResult;
    if (update.status === "processed") processed += 1;
    onUpdate(update, processed);
    if (update.status === "processed") {
      busyRetries = 0;
      if (processed < MAX_WINDOWS) await abortableDelay(250, signal);
    } else if (update.status === "busy" && busyRetries < MAX_BUSY_RETRIES) {
      busyRetries += 1;
      await abortableDelay(5_000, signal);
    } else return update;
  }
  return { status: "limit" };
}
