import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, parseRecord, recordPath, serializeRecord, updateWorkspaceRecord } from "./protocol";

describe("GitHub data protocol", () => {
  it("creates versioned portable records and stable paths", () => {
    const record = createWorkspaceRecord({
      entityType: "capture",
      id: "capture_01",
      ownerId: "owner_01",
      data: { raw_text: "一条跨设备捕捉" },
      timestamp: "2026-08-25T00:00:00.000Z",
    });
    expect(recordPath("capture", record.id)).toBe("data/captures/capture_01.json");
    expect(parseRecord(serializeRecord(record))).toEqual(record);

    const updated = updateWorkspaceRecord(record, { raw_text: "更新后的内容" }, "2026-08-25T01:00:00.000Z");
    expect(updated.version).toBe(2);
    expect(updated.created_at).toBe(record.created_at);
  });

  it("requires a valid date for journal file placement", () => {
    expect(recordPath("journal", "journal_01", "2026-08-25")).toBe("journal/2026/journal_01.md");
    expect(() => recordPath("journal", "journal_01", "25-08-2026")).toThrow("INVALID_JOURNAL_DATE");
  });
});
