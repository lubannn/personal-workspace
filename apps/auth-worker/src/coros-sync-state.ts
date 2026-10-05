import type { AuthEnv, D1DatabaseLike } from "./auth";
import type { HealthSyncProgress } from "./coros-health-sync";
import type { BulkHealthSource } from "./coros-health-history";

export type CorosSyncEnv = AuthEnv & {
  GITHUB_APP_ID?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  COROS_GITHUB_USER_ID?: string;
  COROS_SYNC_TIMEZONE?: string;
  COROS_WORKSPACE_OWNER_ID?: string;
};
export type SyncDomain = "sleep" | "workout";
export const COROS_SYNC_SOURCES = ["sleep", "workout", "hrvActivity", "dailyHealth", "restingHeartRate"] as const;
export type SyncSource = typeof COROS_SYNC_SOURCES[number];
export type SyncWindowFilter = { recent?: boolean; source?: SyncSource };
export const COROS_SYNC_ERROR_STAGES = ["progress_checkpoint", "credentials_refresh", "health_collect", "records_collect",
  "github_adapter", "workspace_read", "workspace_validate", "health_write", "records_write", "coverage_checkpoint",
  "querySportRecords", "getActivityDetail", "querySleepData", "querySleepOverview", "queryAvgHeartRate",
  "queryRestingHeartRate", "queryDailyHealthData", "querySleepHrv", "queryRecoveryStatus", "queryStressLevel"] as const;
export type SyncErrorStage = typeof COROS_SYNC_ERROR_STAGES[number];
export type CheckedRange = { from: string; through: string };
export type DomainProgress = {
  backfillNext: string; backfillThrough: string | null; recentThrough: string | null;
  lastRecentAt: string | null; latestRecordDate: string | null; created: number;
  recentNext?: string | null; retryAfter?: string | null; lastErrorCode?: string | null; lastErrorStage?: SyncErrorStage | null;
  recentRequestSequence?: number;
  /** Successful, persisted checks only; absent in legacy state. Never drives sync cursors. */
  checkedRanges?: CheckedRange[];
};
export type SyncProgress = {
  version: 1; startDate: string; timezone: string;
  backfillEnd?: string;
  scheduling?: { lastKind: "recent" | "history"; recentSource?: SyncSource; historySource?: SyncSource };
  request?: { sequence: number; through: string; historyThrough?: string };
  domains: Record<SyncDomain, DomainProgress>;
  health?: HealthSyncProgress;
  lastAttemptAt: string | null; lastSuccessAt: string | null; lastErrorCode: string | null;
  lastErrorStage?: SyncErrorStage | null;
  failureCount: number; conflicts: number;
  lastBatch: { domain: SyncDomain | "health"; from: string; through: string; created: number; unchanged: number; updated?: number; conflicts: number } | null;
};
export type SyncJob = { progress_json: string; lease_token: string | null; lease_until: string | null; next_run_at: string;
  request_seq: number; requested_through: string | null; daily_requested_date: string | null };

export function syncReadiness(env: CorosSyncEnv) {
  const missing: string[] = [];
  for (const key of ["GITHUB_APP_ID", "GITHUB_APP_INSTALLATION_ID", "GITHUB_APP_PRIVATE_KEY", "COROS_GITHUB_USER_ID", "COROS_WORKSPACE_OWNER_ID"] as const) {
    if (!env[key]?.trim()) missing.push(key);
  }
  return { ready: missing.length === 0, missing, trigger: "daily_first_login" as const, backfillIntervalMinutes: 10 };
}

