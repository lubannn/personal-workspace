import { describe, expect, it } from "vitest";
import { mapCorosSleep, mapCorosWorkouts } from "./coros-sync-mapping";
import type { CorosReadResult } from "./coros-read-client";
import { validWorkoutCandidate } from "../../../src/lib/github-data/health-staging-records";

// All examples below are synthetic, not copied from an account response.
const options = { startDate: "20240102", endDate: "20240102", timezone: "Asia/Shanghai" };
const result = (text: string, encoded = true): CorosReadResult => ({ format: "content", payload: [{ type: "text", text: encoded ? JSON.stringify(text) : text }] });
const prefix = "Sleep Overview\n========================\nNote: each record below is dated by its wake-up day.\n\n";
const modern = `${prefix}2024-01-02
Sleep Score: 80
Daily Sleep: 8h 15min (incl. naps)
Main Sleep (asleep): 7h 30min
Main Sleep Period (incl. awake): 8h 0min
Sleep metrics scope: daily
Deep Sleep Ratio: 20%
Light Sleep Ratio: 50%
REM Ratio: 25%
Awake Ratio: 5%
Awake Time: 30 min
Awake Count (>5 min): 2
Main Sleep Window: 2024-01-01 23:00 - 2024-01-02 07:00
Naps Total (asleep): 45 min
Naps Period (incl. awake): 1h 0min
Nap Window: 2024-01-02 13:00 - 2024-01-02 14:00`;
const legacy = `${prefix}2024-01-02
Sleep Score: 70
Main Sleep: 8h 0min
Awake Time: 30 min
Main Sleep Window: 2024-01-01 23:00 - 2024-01-02 07:00
Naps Total: 30 min (includes legacy reported durations)
Nap Window: 2024-01-02 12:00 - 2024-01-02 12:30`;
const workout = `Sport Records — 2024-01-02 to 2024-01-02 (1 records)
========================

1. Outdoor Run — 2024-01-02
   Location: Synthetic location
   Start Coordinates: 1.2, 3.4
   Time Window: startTimestamp=1704153600 | endTimestamp=1704157200
   Duration: 50:00 | Distance: 6.25 km
   Average Pace: 8:00 /km | Avg HR: 120 bpm | Calories: 350 kcal
   LabelId: 123456789012345678 | SportType: 100`;
const strength = workout.replace("Outdoor Run", "Strength Training")
  .replace("Duration: 50:00 | Distance: 6.25 km", "Duration: 45:00 | Sets: 24")
  .replace("   Average Pace: 8:00 /km | Avg HR: 120 bpm | Calories: 350 kcal", " | Avg HR: 105 bpm | Calories: 210 kcal")
  .replace("SportType: 100", "SportType: 402");

