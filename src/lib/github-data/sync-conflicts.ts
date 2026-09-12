import { isObsidianJournalRelativePath } from "./obsidian-documents";
import { createWorkspaceRecord, parseRecord, type WorkspaceRecord } from "./protocol";

export const SYNC_CONFLICT_VERSION = 1 as const;

export type SyncConflictKind = "obsidian_document_changed" | "obsidian_document_missing" | "obsidian_document_untracked";

export type SyncConflictData = {
  conflict_version: typeof SYNC_CONFLICT_VERSION;
  conflict_kind: SyncConflictKind;
  status: "open";
  vault_mapping_id: string;
  obsidian_document_id: string | null;
  journal_entry_id: string;
  source_revision_id: string;
  relative_path: string;
  baseline_document_sha256: string | null;
  observed_document_sha256: string | null;
  planned_document_sha256: string;
  detected_at: string;
};

export type SyncConflictRecord = WorkspaceRecord<SyncConflictData>;

export function createSyncConflictRecord(input: {
  id: string;
  ownerId: string;
  detectedAt: string;
  data: Omit<SyncConflictData, "conflict_version" | "status" | "detected_at">;
}): SyncConflictRecord {
  const record = createWorkspaceRecord({
    entityType: "sync_conflict",
    id: input.id,
    ownerId: input.ownerId,
    timestamp: input.detectedAt,
    data: { conflict_version: SYNC_CONFLICT_VERSION, status: "open", detected_at: input.detectedAt, ...input.data },
  });
  return parseSyncConflictRecord(`${JSON.stringify(record)}\n`);
}

export function parseSyncConflictRecord(value: string): SyncConflictRecord {
  const record = parseRecord(value);
  if (
    record.entity_type !== "sync_conflict"
    || record.version !== 1
    || record.deleted_at !== null
    || record.updated_at !== record.created_at
    || !isStableId(record.owner_id)
    || !isValidData(record.data)
    || record.data.detected_at !== record.created_at
  ) throw new Error("INVALID_SYNC_CONFLICT_RECORD");
  return record as SyncConflictRecord;
}

function isValidData(value: Record<string, unknown>): value is SyncConflictData {
  const expectedKeys = [
    "baseline_document_sha256", "conflict_kind", "conflict_version", "detected_at", "journal_entry_id",
    "observed_document_sha256", "obsidian_document_id", "planned_document_sha256", "relative_path",
    "source_revision_id", "status", "vault_mapping_id",
  ];
  if (
    Object.keys(value).sort().join(",") !== expectedKeys.join(",")
    || value.conflict_version !== SYNC_CONFLICT_VERSION
    || !isKind(value.conflict_kind)
    || value.status !== "open"
    || !isStableId(value.vault_mapping_id)
    || !(value.obsidian_document_id === null || isStableId(value.obsidian_document_id))
    || !isStableId(value.journal_entry_id)
    || !isStableId(value.source_revision_id)
    || !isObsidianJournalRelativePath(value.relative_path)
    || !(value.baseline_document_sha256 === null || isSha256(value.baseline_document_sha256))
    || !(value.observed_document_sha256 === null || isSha256(value.observed_document_sha256))
    || !isSha256(value.planned_document_sha256)
    || !isInstant(value.detected_at)
  ) return false;
  if (value.conflict_kind === "obsidian_document_changed") {
    return value.obsidian_document_id !== null && value.baseline_document_sha256 !== null
      && value.observed_document_sha256 !== null && value.observed_document_sha256 !== value.baseline_document_sha256;
  }
  if (value.conflict_kind === "obsidian_document_missing") {
    return value.obsidian_document_id !== null && value.baseline_document_sha256 !== null && value.observed_document_sha256 === null;
  }
  return value.obsidian_document_id === null && value.baseline_document_sha256 === null && value.observed_document_sha256 !== null;
}

function isKind(value: unknown): value is SyncConflictKind {
  return value === "obsidian_document_changed" || value === "obsidian_document_missing" || value === "obsidian_document_untracked";
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isInstant(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
