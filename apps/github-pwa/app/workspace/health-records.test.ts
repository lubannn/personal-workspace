import { describe, expect, it } from "vitest";
import { createWorkspaceRecord } from "../../../../src/lib/github-data/protocol";
import { createSleepHealthStagingData, confirmHealthStaging, confirmWorkoutHealthStaging } from "../../../../src/lib/github-data/health-staging-records";
import { createAutomaticSleepSessionData, createConfirmedSleepSessionData } from "../../../../src/lib/github-data/sleep-sessions";
import { mapCorosActivities } from "../../../../src/lib/github-data/coros-activity-mapping";
import { planCorosWorkoutStaging } from "../../../../src/lib/github-data/coros-workout-staging-plan";
import { createAutomaticWorkoutData, createConfirmedWorkoutData } from "../../../../src/lib/github-data/workouts";
import { buildHealthRecordRows, filterHealthRecords, formatHealthDistance, formatHealthDuration, healthLocalParts, healthRangeError, paginateHealthRecords, summarizeHealthRecords, type HealthRecordRow } from "./health-records";

const timestamp = "2024-02-03T00:00:00.000Z";
function row(id: string, startAt: string): HealthRecordRow {
  return { id, startAt, endAt: startAt, timezone: "Asia/Shanghai", source: { kind: "unknown", label: "来源待核实" } };
}
function sleep(id: string, startAt: string) {
  const candidate = createSleepHealthStagingData({ source_label: "手工录入", normalized_json: {
    start_at: startAt, end_at: new Date(Date.parse(startAt) + 8 * 3600_000).toISOString(),
    local_date: healthLocalParts(startAt, "Asia/Shanghai").date, timezone: "Asia/Shanghai", session_type: "main_sleep",
  } }, timestamp);
  const pending = createWorkspaceRecord({ entityType: "health_staging_record", id: `stage_${id}`, ownerId: "test-owner", timestamp, data: candidate });
  const record = createWorkspaceRecord({ entityType: "sleep_session", id, ownerId: "test-owner", timestamp, data: createConfirmedSleepSessionData(candidate.normalized_json, pending.id) });
  return {
    item: { record, path: `data/sleep-sessions/${id}.json`, blobSha: "test-blob" },
    staging: { record: confirmHealthStaging(pending, id, timestamp), path: `data/health-staging-records/${pending.id}.json`, blobSha: "test-stage" },
  };
}

