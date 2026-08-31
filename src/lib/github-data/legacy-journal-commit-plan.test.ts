import { describe, expect, it } from "vitest";

import {
  buildLegacyJournalCommitPlan,
  buildLegacyJournalRollbackPreview,
  createLegacyJournalImportCheckpoint,
  LEGACY_JOURNAL_IMPORT_COMMIT_ENABLED,
  MAX_LEGACY_JOURNAL_DATES_PER_COMMIT,
} from "./legacy-journal-commit-plan";
import type { LegacyDocxPreview } from "./legacy-docx-preview";
import {
  LEGACY_JOURNAL_MAPPING_VERSION,
  LEGACY_JOURNAL_PARSER_VERSION,
  parseLegacyJournalParagraphs,
  type LegacyImportCorrection,
  type LegacyWordParagraph,
} from "./legacy-journal-import";
import { createJournalEntryData } from "./journal-entries";
import { parseJournalSegmentsMarkdown } from "./journal-segment-codec";
import { createWorkspaceRecord } from "./protocol";

const sourceSha256 = "a".repeat(64);
const ownerId = "github_lubannn";
const headSha = "b".repeat(40);
const plannedAt = "2026-08-31T12:00:00.000Z";

function paragraph(index: number, text: string, sourceLocator = `word/document.xml#p${index}`): LegacyWordParagraph {
  return { sourceLocator, text };
}

