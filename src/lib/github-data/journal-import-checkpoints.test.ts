import { describe, expect, it } from "vitest";

import {
  createJournalImportCheckpointRecord,
  parseJournalImportCheckpointRecord,
} from "./journal-import-checkpoints";
import { serializeRecord, updateWorkspaceRecord } from "./protocol";

const timestamp = "2026-08-31T12:00:00.000Z";

function checkpoint() {
  return createJournalImportCheckpointRecord({
    id: `journal_import_checkpoint_${"a".repeat(32)}`,
    ownerId: "github_lubannn",
    importBatchId: `legacy_import_${"b".repeat(32)}`,
    dryRunId: `legacy-journal:${"c".repeat(64)}:parser-v1:mapping-v1:${"d".repeat(64)}`,
    sourceSha256: "c".repeat(64),
    correctionSetSha256: "d".repeat(64),
    expectedParentCommitSha: "e".repeat(40),
    planSha256: "a".repeat(64),
    committedAt: timestamp,
    items: [{ date: "2012-03-05", entry_id: "entry_1", revision_id: "revision_1", segment_ids: ["segment_1"], content_sha256: "1".repeat(64) }],
    plannedFiles: [
      { path: "data/journal-entries/entry_1.json", sha256: "2".repeat(64) },
      { path: "data/journal-revisions/revision_1.json", sha256: "3".repeat(64) },
      { path: "data/journal-segments/segment_1.json", sha256: "4".repeat(64) },
    ],
  });
}

describe("Journal import checkpoint canonical records", () => {
  it("creates a strict immutable record without a self-referential commit SHA", () => {
    const record = checkpoint();
    expect(parseJournalImportCheckpointRecord(serializeRecord(record))).toEqual(record);
    expect(record.data).not.toHaveProperty("commit_sha");
    expect(record.data.expected_parent_commit_sha).toHaveLength(40);
  });

  it("rejects lifecycle mutation, unsorted files and unknown fields", () => {
    const record = checkpoint();
    expect(() => parseJournalImportCheckpointRecord(serializeRecord(updateWorkspaceRecord(record, record.data, "2026-08-31T12:01:00.000Z")))).toThrow("INVALID_JOURNAL_IMPORT_CHECKPOINT_RECORD");
    expect(() => parseJournalImportCheckpointRecord(serializeRecord({ ...record, data: { ...record.data, planned_files: [...record.data.planned_files].reverse() } }))).toThrow("INVALID_JOURNAL_IMPORT_CHECKPOINT_RECORD");
    expect(() => parseJournalImportCheckpointRecord(serializeRecord({ ...record, data: { ...record.data, commit_sha: "9".repeat(40) } }))).toThrow("INVALID_JOURNAL_IMPORT_CHECKPOINT_RECORD");
    expect(() => parseJournalImportCheckpointRecord(serializeRecord({ ...record, id: `journal_import_checkpoint_${"9".repeat(32)}` }))).toThrow("INVALID_JOURNAL_IMPORT_CHECKPOINT_RECORD");
    expect(() => parseJournalImportCheckpointRecord(serializeRecord({ ...record, data: { ...record.data, source_sha256: "9".repeat(64) } }))).toThrow("INVALID_JOURNAL_IMPORT_CHECKPOINT_RECORD");
  });

  it("rejects duplicate entity identities and paths", () => {
    const record = checkpoint();
    const duplicateItem = { ...record.data.items[0]!, date: "2012-03-06" };
    expect(() => parseJournalImportCheckpointRecord(serializeRecord({ ...record, data: { ...record.data, items: [record.data.items[0]!, duplicateItem] } }))).toThrow("INVALID_JOURNAL_IMPORT_CHECKPOINT_RECORD");
    expect(() => parseJournalImportCheckpointRecord(serializeRecord({ ...record, data: { ...record.data, planned_files: [record.data.planned_files[0]!, record.data.planned_files[0]!] } }))).toThrow("INVALID_JOURNAL_IMPORT_CHECKPOINT_RECORD");
  });
});
