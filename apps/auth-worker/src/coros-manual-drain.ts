import { corosSyncDependenciesWithFetch, runCorosSync, type CorosSyncDependencies, type CorosSyncRunResult } from "./coros-sync";
import type { CorosSyncEnv } from "./coros-sync-state";
import { CorosSyncBudgetExceeded } from "./coros-sync-budget";

export const COROS_MANUAL_BUDGET = { batches: 2, fetches: 48, wallTimeMs: 80_000, nextBatchReserve: 24 } as const;

/** Invocation-only resources. Every window still checks its own grant, lease,
 * workspace and current Git revision; no token or adapter survives this call. */
export function createCorosManualScope(deps: CorosSyncDependencies) {
  const sessions: { url: string; token: string; session: NonNullable<ReturnType<NonNullable<CorosSyncDependencies["session"]>>> }[] = [];
  const adapters = new Map<string, ReturnType<CorosSyncDependencies["adapter"]>>();
  const scoped: CorosSyncDependencies = { ...deps,
    async adapter(config) {
      const key = JSON.stringify([config.appId, config.installationId, config.privateKeyPem, config.owner, config.repository]);
      const existing = adapters.get(key);
      if (existing) {
        const adapter = await existing;
        const repository = await adapter.verifyPrivateRepository();
        if (repository.fullName.toLowerCase() !== `${config.owner}/${config.repository}`.toLowerCase()) throw new Error("GITHUB_INSTALLATION_REPOSITORY_MISMATCH");
        return adapter;
      }
      const adapter = deps.adapter(config); adapters.set(key, adapter);
      return adapter;
    },
    ...(deps.session ? { session(url: string, token: string) {
      let existing = sessions.find(item => item.url === url && item.token === token);
      if (!existing) { existing = { url, token, session: deps.session!(url, token) }; sessions.push(existing); }
      return { read: existing.session.read.bind(existing.session), close: async () => {} };
    } } : {}),
  };
  return { dependencies: scoped, async close() {
    await Promise.allSettled(sessions.map(item => item.session.close()));
    sessions.length = 0; adapters.clear();
  } };
}

/** Two serial, independently checkpointed recent windows share setup costs.
 * Reserve room before starting another window; budget yields keep saved progress. */
export function createCorosManualBudget(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
  const deadlineMs = Date.now() + COROS_MANUAL_BUDGET.wallTimeMs;
  const controller = new AbortController();
  let count = 0, denied = false;
  const timer = setTimeout(() => { denied = true; controller.abort(new CorosSyncBudgetExceeded()); }, COROS_MANUAL_BUDGET.wallTimeMs);
  const boundedFetch: typeof fetch = async (input, init) => {
    if (controller.signal.aborted || Date.now() >= deadlineMs || count >= COROS_MANUAL_BUDGET.fetches) {
      denied = true; throw new CorosSyncBudgetExceeded();
    }
    count++;
    const signals = [controller.signal, ...(init?.signal ? [init.signal] : []), ...(input instanceof Request ? [input.signal] : [])];
    try { return await fetcher(input, { ...init, redirect: "manual", signal: AbortSignal.any(signals) }); }
    catch (error) { if (controller.signal.aborted) { denied = true; throw new CorosSyncBudgetExceeded(); } throw error; }
  };
  return { fetch: boundedFetch, deadlineMs, denied: () => denied, remaining: () => COROS_MANUAL_BUDGET.fetches - count,
    close() { clearTimeout(timer); controller.abort(new CorosSyncBudgetExceeded()); } };
}

export async function runCorosManualDrain(env: CorosSyncEnv, batchLimit = 2,
  dependencies?: CorosSyncDependencies, runner = runCorosSync,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<CorosSyncRunResult> {
  const budget = createCorosManualBudget(fetcher);
  const scope = createCorosManualScope(dependencies ?? corosSyncDependenciesWithFetch(budget.fetch));
  const completedBatches: NonNullable<CorosSyncRunResult["batch"]>[] = [];
  let result: CorosSyncRunResult = { status: "complete" };
  let expectedRequest: { sequence: number; through: string } | undefined;
  try {
    for (let index = 0; index < Math.min(COROS_MANUAL_BUDGET.batches, Math.max(1, batchLimit)); index++) {
      if (index && (budget.remaining() < COROS_MANUAL_BUDGET.nextBatchReserve || budget.deadlineMs - Date.now() < 15_000)) break;
      const previous = result;
      result = await runner(env, new Date(), scope.dependencies, { forceDue: true, recentOnly: true,
        deadlineMs: budget.deadlineMs, budgetExhausted: budget.denied, ...(expectedRequest ? { expectedRequest } : {}) });
      if (!result.progress && previous.progress) result = { ...result, progress: previous.progress };
      if (result.status !== "processed") break;
      if (result.batch) completedBatches.push(result.batch);
      if (!result.progress?.request || result.madeProgress === false) break;
      expectedRequest ??= { sequence: result.progress.request.sequence, through: result.progress.request.through };
    }
    if (completedBatches.length && result.status === "deferred" && result.errorCode === "COROS_SYNC_BUDGET_EXHAUSTED") {
      // The committed window counts; the unfinished window resumes immediately
      // in a fresh manual request instead of waiting for a cron tick.
      return { status: "processed", batch: completedBatches.at(-1), progress: result.progress, madeProgress: true, completedBatches };
    }
    return { ...result, completedBatches };
  } catch (error) {
    if (!completedBatches.length) throw error;
    // A later SQL/transport failure cannot hide the earlier committed batch.
    return { status: "error", errorCode: "COROS_SYNC_FAILED", remainingWork: true, progress: result.progress, completedBatches };
  } finally { await scope.close(); budget.close(); }
}
