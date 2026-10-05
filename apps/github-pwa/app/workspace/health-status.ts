import { healthLocalParts } from "./health-records";
import type { SyncedHealthMetric } from "./page-model";
import type { SleepCalendarDay } from "./sleep-calendar";

/** Port of the reviewed coros-health-calendar classifier, with explicit missingness. */
export const HEALTH_STATUS_RULE_VERSION = 2;
export const HEALTH_STATUSES = {
  good: { label: "状态不错", short: "不错" },
  steady: { label: "平稳", short: "平稳" },
  rest: { label: "需要休息", short: "需休息" },
  active: { label: "活动较多", short: "活动多" },
  insufficient: { label: "待补指标", short: "待补指标" },
} as const;
export type HealthStatus = keyof typeof HEALTH_STATUSES;
const activityMetrics = ["steps", "exerciseMinutes", "activeCalories", "elevationGainMeters", "trainingLoad"] as const;
const baselineMetrics = ["hrvMs", "restingBpm", ...activityMetrics] as const;
export type HealthSignal = "sleepScore" | "recoveryPct" | "hrvMs" | "hrvBaselineMs" | "hrvNormalRangeLowMs" | "restingBpm" | typeof activityMetrics[number];
export type HealthStatusDay = { date: string; dayComplete: boolean; partialReason?: "today" | "source"; partialSignals?: HealthSignal[]; sleep?: SleepCalendarDay; recoveryObservedAt?: string } & Partial<Record<HealthSignal, number | null>>;
type Distribution = { count: number; median: number | null; p20: number | null; p80: number | null; p90: number | null };
export type HealthBaseline = Record<typeof baselineMetrics[number], Distribution>;
export type HealthDayRating = { status: HealthStatus; reasons: string[]; missing: string[]; unavailable: string[]; partial: boolean; recoveryObservedAt?: string };
const usable = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

export function healthQuantile(values: number[], probability: number): number | null {
  const sorted = values.filter(usable).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position), weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[Math.ceil(position)] * weight;
}

export function buildHealthBaseline(days: HealthStatusDay[], range?: { start: string; end: string }): HealthBaseline {
  return Object.fromEntries(baselineMetrics.map(metric => {
    // Closed historical dates need no API completeness flag. Missing/partial values
    // exclude only their own metric; unfinished today never enters a baseline.
    const values = days.filter(day => day.dayComplete && !day.partialSignals?.includes(metric) && (!range || (day.date >= range.start && day.date <= range.end)))
      .map(day => day[metric]).filter(usable);
    return [metric, { count: values.length, median: healthQuantile(values, .5), p20: healthQuantile(values, .2), p80: healthQuantile(values, .8), p90: healthQuantile(values, .9) }];
  })) as HealthBaseline;
}
/** One explicit 90-local-date window, shared across displayed months; historical views end at their month end. */
export function healthBaselineRange(month: string, today: string) {
  const last = new Date(`${month || today.slice(0, 7)}-01T00:00:00Z`);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const end = [last.toISOString().slice(0, 10), today].sort()[0];
  return { start: new Date(Date.parse(`${end}T00:00:00Z`) - 89 * 86400_000).toISOString().slice(0, 10), end };
}
const enough = (stat: Distribution) => stat.count >= 21 && stat.median !== null;

