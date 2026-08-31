import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord, updateWorkspaceRecord } from "./protocol";
import { createJournalRevisionData, parseJournalRevisionRecord, sha256JournalRevisionBody } from "./journal-revisions";

describe("journal revision canonical records", () => {
  it("creates an immutable revision with a materialized body hash", async () => {
    const timestamp = "2026-08-31T06:00:00.000Z";
    const body = "## 02:23\n\n正文";
    const record = createWorkspaceRecord({
      entityType: "journal_revision",
      id: "revision_1",
      ownerId: "owner_1",
      timestamp,
      data: createJournalRevisionData({
        journalEntryId: "journal_1",
        revisionNumber: 1,
        contentMode: "segments",
        bodyMarkdown: body,
        segmentIds: ["segment_1"],
        contentSha256: await sha256JournalRevisionBody(body),
        createdAt: timestamp,
        createdBy: "owner",
        changeReason: "initial_create",
      }),
    });
    expect(parseJournalRevisionRecord(serializeRecord(record))).toEqual(record);
    expect(record.data.content_sha256).toHaveLength(64);
  });

  it("enforces body/segment mode and create-only lifecycle", async () => {
    const timestamp = "2026-08-31T06:00:00.000Z";
    const body = "正文";
    expect(() => createJournalRevisionData({ journalEntryId: "journal_1", revisionNumber: 1, contentMode: "body", bodyMarkdown: body, segmentIds: ["segment_1"], contentSha256: "a".repeat(64), createdAt: timestamp, createdBy: "owner", changeReason: "manual_edit" })).toThrow("INVALID_JOURNAL_REVISION_DETAILS");
    const record = createWorkspaceRecord({ entityType: "journal_revision", id: "revision_1", ownerId: "owner_1", timestamp, data: createJournalRevisionData({ journalEntryId: "journal_1", revisionNumber: 1, contentMode: "body", bodyMarkdown: body, contentSha256: await sha256JournalRevisionBody(body), createdAt: timestamp, createdBy: "owner", changeReason: "initial_create" }) });
    expect(() => parseJournalRevisionRecord(serializeRecord(updateWorkspaceRecord(record, record.data, "2026-08-31T07:00:00.000Z")))).toThrow("INVALID_JOURNAL_REVISION_RECORD");
    expect(() => parseJournalRevisionRecord(serializeRecord({ ...record, deleted_at: "2026-08-31T07:00:00.000Z" }))).toThrow("INVALID_JOURNAL_REVISION_RECORD");
  });

  it("rejects free-form creators and change reasons", () => {
    expect(() => createJournalRevisionData({ journalEntryId: "journal_1", revisionNumber: 1, contentMode: "body", bodyMarkdown: "正文", contentSha256: "a".repeat(64), createdAt: "2026-08-31T06:00:00.000Z", createdBy: "owner", changeReason: "restore" as "manual_edit" })).toThrow("INVALID_JOURNAL_REVISION_DETAILS");
    expect(() => createJournalRevisionData({ journalEntryId: "journal_1", revisionNumber: 1, contentMode: "body", bodyMarkdown: "正文", contentSha256: "a".repeat(64), createdAt: "2026-08-31T06:00:00.000Z", createdBy: "free-form" as "owner", changeReason: "manual_edit" })).toThrow("INVALID_JOURNAL_REVISION_DETAILS");
  });
});
