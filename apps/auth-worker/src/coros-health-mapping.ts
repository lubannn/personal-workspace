import type { HealthMetricCandidate } from "../../../src/lib/github-data/health-staging-records";
import { corosResultText, type CorosSyncDateRange } from "./coros-sync-mapping";
import type { CorosReadResult } from "./coros-read-client";
import { dateOnly, todayInTimezone } from "./coros-sync-state";

export type CorosHealthMetricItem = { sourceId: string; candidate: HealthMetricCandidate; dayComplete?: boolean; measurementTimeKind: "observed_at" };
type Context = CorosSyncDateRange & { observedAt: string };
function fail(): never { throw new Error("COROS_SYNC_HEALTH_FORMAT_UNSUPPORTED"); }
function context(options: Context) {
  if (options.timezone !== "Asia/Shanghai" || !dateOnly(options.startDate) || !dateOnly(options.endDate)
    || options.endDate < options.startDate || !Number.isFinite(Date.parse(options.observedAt))) fail();
}
function date(value: string, options: Context) {
  const local = /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}` : value;
  if (!dateOnly(local) || local < options.startDate || local > options.endDate) fail();
  return local;
}
const numeric = (value: string) => { const n = Number(value.replaceAll(",", "")); if (!Number.isFinite(n) || n < 0) fail(); return n; };
function item(local_date: string, metric_type: string, value: number, unit: string, options: Context, instant = false): CorosHealthMetricItem {
  return { sourceId: `health:${local_date}:${metric_type}:${instant ? "instant" : "daily"}`, measurementTimeKind: "observed_at",
    candidate: { metric_type, value, unit, local_date, timezone: options.timezone, measured_at: options.observedAt, aggregation_period: instant ? "instant" : "daily" } };
}

/** Only the observed official daily summary layout. Header-wide HR/baseline are not assigned to past dates. */
export function mapCorosDailyHealth(result: CorosReadResult, options: Context): CorosHealthMetricItem[] {
  context(options); const text = corosResultText(result);
  if (!/^Daily Health Data — Last \d+ days \| Resting HR: .+ \| HRV Baseline: .+\nNote: sleep entries are dated by their wake-up day\./u.test(text)) fail();
  const sections = text.split(/\n\n--- (\d{8}) ---\n/u); if (sections.length < 3 || sections.length % 2 === 0) fail();
  const seen = new Set<string>(); const items: CorosHealthMetricItem[] = [];
  for (let i = 1; i < sections.length; i += 2) {
    const local = date(sections[i], options); if (seen.has(local)) fail(); seen.add(local);
    const line = sections[i + 1].split("\n")[0];
    const fields = /^Steps: ([\d,]+) \| Calories: ([\d,.]+) kcal \| Exercise: ((?:[\d.]+ min)|(?:\d+h \d+min))$/u.exec(line); if (!fields) fail();
    const hours = /^(\d+)h (\d+)min$/u.exec(fields[3]);
    if (hours && Number(hours[2]) >= 60) fail();
    const exercise = hours ? numeric(hours[1]) * 60 + numeric(hours[2]) : numeric(fields[3].slice(0, -4));
    if (exercise > 1440) fail();
    // Relative daily responses can contain unverified zero-only rows. Three zero
    // aggregates provide no evidence of device sampling; preserve them as holes.
    // Individual reported zeros remain usable when another aggregate is positive.
    if (numeric(fields[1]) === 0 && numeric(fields[2]) === 0 && exercise === 0) continue;
    items.push(item(local, "steps", numeric(fields[1]), "steps", options), item(local, "exercise_minutes", exercise, "min", options),
      // COROS Daily Features / Updating Your Calorie Goal: daily calories are
      // active calories from movement and exercise, excluding resting metabolism.
      // https://support.coros.com/hc/en-us/articles/8155758635028-Updating-Your-Calorie-Goal
      item(local, "active_calories", numeric(fields[2]), "kcal", options));
  }
  return items;
}

export function mapCorosRestingHeartRate(result: CorosReadResult, options: Context): CorosHealthMetricItem[] {
  context(options); const text = corosResultText(result);
  if (!/^Resting Heart Rate — Last \d+ days\n=+\n/u.test(text)) fail();
  const body = text.replace(/^Resting Heart Rate — Last \d+ days\n=+\n+/u, ""); const seen = new Set<string>();
  return body.split("\n").flatMap(line => {
    const match = /^(\d{4}-\d{2}-\d{2}): (([\d.]+) bpm|No data)$/u.exec(line); if (!match) fail();
    const local = date(match[1], options); if (seen.has(local)) fail(); seen.add(local);
    return match[2] === "No data" ? [] : [item(local, "resting_heart_rate", numeric(match[3]), "bpm", options)];
  });
}

/** Preserve official assessment; never derive averages or ranges from the time series. */
export function mapCorosSleepHrv(result: CorosReadResult, options: Context): CorosHealthMetricItem[] {
  context(options); const text = corosResultText(result);
  if (!/^Sleep HRV — .+\n=+\n/u.test(text)) fail();
  const assessment = /HRV Assessment — Last \d+ days\n=+\n+([\s\S]*?)\n\nSleep HRV Time Series — Last \d+ days\n/u.exec(text)?.[1];
  if (!assessment) fail(); const sections = assessment.split(/\n\n/u); const seen = new Set<string>(); const items: CorosHealthMetricItem[] = [];
  for (const section of sections) {
    const match = /^(\d{4}-\d{2}-\d{2}):\n  HRV Avg: ([\d.]+) ms — [^\n]+\n  Normal Range: ([\d.]+) - ([\d.]+) ms\n  Baseline: ([\d.]+) ms$/u.exec(section); if (!match) fail();
    const local = date(match[1], options); if (seen.has(local) || numeric(match[3]) > numeric(match[4])) fail(); seen.add(local);
    items.push(item(local, "sleep_hrv_avg", numeric(match[2]), "ms", options), item(local, "sleep_hrv_normal_range_low", numeric(match[3]), "ms", options),
      item(local, "sleep_hrv_baseline", numeric(match[5]), "ms", options));
  }
  return items;
}

/** Current, untimestamped response: save the observation on the actual collection day, never a historical request day. */
export function mapCorosRecovery(result: CorosReadResult, options: Context): CorosHealthMetricItem[] {
  context(options); const text = corosResultText(result);
  const match = /^Recovery Status\n=+\n+Recovery: ([\d.]+)%\nLevel: [^\n]+\nEstimated Full Recovery: [^\n]+$/u.exec(text); if (!match || numeric(match[1]) > 100) fail();
  const local = todayInTimezone(new Date(options.observedAt), options.timezone);
  return [item(local, "recovery_percentage", numeric(match[1]), "%", options, true)];
}
