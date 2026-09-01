import type { GitHubContentsAdapter } from "./github-contents";
import type { JournalEntryRecord } from "./journal-entries";
import { parseJournalImportCheckpointRecord, type JournalImportCheckpointRecord } from "./journal-import-checkpoints";
import type { JournalRevisionRecord } from "./journal-revisions";
import type { JournalSegmentRecord } from "./journal-segments";
import { readLegacyJournalPlanningSnapshot } from "./legacy-journal-atomic-writer";
import { recordPath, serializeRecord } from "./protocol";

type SyncedRecord<T> = { record: T; blobSha: string };

export type LegacyJournalCheckpointRollbackPreview = {
  checkpointId: string;
  importBatchId: string;
  expectedParentCommitSha: string;
  items: Array<{
    date: string;
    entryId: string;
    status: "ready" | "already_inactive" | "blocked";
    blockers: string[];
    expectedEntryBlobSha: string | null;
    retainedRevisionIds: string[];
    retainedSegmentIds: string[];
  }>;
  summary: { ready: number; alreadyInactive: number; blocked: number };
  rollbackReady: boolean;
  operation: "soft_delete_entries_only";
  immutableHistoryRetained: true;
  commitEnabled: false;
};

export function newestLegacyJournalCheckpoints(checkpoints: JournalImportCheckpointRecord[]) {
  return [...checkpoints].sort((left, right) => right.data.committed_at.localeCompare(left.data.committed_at) || right.id.localeCompare(left.id));
}

export async function buildLegacyJournalCheckpointRollbackPreview(input: {
  checkpoint: JournalImportCheckpointRecord;
  entries: Array<SyncedRecord<JournalEntryRecord>>;
  revisions: Array<{ record: JournalRevisionRecord }>;
  segments: Array<{ record: JournalSegmentRecord }>;
}): Promise<LegacyJournalCheckpointRollbackPreview> {
  const plannedHashes = new Map(input.checkpoint.data.planned_files.map((file) => [file.path, file.sha256]));
  const items = await Promise.all(input.checkpoint.data.items.map(async (checkpointItem) => {
    const syncedEntry = input.entries.find((entry) => entry.record.id === checkpointItem.entry_id);
    const syncedRevision = input.revisions.find((revision) => revision.record.id === checkpointItem.revision_id);
    const syncedSegments = checkpointItem.segment_ids.map((id) => input.segments.find((segment) => segment.record.id === id));
    const entry = syncedEntry?.record;
    const revision = syncedRevision?.record;
    const segments = syncedSegments.map((segment) => segment?.record);
    const blockers: string[] = [];

    if (!entry || !syncedEntry) blockers.push("LEGACY_ROLLBACK_ENTRY_MISSING");
    if (!revision || !syncedRevision) blockers.push("LEGACY_ROLLBACK_REVISION_MISSING");
    if (segments.some((segment) => !segment)) blockers.push("LEGACY_ROLLBACK_SEGMENT_MISSING");

    if (entry) {
      if (entry.owner_id !== input.checkpoint.owner_id || revision?.owner_id !== input.checkpoint.owner_id || segments.some((segment) => segment?.owner_id !== input.checkpoint.owner_id)) blockers.push("LEGACY_ROLLBACK_OWNER_MISMATCH");
      if (entry.data.journal_date !== checkpointItem.date) blockers.push("LEGACY_ROLLBACK_DATE_CHANGED");
      if (entry.data.current_revision_id !== checkpointItem.revision_id) blockers.push("LEGACY_ROLLBACK_CURRENT_REVISION_CHANGED");
      if (entry.data.body_markdown !== revision?.data.body_markdown || revision?.data.content_sha256 !== checkpointItem.content_sha256) blockers.push("LEGACY_ROLLBACK_CONTENT_CHANGED");
      const scopedRevisions = input.revisions.filter((item) => item.record.data.journal_entry_id === entry.id);
      const scopedSegments = input.segments.filter((item) => item.record.data.journal_entry_id === entry.id);
      if (scopedRevisions.length !== 1 || scopedRevisions[0]?.record.id !== checkpointItem.revision_id) blockers.push("LEGACY_ROLLBACK_NEWER_REVISION_EXISTS");
      if (scopedSegments.length !== checkpointItem.segment_ids.length || scopedSegments.some((item) => !checkpointItem.segment_ids.includes(item.record.id))) blockers.push("LEGACY_ROLLBACK_SEGMENT_SET_CHANGED");
      if (segments.some((segment) => segment?.data.source_ref?.import_batch_id !== input.checkpoint.data.import_batch_id)) blockers.push("LEGACY_ROLLBACK_SOURCE_MISMATCH");
      if (entry.deleted_at === null && entry.version !== 1) blockers.push("LEGACY_ROLLBACK_ENTRY_EDITED");
      if (entry.deleted_at !== null && entry.version !== 2) blockers.push("LEGACY_ROLLBACK_ENTRY_LIFECYCLE_CHANGED");
    }
    if (syncedEntry && !isGitSha(syncedEntry.blobSha)) blockers.push("LEGACY_ROLLBACK_ENTRY_BLOB_INVALID");

    const immutableRecords = [
      ...(syncedRevision ? [{ path: recordPath("journal_revision", syncedRevision.record.id), record: syncedRevision.record }] : []),
      ...syncedSegments.filter((item): item is { record: JournalSegmentRecord } => Boolean(item)).map((item) => ({ path: recordPath("journal_segment", item.record.id), record: item.record })),
    ];
    for (const current of immutableRecords) {
      const expectedHash = plannedHashes.get(current.path);
      if (!expectedHash) blockers.push("LEGACY_ROLLBACK_PLANNED_FILE_MISSING");
      else if (await sha256Text(serializeRecord(current.record)) !== expectedHash) blockers.push("LEGACY_ROLLBACK_PLANNED_FILE_CHANGED");
    }
    if (entry?.deleted_at === null) {
      const entryPath = recordPath("journal_entry", entry.id);
      const expectedHash = plannedHashes.get(entryPath);
      if (!expectedHash) blockers.push("LEGACY_ROLLBACK_PLANNED_FILE_MISSING");
      else if (await sha256Text(serializeRecord(entry)) !== expectedHash) blockers.push("LEGACY_ROLLBACK_PLANNED_FILE_CHANGED");
    }

    const status = blockers.length ? "blocked" : entry!.deleted_at === null ? "ready" : "already_inactive";
    return {
      date: checkpointItem.date,
      entryId: checkpointItem.entry_id,
      status: status as "ready" | "already_inactive" | "blocked",
      blockers: unique(blockers),
      expectedEntryBlobSha: syncedEntry?.blobSha ?? null,
      retainedRevisionIds: revision ? [revision.id] : [],
      retainedSegmentIds: segments.filter((segment): segment is JournalSegmentRecord => Boolean(segment)).map((segment) => segment.id),
    };
  }));
  const summary = {
    ready: items.filter((item) => item.status === "ready").length,
    alreadyInactive: items.filter((item) => item.status === "already_inactive").length,
    blocked: items.filter((item) => item.status === "blocked").length,
  };
  return {
    checkpointId: input.checkpoint.id,
    importBatchId: input.checkpoint.data.import_batch_id,
    expectedParentCommitSha: input.checkpoint.data.expected_parent_commit_sha,
    items,
    summary,
    rollbackReady: summary.ready > 0 && summary.blocked === 0,
    operation: "soft_delete_entries_only",
    immutableHistoryRetained: true,
    commitEnabled: false,
  };
}