export function classifyHealthDay(day: HealthStatusDay, baseline: HealthBaseline): HealthDayRating {
  const hasSleep = usable(day.sleepScore) && day.sleepScore <= 100;
  const hasRecovery = usable(day.recoveryPct) && day.recoveryPct <= 100;
  const hrvReference = usable(day.hrvBaselineMs) || enough(baseline.hrvMs);
  const hrvLow = usable(day.hrvMs) && (usable(day.hrvNormalRangeLowMs)
    ? day.hrvMs < day.hrvNormalRangeLowMs : enough(baseline.hrvMs) && day.hrvMs < baseline.hrvMs.p20!);
  const restingReference = enough(baseline.restingBpm);
  const restingHigh = usable(day.restingBpm) && restingReference
    && day.restingBpm >= Math.max(baseline.restingBpm.p80!, baseline.restingBpm.median! + 5);
  const missing = [!hasSleep && "睡眠评分", !hasRecovery && "恢复", !usable(day.hrvMs) && "HRV",
    usable(day.hrvMs) && !hrvReference && !usable(day.hrvNormalRangeLowMs) && `HRV 基线（${baseline.hrvMs.count}/21）`,
    !usable(day.restingBpm) && "静息心率", usable(day.restingBpm) && !restingReference && `静息心率基线（${baseline.restingBpm.count}/21）`]
    .filter((value): value is string => typeof value === "string");
  for (const [signal, label] of [["recoveryPct", "恢复"], ["hrvMs", "HRV"], ["restingBpm", "静息心率"]] as const) {
    if (day.partialSignals?.includes(signal)) missing.push(`${label}尚未完整`);
  }
  const unavailable: string[] = [];
  for (const metric of activityMetrics) {
    const label = { steps: "步数", exerciseMinutes: "运动分钟", activeCalories: "活动热量", elevationGainMeters: "爬升", trainingLoad: "训练负荷" }[metric];
    if (!usable(day[metric])) unavailable.push(label);
    else if (day.partialSignals?.includes(metric)) unavailable.push(`${label}尚未完整`);
    else if (!enough(baseline[metric])) unavailable.push(`${label}基线（${baseline[metric].count}/21）`);
  }
  if (!day.dayComplete) missing.push(day.partialReason === "today" ? "当天尚未结束" : "来源部分日尚未完整");
  const rating = (status: HealthStatus, reasons: string[]): HealthDayRating => ({ status, reasons, missing, unavailable, partial: !day.dayComplete || Boolean(day.partialSignals?.length), ...(day.recoveryObservedAt ? { recoveryObservedAt: day.recoveryObservedAt } : {}) });
  const low = [hasSleep && day.sleepScore! < 70 && "COROS 睡眠评分低于 70", hasRecovery && day.recoveryPct! < 70 && `${day.recoveryObservedAt ? "同步观测时" : "COROS "}恢复低于 70%`]
    .filter((value): value is string => typeof value === "string");
  if (low.length) return rating("rest", low);
  const high = (metric: typeof activityMetrics[number], percentile: "p80" | "p90") => !day.partialSignals?.includes(metric) && usable(day[metric]) && enough(baseline[metric])
    && day[metric]! > baseline[metric].median! && day[metric]! >= baseline[metric][percentile]!;
  if (day.dayComplete && (activityMetrics.some(metric => high(metric, "p90")) || activityMetrics.filter(metric => high(metric, "p80")).length >= 2)) {
    return rating("active", ["完整日活动量达到个人 p90，或至少两项达到 p80"]);
  }
  const pressure = [hrvLow && "HRV 低于 COROS 正常范围下限或个人 p20", restingHigh && "静息心率达到个人 p80 与中位数 +5 的较高值"]
    .filter((value): value is string => typeof value === "string");
  if (pressure.length) return rating("rest", pressure);
  // The downloaded script permits missing physiological data to pass this branch.
  // Here a positive combined rating needs observed recovery, HRV/reference and heart-rate/reference.
  if (missing.length === 0 && hasSleep && day.sleepScore! >= 90 && hasRecovery && day.recoveryPct! >= 90
    && usable(day.hrvMs) && hrvReference && day.hrvMs >= (usable(day.hrvBaselineMs) ? day.hrvBaselineMs : baseline.hrvMs.median!)
    && usable(day.restingBpm) && restingReference && day.restingBpm <= baseline.restingBpm.median! + 2) {
    return rating("good", ["睡眠与恢复均至少 90，HRV 与静息心率符合个人基线"]);
  }
  const known = [hasSleep && `COROS 睡眠评分 ${day.sleepScore}`, hasRecovery && `${day.recoveryObservedAt ? "同步观测时" : "COROS "}恢复 ${day.recoveryPct}%`,
    usable(day.hrvMs) && usable(day.hrvNormalRangeLowMs) && !hrvLow && "已测 HRV 未低于 COROS 正常范围下限"]
    .filter((value): value is string => typeof value === "string");
  return missing.length === 0 ? rating("steady", ["已知指标未触发其他评级"])
    : rating("insufficient", ["生理指标缺测、参照样本不足或当天尚未结束", ...known]);
}

