import { describe, expect, it, vi } from "vitest";

import { GitHubConflictError, type GitHubContentsAdapter, type GitHubStoredFile } from "./github-contents";
import { createJournalEntryData, parseJournalEntryRecord } from "./journal-entries";
import {
  createJournalEntryAtomically,
  JOURNAL_REVISION_WRITES_ENABLED,
  updateJournalEntryAtomically,
  type JournalRevisionTransactionAdapter,
} from "./journal-revision-transactions";
import { createJournalRevisionData, parseJournalRevisionRecord, sha256JournalRevisionBody } from "./journal-revisions";
import { createWorkspaceRecord, recordPath, serializeRecord } from "./protocol";

const timestamp = "2026-08-31T08:00:00.000Z";
const ownerId = "github_lubannn";
const entryId = "journal_entry_1";

function fakeAdapter(initialFiles: GitHubStoredFile[] = [], writeError?: Error) {
  const files = new Map(initialFiles.map((file) => [file.path, file]));
  const readBranchSnapshot = vi.fn(async () => ({ branch: "main", headCommitSha: "head-one", rootTreeSha: "tree-one" }));
  const listDirectory = vi.fn(async (path: string, ref?: string) => {
    void ref;
    return [...files.values()]
      .filter((file) => file.path.startsWith(`${path}/`) && !file.path.slice(path.length + 1).includes("/"))
      .map((file) => ({ type: "file" as const, name: file.path.slice(path.length + 1), path: file.path, blobSha: file.blobSha, sizeBytes: file.sizeBytes }));
  });
  const readText = vi.fn(async (path: string, ref?: string) => {
    void ref;
    const file = files.get(path);
    if (!file) throw new Error(`MISSING_FIXTURE:${path}`);
    return file;
  });
  const writeAtomicFiles = vi.fn(async (input: Parameters<GitHubContentsAdapter["writeAtomicFiles"]>[0]) => {
    if (writeError) throw writeError;
    return {
      commitSha: "commit-two",
      treeSha: "tree-two",
      files: input.files.map((file, index) => ({ path: file.path, blobSha: `new-blob-${index}` })),
    };
  });
  return {
    adapter: { readBranchSnapshot, listDirectory, readText, writeAtomicFiles } as unknown as JournalRevisionTransactionAdapter,
    readBranchSnapshot,
    listDirectory,
    readText,
    writeAtomicFiles,
  };
}

function storedRecord(path: string, text: string, blobSha: string): GitHubStoredFile {
  return { path, text, blobSha, sizeBytes: new TextEncoder().encode(text).byteLength };
}

function journalEntry(input: { body: string; currentRevisionId?: string | null }) {
  return createWorkspaceRecord({
    entityType: "journal_entry",
    id: entryId,
    ownerId,
    timestamp,
    data: createJournalEntryData({
      journalDate: "2026-08-31",
      timezone: "Asia/Shanghai",
      title: "旧标题",
      bodyMarkdown: input.body,
      timestamp,
      currentRevisionId: input.currentRevisionId ?? null,
    }),
  });
}

async function journalRevision(input: { id: string; body: string; revisionNumber: number }) {
  return createWorkspaceRecord({
    entityType: "journal_revision",
    id: input.id,
    ownerId,
    timestamp,
    data: createJournalRevisionData({
      journalEntryId: entryId,
      revisionNumber: input.revisionNumber,
      contentMode: "body",
      bodyMarkdown: input.body,
      contentSha256: await sha256JournalRevisionBody(input.body),
      createdAt: timestamp,
      createdBy: "owner",
      changeReason: input.revisionNumber === 1 ? "initial_create" : "manual_edit",
    }),
  });
}