export async function readLegacyJournalCheckpointRollbackPreview(adapter: GitHubContentsAdapter, checkpointPath: string) {
  if (!/^data\/journal-import-checkpoints\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\.json$/u.test(checkpointPath)) throw new Error("INVALID_LEGACY_ROLLBACK_CHECKPOINT_PATH");
  const planning = await readLegacyJournalPlanningSnapshot(adapter);
  const checkpoint = parseJournalImportCheckpointRecord((await adapter.readText(checkpointPath, planning.headCommitSha)).text);
  if (recordPath("journal_import_checkpoint", checkpoint.id) !== checkpointPath) throw new Error("LEGACY_ROLLBACK_CHECKPOINT_PATH_MISMATCH");
  const entryFiles = await Promise.all(checkpoint.data.items.map((item) => adapter.readText(recordPath("journal_entry", item.entry_id), planning.headCommitSha)));
  const endingSnapshot = await adapter.readBranchSnapshot();
  if (endingSnapshot.headCommitSha !== planning.headCommitSha) throw new Error("LEGACY_ROLLBACK_PREVIEW_HEAD_CHANGED");
  return buildLegacyJournalCheckpointRollbackPreview({
    checkpoint,
    entries: checkpoint.data.items.map((item, index) => ({ record: planning.entries.find((entry) => entry.id === item.entry_id)!, blobSha: entryFiles[index]!.blobSha })).filter((item) => Boolean(item.record)),
    revisions: planning.revisions.map((record) => ({ record })),
    segments: planning.segments.map((record) => ({ record })),
  });
}

function isGitSha(value: string) { return /^[a-f0-9]{40}$/u.test(value); }
function unique(values: string[]) { return [...new Set(values)]; }
async function sha256Text(value: string) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
