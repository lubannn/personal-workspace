import { parseCorosOAuthFailure } from "./coros-oauth-errors";
import { corosSyncDependenciesWithFetch, runCorosSync, type CorosSyncDependencies, type CorosSyncRunResult } from "./coros-sync";
import type { CorosSyncEnv } from "./coros-sync-state";

// Cron lasts at most 15 minutes; stop launching work at eight minutes. Existing
// per-request deadlines allow at most one remaining 64-second MCP operation.
// Keep below the next ten-minute trigger and the Free external-request cap.
export const COROS_SCHEDULED_BUDGET = { wallTimeMs: 8 * 60_000, batches: 20, errors: 3, fetches: 40 } as const;
const budgetError = () => new Error("COROS_SYNC_BUDGET_EXHAUSTED");

/** Count actual transport calls, not tools: SDK initialization/cleanup count too. */
export function scheduledCorosFetch(deadlineMs: number, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
  let count = 0, denied = false;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (Date.now() >= deadlineMs || count >= COROS_SCHEDULED_BUDGET.fetches) { denied = true; throw budgetError(); }
    count++;
    // One counted hop only; every upstream adapter already checks its origin.
    // An unexpected redirect is rejected by the existing response validators.
    return fetcher(input, { ...init, redirect: "manual" });
  };
  return { fetch, denied: () => denied, exhausted: () => count >= COROS_SCHEDULED_BUDGET.fetches || Date.now() >= deadlineMs };
}

/** Awaited only by scheduled(), never detached from an HTTP response. Each batch
 * reclaims the existing lease and reloads its committed progress. No new request
 * or scope is created, and source retry gates are never bypassed. */
export async function runScheduledCorosSync(env: CorosSyncEnv, deps?: CorosSyncDependencies) {
  const deadlineMs = Date.now() + COROS_SCHEDULED_BUDGET.wallTimeMs;
  const transport = scheduledCorosFetch(deadlineMs);
  const scoped = deps ?? corosSyncDependenciesWithFetch(transport.fetch);
  let expectedRequest: { sequence: number; through: string } | undefined;
  let result: CorosSyncRunResult | undefined;
  let batches = 0, errors = 0;
  while (batches < COROS_SCHEDULED_BUDGET.batches && !transport.exhausted()) {
    result = await runCorosSync(env, new Date(), scoped, { deadlineMs, budgetExhausted: transport.denied,
      ...(batches ? { forceDue: true, expectedRequest } : {}) });
    batches++;
    if (!["processed", "error"].includes(result.status)) break;
    if (!result.progress?.request) break;
    expectedRequest ??= { sequence: result.progress.request.sequence, through: result.progress.request.through };
    const code = result.errorCode ?? result.progress.lastErrorCode;
    if (code) {
      errors++;
      // Preserve the prior retry policy: transport/JSON/size failures used to
      // be source failures; known HTTP failures and timeouts were shared OAuth failures.
      const oauth = parseCorosOAuthFailure(code);
      const sourceFailure = oauth && ["TRANSPORT_FAILED", "BODY_READ_FAILED", "JSON_INVALID", "RESPONSE_TOO_LARGE"].includes(oauth.reason ?? "");
      // Shared credentials or rate limits cannot be repaired by rotating tools.
      if ((!sourceFailure && /RATE_LIMITED|UNAUTHORIZED|FORBIDDEN|OAUTH|TOKEN|CANCELLED|PAUSED|NOT_CONFIGURED|STATE_INVALID|WORKSPACE_MISMATCH/u.test(code))
        || errors >= COROS_SCHEDULED_BUDGET.errors) break;
    }
    // A successful call must advance coverage or save new resumable details.
    if (!code && result.status === "processed" && result.madeProgress === false) break;
  }
  return { batches, errors, result };
}
