import { parseWorkspaceDescriptor } from "../../../src/lib/github-data/workspace";
import { refreshEnabledCorosConnection } from "./coros-credentials";
import { callCorosReadTool } from "./coros-read-client";
import { mapCorosSleep, mapCorosWorkouts } from "./coros-sync-mapping";
import { createPrivateDataInstallationAdapter } from "./github-installation";
import { writeCorosSyncBatch } from "./coros-sync-writer";
import { collectCorosHealth, nextHealthSyncWindow } from "./coros-health-sync";
import { writeCorosHealthMetrics } from "./coros-health-writer";
import { COROS_BULK_HEALTH_SOURCES } from "./coros-health-history";
import { advanceHistoricalCoverage, closedHistoryThrough, acceptSyncRequest, nextSyncWindow, parseSyncProgress, readSyncJob, recentWindowStart, shiftDate, todayInTimezone, syncReadiness, type CorosSyncEnv, type SyncProgress } from "./coros-sync-state";

const dependencies = { refresh: refreshEnabledCorosConnection, read: callCorosReadTool,
  adapter: createPrivateDataInstallationAdapter, write: writeCorosSyncBatch, health: collectCorosHealth, writeMetrics: writeCorosHealthMetrics };
export type CorosSyncDependencies = Omit<typeof dependencies, "health" | "writeMetrics"> & Partial<Pick<typeof dependencies, "health" | "writeMetrics">>;
const isoAfter = (now: Date, milliseconds: number) => new Date(now.getTime() + milliseconds).toISOString();
export type CorosSyncRunResult = {
  status: "processed" | "busy" | "complete" | "deferred" | "error";
  progress?: SyncProgress;
  batch?: NonNullable<SyncProgress["lastBatch"]>;
  retryAt?: string | null;
  errorCode?: string;
};
export type CorosDrainResult = CorosSyncRunResult;

