import type { CorosReadTool, CorosReadResult } from "./coros-read-client";
import { corosResultText } from "./coros-sync-mapping";
import { mapCorosRecovery, parseCorosSleepHrvAssessment, type CorosHealthMetricItem } from "./coros-health-mapping";
import { closedHistoryThrough, initializeActivityProgress, shiftDate, todayInTimezone, type DomainProgress, type SyncProgress, type SyncWindowFilter } from "./coros-sync-state";
import { collectCorosActivityTotals } from "./coros-health-activity";
import { collectBulkHealthHistory, nextBulkHealthWindow, type BulkHealthProgress, type BulkHealthSource, type BulkHealthWindow } from "./coros-health-history";

export type HealthSyncProgress = DomainProgress & { recentDataThrough?: string; recentObservationSequence?: number; limitations?: string[]; encryptedActivityCache?: string; bulk?: BulkHealthProgress;
  activity?: DomainProgress;
  lastAttemptSource?: "hrvActivity" | "hrv" | "activity" | BulkHealthSource; lastBulkAttemptSource?: BulkHealthSource };
export type HealthSyncWindow = { domain: "health"; source?: undefined | "activity"; recent: boolean; from: string; through: string } | BulkHealthWindow;
export function healthWindowProgress(progress: SyncProgress, window: HealthSyncWindow) {
  return window.source === "activity" ? progress.health!.activity! : window.source ? progress.health!.bulk![window.source] : progress.health!;
}
export function nextHealthSyncWindow(progress: SyncProgress, now: Date, filter: SyncWindowFilter = {}): HealthSyncWindow | null {
  if (!progress.request) return null;
  progress.health ??= { backfillNext: progress.startDate, backfillThrough: null, recentThrough: null, lastRecentAt: null, latestRecordDate: null, created: 0 };
  initializeActivityProgress(progress);
  const through = progress.request.through;
  const domains = [["hrv", progress.health], ["activity", progress.health.activity!]] as const;
  const available = domains.filter(([source, d]) => (!filter.source || source === filter.source) && (!d.retryAfter || d.retryAfter <= now.toISOString()));
  const selected = available.find(([, d]) => filter.recent !== false && d.recentRequestSequence !== progress.request!.sequence);
  const recent: HealthSyncWindow | null = selected ? { domain: "health", ...(selected[0] === "activity" ? { source: "activity" as const } : {}), recent: true,
    from: selected[1].recentNext ?? [progress.startDate, shiftDate(through, -6)].sort()[1], through } : null;
  const bulk = nextBulkHealthWindow(progress, now, filter);
  // Give independent bulk sources a turn after each common attempt.
  if (bulk && ["hrv", "activity", "hrvActivity"].includes(progress.health.lastAttemptSource ?? "")) return bulk;
  if (recent) return recent;
  if (bulk?.recent) return bulk;
  if (filter.recent === true) return null;
  const historyThrough = closedHistoryThrough(progress, now);
  const historical = available.filter(([, d]) => d.backfillNext <= historyThrough).sort((a, b) => a[1].backfillNext.localeCompare(b[1].backfillNext))[0];
  const history: HealthSyncWindow | null = historical ? { domain: "health", ...(historical[0] === "activity" ? { source: "activity" as const } : {}), recent: false,
    from: historical[1].backfillNext, through: [shiftDate(historical[1].backfillNext, 6), historyThrough].sort()[0] } : null;
  return bulk && (!history || bulk.from <= history.from) ? bulk : history;
}

type CollectedHealth = { items: CorosHealthMetricItem[]; through: string; observedAt: string; limitations: string[];
  activityError?: string; activityContinuation?: { detailsRead: number }; bulkSource?: BulkHealthSource;
  observedDates: string[]; unconfirmedZeroDates: string[] };

type Read = (name: CorosReadTool, args: Record<string, unknown>) => Promise<CorosReadResult>;
export async function collectCorosHealth(read: Read, window: HealthSyncWindow, progress: SyncProgress, assertActive: () => Promise<void>, now = new Date(), encryptionKey?: string, checkpoint?: () => Promise<void>): Promise<CollectedHealth> {
  if (window.source && window.source !== "activity") return { ...await collectBulkHealthHistory(read, { ...window, source: window.source }, progress, assertActive, now), activityError: undefined, activityContinuation: undefined };
  const observedAt = () => new Date().toISOString();
  const options = (from: string, through: string) => ({ startDate: from, endDate: through, timezone: progress.timezone, observedAt: observedAt() });
  const items: CorosHealthMetricItem[] = [];
  const limitations = ["恢复仅提供当前时点，不回填历史", "缺测保留；今天的活动总量尚未结束，不进入个人基线", "爬升与训练负荷按完整活动列表、逐项详情汇总，归属活动开始的本地日期；跨午夜不按比例拆分"];
  if (window.source === "activity") {
    // One newly read detail per invocation; historical dates retain their
    // seven-day list window and encrypted continuation, independently of HRV.
    const activity = await collectCorosActivityTotals(read, window.from, window.through, progress, assertActive, observedAt(), encryptionKey, checkpoint, 1);
    return { items: activity.items, through: activity.through, observedAt: observedAt(), limitations,
      activityContinuation: activity.continuation, observedDates: [], unconfirmedZeroDates: [] };
  }
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
    let noDataDates: string[];
    try {
      const assessment = emptySingleDay ? { items: [], noDataDates: [through] } : parseCorosSleepHrvAssessment(response, options(window.from, through));
      hrv = assessment.items; noDataDates = assessment.noDataDates;
    }
    catch (error) {
      if (window.from === through || !(error instanceof Error) || error.message !== "COROS_SYNC_HEALTH_FORMAT_UNSUPPORTED") throw error;
      through = window.from; continue;
    }
    const dates = new Set([...hrv.map(item => item.candidate.local_date), ...noDataDates]);
    const expected = Math.round((Date.parse(through) - Date.parse(window.from)) / 86400000) + 1;
    if (emptySingleDay || dates.size === expected) { items.push(...hrv); break; }
    if (window.from === through) throw new Error("COROS_SYNC_HEALTH_WINDOW_INCOMPLETE");
    // Keep the already verified contiguous prefix instead of rereading its
    // first date. The next invocation checks the first omitted date singly.
    let firstMissing = window.from;
    while (firstMissing <= through && dates.has(firstMissing)) firstMissing = shiftDate(firstMissing, 1);
    if (firstMissing > window.from) {
      through = shiftDate(firstMissing, -1);
      items.push(...hrv.filter(item => item.candidate.local_date <= through));
      break;
    }
    through = window.from; // Omitted first date still needs explicit single-day evidence.
  }
  return { items: items.filter(item => item.candidate.local_date <= through || item.candidate.metric_type === "recovery_percentage"), through, observedAt: observedAt(), limitations,
    bulkSource: undefined, observedDates: [], unconfirmedZeroDates: [] };
}
