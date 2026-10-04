import { describe, expect, it } from "vitest";
import type { CorosProvenance } from "./coros-sync-types";
import type { CorosWorkoutCandidate, SleepSessionCandidate } from "./health-staging-records";
import { createAutomaticWorkoutData, parseWorkoutRecord } from "./workouts";
import { createAutomaticSleepSessionData, parseSleepSessionRecord, type CorosSleepMetrics } from "./sleep-sessions";
import { createAutomaticHealthMetricData, parseHealthMetricRecord } from "./health-metrics";
import { createWorkspaceRecord, recordPath, serializeRecord } from "./protocol";
import { buildPortableWorkspaceExport, inspectPortableWorkspaceExport } from "./portable-export";
import { createPortableRestorePlan } from "./portable-restore";
import { acceptCorosSourceRevision, createCorosSyncConflictRecord } from "./coros-sync-conflicts";
import { dryRunPortableWorkspaceMigrations } from "./schema-migrations";

const timestamp = "2024-02-02T01:00:00.000Z";
const provenance: CorosProvenance = { kind: "coros_mcp", source_id: "synthetic:record:1", source_sha256: "a".repeat(64), mapping_version: 1, retrieved_at: timestamp };
const sleep: SleepSessionCandidate = { start_at: "2024-02-01T15:00:00.000Z", end_at: "2024-02-01T23:00:00.000Z", local_date: "2024-02-01", timezone: "Asia/Shanghai", session_type: "main_sleep", duration_minutes: 480 };
const sleepMetrics = { asleep_minutes: 465, awake_minutes: 15, score: 85, wake_date: "2024-02-02" };
const correctedNap: SleepSessionCandidate = { start_at: "2025-01-10T04:00:00.000Z", end_at: "2025-01-10T04:30:00.000Z",
  local_date: "2025-01-10", timezone: "Asia/Shanghai", session_type: "nap", duration_minutes: 30 };
const correctedMetrics: CorosSleepMetrics = { asleep_minutes: null, awake_minutes: null, score: null, wake_date: "2025-01-10",
  date_correction: { reason: "coros_legacy_nap_year_1982", original_start_at: "1982-01-10T04:00:00.000Z", original_end_at: "1982-01-10T04:30:00.000Z" } };
const workout: CorosWorkoutCandidate = {
  activity_type: "run", start_at: "2024-02-01T01:00:00.000Z", end_at: "2024-02-01T01:30:00.000Z", timezone: "Asia/Shanghai",
  duration_seconds: 1800, distance: 4000, distance_unit: "m", training_load: null,
  metrics_json: { elapsed_seconds: 1800, moving_seconds: null, calories: null, average_heart_rate_bpm: null, maximum_heart_rate_bpm: null, average_cadence_rpm: null, average_power_watts: null, trackpoints: 0 },
};

function automaticRecords() {
  return {
    workout: createWorkspaceRecord({ entityType: "workout", id: "workout_coros_synthetic", ownerId: "github_fixture", timestamp, data: createAutomaticWorkoutData(workout, provenance) }),
    sleep: createWorkspaceRecord({ entityType: "sleep_session", id: "sleep_coros_synthetic", ownerId: "github_fixture", timestamp, data: createAutomaticSleepSessionData(sleep, provenance, sleepMetrics) }),
    metric: createWorkspaceRecord({ entityType: "health_metric", id: "metric_coros_synthetic", ownerId: "github_fixture", timestamp, data: createAutomaticHealthMetricData({ metric_type: "resting_heart_rate", measured_at: timestamp, local_date: "2024-02-02", timezone: "Asia/Shanghai", value: 60, unit: "bpm", aggregation_period: "daily" }, provenance) }),
  };
}

