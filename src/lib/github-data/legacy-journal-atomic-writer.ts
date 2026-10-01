import {
  GitHubConflictError,
  GitHubDataError,
  type GitHubContentsAdapter,
  type GitHubDirectoryItem,
} from "./github-contents";
import {
  createJournalImportCheckpointRecord,
  parseJournalImportCheckpointRecord,
  type JournalImportCheckpointRecord,
} from "./journal-import-checkpoints";
import { parseJournalEntryRecord, type JournalEntryRecord } from "./journal-entries";
import { parseJournalRevisionRecord, sha256JournalRevisionBody, type JournalRevisionRecord } from "./journal-revisions";
import { parseJournalSegmentRecord, type JournalSegmentRecord } from "./journal-segments";
import {
  createLegacyJournalImportCheckpoint,
  type LegacyJournalCommitPlan,
  type LegacyJournalImportCheckpoint,
} from "./legacy-journal-commit-plan";
import { recordPath, serializeRecord } from "./protocol";

export const LEGACY_JOURNAL_ATOMIC_WRITER_IMPLEMENTED = true as const;
export const MAX_LEGACY_JOURNAL_ATOMIC_FILES = 250;
export const MAX_LEGACY_JOURNAL_ATOMIC_BYTES = 10 * 1024 * 1024;

export type LegacyJournalAtomicWriterAdapter = Pick<
  GitHubContentsAdapter,
  "listDirectory" | "readBranchSnapshot" | "readText" | "writeAtomicFiles"
>;

export type LegacyJournalAtomicWriteResult = {
  commitSha: string;
  treeSha: string;
  checkpoint: LegacyJournalImportCheckpoint;
  checkpointRecord: JournalImportCheckpointRecord;
  checkpointFile: { path: string; blobSha: string };
  journalFiles: Array<{ path: string; blobSha: string }>;
};

export type LegacyJournalPlanningSnapshot = {
  headCommitSha: string;
  entries: JournalEntryRecord[];
  revisions: JournalRevisionRecord[];
  segments: JournalSegmentRecord[];
};

export type LegacyJournalScopedPlanningSnapshot = LegacyJournalPlanningSnapshot & {
  existingPaths: Set<string>;
};

export type LegacyJournalAtomicPayloadPreview = {
  ownerId: string;
  planSha256: string;
  checkpointRecord: JournalImportCheckpointRecord | null;
  checkpointPath: string;
  files: Array<{ path: string; text: string }>;
  fileCount: number;
  byteCount: number;
  byteCountExact: boolean;
  limitBlockers: Array<"LEGACY_IMPORT_ATOMIC_FILE_LIMIT_EXCEEDED" | "LEGACY_IMPORT_ATOMIC_BYTE_LIMIT_EXCEEDED">;
};

export type LegacyJournalReconciliation = {
  status: "committed" | "not_committed" | "conflict";
  observedHeadCommitSha: string;
  checkpointPath: string;
  commitSha: string | null;
  blockers: string[];
};

export async function readLegacyJournalPlanningSnapshot(
  adapter: LegacyJournalAtomicWriterAdapter,
): Promise<LegacyJournalPlanningSnapshot> {
  const snapshot = await adapter.readBranchSnapshot();
  const [entries, revisions, segments] = await Promise.all([
    loadCollection(adapter, "data/journal-entries", snapshot.headCommitSha, parseJournalEntryRecord, "journal_entry"),
    loadCollection(adapter, "data/journal-revisions", snapshot.headCommitSha, parseJournalRevisionRecord, "journal_revision"),
    loadCollection(adapter, "data/journal-segments", snapshot.headCommitSha, parseJournalSegmentRecord, "journal_segment"),
  ]);
  return { headCommitSha: snapshot.headCommitSha, entries, revisions, segments };
}

