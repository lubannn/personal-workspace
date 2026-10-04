import { parseWorkspaceDescriptor } from "../../../src/lib/github-data/workspace";
import { refreshEnabledCorosConnection } from "./coros-credentials";
import { callCorosReadTool } from "./coros-read-client";
import { mapCorosSleep, mapCorosWorkouts } from "./coros-sync-mapping";
import { createPrivateDataInstallationAdapter } from "./github-installation";
import { writeCorosSyncBatch } from "./coros-sync-writer";
import { acceptSyncRequest, nextSyncWindow, parseSyncProgress, readSyncJob, recentWindowStart, shiftDate, syncReadiness, type CorosSyncEnv, type SyncProgress } from "./coros-sync-state";

const dependencies = { refresh: refreshEnabledCorosConnection, read: callCorosReadTool,
  adapter: createPrivateDataInstallationAdapter, write: writeCorosSyncBatch };
export type CorosSyncDependencies = typeof dependencies;
const isoAfter = (now: Date, milliseconds: number) => new Date(now.getTime() + milliseconds).toISOString();
export type CorosSyncRunResult = {
  status: "processed" | "busy" | "complete" | "deferred" | "error";
  progress?: SyncProgress;
  batch?: NonNullable<SyncProgress["lastBatch"]>;
  retryAt?: string | null;
  errorCode?: string;
};
export type CorosDrainResult = CorosSyncRunResult;

function pendingRetry(progress: SyncProgress): string | null {
  if (!progress.request) return null;
  return (["sleep", "workout"] as const).filter(domain =>
    progress.domains[domain].recentRequestSequence !== progress.request!.sequence
    || progress.domains[domain].backfillNext <= progress.request!.through)
    .map(domain => progress.domains[domain].retryAfter ?? null)
    .filter((time): time is string => time !== null).sort()[0] ?? null;
}

