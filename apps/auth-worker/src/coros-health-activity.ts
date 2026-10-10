import type { CorosReadResult, CorosReadTool } from "./coros-read-client";
import { corosResultText, mapCorosWorkouts, type CorosSyncCandidate } from "./coros-sync-mapping";
import { shiftDate, todayInTimezone, type SyncProgress } from "./coros-sync-state";
import { decryptRefreshToken, encryptRefreshToken } from "./security";
import type { CorosHealthMetricItem } from "./coros-health-mapping";

type Workout = Extract<CorosSyncCandidate, { kind: "workout" }>;
type Detail = { elevationGainMeters: number | null; trainingLoad: number | null };
type PendingWindow = [string, string[]];
type PendingList = { window: string; through: string; sequence: number; savedAt: number; result: CorosReadResult };
const LIST_CACHE_MS = 5 * 60_000;
const MAX_LIST_BYTES = 64 * 1024;
type Cached = Detail & { signature: string; date: string; requestSequence: number };
type Read = (name: CorosReadTool, args: Record<string, unknown>) => Promise<CorosReadResult>;
function fail(): never { throw new Error("COROS_SYNC_HEALTH_DETAIL_FORMAT_UNSUPPORTED"); }
const number = (value: string) => { if (!/^\d+(?:\.\d+)?$/u.test(value) || !Number.isFinite(Number(value))) fail(); return Number(value); };
function seconds(value: string) {
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some(p => !/^\d+$/u.test(p)) || parts.slice(1).some(p => Number(p) >= 60)) fail();
  return parts.reduce((sum, part) => sum * 60 + Number(part), 0);
}

/** Verified getActivityDetail layout. Never use rolling load assessment as an activity load. */
export function mapCorosActivityDetail(result: CorosReadResult, workout: Workout): Detail {
  const text = corosResultText(result);
  if (!/^.+ Activity Details\n=+\n\n/u.test(text)) fail();
  const fields = new Map<string, string>();
  for (const line of text.split("\n").slice(3).filter(Boolean)) {
    const match = /^([^:]+): (.+)$/u.exec(line); if (!match) fail();
    if (fields.has(match[1])) fail(); fields.set(match[1], match[2]);
  }
  const moving = seconds(fields.get("Workout Time") ?? "");
  const totalTime = fields.get("Total Time");
  // Verified walk and jump-rope details omit elapsed time. Compare their active time
  // with the list's active time; never treat it as the elapsed epoch span.
  const sport = workout.candidate.metrics_json.coros_sport_type;
  const activeOnlyLayout = (sport === 900 && /^🚶 Walk Activity Details\n/u.test(text))
    || (sport === 901 && /^🚶 Jump Rope Activity Details\n/u.test(text))
    || (sport === 902 && /^🚶 Floor Climb Activity Details\n/u.test(text));
  if (totalTime === undefined && (!activeOnlyLayout || workout.candidate.metrics_json.moving_seconds === null)) fail();
  const elapsed = totalTime === undefined ? null : seconds(totalTime);
  if ((elapsed === null ? moving > workout.candidate.duration_seconds + 1
    : Math.abs(elapsed - workout.candidate.duration_seconds) > 1 || moving > elapsed + 1)
    || (workout.candidate.metrics_json.moving_seconds !== null && Math.abs(moving - workout.candidate.metrics_json.moving_seconds) > 1)) {
    throw new Error("COROS_SYNC_HEALTH_DETAIL_MISMATCH");
  }
  const elevation = fields.get("Elevation Gain / Loss");
  const elevationMatch = elevation && /^(\d+(?:\.\d+)?) m \/ (\d+(?:\.\d+)?) m$/u.exec(elevation);
  if (elevation && elevation !== "No data" && !elevationMatch) fail();
  const gain = fields.get("Elevation Gain");
  const gainMatch = gain && /^(\d+(?:\.\d+)?) m$/u.exec(gain);
  if (gain && gain !== "No data" && !gainMatch) fail();
  const combinedGain = elevationMatch ? number(elevationMatch[1]) : null;
  const standaloneGain = gainMatch ? number(gainMatch[1]) : null;
  // Two conflicting source fields cannot be resolved by guessing.
  if (elevation !== undefined && gain !== undefined && combinedGain !== standaloneGain) {
    throw new Error("COROS_SYNC_HEALTH_DETAIL_MISMATCH");
  }
  const load = fields.get("Training Load");
  return { elevationGainMeters: combinedGain ?? standaloneGain,
    trainingLoad: load === undefined || load === "No data" ? null : number(load) };
}

