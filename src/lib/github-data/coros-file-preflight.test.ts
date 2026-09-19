import { describe, expect, it } from "vitest";
import { Encoder, type Encodable, type RecordMesg, type SessionMesg } from "@garmin/fitsdk";

import { previewCorosActivityFile } from "./coros-file-preflight";

describe("COROS activity file local-only preflight", () => {
  it("previews TCX activity metadata without enabling a commit", async () => {
    const bytes = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities><Activity Sport="Running"><Id>2026-09-19T01:00:00Z</Id>
    <Lap StartTime="2026-09-19T01:00:00Z"><Track>
      <Trackpoint><Time>2026-09-19T01:00:00Z</Time></Trackpoint>
      <Trackpoint><Time>2026-09-19T01:30:00Z</Time></Trackpoint>
    </Track></Lap>
  </Activity></Activities>
</TrainingCenterDatabase>`);
    const preview = await previewCorosActivityFile(file("exports/run.tcx", bytes));

    expect(preview.source.fileName).toBe("run.tcx");
    expect(preview.source.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(preview.summary).toEqual({
      format: "tcx",
      activities: 1,
      laps: 1,
      trackpoints: 2,
      sports: ["Running"],
      firstTimestamp: "2026-09-19T01:00:00.000Z",
      lastTimestamp: "2026-09-19T01:30:00.000Z",
    });
    expect(preview.diagnostics).toEqual([]);
    expect(preview.mapping.candidates[0]).toMatchObject({ activity_type: "run", start_at: "2026-09-19T01:00:00.000Z", end_at: "2026-09-19T01:30:00.000Z", duration_seconds: 1800 });
    expect(preview.stagingPlan.items[0]).toMatchObject({ writeMode: "create_only", expectedBlobSha: null });
    expect(preview.stagingPlan).toMatchObject({ protocolAccepted: false, commitEnabled: false });
    expect(preview).toMatchObject({ readyForMapping: true, localOnly: true, sourceModified: false, commitEnabled: false });
  });

  it("rejects TCX documents that declare external entities", async () => {
    const bytes = new TextEncoder().encode(`<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><TrainingCenterDatabase/>`);
    await expect(previewCorosActivityFile(file("unsafe.tcx", bytes))).rejects.toThrow("COROS_IMPORT_TCX_EXTERNAL_ENTITY_FORBIDDEN");
  });

  it("previews a structurally valid FIT activity stream", async () => {
    const bytes = fitActivityFixture();
    const preview = await previewCorosActivityFile(file("activity.fit", bytes));

    expect(preview.summary).toMatchObject({
      format: "fit",
      activityMessages: 0,
      sessionMessages: 1,
      recordMessages: 0,
      fileCrc: "valid",
    });
    expect(preview.readyForMapping).toBe(true);
    expect(preview.mapping.candidates[0]).toMatchObject({ activity_type: "run", duration_seconds: 3600, distance: 10000, confirmation_status: "pending" });
    expect(preview.diagnostics.map((item) => item.code)).toEqual(["FIT_RECORD_MESSAGES_MISSING"]);
  });

  it("fails closed on a FIT data-size mismatch", async () => {
    const bytes = fitActivityFixture();
    new DataView(bytes.buffer).setUint32(4, 99, true);
    await expect(previewCorosActivityFile(file("broken.fit", bytes))).rejects.toThrow("COROS_IMPORT_FIT_SIZE_MISMATCH");
  });

  it("validates FIT header and file CRC values when present", async () => {
    const bytes = fitActivityFixtureWithCrc();
    const preview = await previewCorosActivityFile(file("activity.fit", bytes));

    expect(preview.summary).toMatchObject({ format: "fit", headerCrc: "valid", fileCrc: "valid" });

    bytes[bytes.length - 1] ^= 0xff;
    await expect(previewCorosActivityFile(file("corrupt.fit", bytes))).rejects.toThrow("COROS_IMPORT_FIT_FILE_CRC_MISMATCH");
  });

  it("blocks FIT streams without an Activity or Session message", async () => {
    const encoder = new Encoder();
    const record: Encodable<RecordMesg> = { mesgNum: 20, timestamp: new Date("2026-09-19T01:00:00.000Z"), heartRate: 140 };
    encoder.writeMesg(record);
    const bytes = encoder.close();
    const preview = await previewCorosActivityFile(file("records-only.fit", bytes));

    expect(preview.readyForMapping).toBe(false);
    expect(preview.diagnostics.map((item) => item.code)).toContain("FIT_ACTIVITY_MESSAGES_MISSING");
  });

  it("requires a supported extension before reading the file", async () => {
    let read = false;
    await expect(previewCorosActivityFile({ name: "activity.gpx", size: 1, lastModified: 0, arrayBuffer: async () => { read = true; return new ArrayBuffer(1); } }))
      .rejects.toThrow("COROS_IMPORT_FIT_OR_TCX_REQUIRED");
    expect(read).toBe(false);
  });
});

function file(name: string, bytes: Uint8Array) {
  return { name, size: bytes.byteLength, lastModified: Date.UTC(2026, 8, 19), arrayBuffer: async () => bytes.slice().buffer };
}

function fitActivityFixture() {
  const encoder = new Encoder();
  const session: Encodable<SessionMesg> = {
    mesgNum: 18,
    timestamp: new Date("2026-09-19T02:00:00.000Z"),
    startTime: new Date("2026-09-19T01:00:00.000Z"),
    sport: "running",
    totalElapsedTime: 3600,
    totalTimerTime: 3500,
    totalDistance: 10000,
    totalCalories: 600,
    avgHeartRate: 140,
    maxHeartRate: 170,
  };
  encoder.writeMesg(session);
  return encoder.close();
}

function fitActivityFixtureWithCrc() {
  return fitActivityFixture().slice();
}
