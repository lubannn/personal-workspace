import type { CorosSyncRunResult } from "../../../auth-worker/src/coros-sync";

export type CorosRefreshEvent = { recordsChanged: boolean; refreshStatus: boolean; lastSyncAt?: string | null };

/** A bundled response can commit two sources; reload its final Git head once. */
export function createCorosRefreshPublisher(publish: (event: CorosRefreshEvent) => void) {
  let pending: CorosRefreshEvent | undefined;
  return (event: CorosRefreshEvent) => {
    if (pending) {
      pending = { recordsChanged: pending.recordsChanged || event.recordsChanged, refreshStatus: pending.refreshStatus || event.refreshStatus,
        lastSyncAt: event.lastSyncAt !== undefined ? event.lastSyncAt : pending.lastSyncAt };
      return;
    }
    pending = event;
    queueMicrotask(() => { const update = pending!; pending = undefined; publish(update); });
  };
}

/** Publish records and the first changed metrics promptly; combine later metrics. */
export function createCorosRefreshUpdates(publish: (event: CorosRefreshEvent) => void) {
  let metricsChanged = false;
  let metricsPublished = false;
  let anotherWorker = false;
  let lastSyncAt: string | null | undefined;
  return {
    update(result: CorosSyncRunResult) {
      lastSyncAt = result.progress?.lastSuccessAt ?? lastSyncAt;
      anotherWorker ||= result.status === "busy";
      if (result.status !== "processed" || !result.batch) return;
      const changed = result.batch.created + (result.batch.updated ?? 0) > 0;
      if (result.batch.domain === "health") {
        if (changed && !metricsPublished) { metricsPublished = true; publish({ recordsChanged: true, refreshStatus: false, lastSyncAt }); }
        else metricsChanged ||= changed;
      }
      else if (changed) publish({ recordsChanged: true, refreshStatus: false, lastSyncAt });
    },
    finish() { publish({ recordsChanged: metricsChanged || anotherWorker, refreshStatus: true, lastSyncAt }); },
  };
}
