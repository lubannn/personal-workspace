import { describe, expect, it, vi } from "vitest";

import { GitHubConflictError, type GitHubContentsAdapter, type GitHubStoredFile } from "./github-contents";
import { parseJournalImportCheckpointRecord } from "./journal-import-checkpoints";
import {
  LEGACY_JOURNAL_ATOMIC_WRITER_IMPLEMENTED,
  writeLegacyJournalBatchAtomically,
  type LegacyJournalAtomicWriterAdapter,
} from "./legacy-journal-atomic-writer";
import { buildLegacyJournalCommitPlan, LEGACY_JOURNAL_IMPORT_COMMIT_ENABLED } from "./legacy-journal-commit-plan";
import type { LegacyDocxPreview } from "./legacy-docx-preview";
import {
  LEGACY_JOURNAL_MAPPING_VERSION,
  LEGACY_JOURNAL_PARSER_VERSION,
  parseLegacyJournalParagraphs,
  type LegacyWordParagraph,
} from "./legacy-journal-import";
import { recordPath, serializeRecord } from "./protocol";

const ownerId = "github_lubannn";
const headSha = "a".repeat(40);
const treeSha = "b".repeat(40);
const timestamp = "2026-08-31T12:00:00.000Z";

function preview(): LegacyDocxPreview {
  const paragraphs: LegacyWordParagraph[] = [
    { sourceLocator: "word/document.xml#p1", text: "2012-03-05" },
    { sourceLocator: "word/document.xml#p2", text: "08:30" },
    { sourceLocator: "word/document.xml#p3", text: "正文" },
  ];
  const sourceSha256 = "c".repeat(64);
  const parse = parseLegacyJournalParagraphs(paragraphs, { timezone: "Asia/Shanghai", sourceSha256 });
  return {
    source: { fileName: "fixture.docx", byteSize: 1_024, lastModified: null, sha256: sourceSha256 },
    batchIdentity: `${sourceSha256}:${LEGACY_JOURNAL_PARSER_VERSION}:${LEGACY_JOURNAL_MAPPING_VERSION}`,
    parserVersion: LEGACY_JOURNAL_PARSER_VERSION,
    mappingVersion: LEGACY_JOURNAL_MAPPING_VERSION,
    archiveEntryCount: 2,
    archiveDiagnostics: [],
    parse,
    localOnly: true,
    sourceModified: false,
    commitEnabled: false,
  };
}

async function plan() {
  return buildLegacyJournalCommitPlan({
    preview: preview(),
    ownerId,
    expectedHeadCommitSha: headSha,
    selectedDates: ["2012-03-05"],
    existing: { entries: [], revisions: [], segments: [] },
    plannedAt: timestamp,
  });
}

function stored(path: string, text: string): GitHubStoredFile {
  return { path, text, blobSha: "d".repeat(40), sizeBytes: new TextEncoder().encode(text).byteLength };
}

function fakeAdapter(initialFiles: GitHubStoredFile[] = [], options: { head?: string; writeError?: Error } = {}) {
  const files = new Map(initialFiles.map((file) => [file.path, file]));
  const readBranchSnapshot = vi.fn(async () => ({ branch: "main", headCommitSha: options.head ?? headSha, rootTreeSha: treeSha }));
  const listDirectory = vi.fn(async (directory: string, ref?: string) => {
    expect(ref).toBe(options.head ?? headSha);
    return [...files.values()].filter((file) => file.path.startsWith(`${directory}/`)).map((file) => ({
      type: "file" as const,
      name: file.path.slice(directory.length + 1),
      path: file.path,
      blobSha: file.blobSha,
      sizeBytes: file.sizeBytes,
    }));
  });
  const readText = vi.fn(async (path: string, ref?: string) => {
    expect(ref).toBe(options.head ?? headSha);
    const file = files.get(path);
    if (!file) throw new Error(`MISSING_FIXTURE:${path}`);
    return file;
  });
  const writeAtomicFiles = vi.fn(async (input: Parameters<GitHubContentsAdapter["writeAtomicFiles"]>[0]) => {
    if (options.writeError) throw options.writeError;
    return {
      commitSha: "e".repeat(40),
      treeSha: "f".repeat(40),
      files: input.files.map((file, index) => ({ path: file.path, blobSha: index.toString(16).padStart(40, "0") })),
    };
  });
  return {
    adapter: { readBranchSnapshot, listDirectory, readText, writeAtomicFiles } as unknown as LegacyJournalAtomicWriterAdapter,
    readBranchSnapshot,
    listDirectory,
    readText,
    writeAtomicFiles,
  };
}

