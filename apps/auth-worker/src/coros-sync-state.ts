import type { AuthEnv, D1DatabaseLike } from "./auth";

export type CorosSyncEnv = AuthEnv & {
  GITHUB_APP_ID?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  COROS_GITHUB_USER_ID?: string;
  COROS_SYNC_TIMEZONE?: string;
  COROS_WORKSPACE_OWNER_ID?: string;
};
export type SyncDomain = "sleep" | "workout";
export type DomainProgress = {
  backfillNext: string; backfillThrough: string | null; recentThrough: string | null;
  lastRecentAt: string | null; latestRecordDate: string | null; created: number;
  recentNext?: string | null; retryAfter?: string | null; lastErrorCode?: string | null;
};
export type SyncProgress = {
  version: 1; startDate: string; timezone: string;
  domains: Record<SyncDomain, DomainProgress>;
  lastAttemptAt: string | null; lastSuccessAt: string | null; lastErrorCode: string | null;
  failureCount: number; conflicts: number;
  lastBatch: { domain: SyncDomain; from: string; through: string; created: number; unchanged: number; conflicts: number } | null;
};
export type SyncJob = { progress_json: string; lease_token: string | null; lease_until: string | null; next_run_at: string };

export function syncReadiness(env: CorosSyncEnv) {
  const missing: string[] = [];
  for (const key of ["GITHUB_APP_ID", "GITHUB_APP_INSTALLATION_ID", "GITHUB_APP_PRIVATE_KEY", "COROS_GITHUB_USER_ID", "COROS_WORKSPACE_OWNER_ID"] as const) {
    if (!env[key]?.trim()) missing.push(key);
  }
  return { ready: missing.length === 0, missing, intervalMinutes: 120, backfillIntervalMinutes: 10 };
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
export function todayInTimezone(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
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
  todayInTimezone(new Date(), p.timezone);
  for (const domain of ["sleep", "workout"] as const) {
    if (!p.domains[domain] || !dateOnly(p.domains[domain].backfillNext)) throw new Error("COROS_SYNC_STATE_INVALID");
  }
  return p;
}
export async function readSyncJob(db: D1DatabaseLike, userId: string) {
  return db.prepare("SELECT progress_json, lease_token, lease_until, next_run_at FROM coros_sync_jobs WHERE github_user_id = ?1")
    .bind(userId).first<SyncJob>();
}

/** Recent records are always pulled first, so historical backfill cannot delay today's sleep. */
export function nextSyncWindow(p: SyncProgress, now: Date) {
  const today = todayInTimezone(now, p.timezone);
  for (const domain of ["sleep", "workout"] as const) {
    const d = p.domains[domain];
    if (d.retryAfter && d.retryAfter > now.toISOString()) continue;
    if (!d.lastRecentAt || now.getTime() - Date.parse(d.lastRecentAt) >= 2 * 3600000) {
      // Live sleep responses can silently cap date ranges to the final three days.
      return { domain, recent: true, from: d.recentNext ?? shiftDate(today, domain === "sleep" ? -2 : -6), through: today };
    }
  }
  const domain = (["sleep", "workout"] as const).filter((key) => p.domains[key].backfillNext <= today
    && (!p.domains[key].retryAfter || p.domains[key].retryAfter! <= now.toISOString()))
    .sort((a, b) => p.domains[a].backfillNext.localeCompare(p.domains[b].backfillNext))[0];
  if (!domain) return null;
  const from = p.domains[domain].backfillNext;
  return { domain, recent: false, from, through: [shiftDate(from, 2), today].sort()[0] };
}
