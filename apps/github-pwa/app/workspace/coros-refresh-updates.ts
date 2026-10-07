import type { CorosSyncRunResult } from "../../../auth-worker/src/coros-sync";

export type CorosRefreshEvent = { recordsChanged: boolean; refreshStatus: boolean; lastSyncAt?: string | null };

/** Publish committed records promptly; combine metric changes into one final reload. */
export function createCorosRefreshUpdates(publish: (event: CorosRefreshEvent) => void) {
  let metricsChanged = false;
  let anotherWorker = false;
  let lastSyncAt: string | null | undefined;
  return {
    update(result: CorosSyncRunResult) {
      lastSyncAt = result.progress?.lastSuccessAt ?? lastSyncAt;
      anotherWorker ||= result.status === "busy";
      if (result.status !== "processed" || !result.batch) return;
      const changed = result.batch.created + (result.batch.updated ?? 0) > 0;
      if (result.batch.domain === "health") metricsChanged ||= changed;
      else if (changed) publish({ recordsChanged: true, refreshStatus: false, lastSyncAt });
    },
    finish() { publish({ recordsChanged: metricsChanged || anotherWorker, refreshStatus: true, lastSyncAt }); },
  };
}