describe("Legacy Journal atomic batch writer", () => {
  it("implements one-commit writing while keeping the production import gate closed", async () => {
    expect(LEGACY_JOURNAL_ATOMIC_WRITER_IMPLEMENTED).toBe(true);
    expect(LEGACY_JOURNAL_IMPORT_COMMIT_ENABLED).toBe(false);
    const commitPlan = await plan();
    const fake = fakeAdapter();
    const result = await writeLegacyJournalBatchAtomically(fake.adapter, { plan: commitPlan, committedAt: timestamp });

    expect(fake.writeAtomicFiles).toHaveBeenCalledTimes(1);
    const write = fake.writeAtomicFiles.mock.calls[0]![0];
    expect(write).toMatchObject({ expectedHeadCommitSha: headSha, baseTreeSha: treeSha });
    expect(write.files).toHaveLength(commitPlan.files.length + 1);
    expect(write.files.slice(0, -1).map((file) => file.path)).toEqual(commitPlan.files.map((file) => file.path));
    const checkpointFile = write.files.at(-1)!;
    const checkpoint = parseJournalImportCheckpointRecord(checkpointFile.text);
    expect(checkpointFile.path).toBe(recordPath("journal_import_checkpoint", checkpoint.id));
    expect(checkpoint.data).toMatchObject({ expected_parent_commit_sha: headSha, committed_at: timestamp });
    expect(checkpoint.data).not.toHaveProperty("commit_sha");
    expect(result.commitSha).toBe("e".repeat(40));
    expect(result.checkpoint.commitSha).toBe("e".repeat(40));
    expect(result.checkpointFile.path).toBe(checkpointFile.path);
  });

  it("fails closed before writing on a stale branch, a partial remote state or a tampered plan", async () => {
    const commitPlan = await plan();
    const stale = fakeAdapter([], { head: "9".repeat(40) });
    await expect(writeLegacyJournalBatchAtomically(stale.adapter, { plan: commitPlan, committedAt: timestamp })).rejects.toBeInstanceOf(GitHubConflictError);
    expect(stale.listDirectory).not.toHaveBeenCalled();
    expect(stale.writeAtomicFiles).not.toHaveBeenCalled();

    const artifact = commitPlan.items[0]!.artifacts!;
    const partial = fakeAdapter([stored(recordPath("journal_entry", artifact.entry.id), serializeRecord(artifact.entry))]);
    await expect(writeLegacyJournalBatchAtomically(partial.adapter, { plan: commitPlan, committedAt: timestamp })).rejects.toThrow("LEGACY_IMPORT_REMOTE_ID_CONFLICT");
    expect(partial.writeAtomicFiles).not.toHaveBeenCalled();

    const tampered = { ...commitPlan, files: commitPlan.files.map((file, index) => index === 0 ? { ...file, text: `${file.text} ` } : file) };
    const badPlan = fakeAdapter();
    await expect(writeLegacyJournalBatchAtomically(badPlan.adapter, { plan: tampered, committedAt: timestamp })).rejects.toThrow("LEGACY_IMPORT_PLANNED_FILE_HASH_MISMATCH");
    expect(badPlan.writeAtomicFiles).not.toHaveBeenCalled();
  });

  it("does not fall back to a partial checkpoint write when the atomic commit fails", async () => {
    const commitPlan = await plan();
    const fake = fakeAdapter([], { writeError: new GitHubConflictError("branch advanced during ref update") });
    await expect(writeLegacyJournalBatchAtomically(fake.adapter, { plan: commitPlan, committedAt: timestamp })).rejects.toBeInstanceOf(GitHubConflictError);
    expect(fake.writeAtomicFiles).toHaveBeenCalledTimes(1);
    expect(fake.writeAtomicFiles.mock.calls[0]![0].files.at(-1)!.path).toContain("journal-import-checkpoints");
  });

  it("rejects a duplicate deterministic checkpoint identity before a second commit", async () => {
    const commitPlan = await plan();
    const first = fakeAdapter();
    const result = await writeLegacyJournalBatchAtomically(first.adapter, { plan: commitPlan, committedAt: timestamp });
    const duplicate = fakeAdapter([stored(result.checkpointFile.path, serializeRecord(result.checkpointRecord))]);
    await expect(writeLegacyJournalBatchAtomically(duplicate.adapter, { plan: commitPlan, committedAt: timestamp })).rejects.toThrow("LEGACY_IMPORT_CHECKPOINT_ALREADY_EXISTS");
    expect(duplicate.writeAtomicFiles).not.toHaveBeenCalled();
  });
});