describe("health record browsing", () => {
  it("shows automatic COROS sleep without staging and uses its wake day for summary and filters", () => {
    const data = createAutomaticSleepSessionData({ start_at: "2024-02-01T15:00:00.000Z", end_at: "2024-02-01T23:00:00.000Z", local_date: "2024-02-01", timezone: "Asia/Shanghai", session_type: "main_sleep", duration_minutes: 480 }, { kind: "coros_mcp", source_id: "synthetic-sleep", source_sha256: "c".repeat(64), mapping_version: 1, retrieved_at: timestamp }, { asleep_minutes: 460, awake_minutes: 20, score: 80, wake_date: "2024-02-02" });
    const record = createWorkspaceRecord({ entityType: "sleep_session", id: "sleep_auto", ownerId: "test-owner", timestamp, data });
    const rows = buildHealthRecordRows([{ record, path: "synthetic.json", blobSha: "test" }], [], []).sleepRows;
    expect(rows[0]).toMatchObject({ source: { kind: "coros_mcp", label: "COROS · 自动同步" }, recordDate: "2024-02-02", durationSeconds: 28800, asleepSeconds: 27600, awakeSeconds: 1200, score: 80 });
    expect(summarizeHealthRecords(rows, "Asia/Shanghai")).toEqual({ count: 1, earliest: "2024-02-02", latest: "2024-02-02" });
    expect(filterHealthRecords(rows, { from: "2024-02-02", to: "2024-02-02" }, "Asia/Shanghai")).toHaveLength(1);
    expect(filterHealthRecords(rows, { from: "2024-02-01", to: "2024-02-01" }, "Asia/Shanghai")).toHaveLength(0);
    expect(rows[0].dateCorrection).toBeNull();
  });

  it("retains explicit COROS date correction evidence while sorting and filtering on corrected dates", () => {
    const correction = { reason: "coros_legacy_nap_year_1982" as const,
      original_start_at: "1982-03-15T05:10:00.000Z", original_end_at: "1982-03-15T05:40:00.000Z" };
    const data = createAutomaticSleepSessionData({ start_at: "2030-03-15T05:10:00.000Z", end_at: "2030-03-15T05:40:00.000Z",
      local_date: "2030-03-15", timezone: "Asia/Shanghai", session_type: "nap", duration_minutes: 30 },
    { kind: "coros_mcp", source_id: "synthetic-corrected-nap", source_sha256: "d".repeat(64), mapping_version: 1, retrieved_at: "2030-03-16T00:00:00.000Z" },
    { asleep_minutes: null, awake_minutes: null, score: null, wake_date: "2030-03-15", date_correction: correction });
    const record = createWorkspaceRecord({ entityType: "sleep_session", id: "sleep_corrected", ownerId: "test-owner", timestamp, data });
    const rows = buildHealthRecordRows([{ record, path: "synthetic.json", blobSha: "test" }], [], []).sleepRows;
    expect(rows[0]).toMatchObject({ dateCorrection: correction, source: { kind: "coros_mcp", label: "COROS · 自动同步" },
      recordDate: "2030-03-15", startAt: data.start_at, endAt: data.end_at, durationSeconds: 1800 });
    expect(healthLocalParts(rows[0].dateCorrection!.original_start_at, rows[0].timezone)).toEqual({ date: "1982-03-15", time: "13:10" });
    expect(healthLocalParts(rows[0].startAt, rows[0].timezone)).toEqual({ date: "2030-03-15", time: "13:10" });
    expect(summarizeHealthRecords(rows, "Asia/Shanghai")).toEqual({ count: 1, earliest: "2030-03-15", latest: "2030-03-15" });
    expect(filterHealthRecords(rows, { from: "1982-03-15", to: "1982-03-15" }, "Asia/Shanghai")).toEqual([]);
  });

  it("labels COROS imports only when confirmed source and workout content agree", async () => {
    const mapping = await mapCorosActivities({ sourceSha256: "b".repeat(64), parserVersion: "1", timezone: "Asia/Shanghai", activities: [{
      sourceIdentity: "synthetic-activity", sport: "Running", startAt: "2024-01-02T01:00:00Z", endAt: "2024-01-02T01:30:00Z",
      elapsedSeconds: 1800, movingSeconds: 1800, distanceMeters: 4000, calories: null, averageHeartRate: null,
      maximumHeartRate: null, averageCadence: null, averagePower: null, trackpoints: 0,
    }] });
    const plan = await planCorosWorkoutStaging({ format: "fit", sourceSha256: "b".repeat(64), parserVersion: "1", mapping });
    const pending = createWorkspaceRecord({ entityType: "health_staging_record", id: plan.items[0].stagingRecordId, ownerId: "test-owner", timestamp, data: plan.items[0].proposedData });
    const data = createConfirmedWorkoutData(pending, timestamp);
    const workout = { record: createWorkspaceRecord({ entityType: "workout", id: `workout_${data.import_key}`, ownerId: "test-owner", timestamp, data }), path: "synthetic.json", blobSha: "test" };
    const source = { record: confirmWorkoutHealthStaging(pending, timestamp), path: "synthetic-stage.json", blobSha: "test" };
    expect(buildHealthRecordRows([], [workout], [source]).workoutRows[0]).toMatchObject({ activity: "跑步", distanceMetres: 4000, source: { kind: "coros_file", label: "COROS · FIT" } });
    expect(buildHealthRecordRows([], [workout], []).workoutRows[0].source.kind).toBe("unknown");
    const automatic = createWorkspaceRecord({ entityType: "workout", id: "workout_auto", ownerId: "test-owner", timestamp, data: createAutomaticWorkoutData(plan.items[0].proposedData.normalized_json, { kind: "coros_mcp", source_id: "synthetic-workout", source_sha256: "c".repeat(64), mapping_version: 1, retrieved_at: timestamp }) });
    expect(buildHealthRecordRows([], [{ ...workout, record: automatic }], []).workoutRows[0]).toMatchObject({ activity: "跑步", distanceMetres: 4000, source: { kind: "coros_mcp", label: "COROS · 自动同步" } });
    const badminton = { ...automatic, data: { ...automatic.data, activity_type: "other" as const, metrics_json: { ...automatic.data.metrics_json, coros_sport_type: 1000, coros_sport_name: "Badminton" } } };
    expect(buildHealthRecordRows([], [{ ...workout, record: badminton }], []).workoutRows[0].activity).toBe("羽毛球");
  });

  it("sorts by actual start time and excludes deleted records without inventing provenance", () => {
    const old = sleep("z_old", "2024-01-01T15:00:00Z");
    const recent = sleep("a_recent", "2024-02-01T15:00:00Z");
    const deleted = sleep("deleted", "2024-02-02T15:00:00Z");
    deleted.item.record.deleted_at = timestamp;
    const result = buildHealthRecordRows([old.item, deleted.item, recent.item], [], [old.staging]);
    expect(result.sleepRows.map((item) => item.id)).toEqual(["a_recent", "z_old"]);
    expect(result.sleepRows[0].source.kind).toBe("unknown");
    expect(result.sleepRows[1].source.kind).toBe("manual");
    expect(result.sleepRows[1].durationSeconds).toBe(28800);
  });

  it("computes earliest and latest across all rows in the workspace timezone", () => {
    const rows = [row("new", "2024-03-01T16:01:00Z"), row("old", "2023-12-31T17:00:00Z")];
    expect(summarizeHealthRecords(rows, "Asia/Shanghai")).toEqual({ count: 2, earliest: "2024-01-01", latest: "2024-03-02" });
    expect(summarizeHealthRecords([], "UTC")).toEqual({ count: 0, earliest: null, latest: null });
  });

  it("filters inclusively by local start day, including UTC midnight boundaries", () => {
    const rows = [row("before", "2024-01-01T15:59:00Z"), row("first", "2024-01-01T16:00:00Z"), row("last", "2024-01-02T15:59:59Z"), row("after", "2024-01-02T16:00:00Z")];
    expect(filterHealthRecords(rows, { from: "2024-01-02", to: "2024-01-02" }, "Asia/Shanghai").map((item) => item.id)).toEqual(["first", "last"]);
    expect(healthRangeError({ from: "2024-03-01", to: "2024-02-01" })).toBeTruthy();
    expect(filterHealthRecords(rows, { from: "2024-02-30", to: "" }, "UTC")).toEqual([]);
  });

  it("exposes every page and clamps the page after the filtered list shrinks", () => {
    const rows = Array.from({ length: 23 }, (_, index) => index);
    expect(paginateHealthRecords(rows, 1).rows).toHaveLength(10);
    expect(paginateHealthRecords(rows, 3)).toEqual({ rows: [20, 21, 22], page: 3, pages: 3, count: 23 });
    expect(paginateHealthRecords(rows.slice(0, 2), 3).page).toBe(1);
  });

  it("keeps missing distance distinct from zero and preserves duration", () => {
    expect(formatHealthDistance(null)).toBe("距离未记录");
    expect(formatHealthDistance(0)).toBe("0 米");
    expect(formatHealthDistance(1250)).toBe("1.25 公里");
    expect(formatHealthDuration(3665)).toBe("1 小时 1 分钟 5 秒");
  });
});