describe("atomic Journal revision transactions", () => {
  it("keeps the production atomic write path explicitly enabled", () => {
    expect(JOURNAL_REVISION_WRITES_ENABLED).toBe(true);
  });

  it("creates JournalEntry and revision 1 in one commit from an exact branch snapshot", async () => {
    const fake = fakeAdapter();
    const result = await createJournalEntryAtomically(fake.adapter, {
      ownerId,
      journalEntryId: entryId,
      revisionId: "journal_revision_1",
      journalDate: "2026-08-31",
      timezone: "Asia/Shanghai",
      title: "新日记",
      bodyMarkdown: "第一版正文",
      timestamp,
    });

    expect(result.entry.data.current_revision_id).toBe("journal_revision_1");
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]?.data).toMatchObject({ revision_number: 1, created_by: "owner", change_reason: "initial_create" });
    expect(result.entryFile.blobSha).toBe("new-blob-1");
    expect(fake.writeAtomicFiles).toHaveBeenCalledTimes(1);
    const write = fake.writeAtomicFiles.mock.calls[0]![0];
    expect(write).toMatchObject({ expectedHeadCommitSha: "head-one", baseTreeSha: "tree-one" });
    expect(write.files.map((file) => file.path)).toEqual([
      "data/journal-revisions/journal_revision_1.json",
      "data/journal-entries/journal_entry_1.json",
    ]);
    expect(parseJournalEntryRecord(write.files[1]!.text).data.body_markdown).toBe("第一版正文");
    expect(parseJournalRevisionRecord(write.files[0]!.text).data.content_sha256).toBe(await sha256JournalRevisionBody("第一版正文"));
    expect(fake.listDirectory.mock.calls.every((call) => call[1] === "head-one")).toBe(true);
  });

  it("migrates a legacy null pointer and saves the edit without losing the prior body", async () => {
    const current = journalEntry({ body: "旧正文" });
    const fake = fakeAdapter([
      storedRecord(recordPath("journal_entry", entryId), serializeRecord(current), "entry-blob-one"),
    ]);
    const result = await updateJournalEntryAtomically(fake.adapter, {
      ownerId,
      journalEntryId: entryId,
      expectedJournalEntryBlobSha: "entry-blob-one",
      expectedCurrentRevisionId: null,
      baselineRevisionId: "journal_revision_baseline",
      revisionId: "journal_revision_edit",
      title: "新标题",
      bodyMarkdown: "新正文",
      timestamp: "2026-08-31T09:00:00.000Z",
    });

    expect(result.revisions.map((revision) => ({
      number: revision.data.revision_number,
      body: revision.data.body_markdown,
      creator: revision.data.created_by,
      reason: revision.data.change_reason,
    }))).toEqual([
      { number: 1, body: "旧正文", creator: "migration", reason: "schema_migration" },
      { number: 2, body: "新正文", creator: "owner", reason: "manual_edit" },
    ]);
    expect(result.entry.version).toBe(2);
    expect(result.entry.data.current_revision_id).toBe("journal_revision_edit");
    expect(fake.writeAtomicFiles.mock.calls[0]![0].files).toHaveLength(3);
    expect(fake.readText.mock.calls[0]?.[1]).toBe("head-one");
  });

  it("appends the next revision and keeps metadata-only edits on the current pointer", async () => {
    const revision = await journalRevision({ id: "journal_revision_1", body: "第一版", revisionNumber: 1 });
    const current = journalEntry({ body: "第一版", currentRevisionId: revision.id });
    const fixtures = [
      storedRecord(recordPath("journal_entry", entryId), serializeRecord(current), "entry-blob-one"),
      storedRecord(recordPath("journal_revision", revision.id), serializeRecord(revision), "revision-blob-one"),
    ];
    const changed = fakeAdapter(fixtures);
    const changedResult = await updateJournalEntryAtomically(changed.adapter, {
      ownerId,
      journalEntryId: entryId,
      expectedJournalEntryBlobSha: "entry-blob-one",
      expectedCurrentRevisionId: revision.id,
      revisionId: "journal_revision_2",
      bodyMarkdown: "第二版",
      timestamp: "2026-08-31T09:00:00.000Z",
    });
    expect(changedResult.revisions[0]?.data.revision_number).toBe(2);
    expect(changedResult.entry.data.current_revision_id).toBe("journal_revision_2");

    const metadataOnly = fakeAdapter(fixtures);
    const metadataResult = await updateJournalEntryAtomically(metadataOnly.adapter, {
      ownerId,
      journalEntryId: entryId,
      expectedJournalEntryBlobSha: "entry-blob-one",
      expectedCurrentRevisionId: revision.id,
      revisionId: "unused_revision_id",
      title: "只改标题",
      bodyMarkdown: "第一版",
      timestamp: "2026-08-31T09:00:00.000Z",
    });
    expect(metadataResult.revisions).toEqual([]);
    expect(metadataResult.entry.data.current_revision_id).toBe(revision.id);
    expect(metadataOnly.writeAtomicFiles.mock.calls[0]![0].files.map((file) => file.path)).toEqual([recordPath("journal_entry", entryId)]);
  });

  it("rejects stale blobs, stale pointers and a concurrent branch advance before visibility changes", async () => {
    const revision = await journalRevision({ id: "journal_revision_1", body: "第一版", revisionNumber: 1 });
    const current = journalEntry({ body: "第一版", currentRevisionId: revision.id });
    const fixtures = [
      storedRecord(recordPath("journal_entry", entryId), serializeRecord(current), "entry-blob-one"),
      storedRecord(recordPath("journal_revision", revision.id), serializeRecord(revision), "revision-blob-one"),
    ];
    const staleBlob = fakeAdapter(fixtures);
    await expect(updateJournalEntryAtomically(staleBlob.adapter, {
      ownerId, journalEntryId: entryId, expectedJournalEntryBlobSha: "stale", expectedCurrentRevisionId: revision.id, revisionId: "journal_revision_2", bodyMarkdown: "第二版", timestamp,
    })).rejects.toBeInstanceOf(GitHubConflictError);
    expect(staleBlob.writeAtomicFiles).not.toHaveBeenCalled();

    const stalePointer = fakeAdapter(fixtures);
    await expect(updateJournalEntryAtomically(stalePointer.adapter, {
      ownerId, journalEntryId: entryId, expectedJournalEntryBlobSha: "entry-blob-one", expectedCurrentRevisionId: null, revisionId: "journal_revision_2", bodyMarkdown: "第二版", timestamp,
    })).rejects.toBeInstanceOf(GitHubConflictError);
    expect(stalePointer.writeAtomicFiles).not.toHaveBeenCalled();

    const branchAdvance = fakeAdapter(fixtures, new GitHubConflictError("branch advanced"));
    await expect(updateJournalEntryAtomically(branchAdvance.adapter, {
      ownerId, journalEntryId: entryId, expectedJournalEntryBlobSha: "entry-blob-one", expectedCurrentRevisionId: revision.id, revisionId: "journal_revision_2", bodyMarkdown: "第二版", timestamp,
    })).rejects.toBeInstanceOf(GitHubConflictError);
    expect(branchAdvance.writeAtomicFiles).toHaveBeenCalledTimes(1);
  });

  it("rejects tampered hashes, non-latest pointers and duplicate daily creation", async () => {
    const validRevision = await journalRevision({ id: "journal_revision_1", body: "第一版", revisionNumber: 1 });
    const current = journalEntry({ body: "第一版", currentRevisionId: validRevision.id });
    const tampered = { ...validRevision, data: { ...validRevision.data, content_sha256: "f".repeat(64) } };
    const badHash = fakeAdapter([
      storedRecord(recordPath("journal_entry", entryId), serializeRecord(current), "entry-blob-one"),
      storedRecord(recordPath("journal_revision", tampered.id), serializeRecord(tampered), "revision-blob-one"),
    ]);
    await expect(updateJournalEntryAtomically(badHash.adapter, {
      ownerId, journalEntryId: entryId, expectedJournalEntryBlobSha: "entry-blob-one", expectedCurrentRevisionId: validRevision.id, revisionId: "journal_revision_2", bodyMarkdown: "第二版", timestamp,
    })).rejects.toThrow("JOURNAL_REVISION_HASH_MISMATCH");
    expect(badHash.writeAtomicFiles).not.toHaveBeenCalled();

    const laterRevision = await journalRevision({ id: "journal_revision_2", body: "第二版", revisionNumber: 2 });
    const notLatest = fakeAdapter([
      storedRecord(recordPath("journal_entry", entryId), serializeRecord(current), "entry-blob-one"),
      storedRecord(recordPath("journal_revision", validRevision.id), serializeRecord(validRevision), "revision-blob-one"),
      storedRecord(recordPath("journal_revision", laterRevision.id), serializeRecord(laterRevision), "revision-blob-two"),
    ]);
    await expect(updateJournalEntryAtomically(notLatest.adapter, {
      ownerId, journalEntryId: entryId, expectedJournalEntryBlobSha: "entry-blob-one", expectedCurrentRevisionId: validRevision.id, revisionId: "journal_revision_3", bodyMarkdown: "第三版", timestamp,
    })).rejects.toThrow("JOURNAL_ENTRY_CURRENT_REVISION_NOT_LATEST");

    const duplicate = fakeAdapter([
      storedRecord(recordPath("journal_entry", entryId), serializeRecord(current), "entry-blob-one"),
    ]);
    await expect(createJournalEntryAtomically(duplicate.adapter, {
      ownerId, journalEntryId: "journal_entry_2", revisionId: "journal_revision_new", journalDate: "2026-08-31", timezone: "Asia/Shanghai", bodyMarkdown: "重复", timestamp,
    })).rejects.toThrow("DUPLICATE_ACTIVE_DAILY_JOURNAL");
    expect(duplicate.writeAtomicFiles).not.toHaveBeenCalled();
  });
});