/** Only records on the selected dates are needed to plan a new batch. The full tree still guards every planned path. */
export async function readLegacyJournalScopedPlanningSnapshot(
  adapter: LegacyJournalAtomicWriterAdapter,
  dates: readonly string[],
): Promise<LegacyJournalScopedPlanningSnapshot> {
  const selectedDates = new Set(dates);
  const snapshot = await adapter.readBranchSnapshot();
  const listOrEmpty = async (directory: string) => {
    try { return await adapter.listDirectory(directory, snapshot.headCommitSha); }
    catch (error) {
      if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return [];
      throw error;
    }
  };
  const [entryItems, revisionItems, segmentItems] = await Promise.all([
    listOrEmpty("data/journal-entries"),
    listOrEmpty("data/journal-revisions"),
    listOrEmpty("data/journal-segments"),
  ]);
  const existingPaths = new Set([...entryItems, ...revisionItems, ...segmentItems]
    .filter((item) => item.type === "file")
    .map((item) => item.path));
  const indexed = new Map<string, { record: JournalEntryRecord; blobSha: string }>();
  try {
    const file = await adapter.readText("data/journal-history-index.json", snapshot.headCommitSha);
    const index: unknown = JSON.parse(file.text);
    if (!index || typeof index !== "object" || !("kind" in index) || index.kind !== "legacy_journal_entry_index" || !("entries" in index) || !Array.isArray(index.entries)) {
      throw new Error("INVALID_JOURNAL_HISTORY_INDEX");
    }
    for (const item of index.entries) {
      if (!item || typeof item.path !== "string" || typeof item.blobSha !== "string" || !/^[a-f0-9]{40}$/u.test(item.blobSha)) throw new Error("INVALID_JOURNAL_HISTORY_INDEX");
      const record = parseJournalEntryRecord(JSON.stringify(item.record));
      if (recordPath("journal_entry", record.id) !== item.path || indexed.has(item.path)) throw new Error("INVALID_JOURNAL_HISTORY_INDEX");
      indexed.set(item.path, { record, blobSha: item.blobSha });
    }
  } catch (error) {
    if (!(error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND")) throw error;
  }
  const entries: JournalEntryRecord[] = [];
  const changed = entryItems.filter((item) => item.type === "file" && item.name.endsWith(".json") && indexed.get(item.path)?.blobSha !== item.blobSha);
  for (const item of entryItems) {
    if (item.type !== "file" || !item.name.endsWith(".json")) continue;
    const match = indexed.get(item.path);
    if (match?.blobSha === item.blobSha && selectedDates.has(match.record.data.journal_date)) entries.push(match.record);
  }
  for (let offset = 0; offset < changed.length; offset += 8) {
    const chunk = await Promise.all(changed.slice(offset, offset + 8).map(async (item) => {
      const file = await adapter.readText(item.path, snapshot.headCommitSha);
      const record = parseJournalEntryRecord(file.text);
      if (recordPath("journal_entry", record.id) !== item.path) throw new Error("LEGACY_IMPORT_REMOTE_PATH_MISMATCH");
      return record;
    }));
    entries.push(...chunk.filter((record) => selectedDates.has(record.data.journal_date)));
  }
  return { headCommitSha: snapshot.headCommitSha, entries, revisions: [], segments: [], existingPaths };
}

/** Hydrate only this batch's legacy history so the planner can recognize a completed batch. */
export async function readLegacyJournalBatchHistory(
  adapter: LegacyJournalAtomicWriterAdapter,
  snapshot: LegacyJournalScopedPlanningSnapshot,
  dates: readonly string[],
): Promise<LegacyJournalScopedPlanningSnapshot> {
  const selected = new Set(dates);
  const entries = snapshot.entries.filter((entry) => selected.has(entry.data.journal_date));
  const revisionPaths = new Set(entries.flatMap((entry) => entry.data.current_revision_id
    ? [recordPath("journal_revision", entry.data.current_revision_id)] : []));
  const legacyPrefixes = entries.filter((entry) => entry.id.startsWith("journal_legacy_"))
    .map((entry) => entry.id);
  const paths = [...snapshot.existingPaths].filter((path) => revisionPaths.has(path)
    || legacyPrefixes.some((id) => path.startsWith(`data/journal-revisions/${id}_`)
      || path.startsWith(`data/journal-segments/${id}_`)));
  const revisions: JournalRevisionRecord[] = [];
  const segments: JournalSegmentRecord[] = [];
  for (let offset = 0; offset < paths.length; offset += 8) {
    const records = await Promise.all(paths.slice(offset, offset + 8).map(async (path) => {
      const file = await adapter.readText(path, snapshot.headCommitSha);
      const record = path.startsWith("data/journal-revisions/")
        ? parseJournalRevisionRecord(file.text) : parseJournalSegmentRecord(file.text);
      if (recordPath(record.entity_type, record.id) !== path) throw new Error("LEGACY_IMPORT_REMOTE_PATH_MISMATCH");
      return record;
    }));
    for (const record of records) {
      if (record.entity_type === "journal_revision") revisions.push(record as JournalRevisionRecord);
      else segments.push(record as JournalSegmentRecord);
    }
  }
  return { ...snapshot, revisions, segments };
}

export async function prepareLegacyJournalAtomicPayload(
  plan: LegacyJournalCommitPlan,
  committedAt = plan.plannedAt,
  options: { enforceLimits?: boolean } = {},
): Promise<LegacyJournalAtomicPayloadPreview> {
  assertInstant(committedAt);
  const validated = await validatePlan(plan);
  const planSha256 = await legacyJournalPlanSha256(plan, validated.items);
  const checkpointPath = recordPath("journal_import_checkpoint", `journal_import_checkpoint_${planSha256.slice(0, 32)}`);
  const fileCount = plan.files.length + 1;
  if (fileCount > MAX_LEGACY_JOURNAL_ATOMIC_FILES) {
    const limitBlockers = ["LEGACY_IMPORT_ATOMIC_FILE_LIMIT_EXCEEDED"] as LegacyJournalAtomicPayloadPreview["limitBlockers"];
    if (options.enforceLimits) throw new Error(limitBlockers[0]);
    const files = plan.files.map((file) => ({ path: file.path, text: file.text }));
    return {
      ownerId: validated.ownerId,
      planSha256,
      checkpointRecord: null,
      checkpointPath,
      files,
      fileCount,
      byteCount: files.reduce((total, file) => total + byteLength(file.text), 0),
      byteCountExact: false,
      limitBlockers,
    };
  }
  const checkpointRecord = createJournalImportCheckpointRecord({
    id: `journal_import_checkpoint_${planSha256.slice(0, 32)}`,
    ownerId: validated.ownerId,
    importBatchId: plan.importBatchId,
    dryRunId: plan.dryRunId,
    sourceSha256: plan.sourceSha256,
    correctionSetSha256: plan.correctionSetSha256,
    expectedParentCommitSha: plan.expectedHeadCommitSha,
    planSha256,
    committedAt,
    items: validated.items.map((item) => ({
      date: item.date,
      entry_id: item.entry.id,
      revision_id: item.revision.id,
      segment_ids: item.segments.map((segment) => segment.id),
      content_sha256: item.revision.data.content_sha256,
    })),
    plannedFiles: plan.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
  });
  const files = [
    ...plan.files.map((file) => ({ path: file.path, text: file.text })),
    { path: checkpointPath, text: serializeRecord(checkpointRecord) },
  ];
  const byteCount = files.reduce((total, file) => total + byteLength(file.text), 0);
  const limitBlockers: LegacyJournalAtomicPayloadPreview["limitBlockers"] = [];
  if (files.length > MAX_LEGACY_JOURNAL_ATOMIC_FILES) limitBlockers.push("LEGACY_IMPORT_ATOMIC_FILE_LIMIT_EXCEEDED");
  if (byteCount > MAX_LEGACY_JOURNAL_ATOMIC_BYTES) limitBlockers.push("LEGACY_IMPORT_ATOMIC_BYTE_LIMIT_EXCEEDED");
  if (options.enforceLimits && limitBlockers.length) throw new Error(limitBlockers[0]);
  return { ownerId: validated.ownerId, planSha256, checkpointRecord, checkpointPath, files, fileCount: files.length, byteCount, byteCountExact: true, limitBlockers };
}

export async function reconcileLegacyJournalBatch(
  adapter: LegacyJournalAtomicWriterAdapter,
  plan: LegacyJournalCommitPlan,
): Promise<LegacyJournalReconciliation> {
  const payload = await prepareLegacyJournalAtomicPayload(plan, plan.plannedAt, { enforceLimits: true });
  const snapshot = await adapter.readBranchSnapshot();
  const blockers: string[] = [];
  let checkpoint: JournalImportCheckpointRecord | null = null;
  try {
    checkpoint = parseJournalImportCheckpointRecord((await adapter.readText(payload.checkpointPath, snapshot.headCommitSha)).text);
  } catch (error) {
    if (!(error instanceof GitHubDataError) || error.code !== "GITHUB_NOT_FOUND") throw error;
  }

  if (checkpoint) {
    const expectedCheckpoint = payload.checkpointRecord!;
    if (checkpoint.owner_id !== expectedCheckpoint.owner_id
      || checkpoint.data.plan_sha256 !== payload.planSha256
      || checkpoint.data.import_batch_id !== plan.importBatchId
      || checkpoint.data.dry_run_id !== plan.dryRunId
      || checkpoint.data.expected_parent_commit_sha !== plan.expectedHeadCommitSha
      || checkpoint.data.source_sha256 !== plan.sourceSha256
      || checkpoint.data.correction_set_sha256 !== plan.correctionSetSha256
      || JSON.stringify(checkpoint.data.items) !== JSON.stringify(expectedCheckpoint.data.items)
      || JSON.stringify(checkpoint.data.planned_files) !== JSON.stringify(expectedCheckpoint.data.planned_files)) {
      blockers.push("LEGACY_RECONCILIATION_CHECKPOINT_MISMATCH");
    }
    for (const planned of plan.files) {
      try {
        const stored = await adapter.readText(planned.path, snapshot.headCommitSha);
        if (await sha256Text(stored.text) !== planned.sha256) blockers.push("LEGACY_RECONCILIATION_FILE_MISMATCH");
      } catch (error) {
        if (!(error instanceof GitHubDataError) || error.code !== "GITHUB_NOT_FOUND") throw error;
        blockers.push("LEGACY_RECONCILIATION_FILE_MISSING");
      }
    }
    return {
      status: blockers.length ? "conflict" : "committed",
      observedHeadCommitSha: snapshot.headCommitSha,
      checkpointPath: payload.checkpointPath,
      commitSha: null,
      blockers: unique(blockers),
    };
  }

  const pendingDates = new Set(plan.items.filter((item) => item.status === "pending").map((item) => item.date));
  const scoped = await readLegacyJournalScopedPlanningSnapshot(adapter, [...pendingDates]);
  if (scoped.headCommitSha !== snapshot.headCommitSha) throw new GitHubConflictError("The branch advanced during Legacy Journal reconciliation.");
  if (plan.files.some((file) => scoped.existingPaths.has(file.path))) blockers.push("LEGACY_RECONCILIATION_PARTIAL_RECORDS");
  if (scoped.entries.some((entry) => pendingDates.has(entry.data.journal_date))) blockers.push("LEGACY_RECONCILIATION_DATE_CONFLICT");
  return {
    status: blockers.length ? "conflict" : "not_committed",
    observedHeadCommitSha: snapshot.headCommitSha,
    checkpointPath: payload.checkpointPath,
    commitSha: null,
    blockers: unique(blockers),
  };
}

/**
 * Low-level atomic writer. Production UI exposure remains governed by
 * LEGACY_JOURNAL_IMPORT_COMMIT_ENABLED in legacy-journal-commit-plan.ts.
 */
export async function writeLegacyJournalBatchAtomically(
  adapter: LegacyJournalAtomicWriterAdapter,
  input: { plan: LegacyJournalCommitPlan; committedAt: string },
): Promise<LegacyJournalAtomicWriteResult> {
  const snapshot = await adapter.readBranchSnapshot();
  if (snapshot.headCommitSha !== input.plan.expectedHeadCommitSha) {
    throw new GitHubConflictError("The branch advanced after the Legacy Journal commit plan was built.");
  }
  const payload = await prepareLegacyJournalAtomicPayload(input.plan, input.committedAt, { enforceLimits: true });
  const pendingDates = input.plan.items.filter((item) => item.status === "pending").map((item) => item.date);
  const scoped = await readLegacyJournalScopedPlanningSnapshot(adapter, pendingDates);
  if (scoped.headCommitSha !== snapshot.headCommitSha) throw new GitHubConflictError("The branch advanced during Legacy Journal validation.");
  if (scoped.entries.some((entry) => entry.owner_id !== payload.ownerId)) throw new Error("LEGACY_IMPORT_REMOTE_OWNER_MISMATCH");
  if (input.plan.files.some((file) => scoped.existingPaths.has(file.path))) throw new Error("LEGACY_IMPORT_REMOTE_ID_CONFLICT");
  if (scoped.entries.some((entry) => pendingDates.includes(entry.data.journal_date))) throw new Error("LEGACY_IMPORT_REMOTE_DATE_CONFLICT");
  const checkpointRecord = payload.checkpointRecord!;
  try {
    await adapter.readText(payload.checkpointPath, snapshot.headCommitSha);
    throw new Error("LEGACY_IMPORT_CHECKPOINT_ALREADY_EXISTS");
  } catch (error) {
    if (!(error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND")) throw error;
  }

  const result = await adapter.writeAtomicFiles({
    files: payload.files,
    message: `journal: import ${input.plan.items.filter((item) => item.status === "pending")[0]!.date}..${input.plan.items.filter((item) => item.status === "pending").at(-1)!.date}`,
    expectedHeadCommitSha: snapshot.headCommitSha,
    baseTreeSha: snapshot.rootTreeSha,
  });
  const journalFiles = input.plan.files.map((file) => ({ path: file.path, blobSha: blobShaFor(result.files, file.path) }));
  return {
    commitSha: result.commitSha,
    treeSha: result.treeSha,
    checkpoint: createLegacyJournalImportCheckpoint({
      plan: input.plan,
      commitSha: result.commitSha,
      committedAt: input.committedAt,
      writtenFiles: journalFiles,
    }),
    checkpointRecord,
    checkpointFile: { path: payload.checkpointPath, blobSha: blobShaFor(result.files, payload.checkpointPath) },
    journalFiles,
  };
}

async function legacyJournalPlanSha256(
  plan: LegacyJournalCommitPlan,
  items: Array<{ date: string; entry: JournalEntryRecord; revision: JournalRevisionRecord; segments: JournalSegmentRecord[] }>,
) {
  return sha256Text(JSON.stringify({
    plan_version: plan.planVersion,
    import_batch_id: plan.importBatchId,
    dry_run_id: plan.dryRunId,
    correction_set_sha256: plan.correctionSetSha256,
    source_sha256: plan.sourceSha256,
    expected_parent_commit_sha: plan.expectedHeadCommitSha,
    selected_dates: plan.selectedDates,
    pending_items: items.map((item) => ({
      date: item.date,
      entry_id: item.entry.id,
      revision_id: item.revision.id,
      segment_ids: item.segments.map((segment) => segment.id),
      content_sha256: item.revision.data.content_sha256,
    })),
    planned_files: plan.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
  }));
}

async function validatePlan(plan: LegacyJournalCommitPlan) {
  const pendingCount = plan.items.filter((item) => item.status === "pending").length;
  const alreadyImportedCount = plan.items.filter((item) => item.status === "already_imported").length;
  const conflictCount = plan.items.filter((item) => item.status === "conflict").length;
  if (!plan.commitReady || plan.commitEnabled || pendingCount < 1 || conflictCount !== 0
    || plan.summary.pending !== pendingCount || plan.summary.alreadyImported !== alreadyImportedCount || plan.summary.conflicts !== conflictCount
    || plan.items.length !== plan.selectedDates.length
    || plan.items.some((item, index) => item.date !== plan.selectedDates[index])
    || new Set(plan.selectedDates).size !== plan.selectedDates.length) throw new Error("LEGACY_IMPORT_PLAN_NOT_COMMIT_READY");
  if (plan.files.length === 0 || plan.files.length !== plan.summary.files) throw new Error("LEGACY_IMPORT_PLAN_FILE_COUNT_INVALID");
  if (new Set(plan.files.map((file) => file.path)).size !== plan.files.length) throw new Error("LEGACY_IMPORT_DUPLICATE_PLANNED_PATH");
  if (plan.files.some((file, index) => index > 0 && plan.files[index - 1]!.path >= file.path)) throw new Error("LEGACY_IMPORT_PLANNED_FILES_NOT_SORTED");
  for (const file of plan.files) {
    if (await sha256Text(file.text) !== file.sha256) throw new Error("LEGACY_IMPORT_PLANNED_FILE_HASH_MISMATCH");
  }

  const pending = plan.items.filter((item) => item.status === "pending");
  if (pending.length !== plan.summary.pending || pending.some((item) => !item.artifacts)) throw new Error("LEGACY_IMPORT_PLAN_ITEM_MISMATCH");
  const ownerIds = new Set<string>();
  const validatedItems = pending.map((item) => {
    const artifacts = item.artifacts!;
    const entry = parseJournalEntryRecord(serializeRecord(artifacts.entry));
    const revision = parseJournalRevisionRecord(serializeRecord(artifacts.revision));
    const segments = artifacts.segments.map((segment) => parseJournalSegmentRecord(serializeRecord(segment)));
    ownerIds.add(entry.owner_id);
    ownerIds.add(revision.owner_id);
    segments.forEach((segment) => ownerIds.add(segment.owner_id));
    if (entry.data.journal_date !== item.date || entry.data.current_revision_id !== revision.id
      || revision.data.journal_entry_id !== entry.id || revision.data.content_mode !== "segments"
      || revision.data.segment_ids.join(",") !== segments.map((segment) => segment.id).join(",")
      || segments.some((segment) => segment.data.journal_entry_id !== entry.id || segment.data.source_ref?.import_batch_id !== plan.importBatchId)) {
      throw new Error("LEGACY_IMPORT_PLAN_RELATION_MISMATCH");
    }
    return { date: item.date, entry, revision, segments };
  });
  if (ownerIds.size !== 1) throw new Error("LEGACY_IMPORT_PLAN_OWNER_MISMATCH");
  const artifactFiles = pending.flatMap((item) => item.artifacts!.files).sort((left, right) => left.path.localeCompare(right.path));
  if (artifactFiles.length !== plan.files.length || artifactFiles.some((file, index) => file.path !== plan.files[index]!.path || file.text !== plan.files[index]!.text || file.sha256 !== plan.files[index]!.sha256)) {
    throw new Error("LEGACY_IMPORT_PLAN_FILE_SET_MISMATCH");
  }
  for (const item of validatedItems) {
    if (await sha256JournalRevisionBody(item.revision.data.body_markdown) !== item.revision.data.content_sha256) throw new Error("LEGACY_IMPORT_REVISION_HASH_MISMATCH");
  }
  return { ownerId: [...ownerIds][0]!, items: validatedItems };
}

async function loadCollection<T>(
  adapter: LegacyJournalAtomicWriterAdapter,
  directory: string,
  ref: string,
  parse: (text: string) => T,
  entityType: "journal_entry" | "journal_revision" | "journal_segment" | "journal_import_checkpoint",
): Promise<T[]> {
  let items: GitHubDirectoryItem[];
  try {
    items = await adapter.listDirectory(directory, ref);
  } catch (error) {
    if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return [];
    throw error;
  }
  const files = items.filter((item) => item.type === "file" && item.name.endsWith(".json"));
  const records = await Promise.all(files.map(async (item) => {
    const stored = await adapter.readText(item.path, ref);
    const record = parse(stored.text) as { id: string };
    if (recordPath(entityType, record.id) !== item.path) throw new Error("LEGACY_IMPORT_REMOTE_PATH_MISMATCH");
    return record as T;
  }));
  const ids = records.map((record) => (record as { id: string }).id);
  if (new Set(ids).size !== ids.length) throw new Error("LEGACY_IMPORT_REMOTE_ID_DUPLICATE");
  return records;
}

function blobShaFor(files: Array<{ path: string; blobSha: string }>, path: string) {
  const file = files.find((item) => item.path === path);
  if (!file || !/^[a-f0-9]{40}$/u.test(file.blobSha)) throw new Error("GITHUB_ATOMIC_WRITE_FILE_MISSING");
  return file.blobSha;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

async function sha256Text(value: string) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertInstant(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) throw new Error("INVALID_LEGACY_IMPORT_COMMIT_TIMESTAMP");
}
