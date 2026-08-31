import {
  GitHubConflictError,
  GitHubDataError,
  type GitHubContentsAdapter,
  type GitHubDirectoryItem,
} from "./github-contents";
import {
  createJournalEntryData,
  hasActiveDailyJournalDate,
  parseJournalEntryRecord,
  updateJournalEntryData,
  type JournalEntryRecord,
} from "./journal-entries";
import {
  createJournalRevisionData,
  parseJournalRevisionRecord,
  sha256JournalRevisionBody,
  type JournalRevisionRecord,
} from "./journal-revisions";
import { createWorkspaceRecord, recordPath, serializeRecord, updateWorkspaceRecord } from "./protocol";

export const JOURNAL_REVISION_WRITES_ENABLED = true as const;

export type JournalRevisionTransactionAdapter = Pick<
  GitHubContentsAdapter,
  "listDirectory" | "readBranchSnapshot" | "readText" | "writeAtomicFiles"
>;

export type AtomicJournalWriteResult = {
  entry: JournalEntryRecord;
  entryFile: { path: string; blobSha: string };
  revisions: JournalRevisionRecord[];
  revisionFiles: Array<{ path: string; blobSha: string }>;
  commitSha: string;
  treeSha: string;
};

export async function createJournalEntryAtomically(
  adapter: JournalRevisionTransactionAdapter,
  input: {
    ownerId: string;
    journalEntryId: string;
    revisionId: string;
    journalDate: string;
    timezone: string;
    title?: string;
    bodyMarkdown: string;
    mood?: string;
    weather?: string;
    timestamp?: string;
  },
): Promise<AtomicJournalWriteResult> {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const snapshot = await adapter.readBranchSnapshot();
  const entryFiles = await listJsonFiles(adapter, "data/journal-entries", snapshot.headCommitSha);
  const entries = await loadJournalEntries(adapter, entryFiles, snapshot.headCommitSha);
  if (entries.some((entry) => entry.owner_id !== input.ownerId)) throw new Error("JOURNAL_OWNER_MISMATCH");
  if (entries.some((entry) => entry.id === input.journalEntryId)) throw new Error("JOURNAL_ENTRY_ID_CONFLICT");
  if (hasActiveDailyJournalDate(entries, input.journalDate)) throw new Error("DUPLICATE_ACTIVE_DAILY_JOURNAL");

  const revisionItems = await listJsonFiles(adapter, "data/journal-revisions", snapshot.headCommitSha);
  const revisions = await loadJournalRevisions(adapter, revisionItems, snapshot.headCommitSha);
  const revisionPath = recordPath("journal_revision", input.revisionId);
  if (revisionItems.some((item) => item.path === revisionPath) || revisions.some((revision) => revision.id === input.revisionId)) throw new Error("JOURNAL_REVISION_ID_CONFLICT");

  const entry = createWorkspaceRecord({
    entityType: "journal_entry",
    id: input.journalEntryId,
    ownerId: input.ownerId,
    timestamp,
    data: createJournalEntryData({
      journalDate: input.journalDate,
      timezone: input.timezone,
      title: input.title,
      bodyMarkdown: input.bodyMarkdown,
      mood: input.mood,
      weather: input.weather,
      timestamp,
      currentRevisionId: input.revisionId,
    }),
  });
  const revision = createWorkspaceRecord({
    entityType: "journal_revision",
    id: input.revisionId,
    ownerId: input.ownerId,
    timestamp,
    data: createJournalRevisionData({
      journalEntryId: input.journalEntryId,
      revisionNumber: 1,
      contentMode: "body",
      bodyMarkdown: entry.data.body_markdown,
      contentSha256: await sha256JournalRevisionBody(entry.data.body_markdown),
      createdAt: timestamp,
      createdBy: "owner",
      changeReason: "initial_create",
    }),
  });
  return commitJournalRecords(adapter, snapshot, entry, [revision], `journal: create ${input.journalEntryId}`);
}

