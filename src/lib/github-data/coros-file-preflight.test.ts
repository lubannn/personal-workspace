import { describe, expect, it } from "vitest";

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
      protocolVersion: "2.0",
      profileVersion: 21,
      definitionMessages: 1,
      dataMessages: 1,
      activityMessages: 0,
      sessionMessages: 1,
      recordMessages: 0,
      headerCrc: "not-present",
      fileCrc: "not-present",
    });
    expect(preview.readyForMapping).toBe(true);
    expect(preview.diagnostics.map((item) => item.code)).toEqual(["FIT_FILE_CRC_NOT_PRESENT", "FIT_RECORD_MESSAGES_MISSING"]);
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
    const bytes = fitActivityFixture();
    bytes[15] = 20;
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
  const data = new Uint8Array([
    0x40,
    0x00,
    0x00,
    0x12, 0x00,
    0x01,
    0xfd, 0x04, 0x86,
    0x00,
    0x01, 0x00, 0x00, 0x00,
  ]);
  const bytes = new Uint8Array(12 + data.byteLength);
  const view = new DataView(bytes.buffer);
  bytes[0] = 12;
  bytes[1] = 0x20;
  view.setUint16(2, 2100, true);
  view.setUint32(4, data.byteLength, true);
  bytes.set(new TextEncoder().encode(".FIT"), 8);
  bytes.set(data, 12);
  return bytes;
}

function fitActivityFixtureWithCrc() {
  const source = fitActivityFixture();
  const bytes = new Uint8Array(source.length + 4);
  bytes.set(source.subarray(0, 12));
  bytes[0] = 14;
  new DataView(bytes.buffer).setUint16(12, fitCrc(bytes.subarray(0, 12)), true);
  bytes.set(source.subarray(12), 14);
  new DataView(bytes.buffer).setUint16(bytes.length - 2, fitCrc(bytes.subarray(0, -2)), true);
  return bytes;
}

function fitCrc(bytes: Uint8Array) {
  const table = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
  let crc = 0;
  for (const byte of bytes) {
    let temporary = table[crc & 0x0f];
    crc = ((crc >> 4) & 0x0fff) ^ temporary ^ table[byte & 0x0f];
    temporary = table[crc & 0x0f];
    crc = ((crc >> 4) & 0x0fff) ^ temporary ^ table[(byte >> 4) & 0x0f];
  }
  return crc;
}
