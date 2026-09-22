import { describe, expect, it } from "vitest";

import { mapCorosActivities, type CorosSourceActivity } from "./coros-activity-mapping";
import { planCorosWorkoutStaging } from "./coros-workout-staging-plan";
import { parseHealthStagingRecord } from "./health-staging-records";
import { createWorkspaceRecord, serializeRecord } from "./protocol";

const activity: CorosSourceActivity = {
  sourceIdentity: "tcx-activity:2026-09-19T01:00:00Z:Biking:2026-09-19T01:30:00.000Z:12000",
  sport: "Biking",
  startAt: "2026-09-19T01:00:00.000Z",
  endAt: "2026-09-19T01:30:00.000Z",
  elapsedSeconds: 1800,
  movingSeconds: 1750,
  distanceMeters: 12000,
  calories: 320,
  averageHeartRate: 138,
  maximumHeartRate: 166,
  averageCadence: 84,
  averagePower: 190,
  trackpoints: 2,
};

describe("COROS Workout staging plan", () => {
  it("builds deterministic create-only paths for the registered staging protocol without enabling commit", async () => {
    const mapping = await mapCorosActivities({ sourceSha256: "a".repeat(64), parserVersion: "1", timezone: "Asia/Shanghai", activities: [activity] });
    const first = await planCorosWorkoutStaging({ format: "tcx", sourceSha256: "a".repeat(64), parserVersion: "1", mapping });
    const second = await planCorosWorkoutStaging({ format: "tcx", sourceSha256: "a".repeat(64), parserVersion: "1", mapping });

    expect(first.items).toEqual(second.items);
    expect(first.items[0]).toMatchObject({
      stagingRecordId: `coros_workout_${mapping.candidates[0].importKey}`,
      path: `data/health-staging-records/coros_workout_${mapping.candidates[0].importKey}.json`,
      writeMode: "create_only",
      expectedBlobSha: null,
      proposedData: {
        health_type: "workout",
        import_key: mapping.candidates[0].importKey,
        classifier_version: "coros-mapping-v1",
        status: "pending",
        canonical_record_id: null,
      },
    });
    expect(first.items[0].payloadSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(first).toMatchObject({
      protocolDecision: { stagingProtocolRegistered: true, canonicalProtocolRegistered: false },
      readyForProtocolActivation: true,
      localOnly: true,
      protocolAccepted: true,
      commitEnabled: false,
    });
    const record = createWorkspaceRecord({ entityType: "health_staging_record", id: first.items[0].stagingRecordId, ownerId: "github_lubannn", timestamp: "2026-09-19T02:00:00.000Z", data: first.items[0].proposedData });
    expect(parseHealthStagingRecord(serializeRecord(record))).toEqual(record);
  });

  it("drops raw and location-rich fields from the proposed retained payload", async () => {
    const mapping = await mapCorosActivities({ sourceSha256: "b".repeat(64), parserVersion: "1", timezone: "Asia/Shanghai", activities: [activity] });
    const plan = await planCorosWorkoutStaging({ format: "fit", sourceSha256: "b".repeat(64), parserVersion: "1", mapping });
    const serialized = JSON.stringify(plan.items[0].proposedData);

    expect(plan.retentionPolicy.discarded).toContain("original_file");
    expect(plan.retentionPolicy.discarded).toContain("gps_coordinates");
    expect(serialized).not.toContain("file_name");
    expect(serialized).not.toContain("gps");
    expect(serialized).not.toContain("trackpoint_series");
    expect(plan.items[0].proposedData.normalized_json).not.toHaveProperty("importKey");
  });

  it("skips duplicate candidates instead of planning an overwrite", async () => {
    const initial = await mapCorosActivities({ sourceSha256: "c".repeat(64), parserVersion: "1", timezone: "Asia/Shanghai", activities: [activity] });
    const duplicate = await mapCorosActivities({ sourceSha256: "c".repeat(64), parserVersion: "1", timezone: "Asia/Shanghai", activities: [activity], knownImportKeys: [initial.candidates[0].importKey] });
    const plan = await planCorosWorkoutStaging({ format: "tcx", sourceSha256: "c".repeat(64), parserVersion: "1", mapping: duplicate });

    expect(plan.items).toEqual([]);
    expect(plan.skippedDuplicateCount).toBe(1);
    expect(plan.exactConfirmationPreview).toBe("没有可写入的非重复 Workout staging 候选。");
  });

  it("retains candidate-level mapping warnings in the proposed envelope", async () => {
    const mapping = await mapCorosActivities({ sourceSha256: "d".repeat(64), parserVersion: "1", timezone: "Asia/Shanghai", activities: [{ ...activity, endAt: null, trackpoints: 0 }] });
    const plan = await planCorosWorkoutStaging({ format: "tcx", sourceSha256: "d".repeat(64), parserVersion: "1", mapping });

    expect(plan.items[0].proposedData.diagnostics_json.map((item) => item.code)).toEqual(["ACTIVITY_END_DERIVED", "ACTIVITY_TRACKPOINTS_MISSING"]);
  });
});