export async function updateJournalEntryAtomically(
  adapter: JournalRevisionTransactionAdapter,
  input: {
    ownerId: string;
    journalEntryId: string;
    expectedJournalEntryBlobSha: string;
    expectedCurrentRevisionId: string | null;
    revisionId: string;
    baselineRevisionId?: string;
    title?: string;
    bodyMarkdown: string;
    mood?: string;
    weather?: string;
    timestamp?: string;
  },
): Promise<AtomicJournalWriteResult> {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const snapshot = await adapter.readBranchSnapshot();
  const entryPath = recordPath("journal_entry", input.journalEntryId);
  const storedEntry = await adapter.readText(entryPath, snapshot.headCommitSha);
  if (storedEntry.path !== entryPath) throw new Error("JOURNAL_ENTRY_PATH_MISMATCH");
  if (storedEntry.blobSha !== input.expectedJournalEntryBlobSha) throw new GitHubConflictError("The JournalEntry blob changed before the revision transaction.");
  const current = parseJournalEntryRecord(storedEntry.text);
  if (current.id !== input.journalEntryId || current.owner_id !== input.ownerId) throw new Error("JOURNAL_ENTRY_IDENTITY_MISMATCH");
  if (current.deleted_at !== null) throw new Error("JOURNAL_ENTRY_NOT_ACTIVE");
  if (current.data.current_revision_id !== input.expectedCurrentRevisionId) throw new GitHubConflictError("The current JournalRevision pointer changed before the transaction.");

  const revisionItems = await listJsonFiles(adapter, "data/journal-revisions", snapshot.headCommitSha);
  const revisions = await loadJournalRevisions(adapter, revisionItems, snapshot.headCommitSha);
  await validateRevisionHistory(current, revisions);

  const newRevisionPath = recordPath("journal_revision", input.revisionId);
  if (revisionItems.some((item) => item.path === newRevisionPath)) throw new Error("JOURNAL_REVISION_ID_CONFLICT");
  const normalizedBody = input.bodyMarkdown.trim();
  const bodyChanged = normalizedBody !== current.data.body_markdown;
  const createdRevisions: JournalRevisionRecord[] = [];
  let nextRevisionId = current.data.current_revision_id;

  if (bodyChanged) {
    const scoped = revisions.filter((revision) => revision.data.journal_entry_id === current.id);
    let nextRevisionNumber = scoped.length === 0 ? 1 : Math.max(...scoped.map((revision) => revision.data.revision_number)) + 1;
    if (current.data.current_revision_id === null) {
      if (!input.baselineRevisionId) throw new Error("JOURNAL_BASELINE_REVISION_ID_REQUIRED");
      if (input.baselineRevisionId === input.revisionId) throw new Error("JOURNAL_REVISION_ID_CONFLICT");
      const baselinePath = recordPath("journal_revision", input.baselineRevisionId);
      if (revisionItems.some((item) => item.path === baselinePath)) throw new Error("JOURNAL_REVISION_ID_CONFLICT");
      createdRevisions.push(await createBodyRevision({
        id: input.baselineRevisionId,
        ownerId: input.ownerId,
        journalEntryId: current.id,
        revisionNumber: 1,
        bodyMarkdown: current.data.body_markdown,
        timestamp,
        createdBy: "migration",
        changeReason: "schema_migration",
      }));
      nextRevisionNumber = 2;
    }
    createdRevisions.push(await createBodyRevision({
      id: input.revisionId,
      ownerId: input.ownerId,
      journalEntryId: current.id,
      revisionNumber: nextRevisionNumber,
      bodyMarkdown: normalizedBody,
      timestamp,
      createdBy: "owner",
      changeReason: "manual_edit",
    }));
    nextRevisionId = input.revisionId;
  }

  const entry = updateWorkspaceRecord(current, updateJournalEntryData(current, {
    title: input.title,
    bodyMarkdown: normalizedBody,
    mood: input.mood,
    weather: input.weather,
    timestamp,
    currentRevisionId: nextRevisionId,
  }), timestamp);
  return commitJournalRecords(adapter, snapshot, entry, createdRevisions, `journal: update ${input.journalEntryId}`);
}

async function validateRevisionHistory(entry: JournalEntryRecord, revisions: JournalRevisionRecord[]) {
  const scoped = revisions.filter((revision) => revision.data.journal_entry_id === entry.id);
  if (scoped.some((revision) => revision.owner_id !== entry.owner_id)) throw new Error("JOURNAL_REVISION_OWNER_MISMATCH");
  if (new Set(scoped.map((revision) => revision.data.revision_number)).size !== scoped.length) throw new Error("DUPLICATE_JOURNAL_REVISION_NUMBER");
  for (const revision of scoped) {
    if (await sha256JournalRevisionBody(revision.data.body_markdown) !== revision.data.content_sha256) throw new Error("JOURNAL_REVISION_HASH_MISMATCH");
  }
  if (entry.data.current_revision_id === null) {
    if (scoped.length > 0) throw new Error("JOURNAL_ENTRY_CURRENT_REVISION_MISSING");
    return;
  }
  const current = scoped.find((revision) => revision.id === entry.data.current_revision_id);
  if (!current) throw new Error("JOURNAL_ENTRY_CURRENT_REVISION_NOT_FOUND");
  if (current.data.body_markdown !== entry.data.body_markdown) throw new Error("JOURNAL_ENTRY_MATERIALIZATION_MISMATCH");
  if (current.data.revision_number !== Math.max(...scoped.map((revision) => revision.data.revision_number))) throw new Error("JOURNAL_ENTRY_CURRENT_REVISION_NOT_LATEST");
}

