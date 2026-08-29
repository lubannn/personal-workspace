import { describe, expect, it } from "vitest";

import {
  createWorkspaceRecord,
  parseRecord,
  recordPath,
  serializeRecord,
  setWorkspaceRecordDeleted,
  updateWorkspaceRecord,
} from "./protocol";

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
    expect(recordPath("project_phase", "phase_01")).toBe("data/project-phases/phase_01.json");
    expect(recordPath("milestone", "milestone_01")).toBe("data/milestones/milestone_01.json");
    expect(parseRecord(serializeRecord(record))).toEqual(record);

    const updated = updateWorkspaceRecord(record, { raw_text: "更新后的内容" }, "2026-08-25T01:00:00.000Z");
    expect(updated.version).toBe(2);
    expect(updated.created_at).toBe(record.created_at);
  });

  it("requires a valid date for journal file placement", () => {
    expect(recordPath("journal", "journal_01", "2026-08-25")).toBe("journal/2026/journal_01.md");
    expect(() => recordPath("journal", "journal_01", "25-08-2026")).toThrow("INVALID_JOURNAL_DATE");
  });

  it("soft deletes and restores without changing record identity or business data", () => {
    const record = createWorkspaceRecord({
      entityType: "capture",
      id: "capture_lifecycle",
      ownerId: "owner_01",
      data: { raw_text: "可恢复内容", status: "inbox" as const },
      timestamp: "2026-08-27T01:00:00.000Z",
    });
    const deleted = setWorkspaceRecordDeleted(
      record,
      "2026-08-27T02:00:00.000Z",
      "2026-08-27T02:00:00.000Z",
    );
    const restored = setWorkspaceRecordDeleted(deleted, null, "2026-08-27T03:00:00.000Z");

    expect(deleted).toMatchObject({ id: record.id, version: 2, deleted_at: "2026-08-27T02:00:00.000Z" });
    expect(restored).toMatchObject({ id: record.id, version: 3, deleted_at: null, data: record.data });
    expect(restored.created_at).toBe(record.created_at);
    expect(() => setWorkspaceRecordDeleted(record, "not-a-date")).toThrow("INVALID_DELETED_AT");
  });
});
