import { parseWorkspaceDescriptor } from "../../../src/lib/github-data/workspace";
import { refreshEnabledCorosConnection } from "./coros-credentials";
import { callCorosReadTool } from "./coros-read-client";
import { mapCorosSleep, mapCorosWorkouts } from "./coros-sync-mapping";
import { createPrivateDataInstallationAdapter } from "./github-installation";
import { writeCorosSyncBatch } from "./coros-sync-writer";
import { nextSyncWindow, parseSyncProgress, readSyncJob, shiftDate, syncReadiness, todayInTimezone, type CorosSyncEnv } from "./coros-sync-state";

const dependencies = { refresh: refreshEnabledCorosConnection, read: callCorosReadTool,
  adapter: createPrivateDataInstallationAdapter, write: writeCorosSyncBatch };
export type CorosSyncDependencies = typeof dependencies;
const isoAfter = (now: Date, milliseconds: number) => new Date(now.getTime() + milliseconds).toISOString();

/** Invoked by the Cloudflare scheduler, never an unauthenticated HTTP endpoint. */
export async function runCorosSync(env: CorosSyncEnv, now = new Date(), deps: CorosSyncDependencies = dependencies): Promise<void> {
  if (!env.DB || !env.TOKEN_ENCRYPTION_KEY || !syncReadiness(env).ready) return;
  const db = env.DB; const userId = env.COROS_GITHUB_USER_ID!;
  const connection = await db.prepare("SELECT state, connected_at FROM coros_connections WHERE github_user_id = ?1")
    .bind(userId).first<{ state: string; connected_at: string }>();
  if (connection?.state !== "enabled") return;
  const connectedAt = connection.connected_at;
  const token = crypto.randomUUID();
  const claimed = await db.prepare(`UPDATE coros_sync_jobs SET lease_token = ?1, lease_until = ?2
    WHERE github_user_id = ?3 AND next_run_at <= ?4 AND (lease_until IS NULL OR lease_until <= ?4)
    AND EXISTS (SELECT 1 FROM coros_connections WHERE github_user_id = ?3 AND state = 'enabled')`)
    .bind(token, isoAfter(now, 10 * 60000), userId, now.toISOString()).run();
  if (!claimed.success || claimed.meta?.changes !== 1) return;
  const job = await readSyncJob(db, userId);
  if (!job || job.lease_token !== token) return;
  let progress;
  try { progress = parseSyncProgress(job.progress_json); }
  catch {
    await db.prepare("UPDATE coros_connections SET last_error_code = 'COROS_SYNC_STATE_INVALID', state = 'paused' WHERE github_user_id = ?1").bind(userId).run();
    await db.prepare("UPDATE coros_sync_jobs SET lease_token = NULL, lease_until = NULL WHERE github_user_id = ?1 AND lease_token = ?2").bind(userId, token).run();
    return;
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
    if (!window) { nextRunAt = isoAfter(now, 30 * 60000); return; }
    progress.lastAttemptAt = now.toISOString();
    const ready = await deps.refresh(db, userId, env.TOKEN_ENCRYPTION_KEY);
    if (!ready) throw new Error("COROS_SYNC_CANCELLED");
    await assertActive();
    const range = { startDate: window.from, endDate: window.through, timezone: progress.timezone };
    const args = { startDate: window.from.replaceAll("-", ""), endDate: window.through.replaceAll("-", "") };
    let mapped;
    if (window.domain === "sleep") {
      let result;
      try { result = await deps.read(ready.resourceUrl, ready.accessToken, "querySleepOverview", args); }
      catch (error) {
        if (!(error instanceof Error) || error.message !== "COROS_READ_TOOL_UNAVAILABLE") throw error;
        result = await deps.read(ready.resourceUrl, ready.accessToken, "querySleepData", args);
      }
      mapped = mapCorosSleep(result, range);
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
    const adapter = await deps.adapter({ appId: env.GITHUB_APP_ID!, installationId: env.GITHUB_APP_INSTALLATION_ID!,
      privateKeyPem: env.GITHUB_APP_PRIVATE_KEY!, owner: env.ALLOWED_REPO_OWNER!, repository: env.ALLOWED_REPO_NAME! });
    const descriptor = parseWorkspaceDescriptor((await adapter.readText("workspace.json")).text);
    if (descriptor.owner_login !== env.ALLOWED_GITHUB_LOGIN || descriptor.owner_id !== env.COROS_WORKSPACE_OWNER_ID || descriptor.timezone !== progress.timezone) {
      throw new Error("COROS_SYNC_WORKSPACE_MISMATCH");
    }
    const outcome = await deps.write(adapter, { ownerId: descriptor.owner_id, items: mapped.items,
      timestamp: now.toISOString(), beforeCommit: assertActive });
    await assertActive();
    const domain = progress.domains[window.domain];
    if (window.recent) {
      domain.recentThrough = window.through;
      domain.recentNext = window.through < todayInTimezone(now, progress.timezone) ? shiftDate(window.through, 1) : null;
      if (!domain.recentNext) domain.lastRecentAt = now.toISOString();
    }
    else { domain.backfillThrough = window.through; domain.backfillNext = shiftDate(window.through, 1); }
    const latest = window.domain === "sleep" ? outcome.latestSleepDate : outcome.latestWorkoutDate;
    if (latest && (!domain.latestRecordDate || latest > domain.latestRecordDate)) domain.latestRecordDate = latest;
    domain.created += outcome.created;
    domain.retryAfter = null; domain.lastErrorCode = null;
    progress.conflicts = outcome.totalPendingConflicts;
    progress.lastSuccessAt = now.toISOString(); progress.lastErrorCode = null; progress.failureCount = 0;
    progress.lastBatch = { domain: window.domain, from: window.from, through: window.through,
      created: outcome.created, unchanged: outcome.unchanged, conflicts: outcome.conflicts };
    await db.prepare("UPDATE coros_connections SET last_sync_at = ?1, last_error_code = NULL WHERE github_user_id = ?2 AND state = 'enabled'")
      .bind(now.toISOString(), userId).run();
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
  } finally {
    await db.prepare(`UPDATE coros_sync_jobs SET progress_json = ?1, next_run_at = ?2,
      lease_token = NULL, lease_until = NULL, updated_at = ?3 WHERE github_user_id = ?4 AND lease_token = ?5`)
      .bind(JSON.stringify(progress), nextRunAt, now.toISOString(), userId, token).run();
  }
}