/** One bounded window per invocation; authenticated drain skips queue delay, never leases or backoff. */
export async function runCorosSync(env: CorosSyncEnv, now = new Date(), deps: CorosSyncDependencies = dependencies,
  options: { forceDue?: boolean } = {}): Promise<CorosSyncRunResult> {
  if (!env.DB || !env.TOKEN_ENCRYPTION_KEY || !syncReadiness(env).ready) return { status: "error", errorCode: "COROS_SYNC_NOT_CONFIGURED" };
  const db = env.DB; const userId = env.COROS_GITHUB_USER_ID!;
  const connection = await db.prepare("SELECT state, connected_at FROM coros_connections WHERE github_user_id = ?1")
    .bind(userId).first<{ state: string; connected_at: string }>();
  if (connection?.state !== "enabled") return { status: "error", errorCode: "COROS_SYNC_PAUSED" };
  const connectedAt = connection.connected_at;
  const token = crypto.randomUUID();
  const claimed = await db.prepare(`UPDATE coros_sync_jobs SET lease_token = ?1, lease_until = ?2
    WHERE github_user_id = ?3 AND (?5 = 1 OR next_run_at <= ?4) AND (lease_until IS NULL OR lease_until <= ?4)
    AND EXISTS (SELECT 1 FROM coros_connections WHERE github_user_id = ?3 AND state = 'enabled')`)
    .bind(token, isoAfter(now, 10 * 60000), userId, now.toISOString(), options.forceDue ? 1 : 0).run();
  if (!claimed.success || claimed.meta?.changes !== 1) {
    const current = await readSyncJob(db, userId);
    if (!current) return { status: "error", errorCode: "COROS_SYNC_NOT_CONFIGURED" };
    return current.lease_until && current.lease_until > now.toISOString()
      ? { status: "busy", retryAt: current.lease_until }
      : { status: "deferred", retryAt: current.next_run_at };
  }
  const job = await readSyncJob(db, userId);
  if (!job || job.lease_token !== token) return { status: "busy" };
  let progress;
  try { progress = parseSyncProgress(job.progress_json); acceptSyncRequest(progress, job); }
  catch {
    await db.prepare("UPDATE coros_connections SET last_error_code = 'COROS_SYNC_STATE_INVALID', state = 'paused' WHERE github_user_id = ?1").bind(userId).run();
    await db.prepare("UPDATE coros_sync_jobs SET lease_token = NULL, lease_until = NULL WHERE github_user_id = ?1 AND lease_token = ?2").bind(userId, token).run();
    return { status: "error", errorCode: "COROS_SYNC_STATE_INVALID" };
  }
  const window = nextSyncWindow(progress, now);
  let nextRunAt = isoAfter(now, 10 * 60000);
  async function assertActive() {
    const row = await db.prepare(`SELECT j.lease_token FROM coros_sync_jobs j JOIN coros_connections c
      ON c.github_user_id = j.github_user_id WHERE j.github_user_id = ?1 AND c.state = 'enabled'
      AND j.lease_token = ?2 AND j.lease_until > ?3 AND c.connected_at = ?4`)
      .bind(userId, token, new Date().toISOString(), connectedAt).first<{ lease_token: string }>();
    if (!row) throw new Error("COROS_SYNC_CANCELLED");
  }
  try {
    if (!window) {
      const retryAt = pendingRetry(progress);
      nextRunAt = retryAt ?? isoAfter(now, 30 * 60000);
      return { status: retryAt ? "deferred" : "complete", retryAt, progress };
    }
    progress.lastAttemptAt = now.toISOString();
    const ready = await deps.refresh(db, userId, env.TOKEN_ENCRYPTION_KEY);
    if (!ready) throw new Error("COROS_SYNC_CANCELLED");
    await assertActive();
    const range = { startDate: window.from, endDate: window.through, timezone: progress.timezone };
    const args = { startDate: window.from.replaceAll("-", ""), endDate: window.through.replaceAll("-", "") };
    let mapped;
    if (window.domain === "sleep") {
      const readSleep = async (through: string) => {
        const parameters = { ...args, endDate: through.replaceAll("-", "") };
        let result;
        try { result = await deps.read(ready.resourceUrl, ready.accessToken, "querySleepOverview", parameters); }
        catch (error) {
          if (!(error instanceof Error) || error.message !== "COROS_READ_TOOL_UNAVAILABLE") throw error;
          result = await deps.read(ready.resourceUrl, ready.accessToken, "querySleepData", parameters);
        }
        return mapCorosSleep(result, { ...range, endDate: through });
      };
      try { mapped = await readSleep(window.through); }
      catch (error) {
        if (!(error instanceof Error) || error.message !== "COROS_SYNC_FORMAT_UNSUPPORTED" || window.from === window.through) throw error;
        // A partial multi-day response does not prove omitted days are empty.
        // Re-query the first day explicitly and advance only that verified day.
        await assertActive();
        window.through = window.from;
        mapped = await readSleep(window.through);
      }
    } else {
      for (;;) {
        const result = await deps.read(ready.resourceUrl, ready.accessToken, "querySportRecords", {
          ...args, endDate: window.through.replaceAll("-", ""), limit: 100, sportTypeCodes: [65535], locationKeyword: "", maxAveragePace: "",
          minDistanceKm: 0, maxDistanceKm: 1000000, minDurationMinutes: 0, maxDurationMinutes: 1000000,
        });
        mapped = mapCorosWorkouts(result, { ...range, endDate: window.through });
        // Be conservative about the documented default cap (20), even when requesting 100.
        if (mapped.reportedCount < 20) break;
        const span = Math.round((Date.parse(window.through) - Date.parse(window.from)) / 86400000);
        if (span === 0) throw new Error("COROS_SYNC_WINDOW_TRUNCATED");
        window.through = shiftDate(window.from, Math.floor(span / 2));
        await assertActive();
      }
    }
    await assertActive();
    let outcome: Awaited<ReturnType<CorosSyncDependencies["write"]>> = {
      created: 0, unchanged: 0, conflicts: 0, totalPendingConflicts: progress.conflicts,
      conflictDetails: [], latestSleepDate: null, latestWorkoutDate: null,
    };
    if (mapped.items.length > 0) {
      const adapter = await deps.adapter({ appId: env.GITHUB_APP_ID!, installationId: env.GITHUB_APP_INSTALLATION_ID!,
        privateKeyPem: env.GITHUB_APP_PRIVATE_KEY!, owner: env.ALLOWED_REPO_OWNER!, repository: env.ALLOWED_REPO_NAME! });
      const descriptor = parseWorkspaceDescriptor((await adapter.readText("workspace.json")).text);
      if (descriptor.owner_login !== env.ALLOWED_GITHUB_LOGIN || descriptor.owner_id !== env.COROS_WORKSPACE_OWNER_ID || descriptor.timezone !== progress.timezone) {
        throw new Error("COROS_SYNC_WORKSPACE_MISMATCH");
      }
      outcome = await deps.write(adapter, { ownerId: descriptor.owner_id, items: mapped.items,
        timestamp: now.toISOString(), beforeCommit: assertActive });
    }
    await assertActive();
    const domain = progress.domains[window.domain];
    if (window.recent) {
      domain.recentThrough = window.through;
      domain.recentNext = window.through < progress.request!.through ? shiftDate(window.through, 1) : null;
      if (!domain.recentNext) {
        domain.lastRecentAt = now.toISOString();
        domain.recentRequestSequence = progress.request!.sequence;
        // Advance contiguous coverage only when the entire remaining gap was in this recent window.
        if (domain.backfillNext >= recentWindowStart(progress, window.domain) && domain.backfillNext <= window.through) {
          domain.backfillThrough = window.through;
          domain.backfillNext = shiftDate(window.through, 1);
        }
      }
    }
    else { domain.backfillThrough = window.through; domain.backfillNext = shiftDate(window.through, 1); }
    const latest = window.domain === "sleep" ? outcome.latestSleepDate : outcome.latestWorkoutDate;
    if (latest && (!domain.latestRecordDate || latest > domain.latestRecordDate)) domain.latestRecordDate = latest;
    domain.created += outcome.created;
    domain.retryAfter = null; domain.lastErrorCode = null;
    progress.conflicts = outcome.totalPendingConflicts;
    progress.lastSuccessAt = now.toISOString(); progress.lastErrorCode = null; progress.failureCount = 0;
    progress.lastBatch = { domain: window.domain, from: window.from, through: window.through,
      created: outcome.created, unchanged: outcome.unchanged, updated: outcome.updated ?? 0, conflicts: outcome.conflicts };
    await db.prepare("UPDATE coros_connections SET last_sync_at = ?1, last_error_code = NULL WHERE github_user_id = ?2 AND state = 'enabled'")
      .bind(now.toISOString(), userId).run();
    return { status: "processed", batch: progress.lastBatch, progress };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // Store only bounded internal codes, never exception payloads, credentials or health bodies.
    const code = /^(?:COROS|GITHUB)_[A-Z_]{1,80}$/u.test(message) ? message : "COROS_SYNC_FAILED";
    progress.lastErrorCode = code; progress.failureCount += 1;
    if (window) {
      progress.domains[window.domain].retryAfter = isoAfter(now, Math.min(120, 10 * 2 ** Math.min(progress.failureCount, 4)) * 60000);
      progress.domains[window.domain].lastErrorCode = code;
    }
    await db.prepare("UPDATE coros_connections SET last_error_code = ?1 WHERE github_user_id = ?2 AND state = 'enabled'")
      .bind(code, userId).run();
    return { status: "error", errorCode: code, retryAt: window ? progress.domains[window.domain].retryAfter : null, progress };
  } finally {
    await db.prepare(`UPDATE coros_sync_jobs SET progress_json = ?1, next_run_at = CASE WHEN request_seq > ?6 THEN ?3 ELSE ?2 END,
      lease_token = NULL, lease_until = NULL, updated_at = ?3 WHERE github_user_id = ?4 AND lease_token = ?5`)
      .bind(JSON.stringify(progress), nextRunAt, now.toISOString(), userId, token, job.request_seq).run();
  }
}