describe("strict COROS sleep text mapping", () => {
  it("keeps window duration separate from explicit asleep and uses wake date for identity", () => {
    const mapped = mapCorosSleep(result(modern), options);
    expect(mapped.reportedCount).toBe(1);
    expect(mapped.items).toHaveLength(2);
    expect(mapped.items[0]).toEqual({ kind: "sleep", sourceId: "sleep:2024-01-02:main", candidate: {
      start_at: "2024-01-01T15:00:00.000Z", end_at: "2024-01-01T23:00:00.000Z", local_date: "2024-01-01",
      timezone: "Asia/Shanghai", session_type: "main_sleep", duration_minutes: 480,
    }, metrics: { asleep_minutes: 450, awake_minutes: null, score: 80, wake_date: "2024-01-02" } });
    expect(mapped.items[1]).toMatchObject({ sourceId: "sleep:2024-01-02:nap:2024-01-02T05:00:00.000Z", metrics: { asleep_minutes: 45, awake_minutes: 15, score: null } });
  });
  it("does not pretend ambiguous legacy periods are asleep durations", () => {
    const mapped = mapCorosSleep(result(legacy, false), options);
    expect(mapped.items[0].candidate.duration_minutes).toBe(480);
    expect(mapped.items[0].metrics).toMatchObject({ asleep_minutes: null, awake_minutes: null });
    expect(mapped.items[1].metrics).toMatchObject({ asleep_minutes: null, awake_minutes: null });
  });
  it("never apportions a total asleep duration between multiple naps", () => {
    const input = modern.replace("Naps Period (incl. awake): 1h 0min\nNap Window: 2024-01-02 13:00 - 2024-01-02 14:00", "Naps Period (incl. awake): 1h 0min\nNap Window: 2024-01-02 12:00 - 2024-01-02 12:30\nNap Window: 2024-01-02 13:00 - 2024-01-02 13:30");
    expect(mapCorosSleep(result(input), options).items.slice(1).every(item => item.metrics.asleep_minutes === null)).toBe(true);
  });
  it("does not assign daily awake totals to main sleep or require them to equal its period difference", () => {
    const input = modern.replace("Awake Time: 30 min", "Awake Time: 45 min");
    const mapped = mapCorosSleep(result(input), options);
    expect(mapped.items[0].metrics).toMatchObject({ asleep_minutes: 450, awake_minutes: null });
    expect(mapped.items[1].metrics).toMatchObject({ asleep_minutes: 45, awake_minutes: 15 });
    const mainScoped = modern.replace("Sleep metrics scope: daily", "Sleep metrics scope: main");
    expect(mapCorosSleep(result(mainScoped), options).items[0].metrics.awake_minutes).toBe(30);
  });
  it("accepts modern main sleep with the explicit legacy zero-naps label", () => {
    const input = modern.replace("Daily Sleep: 8h 15min", "Daily Sleep: 7h 30min")
      .replace("Naps Total (asleep): 45 min\nNaps Period (incl. awake): 1h 0min\nNap Window: 2024-01-02 13:00 - 2024-01-02 14:00", "Naps Total: 0 min");
    expect(mapCorosSleep(result(input), options).items).toHaveLength(1);
    expect(() => mapCorosSleep(result(input.replace("Naps Total: 0 min", "Naps Total: 5 min")), options)).toThrow();
    expect(() => mapCorosSleep(result(input + "\nNap Window: 2024-01-02 13:00 - 2024-01-02 14:00"), options)).toThrow();
  });
  it("leaves per-episode awake and asleep unknown for multiple naps when only daily totals are supplied", () => {
    const input = modern.replace("Awake Time: 30 min", "Awake Time: 45 min")
      .replace("Nap Window: 2024-01-02 13:00 - 2024-01-02 14:00", "Nap Window: 2024-01-02 12:00 - 2024-01-02 12:30\nNap Window: 2024-01-02 13:00 - 2024-01-02 13:30");
    const mapped = mapCorosSleep(result(input), options);
    expect(mapped.items).toHaveLength(3);
    expect(mapped.items[0].metrics.awake_minutes).toBeNull();
    expect(mapped.items.slice(1).map(item => item.metrics)).toEqual([
      { asleep_minutes: null, awake_minutes: null, score: null, wake_date: "2024-01-02" },
      { asleep_minutes: null, awake_minutes: null, score: null, wake_date: "2024-01-02" },
    ]);
  });
  it("accepts explicit unavailable days, retaining complete date coverage", () => {
    expect(mapCorosSleep(result(`${prefix}2024-01-02\nSleep detail for this day is not available yet.`), options)).toEqual({ items: [], reportedCount: 1 });
    expect(mapCorosSleep(result(`${modern}\n\n2024-01-03\nSleep detail for this day is not available yet.`), { ...options, endDate: "20240103" }).reportedCount).toBe(2);
  });
  it.each([true, false])("accepts the exact empty sleep response for at most three requested days (encoded=%s)", encoded => {
    for (const endDate of ["20240102", "20240103", "20240104"]) {
      expect(mapCorosSleep(result("No sleep overview data found.", encoded), { ...options, endDate })).toEqual({ items: [], reportedCount: 0 });
    }
    expect(mapCorosSleep(result("No sleep overview data found.", encoded), { ...options, startDate: "20240228", endDate: "20240301" })).toEqual({ items: [], reportedCount: 0 });
  });
  it("refuses unscoped empty sleep responses for ranges the tool could truncate", () => {
    expect(() => mapCorosSleep(result("No sleep overview data found."), { ...options, endDate: "20240105" })).toThrow("COROS_SYNC_FORMAT_UNSUPPORTED");
    for (const input of ["", "No sleep overview data found", "No sleep overview data found.\nMore records omitted.", "No sleep data found."]) {
      expect(() => mapCorosSleep(result(input), options)).toThrow("COROS_SYNC_FORMAT_UNSUPPORTED");
    }
  });
  it("accepts the same reviewed grammar from structured text", () => {
    expect(mapCorosSleep({ format: "structured", payload: { text: modern } }, options).items).toHaveLength(2);
  });
  it.each([
    modern.replace("Sleep Score: 80\n", ""),
    modern.replace("01-01 23:00", "01-01 24:00"),
    modern.replace("Main Sleep Period (incl. awake): 8h 0min", "Main Sleep Period (incl. awake): 9h 0min"),
    modern.replace("8h 15min (incl. naps)", "8h 10min (incl. naps)"),
    modern.replace("7h 30min", "9h 30min"),
    modern.replace("Sleep Score: 80", "Sleep Score: 101"),
    modern.replace("Awake Time: 30 min", "Awake Time: 600 min"),
    modern.replace("Sleep metrics scope: daily", "Sleep metrics scope: main").replace("Awake Time: 30 min", "Awake Time: 20 min"),
    modern.replace("Nap Window: 2024-01-02 13:00 - 2024-01-02 14:00", "Nap Window: 2024-01-02 06:00 - 2024-01-02 07:00"),
    modern + "\nUnknown field: 2",
    modern + "\nSleep Score: 80",
    modern.replace("2024-01-01 23:00", "2024-02-30 23:00"),
    modern.replace("2024-01-02 07:00", "2024-01-03 07:00"),
    `${prefix}2024-01-02\nSleep detail for this day is not available yet.\n...`,
  ])("rejects malformed, contradictory, or unknown output without a partial result", input => {
    expect(() => mapCorosSleep(result(input), options)).toThrow("COROS_SYNC_FORMAT_UNSUPPORTED");
  });
  it("rejects omitted days and duplicate day sections", () => {
    expect(() => mapCorosSleep(result(modern), { ...options, endDate: "20240103" })).toThrow();
    expect(() => mapCorosSleep(result(`${modern}\n\n${modern.slice(prefix.length)}`), options)).toThrow();
  });
  it("requires a supported configured timezone and valid dates", () => {
    expect(() => mapCorosSleep(result(modern), { ...options, timezone: "UTC" })).toThrow("COROS_SYNC_TIMEZONE_UNSUPPORTED");
    expect(() => mapCorosSleep(result(modern), { ...options, startDate: "20240230" })).toThrow();
  });
});

