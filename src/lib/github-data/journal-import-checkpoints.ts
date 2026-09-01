import { createWorkspaceRecord, parseRecord, type WorkspaceRecord } from "./protocol";

export const JOURNAL_IMPORT_CHECKPOINT_VERSION = 1 as const;
export const JOURNAL_IMPORT_CHECKPOINT_KIND = "legacy_word_import" as const;

export type JournalImportCheckpointItem = {
  date: string;
  entry_id: string;
  revision_id: string;
  segment_ids: string[];
  content_sha256: string;
};

export type JournalImportCheckpointPlannedFile = {
  path: string;
  sha256: string;
};

export type JournalImportCheckpointData = {
  checkpoint_version: typeof JOURNAL_IMPORT_CHECKPOINT_VERSION;
  checkpoint_kind: typeof JOURNAL_IMPORT_CHECKPOINT_KIND;
  import_batch_id: string;
  dry_run_id: string;
  source_sha256: string;
  correction_set_sha256: string;
  expected_parent_commit_sha: string;
  plan_sha256: string;
  committed_at: string;
  items: JournalImportCheckpointItem[];
  planned_files: JournalImportCheckpointPlannedFile[];
};

export type JournalImportCheckpointRecord = WorkspaceRecord<JournalImportCheckpointData>;

export function createJournalImportCheckpointRecord(input: {
  id: string;
  ownerId: string;
  importBatchId: string;
  dryRunId: string;
  sourceSha256: string;
  correctionSetSha256: string;
  expectedParentCommitSha: string;
  planSha256: string;
  committedAt: string;
  items: JournalImportCheckpointItem[];
  plannedFiles: JournalImportCheckpointPlannedFile[];
}): JournalImportCheckpointRecord {
  const record = createWorkspaceRecord({
    entityType: "journal_import_checkpoint",
    id: input.id,
    ownerId: input.ownerId,
    timestamp: input.committedAt,
    data: {
      checkpoint_version: JOURNAL_IMPORT_CHECKPOINT_VERSION,
      checkpoint_kind: JOURNAL_IMPORT_CHECKPOINT_KIND,
      import_batch_id: input.importBatchId,
      dry_run_id: input.dryRunId,
      source_sha256: input.sourceSha256,
      correction_set_sha256: input.correctionSetSha256,
      expected_parent_commit_sha: input.expectedParentCommitSha,
      plan_sha256: input.planSha256,
      committed_at: input.committedAt,
      items: input.items.map((item) => ({ ...item, segment_ids: [...item.segment_ids] })),
      planned_files: input.plannedFiles.map((file) => ({ ...file })),
    },
  });
  return parseJournalImportCheckpointRecord(`${JSON.stringify(record)}\n`);
}

export function parseJournalImportCheckpointRecord(value: string): JournalImportCheckpointRecord {
  const record = parseRecord(value);
  if (
    record.entity_type !== "journal_import_checkpoint"
    || record.version !== 1
    || record.deleted_at !== null
    || record.updated_at !== record.created_at
    || !isInstant(record.created_at)
    || !isValidData(record.data)
    || record.id !== `journal_import_checkpoint_${record.data.plan_sha256.slice(0, 32)}`
    || !isStableId(record.owner_id)
    || record.data.committed_at !== record.created_at
  ) throw new Error("INVALID_JOURNAL_IMPORT_CHECKPOINT_RECORD");
  return record as JournalImportCheckpointRecord;
}

function isValidData(value: Record<string, unknown>): value is JournalImportCheckpointData {
  const expectedKeys = [
    "checkpoint_kind", "checkpoint_version", "committed_at", "correction_set_sha256", "dry_run_id",
    "expected_parent_commit_sha", "import_batch_id", "items", "plan_sha256", "planned_files", "source_sha256",
  ];
  const dryRunParts = typeof value.dry_run_id === "string" ? value.dry_run_id.split(":") : [];
  if (
    Object.keys(value).sort().join(",") !== expectedKeys.join(",")
    || value.checkpoint_version !== JOURNAL_IMPORT_CHECKPOINT_VERSION
    || value.checkpoint_kind !== JOURNAL_IMPORT_CHECKPOINT_KIND
    || typeof value.import_batch_id !== "string"
    || !/^legacy_import_[a-f0-9]{32}$/u.test(value.import_batch_id)
    || typeof value.dry_run_id !== "string"
    || !value.dry_run_id.startsWith("legacy-journal:")
    || value.dry_run_id.length > 1_000
    || dryRunParts.length !== 5
    || dryRunParts[0] !== "legacy-journal"
    || dryRunParts[1] !== value.source_sha256
    || !dryRunParts[2]
    || dryRunParts[2]!.length > 128
    || !dryRunParts[3]
    || dryRunParts[3]!.length > 128
    || dryRunParts[4] !== value.correction_set_sha256
    || !isSha256(value.source_sha256)
    || !isSha256(value.correction_set_sha256)
    || !isGitSha(value.expected_parent_commit_sha)
    || !isSha256(value.plan_sha256)
    || !isInstant(value.committed_at)
    || !Array.isArray(value.items)
    || value.items.length === 0
    || value.items.length > 25
    || !Array.isArray(value.planned_files)
    || value.planned_files.length === 0
    || value.planned_files.length > 250
  ) return false;

  const items = value.items as unknown[];
  const files = value.planned_files as unknown[];
  if (items.some((item) => !isCheckpointItem(item)) || files.some((file) => !isPlannedFile(file))) return false;
  const typedItems = items as JournalImportCheckpointItem[];
  const typedFiles = files as JournalImportCheckpointPlannedFile[];
  const segmentIds = typedItems.flatMap((item) => item.segment_ids);
  return new Set(typedItems.map((item) => item.date)).size === typedItems.length
    && new Set(typedItems.map((item) => item.entry_id)).size === typedItems.length
    && new Set(typedItems.map((item) => item.revision_id)).size === typedItems.length
    && new Set(segmentIds).size === segmentIds.length
    && new Set(typedFiles.map((file) => file.path)).size === typedFiles.length
    && typedItems.every((item, index) => index === 0 || typedItems[index - 1]!.date < item.date)
    && typedFiles.every((file, index) => index === 0 || typedFiles[index - 1]!.path < file.path);
}

function isCheckpointItem(value: unknown): value is JournalImportCheckpointItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).sort().join(",") === "content_sha256,date,entry_id,revision_id,segment_ids"
    && typeof item.date === "string"
    && /^\d{4}-\d{2}-\d{2}$/u.test(item.date)
    && isStableId(item.entry_id)
    && isStableId(item.revision_id)
    && Array.isArray(item.segment_ids)
    && item.segment_ids.length > 0
    && item.segment_ids.length <= 10_000
    && item.segment_ids.every(isStableId)
    && new Set(item.segment_ids).size === item.segment_ids.length
    && isSha256(item.content_sha256);
}

function isPlannedFile(value: unknown): value is JournalImportCheckpointPlannedFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const file = value as Record<string, unknown>;
  return Object.keys(file).sort().join(",") === "path,sha256"
    && typeof file.path === "string"
    && /^(?:data\/journal-(?:entries|revisions|segments)\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\.json)$/u.test(file.path)
    && isSha256(file.sha256);
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isGitSha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}

function isInstant(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    && !Number.isNaN(Date.parse(value));
}
