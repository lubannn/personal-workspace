import { localDateTimeToIso } from "./calendar-events";
import type { LegacyDocxPreview } from "./legacy-docx-preview";
import { legacyJournalDryRunIdentity } from "./legacy-journal-dry-run";
import { createJournalEntryData, type JournalEntryRecord } from "./journal-entries";
import { createJournalRevisionData, sha256JournalRevisionBody, type JournalRevisionRecord } from "./journal-revisions";
import { renderJournalSegmentsMarkdown, type JournalSegmentSnapshot } from "./journal-segment-codec";
import { createJournalSegmentData, type JournalSegmentRecord } from "./journal-segments";
import { createWorkspaceRecord, recordPath, serializeRecord, type WorkspaceRecord } from "./protocol";

export const LEGACY_JOURNAL_IMPORT_COMMIT_ENABLED = false as const;
export const LEGACY_JOURNAL_IMPORT_PLAN_VERSION = 1 as const;
export const LEGACY_JOURNAL_IMPORT_CHECKPOINT_VERSION = 1 as const;
export const MAX_LEGACY_JOURNAL_DATES_PER_COMMIT = 25;

export type LegacyJournalExistingState = {
  entries: JournalEntryRecord[];
  revisions: JournalRevisionRecord[];
  segments: JournalSegmentRecord[];
};

export type LegacyJournalPlannedFile = {
  path: string;
  text: string;
  sha256: string;
  entityType: "journal_entry" | "journal_revision" | "journal_segment";
  recordId: string;
};

export type LegacyJournalPlannedArtifacts = {
  entry: JournalEntryRecord;
  revision: JournalRevisionRecord;
  segments: JournalSegmentRecord[];
  files: LegacyJournalPlannedFile[];
};

export type LegacyJournalCommitPlanItem = {
  date: string;
  status: "pending" | "already_imported" | "conflict";
  conflicts: string[];
  artifacts: LegacyJournalPlannedArtifacts | null;
};

export type LegacyJournalCommitPlan = {
  planVersion: typeof LEGACY_JOURNAL_IMPORT_PLAN_VERSION;
  importBatchId: string;
  dryRunId: string;
  correctionSetSha256: string;
  sourceSha256: string;
  expectedHeadCommitSha: string;
  plannedAt: string;
  selectedDates: string[];
  items: LegacyJournalCommitPlanItem[];
  files: LegacyJournalPlannedFile[];
  summary: { pending: number; alreadyImported: number; conflicts: number; files: number };
  commitReady: boolean;
  commitEnabled: false;
};

export type LegacyJournalImportCheckpoint = {
  checkpointVersion: typeof LEGACY_JOURNAL_IMPORT_CHECKPOINT_VERSION;
  importBatchId: string;
  dryRunId: string;
  parentCommitSha: string;
  commitSha: string;
  committedAt: string;
  items: Array<{
    date: string;
    entryId: string;
    revisionId: string;
    segmentIds: string[];
    contentSha256: string;
    entryBlobSha: string;
  }>;
};

export type LegacyJournalRollbackEntry = { record: JournalEntryRecord; blobSha: string };

