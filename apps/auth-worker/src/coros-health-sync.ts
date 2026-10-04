import type { CorosReadTool, CorosReadResult } from "./coros-read-client";
import { corosResultText } from "./coros-sync-mapping";
import { mapCorosDailyHealth, mapCorosRecovery, mapCorosRestingHeartRate, mapCorosSleepHrv, type CorosHealthMetricItem } from "./coros-health-mapping";
import { shiftDate, todayInTimezone, type DomainProgress, type SyncProgress } from "./coros-sync-state";

export type HealthSyncProgress = DomainProgress & { recentDataThrough?: string; limitations?: string[] };
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
export async function collectCorosHealth(read: Read, window: HealthSyncWindow, progress: SyncProgress, assertActive: () => Promise<void>, now = new Date()) {
  const observedAt = () => new Date().toISOString();
  const options = (from: string, through: string) => ({ startDate: from, endDate: through, timezone: progress.timezone, observedAt: observedAt() });
  const items: CorosHealthMetricItem[] = [];
  const limitations = ["恢复仅提供当前时点，不回填历史", "Calories 未确认活动/总热量，未用于评级", "来源未提供完整日证据，个人基线暂不使用这些未知完整性记录", "爬升与训练负荷日汇总未提供"];
  // Recent endpoints have no absolute-date arguments. Read once per accepted request,
  // at most 31 dates initially or after a gap, then only the small overlap.
  if (window.recent && !progress.health?.recentNext) {
    const today = todayInTimezone(now, progress.timezone);
    const previous = progress.health?.recentDataThrough;
    const days = previous ? Math.min(31, Math.max(2, Math.round((Date.parse(today) - Date.parse(previous)) / 86400000) + 2)) : 31;
    const from = shiftDate(today, 1 - days);
    const daily = await read("queryDailyHealthData", { days }); await assertActive();
    items.push(...mapCorosDailyHealth(daily, options(from, today)).filter(item => item.candidate.local_date >= progress.startDate));
    const rhr = await read("queryRestingHeartRate", { days }); await assertActive();
    items.push(...mapCorosRestingHeartRate(rhr, options(from, today)).filter(item => item.candidate.local_date >= progress.startDate));
    const recovery = await read("queryRecoveryStatus", {}); await assertActive();
    items.push(...mapCorosRecovery(recovery, options(from, today)));
    if (previous && previous < shiftDate(today, -30)) limitations.push("静息心率和日健康仅验证近期31日；更早空档未声称已回填");
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
  return { items, through, observedAt: observedAt(), limitations };
}
