import type { CorosReadTool, CorosReadResult } from "./coros-read-client";
import { corosResultText } from "./coros-sync-mapping";
import { mapCorosRecovery, mapCorosSleepHrv, type CorosHealthMetricItem } from "./coros-health-mapping";
import { closedHistoryThrough, shiftDate, todayInTimezone, type DomainProgress, type SyncProgress, type SyncWindowFilter } from "./coros-sync-state";
import { collectCorosActivityTotals } from "./coros-health-activity";
import { collectBulkHealthHistory, nextBulkHealthWindow, type BulkHealthProgress, type BulkHealthSource, type BulkHealthWindow } from "./coros-health-history";

export type HealthSyncProgress = DomainProgress & { recentDataThrough?: string; recentObservationSequence?: number; limitations?: string[]; encryptedActivityCache?: string; bulk?: BulkHealthProgress;
  lastAttemptSource?: "hrvActivity" | BulkHealthSource; lastBulkAttemptSource?: BulkHealthSource };
export type HealthSyncWindow = { domain: "health"; source?: undefined; recent: boolean; from: string; through: string } | BulkHealthWindow;
export function nextHealthSyncWindow(progress: SyncProgress, now: Date, filter: SyncWindowFilter = {}): HealthSyncWindow | null {
  if (!progress.request) return null;
  progress.health ??= { backfillNext: progress.startDate, backfillThrough: null, recentThrough: null, lastRecentAt: null, latestRecordDate: null, created: 0 };
  const d = progress.health, through = progress.request.through;
  const available = (!filter.source || filter.source === "hrvActivity") && (!d.retryAfter || d.retryAfter <= now.toISOString());
  const recent: HealthSyncWindow | null = filter.recent !== false && available && d.recentRequestSequence !== progress.request.sequence ? { domain: "health", recent: true,
    from: d.recentNext ?? [progress.startDate, shiftDate(through, -6)].sort()[1], through } : null;
  const bulk = nextBulkHealthWindow(progress, now, filter);
  // A pending recent activity window retries on the same ten-minute rhythm as
  // cron. Give independent bulk sources a turn after every common attempt,
  // including failed/pending attempts, instead of letting that retry gate them.
  if (bulk && d.lastAttemptSource === "hrvActivity") return bulk;
  if (recent) return recent;
  if (bulk?.recent) return bulk;
  if (filter.recent === true) return null;
  const historyThrough = closedHistoryThrough(progress, now);
  const history = available && d.backfillNext <= historyThrough ? { domain: "health" as const, recent: false, from: d.backfillNext, through: [shiftDate(d.backfillNext, 6), historyThrough].sort()[0] } : null;
  return bulk && (!history || bulk.from <= history.from) ? bulk : history;
}

type Read = (name: CorosReadTool, args: Record<string, unknown>) => Promise<CorosReadResult>;
export async function collectCorosHealth(read: Read, window: HealthSyncWindow, progress: SyncProgress, assertActive: () => Promise<void>, now = new Date(), encryptionKey?: string, checkpoint?: () => Promise<void>) {
  if (window.source) return { ...await collectBulkHealthHistory(read, window, progress, assertActive, now), activityError: undefined };
  const observedAt = () => new Date().toISOString();
  const options = (from: string, through: string) => ({ startDate: from, endDate: through, timezone: progress.timezone, observedAt: observedAt() });
  const items: CorosHealthMetricItem[] = [];
  const limitations = ["恢复仅提供当前时点，不回填历史", "缺测保留；今天的活动总量尚未结束，不进入个人基线", "爬升与训练负荷按完整活动列表、逐项详情汇总，归属活动开始的本地日期；跨午夜不按比例拆分"];
  // Recovery is current-only. Daily/RHR use independent resumable history cursors.
  if (window.recent && !progress.health?.recentNext) {
    const recovery = await read("queryRecoveryStatus", {}); await assertActive();
    items.push(...mapCorosRecovery(recovery, options(window.from, todayInTimezone(now, progress.timezone))));
  }
  let through = window.through;
  for (;;) {
    const response = await read("querySleepHrv", { days: 7, startDate: window.from.replaceAll("-", ""), endDate: through.replaceAll("-", "") }); await assertActive();
    const text = corosResultText(response);
    const emptySingleDay = window.from === through && new RegExp(`^Sleep HRV — ${through}\\n=+\\nNote: dates are wake-up days \\(each value comes from the night that ended that morning\\)\\.\\n\\nNo data found in the last 1 days\\.\\n\\nNo sleep HRV time series data found in the last 1 days\\.$`, "u").test(text);
    let hrv: CorosHealthMetricItem[];
    try { hrv = emptySingleDay ? [] : mapCorosSleepHrv(response, options(window.from, through)); }
    catch (error) {
      if (window.from === through || !(error instanceof Error) || error.message !== "COROS_SYNC_HEALTH_FORMAT_UNSUPPORTED") throw error;
      through = window.from; continue;
    }
    const dates = new Set(hrv.map(item => item.candidate.local_date));
    const expected = Math.round((Date.parse(through) - Date.parse(window.from)) / 86400000) + 1;
    if (emptySingleDay || dates.size === expected) { items.push(...hrv); break; }
    if (window.from === through) throw new Error("COROS_SYNC_HEALTH_WINDOW_INCOMPLETE");
    through = window.from; // Never advance past silently omitted days.
  }
  let activityError: string | undefined;
  try {
    const activity = await collectCorosActivityTotals(read, window.from, through, progress, assertActive, observedAt(), encryptionKey, checkpoint);
    // Both domains must cover the same checkpoint; a narrowed list cannot advance HRV past it.
    through = activity.through; items.push(...activity.items);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (!["COROS_SYNC_ACTIVITY_DETAILS_PENDING", "COROS_SYNC_WINDOW_TRUNCATED", "COROS_SYNC_FORMAT_UNSUPPORTED",
      "COROS_SYNC_HEALTH_DETAIL_FORMAT_UNSUPPORTED", "COROS_SYNC_HEALTH_DETAIL_MISMATCH", "COROS_READ_TOOL_UNAVAILABLE"].includes(code)) throw error;
    activityError = code;
    limitations.push(`活动汇总尚未完成（${code}）；其他已验证指标保留，活动覆盖进度不前移`);
  }
  return { items: items.filter(item => item.candidate.local_date <= through || item.candidate.metric_type === "recovery_percentage"), through, observedAt: observedAt(), limitations, activityError, bulkSource: undefined, observedDates: [], unconfirmedZeroDates: [] };
}