export type LegacyJournalRollbackPreview = {
  checkpointVersion: typeof LEGACY_JOURNAL_IMPORT_CHECKPOINT_VERSION;
  importBatchId: string;
  checkpointCommitSha: string;
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

export async function buildLegacyJournalCommitPlan(input: {
  preview: LegacyDocxPreview;
  ownerId: string;
  expectedHeadCommitSha: string;
  selectedDates: string[];
  existing: LegacyJournalExistingState;
  plannedAt: string;
}): Promise<LegacyJournalCommitPlan> {
  assertCommitPlanInput(input);
  const identity = await legacyJournalDryRunIdentity(input.preview);
  const identityHash = await sha256Text(identity.dryRunId);
  const importBatchId = `legacy_import_${identityHash.slice(0, 32)}`;
  const selectedDates = [...input.selectedDates].sort();
  const previewByDate = new Map(input.preview.parse.entries.map((entry) => [entry.date, entry]));
  const items: LegacyJournalCommitPlanItem[] = [];

  for (const date of selectedDates) {
    const previewEntry = previewByDate.get(date)!;
    let artifacts: LegacyJournalPlannedArtifacts;
    try {
      artifacts = await createPlannedArtifacts({
        previewEntry,
        ownerId: input.ownerId,
        importBatchId,
        identityHash,
        plannedAt: input.plannedAt,
      });
    } catch (error) {
      items.push({ date, status: "conflict", conflicts: [planningErrorCode(error)], artifacts: null });
      continue;
    }

    const existingEntry = input.existing.entries.find((entry) => entry.id === artifacts.entry.id);
    const existingRevision = input.existing.revisions.find((revision) => revision.id === artifacts.revision.id);
    const existingSegments = artifacts.segments.map((segment) => input.existing.segments.find((existing) => existing.id === segment.id));
    const plannedIdPresent = Boolean(existingEntry || existingRevision || existingSegments.some(Boolean));
    const dateRecords = input.existing.entries.filter((entry) => entry.data.journal_date === date);

    if (existingEntry && existingRevision && existingSegments.every(Boolean) && exactImportedRecords(
      artifacts,
      existingEntry,
      existingRevision,
      existingSegments as JournalSegmentRecord[],
      input.existing,
    )) {
      items.push({ date, status: "already_imported", conflicts: [], artifacts });
      continue;
    }

    const conflicts: string[] = [];
    if (dateRecords.length > 0) conflicts.push("LEGACY_IMPORT_JOURNAL_DATE_EXISTS");
    if (plannedIdPresent) conflicts.push("LEGACY_IMPORT_RECORD_ID_CONFLICT");
    const batchSegmentsForDate = input.existing.segments.filter((segment) => segment.data.source_ref?.import_batch_id === importBatchId
      && input.existing.entries.find((entry) => entry.id === segment.data.journal_entry_id)?.data.journal_date === date);
    if (batchSegmentsForDate.length > 0) conflicts.push("LEGACY_IMPORT_BATCH_STATE_MISMATCH");
    items.push({ date, status: conflicts.length ? "conflict" : "pending", conflicts: unique(conflicts), artifacts });
  }

  const files = items.filter((item) => item.status === "pending").flatMap((item) => item.artifacts!.files);
  if (new Set(files.map((file) => file.path)).size !== files.length) throw new Error("LEGACY_IMPORT_DUPLICATE_PLANNED_PATH");
  const summary = {
    pending: items.filter((item) => item.status === "pending").length,
    alreadyImported: items.filter((item) => item.status === "already_imported").length,
    conflicts: items.filter((item) => item.status === "conflict").length,
    files: files.length,
  };
  return {
    planVersion: LEGACY_JOURNAL_IMPORT_PLAN_VERSION,
    importBatchId,
    dryRunId: identity.dryRunId,
    correctionSetSha256: identity.correctionSetSha256,
    sourceSha256: input.preview.source.sha256,
    expectedHeadCommitSha: input.expectedHeadCommitSha,
    plannedAt: input.plannedAt,
    selectedDates,
    items,
    files,
    summary,
    commitReady: summary.pending > 0 && summary.conflicts === 0,
    commitEnabled: false,
  };
}

export function createLegacyJournalImportCheckpoint(input: {
  plan: LegacyJournalCommitPlan;
  commitSha: string;
  committedAt: string;
  writtenFiles: Array<{ path: string; blobSha: string }>;
}): LegacyJournalImportCheckpoint {
  if (!input.plan.commitReady || input.plan.commitEnabled) throw new Error("LEGACY_IMPORT_PLAN_NOT_COMMIT_READY");
  assertGitSha(input.commitSha, "INVALID_LEGACY_IMPORT_COMMIT_SHA");
  assertInstant(input.committedAt, "INVALID_LEGACY_IMPORT_CHECKPOINT_TIMESTAMP");
  const expectedPaths = new Set(input.plan.files.map((file) => file.path));
  if (input.writtenFiles.length !== expectedPaths.size
    || new Set(input.writtenFiles.map((file) => file.path)).size !== input.writtenFiles.length
    || input.writtenFiles.some((file) => !expectedPaths.has(file.path) || !/^[a-f0-9]{40}$/u.test(file.blobSha))) {
    throw new Error("LEGACY_IMPORT_CHECKPOINT_FILE_MISMATCH");
  }
  const blobByPath = new Map(input.writtenFiles.map((file) => [file.path, file.blobSha]));
  return {
    checkpointVersion: LEGACY_JOURNAL_IMPORT_CHECKPOINT_VERSION,
    importBatchId: input.plan.importBatchId,
    dryRunId: input.plan.dryRunId,
    parentCommitSha: input.plan.expectedHeadCommitSha,
    commitSha: input.commitSha,
    committedAt: input.committedAt,
    items: input.plan.items.filter((item) => item.status === "pending").map((item) => {
      const artifacts = item.artifacts!;
      return {
        date: item.date,
        entryId: artifacts.entry.id,
        revisionId: artifacts.revision.id,
        segmentIds: artifacts.segments.map((segment) => segment.id),
        contentSha256: artifacts.revision.data.content_sha256,
        entryBlobSha: blobByPath.get(recordPath("journal_entry", artifacts.entry.id))!,
      };
    }),
  };
}

export function buildLegacyJournalRollbackPreview(input: {
  checkpoint: LegacyJournalImportCheckpoint;
  entries: LegacyJournalRollbackEntry[];
  revisions: JournalRevisionRecord[];
  segments: JournalSegmentRecord[];
}): LegacyJournalRollbackPreview {
  validateCheckpoint(input.checkpoint);
  const items = input.checkpoint.items.map((checkpointItem) => {
    const syncedEntry = input.entries.find((entry) => entry.record.id === checkpointItem.entryId);
    const entry = syncedEntry?.record;
    const revision = input.revisions.find((item) => item.id === checkpointItem.revisionId);
    const segments = checkpointItem.segmentIds.map((id) => input.segments.find((item) => item.id === id));
    const blockers: string[] = [];
    if (!entry || !syncedEntry) blockers.push("LEGACY_ROLLBACK_ENTRY_MISSING");
    if (!revision) blockers.push("LEGACY_ROLLBACK_REVISION_MISSING");
    if (segments.some((segment) => !segment)) blockers.push("LEGACY_ROLLBACK_SEGMENT_MISSING");
    if (entry) {
      if (entry.data.current_revision_id !== checkpointItem.revisionId) blockers.push("LEGACY_ROLLBACK_CURRENT_REVISION_CHANGED");
      if (entry.owner_id !== revision?.owner_id || segments.some((segment) => segment && segment.owner_id !== entry.owner_id)) blockers.push("LEGACY_ROLLBACK_OWNER_MISMATCH");
      if (entry.data.body_markdown !== revision?.data.body_markdown || revision.data.content_sha256 !== checkpointItem.contentSha256) blockers.push("LEGACY_ROLLBACK_CONTENT_CHANGED");
      const scopedRevisions = input.revisions.filter((item) => item.data.journal_entry_id === entry.id);
      const scopedSegments = input.segments.filter((item) => item.data.journal_entry_id === entry.id);
      if (scopedRevisions.length !== 1 || scopedRevisions[0]?.id !== checkpointItem.revisionId) blockers.push("LEGACY_ROLLBACK_NEWER_REVISION_EXISTS");
      if (scopedSegments.length !== checkpointItem.segmentIds.length || scopedSegments.some((item) => !checkpointItem.segmentIds.includes(item.id))) blockers.push("LEGACY_ROLLBACK_SEGMENT_SET_CHANGED");
      if (segments.some((segment) => segment && segment.data.source_ref?.import_batch_id !== input.checkpoint.importBatchId)) blockers.push("LEGACY_ROLLBACK_SOURCE_MISMATCH");
      if (entry.deleted_at === null && entry.version !== 1) blockers.push("LEGACY_ROLLBACK_ENTRY_EDITED");
    }
    if (syncedEntry && !/^[a-f0-9]{40}$/u.test(syncedEntry.blobSha)) blockers.push("LEGACY_ROLLBACK_ENTRY_BLOB_INVALID");
    const status = blockers.length ? "blocked" : entry!.deleted_at !== null ? "already_inactive" : "ready";
    return {
      date: checkpointItem.date,
      entryId: checkpointItem.entryId,
      status: status as "ready" | "already_inactive" | "blocked",
      blockers: unique(blockers),
      expectedEntryBlobSha: syncedEntry?.blobSha ?? null,
      retainedRevisionIds: revision ? [revision.id] : [],
      retainedSegmentIds: segments.filter((segment): segment is JournalSegmentRecord => Boolean(segment)).map((segment) => segment.id),
    };
  });
  const summary = {
    ready: items.filter((item) => item.status === "ready").length,
    alreadyInactive: items.filter((item) => item.status === "already_inactive").length,
    blocked: items.filter((item) => item.status === "blocked").length,
  };
  return {
    checkpointVersion: LEGACY_JOURNAL_IMPORT_CHECKPOINT_VERSION,
    importBatchId: input.checkpoint.importBatchId,
    checkpointCommitSha: input.checkpoint.commitSha,
    items,
    summary,
    rollbackReady: summary.ready > 0 && summary.blocked === 0,
    operation: "soft_delete_entries_only",
    immutableHistoryRetained: true,
    commitEnabled: false,
  };
}

async function createPlannedArtifacts(input: {
  previewEntry: LegacyDocxPreview["parse"]["entries"][number];
  ownerId: string;
  importBatchId: string;
  identityHash: string;
  plannedAt: string;
}): Promise<LegacyJournalPlannedArtifacts> {
  const dateKey = input.previewEntry.date.replaceAll("-", "");
  const entryId = `journal_legacy_${input.identityHash.slice(0, 16)}_${dateKey}`;
  const revisionId = `${entryId}_r1`;
  const segmentRecords: JournalSegmentRecord[] = input.previewEntry.segments.map((segment, index) => {
    if (!segment.bodyMarkdown.trim()) throw new Error("LEGACY_IMPORT_EMPTY_SEGMENT_BODY");
    const sourceLocator = segment.sourceLocators.join(";");
    if (!sourceLocator || sourceLocator.length > 500) throw new Error("LEGACY_IMPORT_SOURCE_LOCATOR_TOO_LONG");
    const id = `${entryId}_s${String(index + 1).padStart(4, "0")}`;
    let occurredAt: string | null = null;
    try {
      occurredAt = segment.time ? localDateTimeToIso(input.previewEntry.date, segment.time, input.previewEntry.timezone) : null;
    } catch {
      throw new Error("LEGACY_IMPORT_INVALID_SEGMENT_TIME");
    }
    return createWorkspaceRecord({
      entityType: "journal_segment",
      id,
      ownerId: input.ownerId,
      timestamp: input.plannedAt,
      data: createJournalSegmentData({
        id,
        journalEntryId: entryId,
        localTime: segment.time,
        occurredAt,
        bodyMarkdown: segment.bodyMarkdown,
        sortOrder: index,
        sourceRef: { source_type: "legacy_word", import_batch_id: input.importBatchId, source_locator: sourceLocator },
      }),
    });
  });
  const snapshots: JournalSegmentSnapshot[] = segmentRecords.map((segment) => ({ id: segment.id, ...segment.data }));
  const bodyMarkdown = renderJournalSegmentsMarkdown(entryId, snapshots).trim();
  const revision = createWorkspaceRecord({
    entityType: "journal_revision",
    id: revisionId,
    ownerId: input.ownerId,
    timestamp: input.plannedAt,
    data: createJournalRevisionData({
      journalEntryId: entryId,
      revisionNumber: 1,
      contentMode: "segments",
      bodyMarkdown,
      segmentIds: segmentRecords.map((segment) => segment.id),
      contentSha256: await sha256JournalRevisionBody(bodyMarkdown),
      createdAt: input.plannedAt,
      createdBy: "legacy_importer",
      changeReason: "legacy_import",
    }),
  });
  const entry = createWorkspaceRecord({
    entityType: "journal_entry",
    id: entryId,
    ownerId: input.ownerId,
    timestamp: input.plannedAt,
    data: createJournalEntryData({
      journalDate: input.previewEntry.date,
      timezone: input.previewEntry.timezone,
      bodyMarkdown,
      timestamp: input.plannedAt,
      currentRevisionId: revisionId,
    }),
  });
  const records: Array<{ entityType: LegacyJournalPlannedFile["entityType"]; record: WorkspaceRecord<Record<string, unknown>> }> = [
    ...segmentRecords.map((record) => ({ entityType: "journal_segment" as const, record })),
    { entityType: "journal_revision", record: revision },
    { entityType: "journal_entry", record: entry },
  ];
  const files = await Promise.all(records.map(async ({ entityType, record }) => {
    const text = serializeRecord(record);
    return { path: recordPath(entityType, record.id), text, sha256: await sha256Text(text), entityType, recordId: record.id };
  }));
  return { entry, revision, segments: segmentRecords, files };
}

function exactImportedRecords(
  planned: LegacyJournalPlannedArtifacts,
  entry: JournalEntryRecord,
  revision: JournalRevisionRecord,
  segments: JournalSegmentRecord[],
  existing: LegacyJournalExistingState,
) {
  if (entry.owner_id !== planned.entry.owner_id || entry.version !== 1 || entry.deleted_at !== null
    || entry.data.journal_date !== planned.entry.data.journal_date
    || entry.data.timezone !== planned.entry.data.timezone
    || entry.data.title !== planned.entry.data.title
    || entry.data.body_markdown !== planned.entry.data.body_markdown
    || entry.data.mood !== null || entry.data.weather !== null
    || entry.data.current_revision_id !== planned.revision.id) return false;
  if (revision.owner_id !== planned.revision.owner_id || revision.version !== 1 || revision.deleted_at !== null
    || revision.data.journal_entry_id !== entry.id
    || revision.data.revision_number !== 1
    || revision.data.content_mode !== "segments"
    || revision.data.body_markdown !== planned.revision.data.body_markdown
    || revision.data.content_sha256 !== planned.revision.data.content_sha256
    || revision.data.created_by !== "legacy_importer"
    || revision.data.change_reason !== "legacy_import"
    || !sameStrings(revision.data.segment_ids, planned.revision.data.segment_ids)) return false;
  if (segments.some((segment, index) => segment.owner_id !== planned.segments[index]?.owner_id
    || segment.version !== 1 || segment.deleted_at !== null
    || JSON.stringify(segment.data) !== JSON.stringify(planned.segments[index]?.data))) return false;
  const scopedRevisions = existing.revisions.filter((item) => item.data.journal_entry_id === entry.id);
  const scopedSegments = existing.segments.filter((item) => item.data.journal_entry_id === entry.id);
  return scopedRevisions.length === 1 && scopedRevisions[0]?.id === revision.id
    && scopedSegments.length === segments.length
    && scopedSegments.every((segment) => segments.some((item) => item.id === segment.id));
}

function assertCommitPlanInput(input: {
  preview: LegacyDocxPreview;
  ownerId: string;
  expectedHeadCommitSha: string;
  selectedDates: string[];
  existing: LegacyJournalExistingState;
  plannedAt: string;
}) {
  if (!input.preview.parse.dryRunReady || input.preview.archiveDiagnostics.some((issue) => issue.severity === "error" || issue.severity === "blocking")) throw new Error("LEGACY_IMPORT_PLAN_NOT_READY");
  if (input.preview.commitEnabled || input.preview.parse.commitEnabled) throw new Error("LEGACY_IMPORT_COMMIT_MUST_REMAIN_DISABLED");
  assertGitSha(input.expectedHeadCommitSha, "INVALID_LEGACY_IMPORT_HEAD_SHA");
  assertInstant(input.plannedAt, "INVALID_LEGACY_IMPORT_PLAN_TIMESTAMP");
  if (input.selectedDates.length === 0 || input.selectedDates.length > MAX_LEGACY_JOURNAL_DATES_PER_COMMIT || new Set(input.selectedDates).size !== input.selectedDates.length) throw new Error("INVALID_LEGACY_IMPORT_DATE_SELECTION");
  const dates = new Set(input.preview.parse.entries.map((entry) => entry.date));
  if (input.selectedDates.some((date) => !dates.has(date))) throw new Error("LEGACY_IMPORT_DATE_NOT_IN_PREVIEW");
  if (new Set(input.existing.entries.map((entry) => entry.id)).size !== input.existing.entries.length
    || new Set(input.existing.revisions.map((revision) => revision.id)).size !== input.existing.revisions.length
    || new Set(input.existing.segments.map((segment) => segment.id)).size !== input.existing.segments.length) throw new Error("LEGACY_IMPORT_EXISTING_ID_DUPLICATE");
}

function validateCheckpoint(checkpoint: LegacyJournalImportCheckpoint) {
  if (checkpoint.checkpointVersion !== LEGACY_JOURNAL_IMPORT_CHECKPOINT_VERSION || !/^legacy_import_[a-f0-9]{32}$/u.test(checkpoint.importBatchId) || !checkpoint.dryRunId.startsWith("legacy-journal:")) throw new Error("INVALID_LEGACY_IMPORT_CHECKPOINT");
  assertGitSha(checkpoint.parentCommitSha, "INVALID_LEGACY_IMPORT_CHECKPOINT");
  assertGitSha(checkpoint.commitSha, "INVALID_LEGACY_IMPORT_CHECKPOINT");
  assertInstant(checkpoint.committedAt, "INVALID_LEGACY_IMPORT_CHECKPOINT");
  const allSegmentIds = checkpoint.items.flatMap((item) => item.segmentIds);
  if (checkpoint.items.length === 0
    || new Set(checkpoint.items.map((item) => item.entryId)).size !== checkpoint.items.length
    || new Set(checkpoint.items.map((item) => item.revisionId)).size !== checkpoint.items.length
    || new Set(allSegmentIds).size !== allSegmentIds.length
    || checkpoint.items.some((item) => !/^\d{4}-\d{2}-\d{2}$/u.test(item.date)
      || !isStableId(item.entryId)
      || !isStableId(item.revisionId)
      || item.segmentIds.length === 0
      || item.segmentIds.some((id) => !isStableId(id))
      || !/^[a-f0-9]{64}$/u.test(item.contentSha256)
      || !/^[a-f0-9]{40}$/u.test(item.entryBlobSha))) throw new Error("INVALID_LEGACY_IMPORT_CHECKPOINT");
}

function planningErrorCode(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return code.startsWith("LEGACY_IMPORT_") || code.startsWith("INVALID_JOURNAL_") ? code : "LEGACY_IMPORT_ARTIFACT_BUILD_FAILED";
}

function assertGitSha(value: string, code: string) {
  if (!/^[a-f0-9]{40}$/u.test(value)) throw new Error(code);
}

function assertInstant(value: string, code: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) throw new Error(code);
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isStableId(value: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(value);
}

function unique(values: string[]) {
  return [...new Set(values)];
}

async function sha256Text(value: string) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
