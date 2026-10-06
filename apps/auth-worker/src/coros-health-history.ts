import { mapCorosDailyHealth, mapCorosRestingHeartRate } from "./coros-health-mapping";
import { corosResultText } from "./coros-sync-mapping";
import type { CorosReadResult, CorosReadTool } from "./coros-read-client";
import { historicalWindow, shiftDate, todayInTimezone, type DomainProgress, type SyncProgress, type SyncWindowFilter } from "./coros-sync-state";

export const COROS_BULK_HEALTH_SOURCES = ["dailyHealth", "restingHeartRate"] as const;
export type BulkHealthSource = typeof COROS_BULK_HEALTH_SOURCES[number];
export type BulkHealthSourceProgress = DomainProgress & { observedDates?: string[]; unconfirmedZeroDates?: string[];
  blockedCode?: "COROS_READ_RESULT_TOO_LARGE" | "COROS_SYNC_HEALTH_RANGE_UNCONFIRMED" };
export type BulkHealthProgress = Record<BulkHealthSource, BulkHealthSourceProgress>;
export type BulkHealthWindow = { domain: "health"; source: BulkHealthSource; recent: boolean; from: string; through: string };

export function initializeBulkHealthProgress(progress: SyncProgress): BulkHealthProgress {
  if (!progress.health) throw new Error("COROS_SYNC_STATE_INVALID");
  const domain = (): DomainProgress => ({ backfillNext: progress.startDate, backfillThrough: null, recentThrough: null,
    lastRecentAt: null, latestRecordDate: null, created: 0 });
  return progress.health.bulk ??= { dailyHealth: domain(), restingHeartRate: domain() };
}

/** Relative-days APIs have their own storage cursors, independent of the rating window. */
export function nextBulkHealthWindow(progress: SyncProgress, now: Date, filter: SyncWindowFilter = {}): BulkHealthWindow | null {
  if (!progress.request) return null;
  const bulk = initializeBulkHealthProgress(progress), through = progress.request.through;
  const available = COROS_BULK_HEALTH_SOURCES.filter(source => (!filter.source || source === filter.source) && !bulk[source].blockedCode && (!bulk[source].retryAfter || bulk[source].retryAfter! <= now.toISOString()))
    .sort((a, b) => Number(a === progress.health?.lastBulkAttemptSource) - Number(b === progress.health?.lastBulkAttemptSource));
  for (const source of available) {
    const d = bulk[source];
    if (filter.recent !== false && d.recentRequestSequence !== progress.request.sequence) return { domain: "health", source, recent: true,
      from: d.recentNext ?? [progress.startDate, shiftDate(through, -6)].sort()[1], through };
  }
  if (filter.recent === true) return null;
  const source = available.filter(source => historicalWindow(progress, bulk[source], now, 28))
    .sort((a, b) => bulk[a].backfillNext.localeCompare(bulk[b].backfillNext))[0];
  if (!source) return null;
  return { domain: "health", source, recent: false, ...historicalWindow(progress, bulk[source], now, 28)! };
}

export async function collectBulkHealthHistory(read: (name: CorosReadTool, args: Record<string, unknown>) => Promise<CorosReadResult>,
  window: BulkHealthWindow, progress: SyncProgress, assertActive: () => Promise<void>, now: Date) {
  const today = todayInTimezone(now, progress.timezone);
  if (window.from < progress.startDate || window.through < window.from || window.through > today) throw new Error("COROS_SYNC_INVALID_DATE");
  // COROS exposes no start/end or pagination here. Request the full relative
  // prefix needed to reach this window, then commit only its bounded dates.
  const days = Math.round((Date.parse(today) - Date.parse(window.from)) / 86400_000) + 1;
  const tool = window.source === "dailyHealth" ? "queryDailyHealthData" : "queryRestingHeartRate";
  const response = await read(tool, { days }); await assertActive();
  const text = corosResultText(response);
  const header = new RegExp(`^${window.source === "dailyHealth" ? "Daily Health Data" : "Resting Heart Rate"} — Last (\\d+) days(?: \\||\\n)`, "u").exec(text);
  if (!header || Number(header[1]) !== days) throw new Error("COROS_SYNC_HEALTH_RANGE_UNCONFIRMED");
  const observedAt = new Date().toISOString();
  const options = { startDate: window.from, endDate: today, timezone: progress.timezone, observedAt };
  const mapped = window.source === "dailyHealth" ? mapCorosDailyHealth(response, options) : mapCorosRestingHeartRate(response, options);
  const items = mapped.filter(item => item.candidate.local_date <= window.through);
  const observedDates = [...new Set(items.map(item => item.candidate.local_date))].sort();
  const unconfirmedZeroDates = window.source === "dailyHealth" ? [...text.matchAll(/^--- (\d{8}) ---\nSteps: 0 \| Calories: 0(?:\.0+)? kcal \| Exercise: (?:0(?:\.0+)? min|0h 0+min)(?:\n|$)/gmu)]
    .map(match => match[1].replace(/^(\d{4})(\d{2})(\d{2})$/u, "$1-$2-$3"))
    .filter(date => date >= window.from && date <= window.through) : [];
  // Empty/sparse windows are checked intervals, never evidence of the account's
  // earliest possible date. The planner continues to the explicit scope end.
  const noDataDates = window.source === "restingHeartRate" ? [...text.matchAll(/^(\d{4}-\d{2}-\d{2}): No data$/gmu)].map(match => match[1])
    .filter(date => date >= window.from && date <= window.through) : [];
  return { items, through: window.through, observedAt, bulkSource: window.source, observedDates, unconfirmedZeroDates, noDataDates,
    limitations: ["日健康与静息心率按各自游标检查全部指定历史范围，90日仅用于评分参照；缺测不补值", "日健康三项均为零时无法证明设备有采样，保持缺测；已检查区间与有证据日期分别记录", "接口仅支持距今N日，已检查区间不等于已证明账号最早日期；接口错误、响应过大或范围不符时保留游标"] };
}