/** Explicit workspace contract; these are not guesses at COROS MCP response fields. */
export const COROS_HEALTH_METRICS: Record<string, { signal: HealthSignal; unit: string }> = {
  recovery_percentage: { signal: "recoveryPct", unit: "%" },
  sleep_hrv_avg: { signal: "hrvMs", unit: "ms" },
  sleep_hrv_baseline: { signal: "hrvBaselineMs", unit: "ms" },
  sleep_hrv_normal_range_low: { signal: "hrvNormalRangeLowMs", unit: "ms" },
  resting_heart_rate: { signal: "restingBpm", unit: "bpm" },
  steps: { signal: "steps", unit: "steps" },
  exercise_minutes: { signal: "exerciseMinutes", unit: "min" },
  active_calories: { signal: "activeCalories", unit: "kcal" },
  elevation_gain: { signal: "elevationGainMeters", unit: "m" },
  training_load: { signal: "trainingLoad", unit: "load" },
};

export function buildHealthStatusDays(sleepDays: SleepCalendarDay[], metrics: SyncedHealthMetric[], today: string): HealthStatusDay[] {
  const byDate = new Map<string, HealthStatusDay>(sleepDays.filter(day => day.date <= today).map(sleep => [sleep.date,
    { date: sleep.date, dayComplete: false, sleep, sleepScore: sleep.score }]));
  const candidates = metrics.filter(({ record }) => record.deleted_at === null && record.data.health_metric_version === 2
    && !record.data.revision_of && (record.data.aggregation_period === "daily"
      || (record.data.metric_type === "recovery_percentage" && record.data.aggregation_period === "instant" && record.data.measurement_time_kind === "observed_at"
        && healthLocalParts(record.data.measured_at, record.data.timezone).date === record.data.local_date)) && record.data.local_date <= today);
  const groups = new Map<string, SyncedHealthMetric[]>();
  for (const item of candidates) {
    const { data } = item.record, spec = COROS_HEALTH_METRICS[data.metric_type];
    if (!spec || data.unit !== spec.unit || !usable(data.value) || (["recoveryPct"].includes(spec.signal) && data.value > 100)) continue;
    const key = `${data.local_date}:${spec.signal}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const partialDates = new Set<string>();
  const explicitlyCompleteDates = new Set<string>();
  for (const items of groups.values()) {
    // Do not add repeated daily totals. Equal-time conflicts stay missing.
    const sorted = items.sort((a, b) => Number(b.record.data.aggregation_period === "daily") - Number(a.record.data.aggregation_period === "daily")
      || Date.parse(b.record.data.measured_at) - Date.parse(a.record.data.measured_at));
    const latest = sorted[0].record.data, spec = COROS_HEALTH_METRICS[latest.metric_type];
    const day = byDate.get(latest.local_date) ?? { date: latest.local_date, dayComplete: false };
    byDate.set(day.date, day);
    const tied = sorted.filter(item => item.record.data.aggregation_period === latest.aggregation_period && Date.parse(item.record.data.measured_at) === Date.parse(latest.measured_at));
    if (new Set(tied.map(item => item.record.data.value)).size > 1) continue;
    day[spec.signal] = latest.value;
    if (spec.signal === "recoveryPct" && latest.aggregation_period === "instant") day.recoveryObservedAt = latest.measured_at;
    if (latest.aggregation_period === "daily" && tied.some(item => item.record.data.health_metric_version === 2 && item.record.data.day_complete === false)) {
      partialDates.add(day.date);
      (day.partialSignals ??= []).push(spec.signal);
    }
    if (latest.aggregation_period === "daily" && tied.every(item => item.record.data.health_metric_version === 2 && item.record.data.day_complete === true)) explicitlyCompleteDates.add(day.date);
  }
  for (const day of byDate.values()) {
    day.dayComplete = (day.date < today || explicitlyCompleteDates.has(day.date)) && !partialDates.has(day.date);
    if (day.date === today && !day.dayComplete) day.partialReason = "today";
    else if (partialDates.has(day.date)) day.partialReason = "source";
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
