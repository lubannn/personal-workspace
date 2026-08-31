import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord, updateWorkspaceRecord } from "./protocol";
import { createJournalSegmentData, parseJournalSegmentRecord } from "./journal-segments";

describe("journal segment canonical records", () => {
  it("creates and parses immutable timed and untimed segments", () => {
    const timestamp = "2012-03-05T02:23:00+08:00";
    const timed = createWorkspaceRecord({
      entityType: "journal_segment",
      id: "segment_timed",
      ownerId: "owner_1",
      timestamp,
      data: createJournalSegmentData({
        id: "segment_timed",
        journalEntryId: "journal_1",
        localTime: "02:23",
        occurredAt: timestamp,
        bodyMarkdown: "  保留正文。  ",
        sortOrder: 1,
        sourceRef: { source_type: "legacy_word", import_batch_id: "batch_1", source_locator: "paragraph:42" },
      }),
    });
    expect(parseJournalSegmentRecord(serializeRecord(timed))).toEqual(timed);
    expect(timed.data.body_markdown).toBe("保留正文。");

    const untimed = createWorkspaceRecord({
      entityType: "journal_segment",
      id: "segment_untimed",
      ownerId: "owner_1",
      timestamp,
      data: createJournalSegmentData({ id: "segment_untimed", journalEntryId: "journal_1", bodyMarkdown: "开头", sortOrder: 0 }),
    });
    expect(parseJournalSegmentRecord(serializeRecord(untimed)).data.local_time).toBeNull();
  });

  it("rejects mutation, soft deletion and non-canonical source metadata", () => {
    const timestamp = "2026-08-31T06:00:00.000Z";
    const record = createWorkspaceRecord({
      entityType: "journal_segment",
      id: "segment_1",
      ownerId: "owner_1",
      timestamp,
      data: createJournalSegmentData({ id: "segment_1", journalEntryId: "journal_1", bodyMarkdown: "正文", sortOrder: 0 }),
    });
    expect(() => parseJournalSegmentRecord(serializeRecord(updateWorkspaceRecord(record, record.data, "2026-08-31T07:00:00.000Z")))).toThrow("INVALID_JOURNAL_SEGMENT_RECORD");
    expect(() => parseJournalSegmentRecord(serializeRecord({ ...record, deleted_at: "2026-08-31T07:00:00.000Z" }))).toThrow("INVALID_JOURNAL_SEGMENT_RECORD");
    const tampered = { ...record, data: { ...record.data, source_ref: { source_type: "legacy_word", import_batch_id: "batch_1", source_locator: "p:1", absolute_path: "/private/diary.docx" } } };
    expect(() => parseJournalSegmentRecord(serializeRecord(tampered))).toThrow("INVALID_JOURNAL_SEGMENT_RECORD");
  });
});
