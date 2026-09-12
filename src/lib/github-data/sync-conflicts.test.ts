import { describe, expect, it } from "vitest";

import { createSyncConflictRecord, parseSyncConflictRecord } from "./sync-conflicts";
import { serializeRecord } from "./protocol";

const common = {
  vault_mapping_id: "onedrive_personal_vault",
  journal_entry_id: "journal_20260912",
  source_revision_id: "revision_2",
  relative_path: "Personal Workspace/Journal/2026/2026-09-12.md",
  planned_document_sha256: "d".repeat(64),
} as const;

describe("SyncConflict canonical facts", () => {
  it("creates immutable changed, missing and untracked conflict facts", () => {
    const changed = createSyncConflictRecord({
      id: "sync_conflict_changed",
      ownerId: "owner_1",
      detectedAt: "2026-09-12T05:00:00.000Z",
      data: { ...common, conflict_kind: "obsidian_document_changed", obsidian_document_id: "obsidian_document_1", baseline_document_sha256: "b".repeat(64), observed_document_sha256: "c".repeat(64) },
    });
    expect(parseSyncConflictRecord(serializeRecord(changed))).toEqual(changed);
    for (const data of [
      { ...common, conflict_kind: "obsidian_document_missing" as const, obsidian_document_id: "obsidian_document_1", baseline_document_sha256: "b".repeat(64), observed_document_sha256: null },
      { ...common, conflict_kind: "obsidian_document_untracked" as const, obsidian_document_id: null, baseline_document_sha256: null, observed_document_sha256: "c".repeat(64) },
    ]) expect(() => createSyncConflictRecord({ id: `sync_conflict_${data.conflict_kind}`, ownerId: "owner_1", detectedAt: "2026-09-12T05:00:00.000Z", data })).not.toThrow();
  });

  it("rejects incoherent conflict evidence and mutable lifecycle fields", () => {
    expect(() => createSyncConflictRecord({
      id: "sync_conflict_bad",
      ownerId: "owner_1",
      detectedAt: "2026-09-12T05:00:00.000Z",
      data: { ...common, conflict_kind: "obsidian_document_missing", obsidian_document_id: null, baseline_document_sha256: null, observed_document_sha256: null },
    })).toThrow("INVALID_SYNC_CONFLICT_RECORD");
    const valid = createSyncConflictRecord({
      id: "sync_conflict_valid",
      ownerId: "owner_1",
      detectedAt: "2026-09-12T05:00:00.000Z",
      data: { ...common, conflict_kind: "obsidian_document_untracked", obsidian_document_id: null, baseline_document_sha256: null, observed_document_sha256: "c".repeat(64) },
    });
    expect(() => parseSyncConflictRecord(serializeRecord({ ...valid, version: 2 }))).toThrow("INVALID_SYNC_CONFLICT_RECORD");
    expect(() => parseSyncConflictRecord(serializeRecord({ ...valid, deleted_at: "2026-09-12T06:00:00.000Z" }))).toThrow("INVALID_SYNC_CONFLICT_RECORD");
  });
});