/** A complete list plus every unique detail establishes a daily sum, independently per metric. */
export async function collectCorosActivityTotals(read: Read, from: string, requestedThrough: string, progress: SyncProgress,
  assertActive: () => Promise<void>, observedAt: string, encryptionKey?: string, checkpoint?: () => Promise<void>, detailLimit = 4) {
  let cache: Record<string, Cached> = {};
  let pendingWindows: PendingWindow[] = [];
  let pendingLists: PendingList[] = [];
  const encrypted = progress.health?.encryptedActivityCache;
  if (encrypted && encryptionKey) {
    try {
      const parsed = JSON.parse(await decryptRefreshToken(encrypted, encryptionKey));
      if (parsed.version === 1 && parsed.timezone === progress.timezone && Array.isArray(parsed.entries) && parsed.entries.length <= 256) {
        cache = Object.fromEntries(parsed.entries.filter((entry: [string, Cached]) => Array.isArray(entry) && /^workout:\d{1,30}$/.test(entry[0])
          && entry[1] && typeof entry[1].signature === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry[1].date) && Number.isSafeInteger(entry[1].requestSequence)
          && [entry[1].elevationGainMeters, entry[1].trainingLoad].every(v => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0))));
        // Optional v1 metadata pins the two serial recent/history windows.
        // It affects eviction only, never completeness or accepted facts.
        if (Array.isArray(parsed.pendingWindows)) pendingWindows = parsed.pendingWindows.filter((entry: PendingWindow) =>
          Array.isArray(entry) && /^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/u.test(entry[0])
          && Array.isArray(entry[1]) && entry[1].length < 20 && entry[1].every(id => typeof id === "string" && /^workout:\d{1,30}$/u.test(id))).slice(-2);
        if (Array.isArray(parsed.pendingLists)) pendingLists = parsed.pendingLists.filter((entry: PendingList) =>
          entry && typeof entry.window === "string" && /^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/u.test(entry.window)
          && typeof entry.through === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(entry.through)
          && Number.isSafeInteger(entry.sequence) && Number.isFinite(entry.savedAt)
          && entry.savedAt <= Date.now() && Date.now() - entry.savedAt <= LIST_CACHE_MS
          && entry.result && ["content", "structured"].includes(entry.result.format)
          && new TextEncoder().encode(JSON.stringify(entry.result)).byteLength <= MAX_LIST_BYTES).slice(-2);
      }
    } catch { cache = {}; pendingWindows = []; pendingLists = []; } // An unusable optional cache never becomes evidence.
  }
  let through = requestedThrough;
  let mapped: ReturnType<typeof mapCorosWorkouts> | undefined;
  const listWindow = `${from}/${requestedThrough}`;
  const sequence = progress.request?.sequence ?? 0;
  const savedList = pendingLists.find(entry => entry.window === listWindow && entry.sequence === sequence);
  if (savedList && savedList.through >= from && savedList.through <= requestedThrough) {
    try {
      mapped = mapCorosWorkouts(savedList.result, { startDate: shiftDate(from, -1), endDate: shiftDate(savedList.through, 1), timezone: progress.timezone });
      if (mapped.reportedCount >= 20) mapped = undefined;
      else through = savedList.through;
    } catch { mapped = undefined; } // Invalid optional evidence is fetched again.
  }
  if (mapped) await assertActive();
  for (; !mapped;) {
    // Padding covers the observed one-day discrepancy between headings and epoch timestamps.
    const result = await read("querySportRecords", { startDate: shiftDate(from, -1).replaceAll("-", ""), endDate: shiftDate(through, 1).replaceAll("-", ""),
      limit: 20, sportTypeCodes: [65535], locationKeyword: "", maxAveragePace: "", minDistanceKm: 0, maxDistanceKm: 1000000, minDurationMinutes: 0, maxDurationMinutes: 1000000 });
    await assertActive();
    mapped = mapCorosWorkouts(result, { startDate: shiftDate(from, -1), endDate: shiftDate(through, 1), timezone: progress.timezone });
    if (mapped.reportedCount < 20) {
      // Only reuse the complete list while reading bounded detail continuations
      // of this exact observation. A new observation always fetches a fresh list.
      if (new TextEncoder().encode(JSON.stringify(result)).byteLength <= MAX_LIST_BYTES) {
        pendingLists = [...pendingLists.filter(entry => entry.window !== listWindow),
          { window: listWindow, through, sequence, savedAt: Date.now(), result }].slice(-2);
      }
      break;
    }
    mapped = undefined;
    const span = Math.round((Date.parse(through) - Date.parse(from)) / 86400000);
    if (span === 0) throw new Error("COROS_SYNC_WINDOW_TRUNCATED");
    through = shiftDate(from, Math.floor(span / 2));
  }
  const localDates = new Map(mapped.items.map(workout => [workout.sourceId, todayInTimezone(new Date(workout.candidate.start_at), progress.timezone)]));
  const localDate = (workout: Workout) => localDates.get(workout.sourceId)!;
  const today = todayInTimezone(new Date(observedAt), progress.timezone);
  const workouts = mapped.items.filter(workout => localDate(workout) >= from && localDate(workout) <= through);
  const windowId = `${from}/${through}`;
  const wasPending = pendingWindows.some(([id]) => id === windowId);
  pendingWindows = [...pendingWindows.filter(([id]) => id !== windowId), [windowId, workouts.map(workout => workout.sourceId)] as PendingWindow].slice(-2);
  const remember = async () => {
    if (!encryptionKey || !progress.health) return;
    // Both in-flight windows survive fair recent/history rotation at capacity.
    const currentIds = new Set([...workouts.map(workout => workout.sourceId), ...pendingWindows.flatMap(([, ids]) => ids)]);
    const pinned = Object.entries(cache).filter(([id]) => currentIds.has(id));
    const others = Object.entries(cache).filter(([id]) => !currentIds.has(id)).sort((a, b) => a[1].date.localeCompare(b[1].date));
    const entries = [...others.slice(-Math.max(0, 256 - pinned.length)), ...pinned];
    progress.health.encryptedActivityCache = await encryptRefreshToken(JSON.stringify({ version: 1, timezone: progress.timezone, entries, pendingWindows, pendingLists }), encryptionKey);
    await checkpoint?.();
  };
  const observationSequence = progress.health?.recentObservationSequence ?? progress.request?.sequence ?? 0;
  let reads = 0;
  for (const workout of workouts) {
    const signature = JSON.stringify([1, workout.candidate.start_at, workout.candidate.end_at, workout.candidate.metrics_json.moving_seconds, workout.candidate.metrics_json.coros_sport_type]);
    const cached = cache[workout.sourceId];
    // Today's mutable activities refresh for a new observation, while partial
    // same-day continuation and historical identities reuse encrypted facts.
    if (cached?.signature === signature && (cached.date < today || cached.requestSequence === observationSequence)) continue;
    if (reads === detailLimit) {
      // A bounded batch with saved, validated details is normal continuation.
      // It cannot establish a daily total until every listed detail is known.
      return { items: [] as CorosHealthMetricItem[], through,
        continuation: { detailsRead: encryptionKey && progress.health ? reads : 0 } };
    }
    const result = await read("getActivityDetail", { labelId: workout.sourceId.slice(8), sportType: workout.candidate.metrics_json.coros_sport_type });
    reads++; await assertActive();
    cache[workout.sourceId] = { signature, date: localDate(workout), requestSequence: observationSequence, ...mapCorosActivityDetail(result, workout) };
    await remember();
  }
  pendingWindows = pendingWindows.filter(([id]) => id !== windowId);
  pendingLists = pendingLists.filter(entry => entry.window !== listWindow);
  if (reads || wasPending) await remember();
  const items: CorosHealthMetricItem[] = [];
  for (let date = from; date <= through; date = shiftDate(date, 1)) {
    const day = workouts.filter(workout => localDate(workout) === date);
    for (const [field, metric, unit] of [["elevationGainMeters", "elevation_gain", "m"], ["trainingLoad", "training_load", "load"]] as const) {
      const values = day.map(workout => cache[workout.sourceId][field]);
      if (values.some(value => value === null)) continue;
      items.push({ sourceId: `health:${date}:${metric}:daily`, measurementTimeKind: "observed_at",
        candidate: { metric_type: metric, value: values.reduce<number>((sum, value) => sum + value!, 0), unit, local_date: date,
          timezone: progress.timezone, measured_at: observedAt, aggregation_period: "daily" } });
    }
  }
  return { items, through, continuation: undefined };
}