describe("automatic COROS canonical records", () => {
  it("round-trips verified automatic provenance without inventing user confirmation or staging", () => {
    const records = automaticRecords();
    expect(parseWorkoutRecord(serializeRecord(records.workout))).toEqual(records.workout);
    expect(parseSleepSessionRecord(serializeRecord(records.sleep))).toEqual(records.sleep);
    expect(parseHealthMetricRecord(serializeRecord(records.metric))).toEqual(records.metric);
    for (const record of Object.values(records)) {
      expect(record.data).toMatchObject({ import_mode: "automatic", review_status: "validated", source: provenance });
      expect(record.data).not.toHaveProperty("confirmation_status");
      expect(record.data).not.toHaveProperty("staging_record_id");
      expect(record.data).not.toHaveProperty("user_adjusted");
    }
  });

  it("keeps elapsed sleep window, actual asleep time and wake-day distinct", () => {
    const data = automaticRecords().sleep.data;
    expect(data).toMatchObject({ duration_minutes: 480, local_date: "2024-02-01", sleep_metrics_json: { asleep_minutes: 465, awake_minutes: 15, wake_date: "2024-02-02" } });
    expect(() => createAutomaticSleepSessionData(sleep, provenance, { ...sleepMetrics, wake_date: "2024-02-01" })).toThrow("INVALID_SLEEP_SESSION_DETAILS");
    expect(() => createAutomaticSleepSessionData(sleep, provenance, { ...sleepMetrics, asleep_minutes: 500 })).toThrow("INVALID_SLEEP_SESSION_DETAILS");
    expect(() => createAutomaticSleepSessionData(sleep, provenance, { ...sleepMetrics, awake_minutes: 50 })).toThrow("INVALID_SLEEP_SESSION_DETAILS");
    expect(() => createAutomaticSleepSessionData({ ...sleep, session_type: "unknown" }, provenance, sleepMetrics)).toThrow("INVALID_SLEEP_SESSION_DETAILS");
    expect(() => createAutomaticSleepSessionData(sleep, provenance, { ...sleepMetrics, score: 101 })).toThrow("INVALID_SLEEP_SESSION_DETAILS");
  });
  it("accepts a separate daily total above a single episode duration while rejecting invalid totals", () => {
    const data = createAutomaticSleepSessionData(sleep, provenance, { ...sleepMetrics, daily_sleep_minutes: 600 });
    const record = createWorkspaceRecord({ entityType: "sleep_session", id: "daily_total", ownerId: "github_fixture", timestamp, data });
    expect(parseSleepSessionRecord(serializeRecord(record)).data.sleep_metrics_json).toMatchObject({ daily_sleep_minutes: 600, asleep_minutes: 465 });
    for (const value of [-1, 2161, 30.5, NaN, null, "600"]) {
      expect(() => createAutomaticSleepSessionData(sleep, provenance, { ...sleepMetrics, daily_sleep_minutes: value as number })).toThrow("INVALID_SLEEP_SESSION_DETAILS");
    }
  });

  it("validates the exact legacy nap correction and rejects arbitrary date edits or invented measurements", () => {
    const record = createWorkspaceRecord({ entityType: "sleep_session", id: "sleep_corrected_nap", ownerId: "github_fixture", timestamp,
      data: createAutomaticSleepSessionData(correctedNap, provenance, correctedMetrics) });
    expect(parseSleepSessionRecord(serializeRecord(record))).toEqual(record);
    for (const dateCorrection of [
      null, { ...correctedMetrics.date_correction, reason: "guessed" },
      { ...correctedMetrics.date_correction, original_start_at: "1983-01-10T04:00:00.000Z" },
      { ...correctedMetrics.date_correction, original_start_at: "1982-01-11T04:00:00.000Z" },
      { ...correctedMetrics.date_correction, original_start_at: "1982-01-08T04:00:00.000Z" },
      { ...correctedMetrics.date_correction, original_start_at: "1982-01-10T04:01:00.000Z" },
      { ...correctedMetrics.date_correction, original_end_at: "1982-01-11T04:30:00.000Z" },
      { ...correctedMetrics.date_correction, raw_text: "unexpected" },
    ]) expect(() => parseSleepSessionRecord(JSON.stringify({ ...record, data: { ...record.data,
      sleep_metrics_json: { ...correctedMetrics, date_correction: dateCorrection } } }))).toThrow("INVALID_SLEEP_SESSION_RECORD");
    for (const metrics of [{ ...correctedMetrics, score: 80 }, { ...correctedMetrics, asleep_minutes: 30 }, { ...correctedMetrics, awake_minutes: 0 }]) {
      expect(() => createAutomaticSleepSessionData(correctedNap, provenance, metrics)).toThrow("INVALID_SLEEP_SESSION_DETAILS");
    }
    expect(() => createAutomaticSleepSessionData({ ...correctedNap, session_type: "main_sleep" }, provenance, correctedMetrics)).toThrow("INVALID_SLEEP_SESSION_DETAILS");
  });

  it("rejects forged confirmation, invalid provenance, unexpected sensitive fields and unknown mapping versions", () => {
    const records = automaticRecords();
    for (const [record, parse] of [[records.workout, parseWorkoutRecord], [records.sleep, parseSleepSessionRecord], [records.metric, parseHealthMetricRecord]] as const) {
      for (const badSource of [{ ...provenance, source_id: "" }, { ...provenance, source_sha256: "invalid" }, { ...provenance, mapping_version: 2 }, { ...provenance, retrieved_at: "yesterday" }]) {
        expect(() => parse(JSON.stringify({ ...record, data: { ...record.data, source: badSource } }))).toThrow();
      }
      expect(() => parse(JSON.stringify({ ...record, data: { ...record.data, confirmation_status: "confirmed" } }))).toThrow();
      expect(() => parse(JSON.stringify({ ...record, data: { ...record.data, gps: [1, 2] } }))).toThrow();
    }
  });

  it.each([[false, false], [true, false], [false, true]])("exports/restores automatic records and conflict candidates, retaining date corrections (%s, resolved %s)", async (corrected, resolved) => {
    const records = automaticRecords();
    const candidate = corrected ? correctedNap : sleep; const metrics = corrected ? correctedMetrics : sleepMetrics;
    if (corrected) records.sleep = { ...records.sleep, data: createAutomaticSleepSessionData(candidate, provenance, metrics) };
    const stored = (path: string, text: string) => ({ path, text, blobSha: "fixture", sizeBytes: new TextEncoder().encode(text).byteLength });
    const recordFile = (record: (typeof records)[keyof typeof records]) => stored(recordPath(record.entity_type, record.id), serializeRecord(record));
    let conflict = createCorosSyncConflictRecord({ id: "coros_conflict_fixture", ownerId: "github_fixture", detectedAt: timestamp, data: {
      source_id: provenance.source_id, source_sha256: "b".repeat(64), mapping_version: 1, record_kind: "sleep", reason: "source_changed", existing_record_id: records.sleep.id,
      existing_source_sha256: provenance.source_sha256, candidate: { kind: "sleep", candidate, metrics },
    } });
    if (resolved) conflict = acceptCorosSourceRevision(conflict, parseSleepSessionRecord(serializeRecord(records.sleep)), "2024-02-03T00:00:00.000Z").conflict;
    const exported = await buildPortableWorkspaceExport({
      repository: "fixture/personal-workspace-data", branch: "main", captureFiles: [],
      workspaceFile: stored("workspace.json", JSON.stringify({ schema_version: 1, workspace_id: "personal-workspace", owner_id: "github_fixture", owner_login: "fixture", locale: "zh-CN", timezone: "Asia/Shanghai" })),
      workoutFiles: [recordFile(records.workout)], sleepSessionFiles: [recordFile(records.sleep)], healthMetricFiles: [recordFile(records.metric)],
      corosSyncConflictFiles: [stored(recordPath("coros_sync_conflict", conflict.id), serializeRecord(conflict))],
    });
    expect(await inspectPortableWorkspaceExport(exported)).toMatchObject({ valid: true, counts: { workouts: 1, sleepSessions: 1, healthMetrics: 1, healthStagingRecords: 0, corosSyncConflicts: 1 } });
    expect(await dryRunPortableWorkspaceMigrations(exported)).toMatchObject({ valid: true, counts: { current: 5, blocked: 0 } });
    const restored = await createPortableRestorePlan(exported, { repository: { fullName: "fixture/restore-test", private: true, visibility: "private", defaultBranch: "main" }, branch: { branch: "main", headCommitSha: "head", rootTreeSha: "tree" }, rootEntries: [] });
    expect(restored.ready).toBe(true);
    expect(restored.files.find((file) => file.path === recordPath("sleep_session", records.sleep.id))?.text).toBe(serializeRecord(records.sleep));
    expect(restored.files.find((file) => file.path === recordPath("coros_sync_conflict", conflict.id))?.text).toBe(serializeRecord(conflict));
  });
});