export function dateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function shiftDate(value: string, days: number): string {
  if (!dateOnly(value)) throw new Error("COROS_SYNC_INVALID_DATE");
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
/** Preserve gaps, merging only overlapping or adjacent verified windows. */
export function recordCheckedRange(domain: DomainProgress, from: string, through: string) {
  if (!dateOnly(from) || !dateOnly(through) || from > through) throw new Error("COROS_SYNC_INVALID_DATE");
  const ranges = [...(domain.checkedRanges ?? []), { from, through }].sort((a, b) => a.from.localeCompare(b.from));
  const merged: CheckedRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.from <= shiftDate(previous.through, 1)) {
      previous.through = [previous.through, range.through].sort()[1];
    } else merged.push({ ...range });
  }
  domain.checkedRanges = merged;
}
export function todayInTimezone(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
/** Historical coverage ends at the last finished local date; recent observations may include today. */
export function closedHistoryThrough(p: SyncProgress, now: Date): string {
  return [p.request!.historyThrough ?? p.request!.through, shiftDate(todayInTimezone(now, p.timezone), -1)].sort()[0];
}
export function advanceHistoricalCoverage(p: SyncProgress, domain: DomainProgress, from: string, through: string, now: Date) {
  const closedThrough = [through, closedHistoryThrough(p, now)].sort()[0];
  if (domain.backfillNext >= from && domain.backfillNext <= closedThrough) {
    domain.backfillThrough = closedThrough; domain.backfillNext = shiftDate(closedThrough, 1);
  }
}
export function initialSyncProgress(startDate: string, timezone: string): SyncProgress {
  if (!dateOnly(startDate)) throw new Error("COROS_SYNC_INVALID_DATE");
  todayInTimezone(new Date(), timezone);
  const domain = (): DomainProgress => ({ backfillNext: startDate, backfillThrough: null, recentThrough: null,
    lastRecentAt: null, latestRecordDate: null, created: 0 });
  return { version: 1, startDate, timezone, domains: { sleep: domain(), workout: domain() },
    lastAttemptAt: null, lastSuccessAt: null, lastErrorCode: null, failureCount: 0, conflicts: 0, lastBatch: null };
}
export function parseSyncProgress(text: string): SyncProgress {
  const p = JSON.parse(text) as SyncProgress;
  if (p.version !== 1 || !dateOnly(p.startDate) || !p.domains || !Number.isInteger(p.failureCount)) throw new Error("COROS_SYNC_STATE_INVALID");
  if (p.lastErrorStage !== undefined && p.lastErrorStage !== null && !COROS_SYNC_ERROR_STAGES.includes(p.lastErrorStage)) throw new Error("COROS_SYNC_STATE_INVALID");
  todayInTimezone(new Date(), p.timezone);
  if (p.scheduling !== undefined && (!p.scheduling || typeof p.scheduling !== "object" || Array.isArray(p.scheduling) || !["recent", "history"].includes(p.scheduling.lastKind)
    || [p.scheduling.recentSource, p.scheduling.historySource].some(source => source !== undefined && !COROS_SYNC_SOURCES.includes(source)))) throw new Error("COROS_SYNC_STATE_INVALID");
  if (p.backfillEnd && !dateOnly(p.backfillEnd)) throw new Error("COROS_SYNC_STATE_INVALID");
  if (p.request && (!Number.isSafeInteger(p.request.sequence) || p.request.sequence < 1 || !dateOnly(p.request.through))) throw new Error("COROS_SYNC_STATE_INVALID");
  if (p.request?.historyThrough && (!dateOnly(p.request.historyThrough) || p.request.historyThrough > p.request.through)) throw new Error("COROS_SYNC_STATE_INVALID");
  for (const domain of ["sleep", "workout"] as const) {
    if (!p.domains[domain] || !dateOnly(p.domains[domain].backfillNext)) throw new Error("COROS_SYNC_STATE_INVALID");
  }
  if (p.health && (!dateOnly(p.health.backfillNext) || (p.health.recentDataThrough && !dateOnly(p.health.recentDataThrough)))) throw new Error("COROS_SYNC_STATE_INVALID");
  if (p.health?.recentObservationSequence !== undefined && (!Number.isSafeInteger(p.health.recentObservationSequence) || p.health.recentObservationSequence < 1)) throw new Error("COROS_SYNC_STATE_INVALID");
  if (p.health?.lastAttemptSource && !["hrvActivity", "dailyHealth", "restingHeartRate"].includes(p.health.lastAttemptSource)) throw new Error("COROS_SYNC_STATE_INVALID");
  if (p.health?.lastBulkAttemptSource && !["dailyHealth", "restingHeartRate"].includes(p.health.lastBulkAttemptSource)) throw new Error("COROS_SYNC_STATE_INVALID");
  if (p.health?.bulk) for (const source of ["dailyHealth", "restingHeartRate"] as const) {
    const d = p.health.bulk[source];
    if (!d || !dateOnly(d.backfillNext) || d.backfillNext < p.startDate
      || (d.backfillThrough !== null && !dateOnly(d.backfillThrough)) || (d.recentNext && !dateOnly(d.recentNext))) throw new Error("COROS_SYNC_STATE_INVALID");
    for (const dates of [d.observedDates, d.unconfirmedZeroDates]) if (dates && (!Array.isArray(dates) || dates.length > 20_000
      || dates.some(date => !dateOnly(date) || date < p.startDate) || new Set(dates).size !== dates.length)) throw new Error("COROS_SYNC_STATE_INVALID");
    if (d.blockedCode && !["COROS_READ_RESULT_TOO_LARGE", "COROS_SYNC_HEALTH_RANGE_UNCONFIRMED"].includes(d.blockedCode)) throw new Error("COROS_SYNC_STATE_INVALID");
  }
  for (const d of [...Object.values(p.domains), ...(p.health ? [p.health] : []), ...Object.values(p.health?.bulk ?? {})]) {
    if (d.checkedRanges !== undefined && (!Array.isArray(d.checkedRanges) || d.checkedRanges.length > 20_000
      || d.checkedRanges.some((range, index, ranges) => !range || !dateOnly(range.from) || !dateOnly(range.through)
        || range.from > range.through || (index > 0 && range.from <= shiftDate(ranges[index - 1].through, 1))))) throw new Error("COROS_SYNC_STATE_INVALID");
    if (d.lastErrorStage !== undefined && d.lastErrorStage !== null && !COROS_SYNC_ERROR_STAGES.includes(d.lastErrorStage)) throw new Error("COROS_SYNC_STATE_INVALID");
  }
  return p;
}
export async function readSyncJob(db: D1DatabaseLike, userId: string) {
  return db.prepare("SELECT progress_json, lease_token, lease_until, next_run_at, request_seq, requested_through, daily_requested_date FROM coros_sync_jobs WHERE github_user_id = ?1")
    .bind(userId).first<SyncJob>();
}

/** A request is independent of worker progress, so login cannot overwrite an in-flight batch. */
export function acceptSyncRequest(p: SyncProgress, job: Pick<SyncJob, "request_seq" | "requested_through">, now = new Date()) {
  if (job.request_seq < 1 || !job.requested_through) return;
  if (!dateOnly(job.requested_through) || job.requested_through < p.startDate) throw new Error("COROS_SYNC_STATE_INVALID");
  p.backfillEnd ??= [job.requested_through, shiftDate(todayInTimezone(now, p.timezone), -1)].sort()[0];
  if (p.request && p.request.sequence >= job.request_seq) return;
  const previous = p.request;
  if (p.health) {
    const resuming = previous?.through === job.requested_through && p.health.recentRequestSequence !== previous.sequence;
    p.health.recentObservationSequence = resuming ? p.health.recentObservationSequence ?? previous.sequence : job.request_seq;
  }
  p.request = { sequence: job.request_seq, through: job.requested_through,
    historyThrough: [job.requested_through, shiftDate(todayInTimezone(now, p.timezone), -1)].sort()[0] };
  for (const d of [...Object.values(p.domains), ...(p.health ? [p.health] : []), ...Object.values(p.health?.bulk ?? {})]) {
    // A same-day refresh must resume unfinished recent work, including source
    // backoff. Completed sources may refresh; a new date rechecks recent overlap.
    if (previous?.through !== job.requested_through || d.recentRequestSequence === previous.sequence) d.recentNext = null;
  }
}

/** Invoke only while paused, then persist with a lease/state compare-and-swap. */
export function extendSyncHistory(p: SyncProgress, startDate: string, retryBlockedSources: readonly BulkHealthSource[] = []) {
  if (!dateOnly(startDate) || startDate < "2000-01-01" || startDate > p.startDate) throw new Error("COROS_SYNC_INVALID_DATE");
  // Editing the date never silently resumes a source blocked by capacity/range.
  for (const source of retryBlockedSources) {
    const d = p.health?.bulk?.[source];
    if (d) { delete d.blockedCode; d.retryAfter = null; }
  }
  if (startDate === p.startDate) return;
  p.startDate = startDate;
  const domains: DomainProgress[] = [...Object.values(p.domains), ...(p.health ? [p.health] : []), ...Object.values(p.health?.bulk ?? {})];
  for (const d of domains) {
    d.backfillNext = startDate; d.backfillThrough = null; d.retryAfter = null;
    // New scope does not erase committed records, provenance, counters or recent checkpoints.
  }
}

export function recentWindowStart(p: SyncProgress, domain: SyncDomain) {
  return [p.startDate, shiftDate(p.request!.through, domain === "sleep" ? -2 : -6)].sort()[1];
}

/** No wall-clock recurrence: cron drains only previously requested ranges. */
export function nextSyncWindow(p: SyncProgress, now: Date, filter: SyncWindowFilter = {}) {
  if (!p.request) return null;
  const through = p.request.through;
  for (const domain of ["sleep", "workout"] as const) {
    const d = p.domains[domain];
    if (filter.recent === false || (filter.source && domain !== filter.source) || (d.retryAfter && d.retryAfter > now.toISOString())) continue;
    if (d.recentRequestSequence !== p.request.sequence) {
      // Live sleep responses can silently cap date ranges to the final three days.
      return { domain, recent: true, from: d.recentNext ?? recentWindowStart(p, domain), through };
    }
  }
  if (filter.recent === true) return null;
  const historyThrough = closedHistoryThrough(p, now);
  const domain = (["sleep", "workout"] as const).filter((key) => (!filter.source || key === filter.source) && p.domains[key].backfillNext <= historyThrough
    && (!p.domains[key].retryAfter || p.domains[key].retryAfter! <= now.toISOString()))
    .sort((a, b) => p.domains[a].backfillNext.localeCompare(p.domains[b].backfillNext))[0];
  if (!domain) return null;
  const from = p.domains[domain].backfillNext;
  // Workout summaries are sparse and the caller halves windows that hit the result cap.
  // Sleep responses have an observed three-day cap and must keep their smaller window.
  return { domain, recent: false, from, through: [shiftDate(from, domain === "workout" ? 29 : 2), historyThrough].sort()[0] };
}
