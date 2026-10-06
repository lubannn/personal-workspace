import { historicalWindow, parseSyncProgress, readSyncJob, syncProgressDomains, todayInTimezone, type CorosSyncEnv } from "./coros-sync-state";

/** One regular observation at 08:00 local time after the initial backfill.
 * The ten-minute dispatcher only continues an existing request between observations. */
export async function queueScheduledCorosDailySync(env: CorosSyncEnv, now = new Date()) {
  if (!env.DB || !env.COROS_GITHUB_USER_ID) return false;
  const timezone = env.COROS_SYNC_TIMEZONE ?? "Asia/Shanghai";
  const hour = Number(new Intl.DateTimeFormat("en", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(now));
  if (hour < 8) return false;
  const job = await readSyncJob(env.DB, env.COROS_GITHUB_USER_ID);
  if (!job) return false;
  const today = todayInTimezone(now, timezone);
  if (job.daily_requested_date && job.daily_requested_date >= today) return false;
  const progress = parseSyncProgress(job.progress_json);
  if (!progress.request || !progress.health?.activity || !progress.health.bulk
    || syncProgressDomains(progress).some(domain => historicalWindow(progress, domain, now, 1))) return false;
  const queued = await env.DB.prepare(`UPDATE coros_sync_jobs SET request_seq = request_seq + 1,
    requested_through = MAX(COALESCE(requested_through, ?1), ?1), daily_requested_date = ?1,
    next_run_at = ?2, updated_at = ?2 WHERE github_user_id = ?3
    AND (daily_requested_date IS NULL OR daily_requested_date < ?1)
    AND EXISTS (SELECT 1 FROM coros_connections WHERE github_user_id = ?3 AND state = 'enabled')`)
    .bind(today, now.toISOString(), env.COROS_GITHUB_USER_ID).run();
  if (!queued.success) throw new Error("COROS_SYNC_QUEUE_FAILED");
  return queued.meta?.changes === 1;
}
