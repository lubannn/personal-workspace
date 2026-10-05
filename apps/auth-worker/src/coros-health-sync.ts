import type { CorosReadTool, CorosReadResult } from "./coros-read-client";
import { corosResultText } from "./coros-sync-mapping";
import { mapCorosDailyHealth, mapCorosRecovery, mapCorosRestingHeartRate, mapCorosSleepHrv, type CorosHealthMetricItem } from "./coros-health-mapping";
import { shiftDate, todayInTimezone, type DomainProgress, type SyncProgress } from "./coros-sync-state";
import { collectCorosActivityTotals } from "./coros-health-activity";

export type HealthSyncProgress = DomainProgress & { recentDataThrough?: string; limitations?: string[]; encryptedActivityCache?: string };
export type HealthSyncWindow = { domain: "health"; recent: boolean; from: string; through: string };
export function nextHealthSyncWindow(progress: SyncProgress, now: Date): HealthSyncWindow | null {
  if (!progress.request || (progress.health?.retryAfter && progress.health.retryAfter > now.toISOString())) return null;
  progress.health ??= { backfillNext: progress.startDate, backfillThrough: null, recentThrough: null, lastRecentAt: null, latestRecordDate: null, created: 0 };
  const d = progress.health, through = progress.request.through;
  if (d.recentRequestSequence !== progress.request.sequence) return { domain: "health", recent: true,
    from: d.recentNext ?? [progress.startDate, shiftDate(through, -6)].sort()[1], through };
  return d.backfillNext <= through ? { domain: "health", recent: false, from: d.backfillNext, through: [shiftDate(d.backfillNext, 6), through].sort()[0] } : null;
}

type Read = (name: CorosReadTool, args: Record<string, unknown>) => Promise<CorosReadResult>;
export async function collectCorosHealth(read: Read, window: HealthSyncWindow, progress: SyncProgress, assertActive: () => Promise<void>, now = new Date(), encryptionKey?: string) {
  const observedAt = () => new Date().toISOString();
  const options = (from: string, through: string) => ({ startDate: from, endDate: through, timezone: progress.timezone, observedAt: observedAt() });
  const items: CorosHealthMetricItem[] = [];
  const limitations = ["恢复仅提供当前时点，不回填历史", "缺测保留；今天的活动总量尚未结束，不进入个人基线", "爬升与训练负荷按完整活动列表、逐项详情汇总，归属活动开始的本地日期；跨午夜不按比例拆分"];
  // Recent endpoints have no absolute-date arguments. Read once per accepted request,
  // 90 dates initially or after a gap, then only the small overlap. This is
  // a chosen baseline window, not an asserted upstream maximum.
  if (window.recent && !progress.health?.recentNext) {
    const today = todayInTimezone(now, progress.timezone);
    const previous = progress.health?.recentDataThrough;
    const days = previous ? Math.min(90, Math.max(2, Math.round((Date.parse(today) - Date.parse(previous)) / 86400000) + 2)) : 90;
    const from = shiftDate(today, 1 - days);
    const daily = await read("queryDailyHealthData", { days }); await assertActive();
    items.push(...mapCorosDailyHealth(daily, options(from, today)).filter(item => item.candidate.local_date >= progress.startDate));
    const rhr = await read("queryRestingHeartRate", { days }); await assertActive();
    items.push(...mapCorosRestingHeartRate(rhr, options(from, today)).filter(item => item.candidate.local_date >= progress.startDate));
    const recovery = await read("queryRecoveryStatus", {}); await assertActive();
    items.push(...mapCorosRecovery(recovery, options(from, today)));
    if (previous && previous < shiftDate(today, -89)) limitations.push("本次日健康与静息心率读取最近90日；更早空档未声称已回填");
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
    const activity = await collectCorosActivityTotals(read, window.from, through, progress, assertActive, observedAt(), encryptionKey);
    // Both domains must cover the same checkpoint; a narrowed list cannot advance HRV past it.
    through = activity.through; items.push(...activity.items);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (!["COROS_SYNC_ACTIVITY_DETAILS_PENDING", "COROS_SYNC_WINDOW_TRUNCATED", "COROS_SYNC_FORMAT_UNSUPPORTED",
      "COROS_SYNC_HEALTH_DETAIL_FORMAT_UNSUPPORTED", "COROS_SYNC_HEALTH_DETAIL_MISMATCH", "COROS_READ_TOOL_UNAVAILABLE"].includes(code)) throw error;
    activityError = code;
    limitations.push(`活动汇总尚未完成（${code}）；其他已验证指标保留，活动覆盖进度不前移`);
  }
  return { items: items.filter(item => item.candidate.local_date <= through || ["steps", "exercise_minutes", "active_calories", "resting_heart_rate", "recovery_percentage"].includes(item.candidate.metric_type)), through, observedAt: observedAt(), limitations, activityError };
}
