import { describe, expect, it } from "vitest";

import { mapCorosActivities, type CorosSourceActivity } from "./coros-activity-mapping";

const run: CorosSourceActivity = {
  sourceIdentity: "tcx-activity:0:2026-09-19T01:00:00.000Z:Running",
  sport: "Running",
  startAt: "2026-09-19T01:00:00.000Z",
  endAt: "2026-09-19T02:00:00.000Z",
  elapsedSeconds: 3600,
  movingSeconds: 3500,
  distanceMeters: 10000,
  calories: 600,
  averageHeartRate: 140,
  maximumHeartRate: 170,
  averageCadence: 176,
  averagePower: null,
  trackpoints: 2,
};

describe("COROS activity mapping dry run", () => {
  it("creates stable pending Workout proposals without commit capability", async () => {
    const first = await mapCorosActivities({ sourceSha256: "a".repeat(64), parserVersion: "1", timezone: "Asia/Shanghai", activities: [run] });
    const second = await mapCorosActivities({ sourceSha256: "a".repeat(64), parserVersion: "1", timezone: "Asia/Shanghai", activities: [run] });

    expect(first.batchIdentity).toBe(second.batchIdentity);
    expect(first.candidates[0]).toMatchObject({
      importKey: second.candidates[0].importKey,
      activity_type: "run",
      duration_seconds: 3600,
      distance: 10000,
      distance_unit: "m",
      confirmation_status: "pending",
      staging_record_id: null,
    });
    expect(first).toMatchObject({ readyForStagingDesign: true, localOnly: true, commitEnabled: false });
  });

  it("marks a known import key as a duplicate", async () => {
    const initial = await mapCorosActivities({ sourceSha256: "b".repeat(64), parserVersion: "1", timezone: "Asia/Shanghai", activities: [run] });
    const repeated = await mapCorosActivities({ sourceSha256: "b".repeat(64), parserVersion: "1", timezone: "Asia/Shanghai", activities: [run], knownImportKeys: [initial.candidates[0].importKey] });

    expect(repeated.candidates[0]).toMatchObject({ duplicate: true, duplicateReason: "known-import" });
    expect(repeated.diagnostics.map((item) => item.code)).toContain("ACTIVITY_DUPLICATE");
  });

  it("warns when a summary has no trackpoints and derives its end time", async () => {
    const mapped = await mapCorosActivities({ sourceSha256: "c".repeat(64), parserVersion: "1", timezone: "Asia/Shanghai", activities: [{ ...run, endAt: null, trackpoints: 0 }] });
    expect(mapped.candidates[0].end_at).toBe("2026-09-19T02:00:00.000Z");
    expect(mapped.diagnostics.map((item) => item.code)).toEqual(["ACTIVITY_END_DERIVED", "ACTIVITY_TRACKPOINTS_MISSING"]);
  });
});
