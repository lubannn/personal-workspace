import type { GitHubContentsAdapter } from "./github-contents";
import { canWriteJournalDate, createJournalEntryData, parseJournalEntryRecord, updateJournalEntryData, type JournalEntryRecord } from "./journal-entries";
import { createWorkspaceRecord, recordPath, serializeRecord, updateWorkspaceRecord } from "./protocol";

type Writer = Pick<GitHubContentsAdapter, "writeText">;

// The caller uses the adapter from the already verified private-repository login.
// GitHub creates the commit itself; there are no archive reads or separate revisions.
export async function createJournalEntrySingleFile(adapter: Writer, input: {
  ownerId: string; id: string; journalDate: string; todayDate: string;
  timezone: string; bodyMarkdown: string; timestamp: string;
}) {
  if (!canWriteJournalDate(input.journalDate, input.todayDate)) throw new Error("JOURNAL_DATE_NOT_WRITABLE");
  const entry = createWorkspaceRecord({
    entityType: "journal_entry", id: input.id, ownerId: input.ownerId, timestamp: input.timestamp,
    data: createJournalEntryData({ journalDate: input.journalDate, timezone: input.timezone, bodyMarkdown: input.bodyMarkdown, timestamp: input.timestamp }),
  });
  const file = await adapter.writeText({ path: recordPath("journal_entry", entry.id), text: serializeRecord(entry), message: `journal: create ${entry.id}` });
  return { entry, file };
}

export async function updateJournalEntrySingleFile(adapter: Writer, input: {
  ownerId: string; current: JournalEntryRecord; path: string; expectedBlobSha: string;
  todayDate: string; bodyMarkdown: string; timestamp: string;
}) {
  const current = parseJournalEntryRecord(serializeRecord(input.current));
  if (current.owner_id !== input.ownerId) throw new Error("JOURNAL_OWNER_MISMATCH");
  if (input.path !== recordPath("journal_entry", current.id)) throw new Error("JOURNAL_ENTRY_PATH_MISMATCH");
  if (!input.expectedBlobSha) throw new Error("JOURNAL_EXPECTED_BLOB_REQUIRED");
  if (current.deleted_at !== null) throw new Error("JOURNAL_ENTRY_NOT_ACTIVE");
  if (!canWriteJournalDate(current.data.journal_date, input.todayDate)) throw new Error("JOURNAL_DATE_NOT_WRITABLE");
  // Existing immutable revisions remain untouched in Git. The updated body no
  // longer points to a separate revision whose materialized content is now stale.
  const entry = updateWorkspaceRecord(current, updateJournalEntryData(current, {
    bodyMarkdown: input.bodyMarkdown, timestamp: input.timestamp, currentRevisionId: null,
  }), input.timestamp);
  // GitHub rejects a stale SHA instead of overwriting another device's changes.
  const file = await adapter.writeText({ path: input.path, text: serializeRecord(entry), message: `journal: update ${entry.id}`, expectedBlobSha: input.expectedBlobSha });
  return { entry, file };
}