describe("strict COROS workout text mapping", () => {
  it("uses exact timestamps for elapsed duration and keeps reported active duration separately", () => {
    const mapped = mapCorosWorkouts(result(workout), options);
    expect(mapped.reportedCount).toBe(1);
    const item = mapped.items[0];
    expect(item.sourceId).toBe("workout:123456789012345678");
    expect(item.candidate).toMatchObject({ activity_type: "run", duration_seconds: 3600, distance: 6250,
      metrics_json: { elapsed_seconds: 3600, moving_seconds: 3000, average_heart_rate_bpm: 120, calories: 350, trackpoints: 0 } });
    expect(validWorkoutCandidate(item.candidate)).toBe(true);
    expect(JSON.stringify(mapped)).not.toMatch(/Synthetic location|Coordinates|1\.2|3\.4/u);
  });
  it("supports set-based activities without guessing distance", () => {
    const input = workout.replace("Distance: 6.25 km", "Sets: 500").replace("SportType: 100", "SportType: 901");
    expect(mapCorosWorkouts(result(input), options).items[0].candidate).toMatchObject({ activity_type: "other", distance: null });
  });
  it.each([true, false])("accepts a no-pace strength metric row with the exact leading separator (encoded=%s)", encoded => {
    const mapped = mapCorosWorkouts(result(strength, encoded), options);
    expect(mapped.reportedCount).toBe(1);
    expect(mapped.items[0].candidate).toMatchObject({ activity_type: "strength", duration_seconds: 3600, distance: null,
      metrics_json: { elapsed_seconds: 3600, moving_seconds: 2700, average_heart_rate_bpm: 105, calories: 210 } });
    expect(validWorkoutCandidate(mapped.items[0].candidate)).toBe(true);
  });
  it.each([
    strength.replace(" | Avg HR:", "Avg HR:"),
    strength.replace(" | Avg HR:", "  | Avg HR:"),
    strength.replace(" | Avg HR:", " | Unknown:"),
    strength.replace(" | Avg HR: 105 bpm", " | Average Pace: 8:00 /km"),
    strength.replace(" | Avg HR: 105 bpm", " | Time Window: startTimestamp=1704153600"),
    strength.replace(" | Avg HR: 105 bpm", " | Location: Synthetic location"),
    strength.replace("Avg HR: 105 bpm", "Avg HR:105 bpm"),
    strength.replace("Avg HR: 105 bpm", "Avg HR: 105 beats/min"),
    strength.replace("Calories: 210 kcal", "Calories: 210 kJ"),
    strength.replace("Calories: 210 kcal", "Calories: 210 kcal | Avg HR: 105 bpm"),
    strength + "\n   Calories: 210 kcal",
  ])("rejects malformed or unrestricted separator rows and duplicate metrics", input => {
    expect(() => mapCorosWorkouts(result(input), options)).toThrow("COROS_SYNC_FORMAT_UNSUPPORTED");
  });
  it("normalizes a one-second display rounding excess without changing exact workout timestamps", () => {
    const input = workout.replace("Outdoor Run", "Jump Rope").replace("endTimestamp=1704157200", "endTimestamp=1704154800")
      .replace("Duration: 50:00 | Distance: 6.25 km", "Duration: 20:01 | Sets: 500").replace("SportType: 100", "SportType: 901");
    const candidate = mapCorosWorkouts(result(input), options).items[0].candidate;
    expect(candidate).toMatchObject({ start_at: "2024-01-02T00:00:00.000Z", end_at: "2024-01-02T00:20:00.000Z",
      activity_type: "other", distance: null, duration_seconds: 1200, metrics_json: { elapsed_seconds: 1200, moving_seconds: 1200 } });
    expect(validWorkoutCandidate(candidate)).toBe(true);
    expect(mapCorosWorkouts(result(input.replace("Duration: 20:01", "Duration: 19:59")), options).items[0].candidate.metrics_json.moving_seconds).toBe(1199);
    expect(() => mapCorosWorkouts(result(input.replace("Duration: 20:01", "Duration: 20:02")), options)).toThrow("COROS_SYNC_FORMAT_UNSUPPORTED");
  });
  it("allows absent optional measurements", () => {
    const input = workout.replace(" | Distance: 6.25 km", "").replace("   Average Pace: 8:00 /km | Avg HR: 120 bpm | Calories: 350 kcal\n", "");
    expect(mapCorosWorkouts(result(input), options).items[0].candidate.metrics_json).toMatchObject({ calories: null, average_heart_rate_bpm: null });
  });
  it("accepts empty results only when the returned window matches the requested window", () => {
    expect(mapCorosWorkouts(result("No sport records found from 2024-01-02 to 2024-01-02."), options)).toEqual({ items: [], reportedCount: 0 });
    expect(() => mapCorosWorkouts(result("No sport records found from 2024-01-01 to 2024-01-02."), options)).toThrow();
  });
  it.each([
    workout.replace("(1 records)", "(2 records)"),
    workout.replace("   LabelId: 123456789012345678 | SportType: 100", ""),
    workout.replace("endTimestamp=1704157200", "endTimestamp=1704150000"),
    workout.replace("startTimestamp=1704153600 | endTimestamp=1704157200", "startTimestamp=1000 | endTimestamp=4600"),
    workout.replace("Duration: 50:00", "Duration: 70:00"),
    workout.replace("Duration: 50:00", "Duration: 50:99"),
    workout.replace("Distance: 6.25 km", "Distance: -1 km"),
    workout.replace("LabelId: 123456789012345678", "LabelId: 1.234e17"),
    workout + "\n   More records omitted: yes",
    workout.replace("   Time Window: startTimestamp=1704153600 | endTimestamp=1704157200\n", ""),
  ])("rejects incomplete and malformed records", input => {
    expect(() => mapCorosWorkouts(result(input), options)).toThrow("COROS_SYNC_FORMAT_UNSUPPORTED");
  });
  it("rejects unknown envelopes instead of guessing fields", () => {
    for (const response of [
      { format: "structured", payload: { records: [] } },
      { format: "content", payload: [{ type: "text", text: workout }, { type: "image", data: "unused" }] },
      { format: "content", payload: [{ type: "text", text: JSON.stringify({ records: [] }) }] },
    ] as CorosReadResult[]) expect(() => mapCorosWorkouts(response, options)).toThrow();
  });
});