async function createBodyRevision(input: {
  id: string;
  ownerId: string;
  journalEntryId: string;
  revisionNumber: number;
  bodyMarkdown: string;
  timestamp: string;
  createdBy: "owner" | "migration";
  changeReason: "manual_edit" | "schema_migration";
}) {
  return createWorkspaceRecord({
    entityType: "journal_revision",
    id: input.id,
    ownerId: input.ownerId,
    timestamp: input.timestamp,
    data: createJournalRevisionData({
      journalEntryId: input.journalEntryId,
      revisionNumber: input.revisionNumber,
      contentMode: "body",
      bodyMarkdown: input.bodyMarkdown,
      contentSha256: await sha256JournalRevisionBody(input.bodyMarkdown),
      createdAt: input.timestamp,
      createdBy: input.createdBy,
      changeReason: input.changeReason,
    }),
  });
}

async function commitJournalRecords(
  adapter: JournalRevisionTransactionAdapter,
  snapshot: Awaited<ReturnType<JournalRevisionTransactionAdapter["readBranchSnapshot"]>>,
  entry: JournalEntryRecord,
  revisions: JournalRevisionRecord[],
  message: string,
): Promise<AtomicJournalWriteResult> {
  const entryPath = recordPath("journal_entry", entry.id);
  const files = [
    ...revisions.map((revision) => ({ path: recordPath("journal_revision", revision.id), text: serializeRecord(revision) })),
    { path: entryPath, text: serializeRecord(entry) },
  ];
  const result = await adapter.writeAtomicFiles({
    files,
    message,
    expectedHeadCommitSha: snapshot.headCommitSha,
    baseTreeSha: snapshot.rootTreeSha,
  });
  return {
    entry,
    entryFile: { path: entryPath, blobSha: blobShaFor(result.files, entryPath) },
    revisions,
    revisionFiles: revisions.map((revision) => {
      const path = recordPath("journal_revision", revision.id);
      return { path, blobSha: blobShaFor(result.files, path) };
    }),
    commitSha: result.commitSha,
    treeSha: result.treeSha,
  };
}

async function listJsonFiles(adapter: JournalRevisionTransactionAdapter, path: string, ref: string): Promise<GitHubDirectoryItem[]> {
  try {
    return (await adapter.listDirectory(path, ref)).filter((item) => item.type === "file" && item.name.endsWith(".json"));
  } catch (error) {
    if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return [];
    throw error;
  }
}

async function loadJournalEntries(adapter: JournalRevisionTransactionAdapter, items: GitHubDirectoryItem[], ref: string) {
  const records = await Promise.all(items.map(async (item) => {
    const record = parseJournalEntryRecord((await adapter.readText(item.path, ref)).text);
    if (recordPath("journal_entry", record.id) !== item.path) throw new Error("JOURNAL_ENTRY_PATH_MISMATCH");
    return record;
  }));
  if (new Set(records.map((record) => record.id)).size !== records.length) throw new Error("DUPLICATE_JOURNAL_ENTRY_ID");
  return records;
}

async function loadJournalRevisions(adapter: JournalRevisionTransactionAdapter, items: GitHubDirectoryItem[], ref: string) {
  const records = await Promise.all(items.map(async (item) => {
    const record = parseJournalRevisionRecord((await adapter.readText(item.path, ref)).text);
    if (recordPath("journal_revision", record.id) !== item.path) throw new Error("JOURNAL_REVISION_PATH_MISMATCH");
    return record;
  }));
  if (new Set(records.map((record) => record.id)).size !== records.length) throw new Error("DUPLICATE_JOURNAL_REVISION_ID");
  return records;
}

function blobShaFor(files: Array<{ path: string; blobSha: string }>, path: string) {
  const file = files.find((item) => item.path === path);
  if (!file) throw new Error("GITHUB_ATOMIC_WRITE_FILE_MISSING");
  return file.blobSha;
}
