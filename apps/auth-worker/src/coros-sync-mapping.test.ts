import { describe, expect, it } from "vitest";
import { mapCorosSleep, mapCorosWorkouts } from "./coros-sync-mapping";
import type { CorosReadResult } from "./coros-read-client";
import { validWorkoutCandidate } from "../../../src/lib/github-data/health-staging-records";
import { createAutomaticSleepSessionData } from "../../../src/lib/github-data/sleep-sessions";

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
const napOnly = `${prefix}2024-01-02
Naps Total: 40 min (includes legacy reported durations)
Nap Window: 2024-01-02 19:00 - 2024-01-02 19:40`;
const yearCorrectionOptions = { ...options, startDate: "20250110", endDate: "20250110" };
const wrongYearNap = legacy.replaceAll("2024-01-02", "2025-01-10").replaceAll("2024-01-01", "2025-01-09")
  .replace("Nap Window: 2025-01-10 12:00 - 2025-01-10 12:30", "Nap Window: 1982-01-10 12:00 - 1982-01-10 12:30");
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
    }, metrics: { asleep_minutes: 450, awake_minutes: null, score: 80, wake_date: "2024-01-02", daily_sleep_minutes: 495 } });
    expect(mapped.items[1]).toMatchObject({ sourceId: "sleep:2024-01-02:nap:2024-01-02T05:00:00.000Z", metrics: { asleep_minutes: 45, awake_minutes: 15, score: null } });
  });
  it("does not pretend ambiguous legacy periods are asleep durations", () => {
    const mapped = mapCorosSleep(result(legacy, false), options);
    expect(mapped.items[0].candidate.duration_minutes).toBe(480);
    expect(mapped.items[0].metrics).toMatchObject({ asleep_minutes: null, awake_minutes: null });
    expect(mapped.items[1].metrics).toMatchObject({ asleep_minutes: null, awake_minutes: null });
  });
  it("retains a reported legacy daily total without deriving per-episode asleep durations", () => {
    const mapped = mapCorosSleep(result(legacy.replace("Sleep Score: 70", "Sleep Score: 70\nDaily Sleep: 8h 0min (incl. naps)")), options);
    expect(mapped.items[0].metrics).toMatchObject({ asleep_minutes: null, daily_sleep_minutes: 480 });
    expect(mapped.items[1].metrics).not.toHaveProperty("daily_sleep_minutes");
    for (const invalid of ["unknown", "8h 0min", "40h 0min (incl. naps)"]) {
      expect(() => mapCorosSleep(result(legacy.replace("Sleep Score: 70", `Sleep Score: 70\nDaily Sleep: ${invalid}`)), options)).toThrow("COROS_SYNC_FORMAT_UNSUPPORTED");
    }
  });
  it.each([true, false])("corrects only the authorized legacy 1982 nap year and retains exact original instants (encoded=%s)", encoded => {
    const mapped = mapCorosSleep(result(wrongYearNap, encoded), yearCorrectionOptions);
    expect(mapped.items).toHaveLength(2);
    expect(mapped.items[0].metrics).not.toHaveProperty("date_correction");
    const nap = mapped.items[1];
    expect(nap).toEqual({ kind: "sleep", sourceId: "sleep:2025-01-10:nap:2025-01-10T04:00:00.000Z",
      candidate: { start_at: "2025-01-10T04:00:00.000Z", end_at: "2025-01-10T04:30:00.000Z", local_date: "2025-01-10",
        timezone: "Asia/Shanghai", session_type: "nap", duration_minutes: 30 },
      metrics: { asleep_minutes: null, awake_minutes: null, score: null, wake_date: "2025-01-10", date_correction: {
        reason: "coros_legacy_nap_year_1982", original_start_at: "1982-01-10T04:00:00.000Z", original_end_at: "1982-01-10T04:30:00.000Z",
      } } });
    expect(createAutomaticSleepSessionData(nap.candidate, { kind: "coros_mcp", source_id: nap.sourceId, source_sha256: "a".repeat(64),
      mapping_version: 1, retrieved_at: "2025-01-11T00:00:00.000Z" }, nap.metrics).sleep_metrics_json).toEqual(nap.metrics);
    const upstreamFixed = wrongYearNap.replaceAll("1982-01-10", "2025-01-10");
    const normalNap = mapCorosSleep(result(upstreamFixed), yearCorrectionOptions).items[1];
    expect(normalNap.sourceId).toBe(nap.sourceId);
    expect(normalNap.metrics).not.toHaveProperty("date_correction");
  });
  it("applies the same correction to a nap-only day across the UTC year boundary", () => {
    const input = `${prefix}2025-01-01\nNaps Total: 20 min (includes legacy reported durations)\nNap Window: 1982-01-01 00:10 - 1982-01-01 00:30`;
    const mapped = mapCorosSleep(result(input), { ...options, startDate: "20250101", endDate: "20250101" });
    expect(mapped.items).toHaveLength(1);
    expect(mapped.items[0]).toMatchObject({ candidate: { start_at: "2024-12-31T16:10:00.000Z", end_at: "2024-12-31T16:30:00.000Z", duration_minutes: 20 },
      metrics: { date_correction: { original_start_at: "1981-12-31T16:10:00.000Z", original_end_at: "1981-12-31T16:30:00.000Z" } } });
  });
  it.each([
    { date: "2025-01-10", previous: "2025-01-09", originalStart: "1982-01-09", originalEnd: "1982-01-10" },
    { date: "2025-01-01", previous: "2024-12-31", originalStart: "1981-12-31", originalEnd: "1982-01-01" },
  ])("anchors an overnight legacy nap to its wake date and retains the preceding start date ($date)", sample => {
    const input = `${prefix}${sample.date}\nNaps Total: 30 min (includes legacy reported durations)\nNap Window: ${sample.originalStart} 23:45 - ${sample.originalEnd} 00:15`;
    const mapped = mapCorosSleep(result(input), { ...options, startDate: sample.date, endDate: sample.date });
    const nap = mapped.items[0];
    expect(nap.candidate).toMatchObject({ local_date: sample.previous, duration_minutes: 30,
      start_at: new Date(`${sample.previous}T23:45:00+08:00`).toISOString(), end_at: new Date(`${sample.date}T00:15:00+08:00`).toISOString() });
    expect(nap.metrics).toMatchObject({ wake_date: sample.date, date_correction: {
      original_start_at: new Date(`${sample.originalStart}T23:45:00+08:00`).toISOString(),
      original_end_at: new Date(`${sample.originalEnd}T00:15:00+08:00`).toISOString() } });
    expect(createAutomaticSleepSessionData(nap.candidate, { kind: "coros_mcp", source_id: nap.sourceId, source_sha256: "a".repeat(64),
      mapping_version: 1, retrieved_at: "2025-01-11T00:00:00.000Z" }, nap.metrics).sleep_metrics_json).toEqual(nap.metrics);
  });
  it("rejects a legacy correction crossing more than one local date even within the maximum duration", () => {
    const input = `${prefix}2025-01-10\nNaps Total: 24h 30min (includes legacy reported durations)\nNap Window: 1982-01-08 23:45 - 1982-01-10 00:15`;
    expect(() => mapCorosSleep(result(input), yearCorrectionOptions)).toThrow("COROS_SYNC_FORMAT_UNSUPPORTED");
  });
  it.each([
    wrongYearNap.replaceAll("1982-01-10", "1983-01-10"),
    wrongYearNap.replaceAll("1982-01-10", "1982-02-10"),
    wrongYearNap.replaceAll("1982-01-10", "1982-01-11"),
    wrongYearNap.replace("1982-01-10 12:00 - 1982-01-10 12:30", "1982-01-10 23:50 - 1982-01-11 00:20"),
    wrongYearNap.replace(" (includes legacy reported durations)", ""),
    wrongYearNap + "\nNaps Total (asleep): 30 min",
    wrongYearNap + "\nNaps Period (incl. awake): 30 min",
    wrongYearNap.replace("Main Sleep Window: 2025-01-09 23:00 - 2025-01-10 07:00", "Main Sleep Window: 1982-01-09 23:00 - 1982-01-10 07:00"),
    wrongYearNap.replace("1982-01-10 12:00 - 1982-01-10 12:30", "1982-01-10 06:45 - 1982-01-10 07:15"),
  ])("refuses broader or ambiguous date repairs and corrected overlaps", input => {
    expect(() => mapCorosSleep(result(input), yearCorrectionOptions)).toThrow("COROS_SYNC_FORMAT_UNSUPPORTED");
  });
  it("does not apply the exceptional year correction outside the authorized modern history", () => {
    const input = wrongYearNap.replaceAll("2025-01-10", "2024-01-10").replaceAll("2025-01-09", "2024-01-09");
    expect(() => mapCorosSleep(result(input), { ...options, startDate: "20240110", endDate: "20240110" })).toThrow("COROS_SYNC_FORMAT_UNSUPPORTED");
  });
  it.each([true, false])("accepts legacy nap-only days without inventing main sleep or score (encoded=%s)", encoded => {
    expect(mapCorosSleep(result(napOnly, encoded), options)).toEqual({ reportedCount: 1, items: [{
      kind: "sleep", sourceId: "sleep:2024-01-02:nap:2024-01-02T11:00:00.000Z",
      candidate: { start_at: "2024-01-02T11:00:00.000Z", end_at: "2024-01-02T11:40:00.000Z",
        local_date: "2024-01-02", timezone: "Asia/Shanghai", session_type: "nap", duration_minutes: 40 },
      metrics: { asleep_minutes: null, awake_minutes: null, score: null, wake_date: "2024-01-02" },
    }] });
  });
  it("validates the combined period of multiple legacy naps without apportioning asleep time", () => {
    const input = napOnly.replace("19:40", "19:20") + "\nNap Window: 2024-01-02 20:00 - 2024-01-02 20:20";
    const mapped = mapCorosSleep(result(input), options);
    expect(mapped.items.map(item => item.candidate.duration_minutes)).toEqual([20, 20]);
    expect(mapped.items.every(item => item.metrics.asleep_minutes === null && item.metrics.score === null)).toBe(true);
  });
  it.each([false, true])("accepts the unavailable-score layout for a nap-only day, with optional legacy year correction (%s)", corrected => {
    const date = "2025-01-10";
    const input = `${prefix}${date}\nSleep Score: -1\nDaily Sleep: 40min (incl. naps)\nDeep Sleep Ratio: 0%\nLight Sleep Ratio: 100%\nREM Ratio: 0%\nAwake Ratio: 0%\nAwake Time: 0 min\nAwake Count (>5 min): 0\nNaps Total: 40 min (includes legacy reported durations)\nNap Window: ${corrected ? "1982-01-10" : date} 19:00 - ${corrected ? "1982-01-10" : date} 19:40`;
    const mapped = mapCorosSleep(result(input), yearCorrectionOptions);
    expect(mapped.items).toHaveLength(1);
    expect(mapped.items[0]).toMatchObject({ candidate: { session_type: "nap", duration_minutes: 40, local_date: date },
      metrics: { asleep_minutes: null, awake_minutes: null, score: null, wake_date: date } });
    expect(Boolean(mapped.items[0].metrics.date_correction)).toBe(corrected);
    for (const invalid of [
      input.replace("Sleep Score: -1", "Sleep Score: 0"), input.replace("Sleep Score: -1", "Sleep Score: -2"),
      input.replace("Daily Sleep: 40min", "Daily Sleep: 41min"), input.replace("Daily Sleep: 40min (incl. naps)\n", ""),
      input.replace("Light Sleep Ratio: 100%", "Light Sleep Ratio: 101%"), input.replace("Awake Ratio: 0%", "Awake Ratio: unknown"),
      input.replace("Awake Time: 0 min", "Awake Time: 41 min"), input.replace("Awake Count (>5 min): 0", "Awake Count (>5 min): -1"),
      input + "\nMain Sleep: 1h 0min", input + "\nMain Sleep (asleep): 0 min", input + "\nSleep metrics scope: main",
    ]) expect(() => mapCorosSleep(result(invalid), yearCorrectionOptions)).toThrow("COROS_SYNC_FORMAT_UNSUPPORTED");
  });
  it.each([
    napOnly.replace("Naps Total: 40 min", "Naps Total: 41 min"),
    napOnly.replace("19:40", "19:20") + "\nNap Window: 2024-01-02 19:10 - 2024-01-02 19:30",
    napOnly.replace("2024-01-02 19:40", "2024-01-03 19:40"),
    napOnly + "\nMain Sleep: 8h 0min",
    napOnly + "\nMain Sleep Unknown: 8h 0min",
    napOnly + "\nSleep Score: 80",
    napOnly.replace("\nNap Window: 2024-01-02 19:00 - 2024-01-02 19:40", ""),
  ])("rejects contradictory or unrecognized nap-only days", input => {
    expect(() => mapCorosSleep(result(input), options)).toThrow("COROS_SYNC_FORMAT_UNSUPPORTED");
  });
  it("validates modern nap-only totals without apportioning daily asleep time across naps", () => {
    const input = `${prefix}2024-01-02\nSleep Score: -1\nDaily Sleep: 50min (incl. naps)\nSleep metrics scope: daily\nNaps Total (asleep): 50 min\nNaps Period (incl. awake): 1h 0min\nNap Window: 2024-01-02 12:00 - 2024-01-02 12:20\nNap Window: 2024-01-02 16:00 - 2024-01-02 16:40`;
    const mapped = mapCorosSleep(result(input), options);
    expect(mapped.items).toHaveLength(2);
    expect(mapped.items.map(item => item.metrics)).toEqual([
      { asleep_minutes: null, awake_minutes: null, score: null, wake_date: "2024-01-02", daily_sleep_minutes: 50 },
      { asleep_minutes: null, awake_minutes: null, score: null, wake_date: "2024-01-02" },
    ]);
    const single = input.replace("Nap Window: 2024-01-02 12:00 - 2024-01-02 12:20\nNap Window: 2024-01-02 16:00 - 2024-01-02 16:40", "Nap Window: 2024-01-02 12:00 - 2024-01-02 13:00");
    expect(mapCorosSleep(result(single), options).items[0].metrics).toEqual({ asleep_minutes: 50, awake_minutes: 10, score: null, wake_date: "2024-01-02", daily_sleep_minutes: 50 });
    for (const invalid of [input.replace("Sleep Score: -1", "Sleep Score: 70"), input.replaceAll("50min", "51min"),
      input.replace("Naps Total (asleep): 50 min", "Naps Total (asleep): 61 min"),
      input.replace("Naps Period (incl. awake): 1h 0min", "Naps Period (incl. awake): 59 min"),
      input.replace("Sleep metrics scope: daily", "Sleep metrics scope: main"), input + "\nNaps Total: 1h 0min",
      input.replace("16:00 - 2024-01-02 16:40", "12:10 - 2024-01-02 12:50")]) {
      expect(() => mapCorosSleep(result(invalid), options)).toThrow("COROS_SYNC_FORMAT_UNSUPPORTED");
    }
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
  it("accepts only the exact zero-score unavailable layout without inventing a sleep record", () => {
    const input = `${prefix}2024-01-02\nSleep Score: 0\nSleep detail for this day is not available yet.`;
    expect(mapCorosSleep(result(input), options)).toEqual({ items: [], reportedCount: 1 });
    for (const invalid of [input.replace("Sleep Score: 0", "Sleep Score: -1"), input.replace("Sleep Score: 0", "Sleep Score: 75"), input + "\nNaps Total: 0 min"]) {
      expect(() => mapCorosSleep(result(invalid), options)).toThrow("COROS_SYNC_FORMAT_UNSUPPORTED");
    }
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