function pendingRetry(progress: SyncProgress, now: Date): string | null {
  if (!progress.request) return null;
  const retries = (["sleep", "workout"] as const).filter(domain =>
    progress.domains[domain].recentRequestSequence !== progress.request!.sequence
    || progress.domains[domain].backfillNext <= closedHistoryThrough(progress, now))
    .map(domain => progress.domains[domain].retryAfter ?? null)
    .filter((time): time is string => time !== null);
  if (progress.health?.retryAfter && (progress.health.recentRequestSequence !== progress.request.sequence || progress.health.backfillNext <= closedHistoryThrough(progress, now))) retries.push(progress.health.retryAfter);
  for (const source of COROS_BULK_HEALTH_SOURCES) {
    const d = progress.health?.bulk?.[source];
    if (d?.retryAfter && (d.recentRequestSequence !== progress.request.sequence || d.backfillNext <= closedHistoryThrough(progress, now))) retries.push(d.retryAfter);
  }
  return retries.sort()[0] ?? null;
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
  try { progress = parseSyncProgress(job.progress_json); acceptSyncRequest(progress, job, now); }
  catch {
    await db.prepare("UPDATE coros_connections SET last_error_code = 'COROS_SYNC_STATE_INVALID', state = 'paused' WHERE github_user_id = ?1").bind(userId).run();
    await db.prepare("UPDATE coros_sync_jobs SET lease_token = NULL, lease_until = NULL WHERE github_user_id = ?1 AND lease_token = ?2").bind(userId, token).run();
    return { status: "error", errorCode: "COROS_SYNC_STATE_INVALID" };
  }
  const recordWindow = nextSyncWindow(progress, now);
  const healthWindow = deps.health && deps.writeMetrics ? nextHealthSyncWindow(progress, now) : null;
  const window = recordWindow?.recent ? recordWindow : healthWindow ?? recordWindow;
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
      const retryAt = pendingRetry(progress, now);
      nextRunAt = retryAt ?? isoAfter(now, 30 * 60000);
      const blocked = Object.values(progress.health?.bulk ?? {}).find(source => source.blockedCode);
      if (!retryAt && blocked) return { status: "error", errorCode: blocked.blockedCode, retryAt: null, progress };
      return { status: retryAt ? "deferred" : "complete", retryAt, progress };
    }
    progress.lastAttemptAt = now.toISOString();
    const ready = await deps.refresh(db, userId, env.TOKEN_ENCRYPTION_KEY);
    if (!ready) throw new Error("COROS_SYNC_CANCELLED");
    await assertActive();
    if (window.domain === "health") {
      const collected = await deps.health!((name, args) => deps.read(ready.resourceUrl, ready.accessToken, name, args), window, progress, assertActive, now, env.TOKEN_ENCRYPTION_KEY);
      await assertActive();
      const adapter = await deps.adapter({ appId: env.GITHUB_APP_ID!, installationId: env.GITHUB_APP_INSTALLATION_ID!, privateKeyPem: env.GITHUB_APP_PRIVATE_KEY!, owner: env.ALLOWED_REPO_OWNER!, repository: env.ALLOWED_REPO_NAME! });
      const descriptor = parseWorkspaceDescriptor((await adapter.readText("workspace.json")).text);
      if (descriptor.owner_login !== env.ALLOWED_GITHUB_LOGIN || descriptor.owner_id !== env.COROS_WORKSPACE_OWNER_ID || descriptor.timezone !== progress.timezone) throw new Error("COROS_SYNC_WORKSPACE_MISMATCH");
      const outcome = collected.items.length ? await deps.writeMetrics!(adapter, { ownerId: descriptor.owner_id, items: collected.items, timestamp: collected.observedAt, beforeCommit: assertActive }) : { created: 0, updated: 0, unchanged: 0 };
      await assertActive();
      const health = progress.health!;
      const domain = collected.bulkSource ? health.bulk![collected.bulkSource] : health;
      if (collected.bulkSource) {
        const bulk = health.bulk![collected.bulkSource];
        bulk.observedDates = [...new Set([...(bulk.observedDates ?? []), ...collected.observedDates])].sort();
        const confirmed = new Set(bulk.observedDates);
        bulk.unconfirmedZeroDates = [...new Set([...(bulk.unconfirmedZeroDates ?? []), ...collected.unconfirmedZeroDates])].filter(date => !confirmed.has(date)).sort();
        if (window.recent) {
          domain.recentThrough = collected.through;
          domain.recentNext = collected.through < progress.request!.through ? shiftDate(collected.through, 1) : null;
          if (!domain.recentNext) { domain.recentRequestSequence = progress.request!.sequence; domain.lastRecentAt = collected.observedAt; }
          advanceHistoricalCoverage(progress, domain, window.from, collected.through, now);
        } else { advanceHistoricalCoverage(progress, domain, window.from, collected.through, now); }
      } else if (collected.activityError) {
        // A pending activity source never discards verified bulk/HRV facts or
        // advances the common coverage checkpoint. Encrypted details resume later.
        if (window.recent) { health.recentDataThrough = todayInTimezone(new Date(collected.observedAt), progress.timezone); domain.recentNext = window.from; }
      } else if (window.recent) {
        health.recentDataThrough = todayInTimezone(new Date(collected.observedAt), progress.timezone);
        domain.recentThrough = collected.through;
        domain.recentNext = collected.through < progress.request!.through ? shiftDate(collected.through, 1) : null;
        if (!domain.recentNext) { domain.recentRequestSequence = progress.request!.sequence; domain.lastRecentAt = collected.observedAt; }
        advanceHistoricalCoverage(progress, domain, window.from, collected.through, now);
      } else { advanceHistoricalCoverage(progress, domain, window.from, collected.through, now); }
      domain.created += outcome.created; health.limitations = collected.limitations;
      domain.retryAfter = collected.activityError ? isoAfter(now, 10 * 60000) : null; domain.lastErrorCode = collected.activityError ?? null;
      domain.latestRecordDate = [domain.latestRecordDate, ...collected.items.map(item => item.candidate.local_date)].filter((value): value is string => value !== null).sort().at(-1) ?? null;
      progress.lastSuccessAt = collected.observedAt; progress.lastErrorCode = collected.activityError ?? null; progress.failureCount = 0;
      progress.lastBatch = { domain: "health", from: window.from, through: collected.through, ...outcome, conflicts: 0 };
      await db.prepare("UPDATE coros_connections SET last_sync_at = ?1, last_error_code = ?2 WHERE github_user_id = ?3 AND state = 'enabled'").bind(collected.observedAt, collected.activityError ?? null, userId).run();
      return { status: "processed", batch: progress.lastBatch, progress };
    }
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
        advanceHistoricalCoverage(progress, domain, recentWindowStart(progress, window.domain), window.through, now);
      }
    }
    else { advanceHistoricalCoverage(progress, domain, window.from, window.through, now); }
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
      const domain = window.domain === "health" ? window.source ? progress.health!.bulk![window.source] : progress.health! : progress.domains[window.domain];
      domain.retryAfter = isoAfter(now, Math.min(120, 10 * 2 ** Math.min(progress.failureCount, 4)) * 60000);
      domain.lastErrorCode = code;
      if (window.domain === "health" && window.source && ["COROS_READ_RESULT_TOO_LARGE", "COROS_SYNC_HEALTH_RANGE_UNCONFIRMED"].includes(code)) {
        // Repeating the same relative prefix cannot repair a capacity/range
        // boundary. Stop this source until an explicit paused history reset.
        const bulk = progress.health!.bulk![window.source];
        bulk.blockedCode = code as NonNullable<typeof bulk.blockedCode>;
        bulk.retryAfter = null;
      }
    }
    await db.prepare("UPDATE coros_connections SET last_error_code = ?1 WHERE github_user_id = ?2 AND state = 'enabled'")
      .bind(code, userId).run();
    return { status: "error", errorCode: code, retryAt: window ? (window.domain === "health" ? window.source ? progress.health!.bulk![window.source] : progress.health! : progress.domains[window.domain]).retryAfter : null, progress };
  } finally {
    await db.prepare(`UPDATE coros_sync_jobs SET progress_json = ?1, next_run_at = CASE WHEN request_seq > ?6 THEN ?3 ELSE ?2 END,
      lease_token = NULL, lease_until = NULL, updated_at = ?3 WHERE github_user_id = ?4 AND lease_token = ?5`)
      .bind(JSON.stringify(progress), nextRunAt, now.toISOString(), userId, token, job.request_seq).run();
  }
}
