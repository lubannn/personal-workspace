import type { CorosWorkoutCandidate, SleepSessionCandidate } from "../../../src/lib/github-data/health-staging-records";
import type { CorosReadResult } from "./coros-read-client";
import type { CorosSleepDateCorrection, CorosSleepMetrics } from "../../../src/lib/github-data/sleep-sessions";

export type CorosSyncDateRange = { startDate: string; endDate: string; timezone: string };
export type CorosSyncSleepMetrics = CorosSleepMetrics;
export type CorosSyncCandidate =
  | { kind: "sleep"; sourceId: string; candidate: SleepSessionCandidate; metrics: CorosSyncSleepMetrics }
  | { kind: "workout"; sourceId: string; candidate: CorosWorkoutCandidate };
type SleepItem = Extract<CorosSyncCandidate, { kind: "sleep" }>;
type WorkoutItem = Extract<CorosSyncCandidate, { kind: "workout" }>;

// This is a versioned parser for observed COROS output, not natural-language extraction.
// Unknown layouts fail the entire read so the caller cannot advance a coverage checkpoint.
function fail(): never { throw new Error("COROS_SYNC_FORMAT_UNSUPPORTED"); }
function resultText(result: CorosReadResult): string {
  let payload: unknown;
  if (result.format === "content") {
    if (!Array.isArray(result.payload) || result.payload.length !== 1) return fail();
    const block = result.payload[0];
    if (!block || block.type !== "text" || typeof block.text !== "string") return fail();
    payload = block.text;
  } else {
    payload = result.payload;
    if (payload && typeof payload === "object" && !Array.isArray(payload)
      && Object.keys(payload).join(",") === "text") payload = (payload as { text: unknown }).text;
  }
  if (typeof payload !== "string" || payload.length > 512 * 1024) return fail();
  if (payload.startsWith('"')) {
    try { payload = JSON.parse(payload); } catch { return fail(); }
  }
  if (typeof payload !== "string" || /\u0000|\r(?!\n)/u.test(payload)) return fail();
  return payload.replace(/\r\n/gu, "\n").trim();
}
function dateOnly(value: string): string {
  const date = /^\d{8}$/u.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}` : value;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return fail();
  const instant = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(instant.valueOf()) || instant.toISOString().slice(0, 10) !== date) return fail();
  return date;
}
function range(options: CorosSyncDateRange) {
  // Current workspace account uses China time. Other zones require an explicitly tested mapper.
  if (options.timezone !== "Asia/Shanghai") throw new Error("COROS_SYNC_TIMEZONE_UNSUPPORTED");
  const start = dateOnly(options.startDate); const end = dateOnly(options.endDate);
  if (end < start || (Date.parse(end) - Date.parse(start)) / 86400000 > 366) return fail();
  return { start, end };
}
function inRange(value: string, bounds: { start: string; end: string }) {
  const date = dateOnly(value);
  if (date < bounds.start || date > bounds.end) return fail();
  return date;
}
function localInstant(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/u.exec(value);
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59) return fail();
  dateOnly(match[1]);
  return new Date(`${value.replace(" ", "T")}:00+08:00`).toISOString();
}
function window(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) - (\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/u.exec(value);
  if (!match) return fail();
  const start = localInstant(match[1]); const end = localInstant(match[2]);
  const minutes = (Date.parse(end) - Date.parse(start)) / 60000;
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 2160) return fail();
  return { start, end, minutes, startDate: match[1].slice(0, 10), endDate: match[2].slice(0, 10) };
}
type SleepWindow = ReturnType<typeof window> & { dateCorrection?: CorosSleepDateCorrection };
function legacyNapDateCorrection(span: SleepWindow, date: string, fields: Map<string, string>): SleepWindow {
  // User-authorized repair for the observed legacy COROS 1982 nap-year defect.
  // Anchor the matching end month/day; start may be that day or the previous day.
  const daySpan = (Date.parse(span.endDate) - Date.parse(span.startDate)) / 86400_000;
  if (date < "2025-01-01" || span.endDate !== `1982${date.slice(4)}` || ![0, 1].includes(daySpan)
    || !fields.get("Naps Total")?.endsWith(" (includes legacy reported durations)")
    || fields.has("Naps Total (asleep)") || fields.has("Naps Period (incl. awake)")) return span;
  const clock = (instant: string) => new Date(Date.parse(instant) + 8 * 3600_000).toISOString().slice(11, 16);
  const startDate = new Date(Date.parse(date) - daySpan * 86400_000).toISOString().slice(0, 10);
  const corrected = window(`${startDate} ${clock(span.start)} - ${date} ${clock(span.end)}`);
  if (corrected.minutes !== span.minutes) return fail();
  return { ...corrected, dateCorrection: { reason: "coros_legacy_nap_year_1982", original_start_at: span.start, original_end_at: span.end } };
}
function minutes(value: string) {
  const match = /^(?:(\d+)h(?: )?)?(\d+) ?min$/u.exec(value);
  if (!match || (match[1] && Number(match[2]) >= 60)) return fail();
  const result = Number(match[1] ?? 0) * 60 + Number(match[2]);
  if (!Number.isSafeInteger(result) || result > 2160) return fail();
  return result;
}
function optionalMinutes(fields: Map<string, string>, key: string) {
  const value = fields.get(key); return value === undefined ? null : minutes(value);
}
function integer(value: string, max = Number.MAX_SAFE_INTEGER) {
  if (!/^\d+$/u.test(value)) return fail();
  const number = Number(value); if (!Number.isSafeInteger(number) || number > max) return fail(); return number;
}
const sleepFields = new Set([
  "Sleep Score", "Daily Sleep", "Main Sleep (asleep)", "Main Sleep Period (incl. awake)", "Main Sleep",
  "Sleep metrics scope", "Deep Sleep Ratio", "Light Sleep Ratio", "REM Ratio", "Awake Ratio", "Awake Time",
  "Awake Count (>5 min)", "Main Sleep Window", "Naps Total (asleep)", "Naps Period (incl. awake)", "Naps Total",
]);

export function mapCorosSleep(result: CorosReadResult, options: CorosSyncDateRange): { items: SleepItem[]; reportedCount: number } {
  const bounds = range(options); const text = resultText(result);
  if (text === "No sleep overview data found.") {
    // This observed empty response has no dates. Accept it only within the
    // tool's verified three-day window; a larger request could be silently capped.
    if ((Date.parse(bounds.end) - Date.parse(bounds.start)) / 86400000 >= 3) return fail();
    return { items: [], reportedCount: 0 };
  }
  const prefix = "Sleep Overview\n========================\nNote: each record below is dated by its wake-up day.\n\n";
  if (!text.startsWith(prefix)) return fail();
  const sections = text.slice(prefix.length).split(/\n\n/u);
  const seen = new Set<string>(); const items: SleepItem[] = [];
  for (const section of sections) {
    const [dateLine, ...lines] = section.split("\n"); const date = inRange(dateLine, bounds);
    if (seen.has(date)) return fail(); seen.add(date);
    if ((lines.length === 1 && lines[0] === "Sleep detail for this day is not available yet.")
      || (lines.length === 2 && lines[0] === "Sleep Score: 0" && lines[1] === "Sleep detail for this day is not available yet.")) continue;
    const fields = new Map<string, string>(); const rawNaps: SleepWindow[] = [];
    for (const line of lines) {
      const match = /^([^:]+): (.+)$/u.exec(line);
      if (!match) return fail();
      if (match[1] === "Nap Window") { rawNaps.push(window(match[2])); continue; }
      if (!sleepFields.has(match[1]) || fields.has(match[1])) return fail();
      fields.set(match[1], match[2]);
    }
    const naps = rawNaps.map(nap => legacyNapDateCorrection(nap, date, fields));
    // Nap-only days omit main-sleep fields; the fuller layouts use -1 for an
    // unavailable score. Legacy totals represent periods, not time asleep.
    if (!fields.has("Main Sleep Window")) {
      const legacyNaps = fields.get("Naps Total");
      if (naps.length === 0) return fail();
      const napPeriod = naps.reduce((sum, nap) => sum + nap.minutes, 0);
      if (naps.some(nap => nap.endDate !== date)) return fail();
      let napsAsleep: number | null = null;
      if (legacyNaps === undefined) {
        const allowed = new Set(["Sleep Score", "Daily Sleep", "Sleep metrics scope", "Naps Total (asleep)", "Naps Period (incl. awake)"]);
        const daily = fields.get("Daily Sleep");
        napsAsleep = optionalMinutes(fields, "Naps Total (asleep)");
        if (fields.size !== allowed.size || [...fields.keys()].some(key => !allowed.has(key))
          || fields.get("Sleep Score") !== "-1" || fields.get("Sleep metrics scope") !== "daily"
          || optionalMinutes(fields, "Naps Period (incl. awake)") !== napPeriod
          || napsAsleep === null || napsAsleep > napPeriod || !daily?.endsWith(" (incl. naps)")
          || minutes(daily.slice(0, -13)) !== napsAsleep) return fail();
      } else if (minutes(legacyNaps.replace(/ \(includes legacy reported durations\)$/u, "")) !== napPeriod) return fail();
      else if (fields.size > 1) {
        const ratios = ["Deep Sleep Ratio", "Light Sleep Ratio", "REM Ratio", "Awake Ratio"];
        const allowed = new Set(["Naps Total", "Sleep Score", "Daily Sleep", "Awake Time", "Awake Count (>5 min)", ...ratios]);
        const daily = fields.get("Daily Sleep");
        if ([...fields.keys()].some(key => !allowed.has(key)) || fields.get("Sleep Score") !== "-1"
          || !legacyNaps.endsWith(" (includes legacy reported durations)")
          || !daily?.endsWith(" (incl. naps)") || minutes(daily.slice(0, -13)) !== napPeriod) return fail();
        for (const key of ratios) {
          const value = fields.get(key);
          if (value !== undefined && (!/^\d+%$/u.test(value) || integer(value.slice(0, -1), 100) > 100)) return fail();
        }
        const awake = optionalMinutes(fields, "Awake Time");
        if (awake !== null && awake > napPeriod) return fail();
        if (fields.has("Awake Count (>5 min)")) integer(fields.get("Awake Count (>5 min)")!, 1000);
      }
      const sorted = [...naps].sort((a, b) => a.start.localeCompare(b.start));
      if (sorted.some((span, i) => i > 0 && span.start < sorted[i - 1].end)) return fail();
      for (const nap of naps) items.push({
        kind: "sleep", sourceId: `sleep:${date}:nap:${nap.start}`,
        candidate: { start_at: nap.start, end_at: nap.end, local_date: nap.startDate,
          timezone: options.timezone, session_type: "nap", duration_minutes: nap.minutes },
        metrics: { asleep_minutes: naps.length === 1 ? napsAsleep : null,
          awake_minutes: naps.length === 1 && napsAsleep !== null ? nap.minutes - napsAsleep : null, score: null, wake_date: date,
          ...(nap.dateCorrection ? { date_correction: nap.dateCorrection } : {}) },
      });
      continue;
    }
    if (!fields.has("Main Sleep Window") || !fields.has("Sleep Score")) return fail();
    const main = window(fields.get("Main Sleep Window")!);
    if (main.endDate !== date || naps.some(nap => nap.endDate !== date)) return fail();
    const score = integer(fields.get("Sleep Score")!, 100);
    for (const key of ["Deep Sleep Ratio", "Light Sleep Ratio", "REM Ratio", "Awake Ratio"]) {
      if (fields.has(key)) { const value = fields.get(key)!; if (!/^\d+%$/u.test(value)) return fail(); integer(value.slice(0, -1), 100); }
    }
    if (fields.has("Awake Count (>5 min)")) integer(fields.get("Awake Count (>5 min)")!, 1000);
    if (fields.has("Sleep metrics scope") && !["daily", "main"].includes(fields.get("Sleep metrics scope")!)) return fail();
    const modern = fields.has("Main Sleep (asleep)");
    if (modern === fields.has("Main Sleep") || (modern && !fields.has("Main Sleep Period (incl. awake)"))) return fail();
    const asleep = optionalMinutes(fields, "Main Sleep (asleep)");
    const reportedAwake = optionalMinutes(fields, "Awake Time");
    // COROS may report daily awake time across main sleep and naps. Only an
    // explicitly main-scoped value belongs on the main episode. Unscoped legacy
    // values are also ambiguous and must not be silently assigned to that episode.
    const awake = fields.get("Sleep metrics scope") === "main" ? reportedAwake : null;
    const allPeriods = main.minutes + naps.reduce((sum, nap) => sum + nap.minutes, 0);
    if ((asleep !== null && asleep > main.minutes) || (reportedAwake !== null && reportedAwake > allPeriods) || (awake !== null && awake > main.minutes)) return fail();
    if (asleep !== null && awake !== null && asleep + awake !== main.minutes) return fail();
    if (modern && optionalMinutes(fields, "Main Sleep Period (incl. awake)") !== main.minutes) return fail();
    if (!modern && minutes(fields.get("Main Sleep")!) !== main.minutes) return fail();
    // Modern asleep is explicit. Legacy Main Sleep is an ambiguous reported period; never subtract awake to invent asleep.
    const make = (span: SleepWindow, type: "main_sleep" | "nap", slept: number | null, awakeMinutes: number | null): SleepItem => ({
      kind: "sleep", sourceId: `sleep:${date}:${type === "main_sleep" ? "main" : `nap:${span.start}`}`,
      candidate: { start_at: span.start, end_at: span.end, local_date: span.startDate, timezone: options.timezone, session_type: type, duration_minutes: span.minutes },
      metrics: { asleep_minutes: slept, awake_minutes: awakeMinutes, score: type === "main_sleep" ? score : null, wake_date: date,
        ...(span.dateCorrection ? { date_correction: span.dateCorrection } : {}) },
    });
    const napPeriod = naps.reduce((sum, nap) => sum + nap.minutes, 0);
    let napsAsleep: number | null = null;
    if (modern) {
      const legacyZeroNaps = naps.length === 0 && fields.get("Naps Total") === "0 min";
      napsAsleep = optionalMinutes(fields, "Naps Total (asleep)") ?? (legacyZeroNaps ? 0 : null);
      const reportedNapPeriod = optionalMinutes(fields, "Naps Period (incl. awake)");
      if (napsAsleep === null || (reportedNapPeriod !== null && reportedNapPeriod !== napPeriod) || napsAsleep > napPeriod) return fail();
      if (fields.has("Naps Total") && (!legacyZeroNaps || fields.has("Naps Total (asleep)"))) return fail();
      const daily = fields.get("Daily Sleep");
      if (daily !== undefined) {
        if (!daily.endsWith(" (incl. naps)")) return fail();
        if (minutes(daily.slice(0, -13)) !== asleep! + napsAsleep) return fail();
      }
    } else {
      const legacyNaps = fields.get("Naps Total");
      if (legacyNaps === undefined || fields.has("Naps Total (asleep)") || fields.has("Naps Period (incl. awake)")) return fail();
      if (minutes(legacyNaps.replace(/ \(includes legacy reported durations\)$/u, "")) !== napPeriod) return fail();
    }
    const sorted = [main, ...naps].sort((a, b) => a.start.localeCompare(b.start));
    if (sorted.some((span, i) => i > 0 && span.start < sorted[i - 1].end)) return fail();
    items.push(make(main, "main_sleep", asleep, awake));
    for (const nap of naps) {
      // A daily nap total cannot be apportioned across multiple nap episodes.
      const napAsleep = naps.length === 1 ? napsAsleep : null;
      items.push(make(nap, "nap", napAsleep, napAsleep === null ? null : nap.minutes - napAsleep));
    }
  }
  const expectedDays = (Date.parse(bounds.end) - Date.parse(bounds.start)) / 86400000 + 1;
  if (seen.size !== expectedDays || new Set(items.map(item => item.sourceId)).size !== items.length) return fail();
  return { items, reportedCount: sections.length };
}

function durationSeconds(value: string) {
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some(p => !/^\d+$/u.test(p)) || parts.slice(1).some(p => Number(p) >= 60)) return fail();
  const valueSeconds = parts.reduce((sum, part) => sum * 60 + Number(part), 0);
  if (!Number.isSafeInteger(valueSeconds) || valueSeconds <= 0 || valueSeconds > 604800) return fail();
  return valueSeconds;
}
function activityType(code: number): CorosWorkoutCandidate["activity_type"] {
  if ([100, 101, 102, 103].includes(code)) return "run";
  if ([104, 105, 106].includes(code)) return "hike";
  if ([200, 201, 202, 203, 204, 205, 299].includes(code)) return "ride";
  if ([300, 301].includes(code)) return "swim";
  if (code === 900) return "walk";
  if (code === 402) return "strength";
  return "other";
}
function nonNegative(value: string) {
  if (!/^\d+(?:\.\d+)?$/u.test(value)) return fail();
  const number = Number(value); if (!Number.isFinite(number)) return fail(); return number;
}
export function mapCorosWorkouts(result: CorosReadResult, options: CorosSyncDateRange): { items: WorkoutItem[]; reportedCount: number } {
  const bounds = range(options); const text = resultText(result);
  const empty = /^No sport records found from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})\.$/u.exec(text);
  if (empty) {
    if (empty[1] !== bounds.start || empty[2] !== bounds.end) return fail();
    return { items: [], reportedCount: 0 };
  }
  const header = /^Sport Records — (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2}) \((\d+) records\)\n========================\n\n/u.exec(text);
  if (!header || header[1] !== bounds.start || header[2] !== bounds.end) return fail();
  const reportedCount = integer(header[3], 10000);
  const sections = text.slice(header[0].length).split(/\n\n/u);
  if (reportedCount !== sections.length) return fail();
  const items: WorkoutItem[] = sections.map((section, index) => {
    const [title, ...rawLines] = section.split("\n");
    const heading = /^(\d+)\. [^\n]+ — (\d{4}-\d{2}-\d{2})$/u.exec(title);
    if (!heading || integer(heading[1]) !== index + 1) return fail(); inRange(heading[2], bounds);
    const fields = new Map<string, string>();
    for (const raw of rawLines) {
      // Without pace/speed, COROS can leave the metric row's leading separator.
      // Accept that exact prefix only for the optional heart-rate/calorie fields.
      const detachedMetrics = raw.startsWith(" | ");
      if (!detachedMetrics && !raw.startsWith("   ")) return fail();
      const line = raw.slice(3);
      // Location and coordinates are deliberately not retained or used to infer anything.
      if (!detachedMetrics && /^(?:Location|Start Coordinates): .+$/u.test(line)) continue;
      if (!detachedMetrics && line.startsWith("Time Window: ")) {
        if (fields.has("Time Window")) return fail();
        fields.set("Time Window", line.slice(13));
        continue;
      }
      for (const part of line.split(" | ")) {
        const match = /^([^:]+): (.+)$/u.exec(part);
        if (!match || fields.has(match[1])) return fail();
        if (detachedMetrics && !["Avg HR", "Calories"].includes(match[1])) return fail();
        if (!["Time Window", "Duration", "Distance", "Sets", "Average Pace", "Average Speed", "Avg HR", "Calories", "LabelId", "SportType"].includes(match[1])) return fail();
        fields.set(match[1], match[2]);
      }
    }
    // Time Window contains a separator but only one field label.
    const rawTime = fields.get("Time Window");
    const time = rawTime && /^startTimestamp=(\d+) \| endTimestamp=(\d+)$/u.exec(rawTime);
    if (!time) return fail();
    const start = integer(time[1]); const end = integer(time[2]); const elapsed = end - start;
    if (elapsed <= 0 || elapsed > 604800 || !Number.isFinite(new Date(start * 1000).valueOf()) || !Number.isFinite(new Date(end * 1000).valueOf())) return fail();
    // Some COROS headings are one date off their epoch timestamps. Preserve the exact
    // instants, but reject unrelated timestamps instead of trusting a plausible heading.
    const localStartDate = new Date((start + 8 * 3600) * 1000).toISOString().slice(0, 10);
    if (Math.abs(Date.parse(localStartDate) - Date.parse(heading[2])) > 86400000) return fail();
    const reportedMoving = durationSeconds(fields.get("Duration") ?? "");
    if (reportedMoving > elapsed + 1) return fail();
    // COROS display duration can round one second above its integer epoch span.
    // Keep the exact instants/elapsed span and bound normalized active time to it.
    const moving = Math.min(reportedMoving, elapsed);
    const id = fields.get("LabelId"); if (!id || !/^\d{1,30}$/u.test(id)) return fail();
    const code = integer(fields.get("SportType") ?? "", 65535);
    let distance: number | null = null;
    if (fields.has("Distance")) {
      const match = /^(\d+(?:\.\d+)?) (km|m)$/u.exec(fields.get("Distance")!); if (!match) return fail();
      distance = nonNegative(match[1]) * (match[2] === "km" ? 1000 : 1);
    }
    if (fields.has("Sets")) integer(fields.get("Sets")!);
    if (fields.has("Average Pace") && !/^\d+:\d{2} \/km$/u.test(fields.get("Average Pace")!)) return fail();
    if (fields.has("Average Speed") && !/^\d+(?:\.\d+)? km\/h$/u.test(fields.get("Average Speed")!)) return fail();
    const metric = (key: string, unit: string) => {
      const raw = fields.get(key); if (raw === undefined) return null;
      if (!raw.endsWith(` ${unit}`)) return fail(); return nonNegative(raw.slice(0, -unit.length - 1));
    };
    return { kind: "workout", sourceId: `workout:${id}`, candidate: {
      activity_type: activityType(code), start_at: new Date(start * 1000).toISOString(), end_at: new Date(end * 1000).toISOString(), timezone: options.timezone,
      duration_seconds: elapsed, distance, distance_unit: "m", training_load: null,
      metrics_json: { elapsed_seconds: elapsed, moving_seconds: moving, calories: metric("Calories", "kcal"), average_heart_rate_bpm: metric("Avg HR", "bpm"),
        maximum_heart_rate_bpm: null, average_cadence_rpm: null, average_power_watts: null, trackpoints: 0 },
    } };
  });
  if (new Set(items.map(item => item.sourceId)).size !== items.length) return fail();
  return { items, reportedCount };
}