function preview(paragraphs: LegacyWordParagraph[], corrections: LegacyImportCorrection[] = []): LegacyDocxPreview {
  const parse = parseLegacyJournalParagraphs(paragraphs, { timezone: "Asia/Shanghai", sourceSha256, corrections });
  return {
    source: { fileName: "sanitized.docx", byteSize: 1_024, lastModified: null, sha256: sourceSha256 },
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

function twoDayPreview() {
  return preview([
    paragraph(1, "2012-03-05"),
    paragraph(2, "08:30"),
    paragraph(3, "五日正文"),
    paragraph(4, "2012-03-06"),
    paragraph(5, "六日无时间正文"),
  ]);
}

function emptyExisting() {
  return { entries: [], revisions: [], segments: [] };
}

describe("Legacy Journal formal commit preflight contract", () => {
  it("keeps formal import writes disabled while producing deterministic segment-mode artifacts", async () => {
    expect(LEGACY_JOURNAL_IMPORT_COMMIT_ENABLED).toBe(false);
    const source = twoDayPreview();
    const first = await buildLegacyJournalCommitPlan({
      preview: source,
      ownerId,
      expectedHeadCommitSha: headSha,
      selectedDates: ["2012-03-06", "2012-03-05"],
      existing: emptyExisting(),
      plannedAt,
    });
    const second = await buildLegacyJournalCommitPlan({
      preview: source,
      ownerId,
      expectedHeadCommitSha: headSha,
      selectedDates: ["2012-03-05", "2012-03-06"],
      existing: emptyExisting(),
      plannedAt,
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      planVersion: 1,
      selectedDates: ["2012-03-05", "2012-03-06"],
      summary: { pending: 2, alreadyImported: 0, conflicts: 0, files: 6 },
      commitReady: true,
      commitEnabled: false,
    });
    expect(first.importBatchId).toMatch(/^legacy_import_[a-f0-9]{32}$/u);
    const artifacts = first.items[0]!.artifacts!;
    expect(artifacts.entry.data).toMatchObject({ journal_date: "2012-03-05", current_revision_id: artifacts.revision.id });
    expect(artifacts.revision.data).toMatchObject({ content_mode: "segments", created_by: "legacy_importer", change_reason: "legacy_import", revision_number: 1 });
    expect(artifacts.segments[0]!.data).toMatchObject({ local_time: "08:30", occurred_at: "2012-03-05T00:30:00.000Z", source_ref: { source_type: "legacy_word", import_batch_id: first.importBatchId } });
    expect(parseJournalSegmentsMarkdown(artifacts.entry.data.body_markdown).segments).toHaveLength(1);
    expect(first.files.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256))).toBe(true);
  });

  it("classifies an exact retry as already imported even when the new preflight timestamp differs", async () => {
    const source = twoDayPreview();
    const initial = await buildLegacyJournalCommitPlan({
      preview: source,
      ownerId,
      expectedHeadCommitSha: headSha,
      selectedDates: ["2012-03-05"],
      existing: emptyExisting(),
      plannedAt,
    });
    const artifacts = initial.items[0]!.artifacts!;
    const retry = await buildLegacyJournalCommitPlan({
      preview: source,
      ownerId,
      expectedHeadCommitSha: "c".repeat(40),
      selectedDates: ["2012-03-05"],
      existing: { entries: [artifacts.entry], revisions: [artifacts.revision], segments: artifacts.segments },
      plannedAt: "2026-08-31T12:10:00.000Z",
    });

    expect(retry.summary).toEqual({ pending: 0, alreadyImported: 1, conflicts: 0, files: 0 });
    expect(retry.items[0]!.status).toBe("already_imported");
    expect(retry.commitReady).toBe(false);
  });

  it("blocks an existing date, partial deterministic IDs, oversized batches and untraceable locator sets", async () => {
    const source = twoDayPreview();
    const existingDate = createWorkspaceRecord({
      entityType: "journal_entry",
      id: "existing_journal",
      ownerId,
      timestamp: plannedAt,
      data: createJournalEntryData({ journalDate: "2012-03-05", timezone: "Asia/Shanghai", bodyMarkdown: "既有正文", timestamp: plannedAt }),
    });
    const conflict = await buildLegacyJournalCommitPlan({
      preview: source,
      ownerId,
      expectedHeadCommitSha: headSha,
      selectedDates: ["2012-03-05"],
      existing: { entries: [existingDate], revisions: [], segments: [] },
      plannedAt,
    });
    expect(conflict.items[0]).toMatchObject({ status: "conflict", conflicts: ["LEGACY_IMPORT_JOURNAL_DATE_EXISTS"] });
    expect(conflict.commitReady).toBe(false);

    const tooManyParagraphs: LegacyWordParagraph[] = [];
    for (let day = 1; day <= MAX_LEGACY_JOURNAL_DATES_PER_COMMIT + 1; day += 1) {
      tooManyParagraphs.push(paragraph(day * 2 - 1, `2012-01-${String(day).padStart(2, "0")}`), paragraph(day * 2, `正文 ${day}`));
    }
    const tooMany = preview(tooManyParagraphs);
    await expect(buildLegacyJournalCommitPlan({
      preview: tooMany,
      ownerId,
      expectedHeadCommitSha: headSha,
      selectedDates: tooMany.parse.entries.map((entry) => entry.date),
      existing: emptyExisting(),
      plannedAt,
    })).rejects.toThrow("INVALID_LEGACY_IMPORT_DATE_SELECTION");

    const longLocator = preview([
      paragraph(1, "2012-03-05"),
      paragraph(2, "正文", `word/document.xml#${"x".repeat(501)}`),
    ]);
    const locatorConflict = await buildLegacyJournalCommitPlan({
      preview: longLocator,
      ownerId,
      expectedHeadCommitSha: headSha,
      selectedDates: ["2012-03-05"],
      existing: emptyExisting(),
      plannedAt,
    });
    expect(locatorConflict.items[0]).toMatchObject({ status: "conflict", conflicts: ["LEGACY_IMPORT_SOURCE_LOCATOR_TOO_LONG"], artifacts: null });
  });

  it("creates an exact checkpoint only from the complete planned write result", async () => {
    const plan = await buildLegacyJournalCommitPlan({
      preview: twoDayPreview(), ownerId, expectedHeadCommitSha: headSha, selectedDates: ["2012-03-05"], existing: emptyExisting(), plannedAt,
    });
    const writtenFiles = plan.files.map((file, index) => ({ path: file.path, blobSha: String(index + 1).repeat(40) }));
    const checkpoint = createLegacyJournalImportCheckpoint({ plan, commitSha: "d".repeat(40), committedAt: plannedAt, writtenFiles });

    expect(checkpoint).toMatchObject({ checkpointVersion: 1, importBatchId: plan.importBatchId, parentCommitSha: headSha, commitSha: "d".repeat(40) });
    expect(checkpoint.items[0]).toMatchObject({ date: "2012-03-05", entryId: plan.items[0]!.artifacts!.entry.id, revisionId: plan.items[0]!.artifacts!.revision.id });
    expect(() => createLegacyJournalImportCheckpoint({ plan, commitSha: "d".repeat(40), committedAt: plannedAt, writtenFiles: writtenFiles.slice(1) })).toThrow("LEGACY_IMPORT_CHECKPOINT_FILE_MISMATCH");
    expect(() => buildLegacyJournalRollbackPreview({
      checkpoint: { ...checkpoint, items: [{ ...checkpoint.items[0]!, entryBlobSha: "not-a-blob" }] },
      entries: [],
      revisions: [],
      segments: [],
    })).toThrow("INVALID_LEGACY_IMPORT_CHECKPOINT");
  });

  it("previews soft-delete-only rollback and blocks any post-import edit or history expansion", async () => {
    const plan = await buildLegacyJournalCommitPlan({
      preview: twoDayPreview(), ownerId, expectedHeadCommitSha: headSha, selectedDates: ["2012-03-05"], existing: emptyExisting(), plannedAt,
    });
    const artifacts = plan.items[0]!.artifacts!;
    const writtenFiles = plan.files.map((file, index) => ({ path: file.path, blobSha: String(index + 1).repeat(40) }));
    const checkpoint = createLegacyJournalImportCheckpoint({ plan, commitSha: "d".repeat(40), committedAt: plannedAt, writtenFiles });
    const entryBlobSha = checkpoint.items[0]!.entryBlobSha;
    const safe = buildLegacyJournalRollbackPreview({
      checkpoint,
      entries: [{ record: artifacts.entry, blobSha: entryBlobSha }],
      revisions: [artifacts.revision],
      segments: artifacts.segments,
    });

    expect(safe).toMatchObject({
      summary: { ready: 1, alreadyInactive: 0, blocked: 0 },
      rollbackReady: true,
      operation: "soft_delete_entries_only",
      immutableHistoryRetained: true,
      commitEnabled: false,
    });
    expect(safe.items[0]).toMatchObject({ expectedEntryBlobSha: entryBlobSha, retainedRevisionIds: [artifacts.revision.id], retainedSegmentIds: artifacts.segments.map((segment) => segment.id) });

    const editedEntry = { ...artifacts.entry, version: 2, updated_at: "2026-08-31T12:30:00.000Z", data: { ...artifacts.entry.data, title: "导入后人工编辑" } };
    const blocked = buildLegacyJournalRollbackPreview({
      checkpoint,
      entries: [{ record: editedEntry, blobSha: "e".repeat(40) }],
      revisions: [artifacts.revision],
      segments: artifacts.segments,
    });
    expect(blocked.items[0]).toMatchObject({ status: "blocked", blockers: ["LEGACY_ROLLBACK_ENTRY_EDITED"] });
    expect(blocked.rollbackReady).toBe(false);

    const laterRevision = { ...artifacts.revision, id: `${artifacts.entry.id}_r2`, data: { ...artifacts.revision.data, revision_number: 2 } };
    const expanded = buildLegacyJournalRollbackPreview({
      checkpoint,
      entries: [{ record: artifacts.entry, blobSha: entryBlobSha }],
      revisions: [artifacts.revision, laterRevision],
      segments: artifacts.segments,
    });
    expect(expanded.items[0]!.blockers).toContain("LEGACY_ROLLBACK_NEWER_REVISION_EXISTS");
  });
});
