import { describe, expect, it } from "vitest";

import { createObsidianDocumentData, expectedObsidianJournalRelativePath, parseObsidianDocumentRecord, updateObsidianDocumentRecord } from "./obsidian-documents";
import { createWorkspaceRecord, serializeRecord } from "./protocol";

const exportedAt = "2026-09-12T04:00:00.000Z";
const baseData = createObsidianDocumentData({
  vault_mapping_id: "onedrive_personal_vault",
  journal_entry_id: "journal_20260912",
  relative_path: "Personal Workspace/Journal/2026/2026-09-12.md",
  source_revision_id: "revision_1",
  source_record_version: 1,
  source_content_sha256: "a".repeat(64),
  document_sha256: "b".repeat(64),
  exported_at: exportedAt,
});

function record() {
  return createWorkspaceRecord({ entityType: "obsidian_document", id: "obsidian_document_1", ownerId: "owner_1", timestamp: exportedAt, data: baseData });
}

describe("ObsidianDocument canonical baseline", () => {
  it("creates, parses and version-updates an exact export baseline", () => {
    const current = record();
    expect(parseObsidianDocumentRecord(serializeRecord(current))).toEqual(current);
    const updated = updateObsidianDocumentRecord(current, {
      sourceRevisionId: "revision_2",
      sourceRecordVersion: 2,
      sourceContentSha256: "c".repeat(64),
      documentSha256: "d".repeat(64),
      exportedAt: "2026-09-12T05:00:00.000Z",
    });
    expect(updated).toMatchObject({ version: 2, updated_at: "2026-09-12T05:00:00.000Z" });
    expect(updated.data).toMatchObject({ vault_mapping_id: "onedrive_personal_vault", journal_entry_id: "journal_20260912", source_revision_id: "revision_2", source_record_version: 2 });
  });

  it("derives a cross-platform day path and rejects unsafe or impossible paths", () => {
    expect(expectedObsidianJournalRelativePath("Personal Workspace", "2026-09-12")).toBe("Personal Workspace/Journal/2026/2026-09-12.md");
    expect(expectedObsidianJournalRelativePath("Personal Workspace", "2026-09-12", "journal_1")).toBe("Personal Workspace/Journal/2026/2026-09-12-journal_1.md");
    expect(() => expectedObsidianJournalRelativePath("../Private", "2026-09-12")).toThrow("INVALID_OBSIDIAN_SUBDIRECTORY");
    expect(() => expectedObsidianJournalRelativePath("Personal Workspace", "2026-02-31")).toThrow("INVALID_OBSIDIAN_JOURNAL_DATE");
    expect(() => createObsidianDocumentData({ ...baseData, relative_path: "Personal Workspace/Journal/2025/2026-09-12.md" })).toThrow("INVALID_OBSIDIAN_DOCUMENT_DETAILS");
  });

  it("rejects malformed hashes, identities, extra fields and time regression", () => {
    expect(() => createObsidianDocumentData({ ...baseData, document_sha256: "bad" })).toThrow("INVALID_OBSIDIAN_DOCUMENT_DETAILS");
    expect(() => createObsidianDocumentData({ ...baseData, vault_mapping_id: "invalid/path" })).toThrow("INVALID_OBSIDIAN_DOCUMENT_DETAILS");
    const extra = { ...record(), data: { ...baseData, unexpected: true } };
    expect(() => parseObsidianDocumentRecord(serializeRecord(extra))).toThrow("INVALID_OBSIDIAN_DOCUMENT_RECORD");
    expect(() => updateObsidianDocumentRecord(record(), {
      sourceRevisionId: "revision_2",
      sourceRecordVersion: 2,
      sourceContentSha256: "c".repeat(64),
      documentSha256: "d".repeat(64),
      exportedAt: "2026-09-12T03:00:00.000Z",
    })).toThrow("INVALID_OBSIDIAN_DOCUMENT_DETAILS");
  });
});
