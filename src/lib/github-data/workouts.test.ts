import { describe, expect, it } from "vitest";

import { mapCorosActivities, type CorosSourceActivity } from "./coros-activity-mapping";
import { planCorosWorkoutStaging } from "./coros-workout-staging-plan";
import { confirmWorkoutHealthStaging } from "./health-staging-records";
import { createWorkspaceRecord } from "./protocol";
import { createConfirmedWorkoutData, isWorkoutLinkedToStaging, parseWorkoutRecord } from "./workouts";

const timestamp = "2026-09-19T02:00:00.000Z";
const activity: CorosSourceActivity = {
  sourceIdentity: "activity-1", sport: "Biking", startAt: "2026-09-19T01:00:00.000Z",
  endAt: "2026-09-19T01:30:00.000Z", elapsedSeconds: 1800, movingSeconds: 1750,
  distanceMeters: 12000, calories: 320, averageHeartRate: 138, maximumHeartRate: 166,
  averageCadence: 84, averagePower: 190, trackpoints: 2,
};

async function staging() {
  const mapping = await mapCorosActivities({ sourceSha256: "a".repeat(64), parserVersion: "1", timezone: "Asia/Shanghai", activities: [activity] });
  const plan = await planCorosWorkoutStaging({ format: "tcx", sourceSha256: "a".repeat(64), parserVersion: "1", mapping });
  return createWorkspaceRecord({ entityType: "health_staging_record", id: plan.items[0].stagingRecordId, ownerId: "github_lubannn", timestamp, data: plan.items[0].proposedData });
}

describe("canonical Workout data contract (not yet registered)", () => {
  it("retains only the reviewed activity summary and staging provenance", async () => {
    const source = await staging();
    const data = createConfirmedWorkoutData(source, timestamp);
    expect(data).toMatchObject({
      workout_version: 1, confirmation_status: "confirmed", staging_record_id: source.id,
      import_key: source.data.import_key, source_sha256: "a".repeat(64),
      activity_type: "ride", duration_seconds: 1800, distance: 12000,
    });
    expect(JSON.stringify(data)).not.toMatch(/file_name|gps|trackpoint_series/u);
    const record = createWorkspaceRecord({ entityType: "workout", id: `workout_${source.data.import_key}`, ownerId: source.owner_id, timestamp, data });
    expect(parseWorkoutRecord(JSON.stringify(record))).toEqual(record);
  });

  it("refuses rejected or deleted staging records", async () => {
    const source = await staging();
    expect(() => createConfirmedWorkoutData({ ...source, data: { ...source.data, status: "rejected" } }, timestamp)).toThrow("WORKOUT_STAGING_NOT_PENDING");
    expect(() => createConfirmedWorkoutData({ ...source, deleted_at: timestamp }, timestamp)).toThrow("WORKOUT_STAGING_NOT_PENDING");
  });

  it("shows only Workout records linked to the confirmed matching staging record", async () => {
    const pending = await staging();
    const reviewed = confirmWorkoutHealthStaging(pending, timestamp);
    const data = createConfirmedWorkoutData(pending, timestamp);
    const workout = parseWorkoutRecord(JSON.stringify(createWorkspaceRecord({ entityType: "workout", id: `workout_${data.import_key}`, ownerId: pending.owner_id, timestamp, data })));
    expect(isWorkoutLinkedToStaging(workout, reviewed)).toBe(true);
    expect(isWorkoutLinkedToStaging(workout, pending)).toBe(false);
    expect(isWorkoutLinkedToStaging({ ...workout, owner_id: "github_other" }, reviewed)).toBe(false);
    expect(isWorkoutLinkedToStaging({ ...workout, data: { ...workout.data, distance: 42 } }, reviewed)).toBe(false);
  });

  it("rejects malformed provenance and unexpected sensitive fields", async () => {
    const source = await staging();
    const data = createConfirmedWorkoutData(source, timestamp);
    const record = createWorkspaceRecord({ entityType: "workout", id: `workout_${source.data.import_key}`, ownerId: source.owner_id, timestamp, data });
    expect(() => parseWorkoutRecord(JSON.stringify({ ...record, data: { ...data, staging_record_id: "other" } }))).toThrow("INVALID_WORKOUT_RECORD");
    expect(() => parseWorkoutRecord(JSON.stringify({ ...record, id: "workout_other" }))).toThrow("INVALID_WORKOUT_RECORD");
    expect(() => parseWorkoutRecord(JSON.stringify({ ...record, data: { ...data, gps: [1, 2] } }))).toThrow("INVALID_WORKOUT_RECORD");
    expect(() => parseWorkoutRecord(JSON.stringify({ ...record, data: { ...data, metrics_json: { ...data.metrics_json, trackpoints: -1 } } }))).toThrow("INVALID_WORKOUT_RECORD");
  });
});
