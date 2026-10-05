import { nextHealthSyncWindow, type HealthSyncWindow } from "./coros-health-sync";
import { COROS_SYNC_SOURCES, nextSyncWindow, type SyncProgress, type SyncSource } from "./coros-sync-state";

type Window = NonNullable<ReturnType<typeof nextSyncWindow>> | HealthSyncWindow;

/** One serial turn: alternate recent/history, then rotate eligible sources within that kind. */
export function nextFairSyncWindow(progress: SyncProgress, now: Date, healthEnabled: boolean, recentOnly = false): Window | null {
  // Include all enabled sources in checkpoints even when a record wins the
  // first turn; clients must not mistake absent health state for completion.
  if (healthEnabled) nextHealthSyncWindow(progress, now);
  const firstKind = recentOnly || progress.scheduling?.lastKind !== "recent" ? "recent" : "history";
  const kinds = recentOnly ? ["recent" as const] : [firstKind, firstKind === "recent" ? "history" as const : "recent" as const];
  for (const kind of kinds) {
    const last = kind === "recent" ? progress.scheduling?.recentSource : progress.scheduling?.historySource;
    const offset = last ? COROS_SYNC_SOURCES.indexOf(last) + 1 : 0;
    for (let turn = 0; turn < COROS_SYNC_SOURCES.length; turn++) {
      const source = COROS_SYNC_SOURCES[(offset + turn) % COROS_SYNC_SOURCES.length];
      const filter = { source, recent: kind === "recent" };
      const window = source === "sleep" || source === "workout" ? nextSyncWindow(progress, now, filter)
        : healthEnabled ? nextHealthSyncWindow(progress, now, filter) : null;
      if (window) return window;
    }
  }
  return null;
}

/** Save before I/O so failure, pending details or lease expiry still yield the next turn. */
export function recordSyncTurn(progress: SyncProgress, window: Window) {
  const kind = window.recent ? "recent" : "history";
  const source: SyncSource = window.domain === "health" ? window.source ?? "hrvActivity" : window.domain;
  progress.scheduling = { ...progress.scheduling, lastKind: kind, [kind === "recent" ? "recentSource" : "historySource"]: source };
}

/** Align to cron's next ten-minute tick, avoiding missed claims from invocation jitter. */
export function nextSyncTick(now: Date) {
  const interval = 10 * 60_000;
  return new Date((Math.floor(now.getTime() / interval) + 1) * interval).toISOString();
}
