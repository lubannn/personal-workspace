import { describe, expect, it } from "vitest";

import { prepareLegacyJournalAtomicPayload } from "./legacy-journal-atomic-writer";
import type { GitHubContentsAdapter } from "./github-contents";
import { buildLegacyJournalCheckpointRollbackPreview, newestLegacyJournalCheckpoints, readLegacyJournalCheckpointRollbackPreview } from "./legacy-journal-checkpoint-history";
import { buildLegacyJournalCommitPlan } from "./legacy-journal-commit-plan";
import type { LegacyDocxPreview } from "./legacy-docx-preview";
import { LEGACY_JOURNAL_MAPPING_VERSION, LEGACY_JOURNAL_PARSER_VERSION, parseLegacyJournalParagraphs } from "./legacy-journal-import";
import { recordPath, serializeRecord, setWorkspaceRecordDeleted } from "./protocol";

const ownerId = "github_lubannn";
const headSha = "a".repeat(40);
const timestamp = "2026-08-31T12:00:00.000Z";

function preview(): LegacyDocxPreview {
  const sourceSha256 = "c".repeat(64);
  const parse = parseLegacyJournalParagraphs([
    { sourceLocator: "word/document.xml#p1", text: "2012-03-05" },
    { sourceLocator: "word/document.xml#p2", text: "08:30" },
    { sourceLocator: "word/document.xml#p3", text: "脱敏正文" },
  ], { timezone: "Asia/Shanghai", sourceSha256 });
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

async function fixture() {
  const plan = await buildLegacyJournalCommitPlan({
    preview: preview(), ownerId, expectedHeadCommitSha: headSha, selectedDates: ["2012-03-05"], existing: { entries: [], revisions: [], segments: [] }, plannedAt: timestamp,
  });
  const payload = await prepareLegacyJournalAtomicPayload(plan);
  return { artifacts: plan.items[0]!.artifacts!, checkpoint: payload.checkpointRecord! };
}

describe("Legacy Journal checkpoint history and read-only rollback preview", () => {
  it("sorts checkpoint history newest-first without mutating input", async () => {
    const { checkpoint } = await fixture();
    const later = { ...checkpoint, id: `journal_import_checkpoint_${"f".repeat(32)}`, created_at: "2026-09-01T12:00:00.000Z", updated_at: "2026-09-01T12:00:00.000Z", data: { ...checkpoint.data, committed_at: "2026-09-01T12:00:00.000Z", plan_sha256: "f".repeat(64) } };
    const source = [checkpoint, later];
    expect(newestLegacyJournalCheckpoints(source).map((item) => item.id)).toEqual([later.id, checkpoint.id]);
    expect(source[0]).toBe(checkpoint);
  });

  it("allows only an exact untouched import and keeps immutable history out of the operation", async () => {
    const { artifacts, checkpoint } = await fixture();
    const result = await buildLegacyJournalCheckpointRollbackPreview({
      checkpoint,
      entries: [{ record: artifacts.entry, blobSha: "1".repeat(40) }],
      revisions: [{ record: artifacts.revision }],
      segments: artifacts.segments.map((record) => ({ record })),
    });
    expect(result).toMatchObject({ summary: { ready: 1, alreadyInactive: 0, blocked: 0 }, rollbackReady: true, operation: "soft_delete_entries_only", immutableHistoryRetained: true, commitEnabled: false });
    expect(result.items[0]).toMatchObject({ status: "ready", retainedRevisionIds: [artifacts.revision.id], retainedSegmentIds: artifacts.segments.map((item) => item.id) });
  });

  it("recognizes one soft deletion and blocks edits or immutable file drift", async () => {
    const { artifacts, checkpoint } = await fixture();
    const inactive = setWorkspaceRecordDeleted(artifacts.entry, timestamp, timestamp);
    const alreadyInactive = await buildLegacyJournalCheckpointRollbackPreview({
      checkpoint,
      entries: [{ record: inactive, blobSha: "4".repeat(40) }],
      revisions: [{ record: artifacts.revision }],
      segments: artifacts.segments.map((record) => ({ record })),
    });
    expect(alreadyInactive.items[0]?.status).toBe("already_inactive");
    expect(alreadyInactive.rollbackReady).toBe(false);

    const editedEntry = { ...artifacts.entry, version: 2, updated_at: "2026-09-01T12:00:00.000Z", data: { ...artifacts.entry.data, title: "edited" } };
    const changedSegment = { ...artifacts.segments[0]!, data: { ...artifacts.segments[0]!.data, body_markdown: "changed" } };
    const blocked = await buildLegacyJournalCheckpointRollbackPreview({
      checkpoint,
      entries: [{ record: editedEntry, blobSha: "7".repeat(40) }],
      revisions: [{ record: artifacts.revision }],
      segments: [{ record: changedSegment }],
    });
    expect(blocked.items[0]?.status).toBe("blocked");
    expect(blocked.items[0]?.blockers).toEqual(expect.arrayContaining(["LEGACY_ROLLBACK_ENTRY_EDITED", "LEGACY_ROLLBACK_PLANNED_FILE_CHANGED"]));
    expect(blocked.rollbackReady).toBe(false);
  });

  it("reads one remote HEAD and fails closed when the branch moves during preview", async () => {
    const { artifacts, checkpoint } = await fixture();
    const checkpointPath = recordPath("journal_import_checkpoint", checkpoint.id);
    const files = new Map([
      [recordPath("journal_entry", artifacts.entry.id), serializeRecord(artifacts.entry)],
      [recordPath("journal_revision", artifacts.revision.id), serializeRecord(artifacts.revision)],
      ...artifacts.segments.map((record) => [recordPath("journal_segment", record.id), serializeRecord(record)] as const),
      [checkpointPath, serializeRecord(checkpoint)],
    ]);
    let reads = 0;
    const adapter = {
      readBranchSnapshot: async () => ({ branch: "main", headCommitSha: reads++ === 0 ? headSha : "f".repeat(40), rootTreeSha: "b".repeat(40) }),
      listDirectory: async (directory: string) => [...files.keys()].filter((path) => path.startsWith(`${directory}/`)).map((path) => ({ type: "file" as const, name: path.slice(directory.length + 1), path, blobSha: "d".repeat(40), sizeBytes: files.get(path)!.length })),
      readText: async (path: string) => ({ path, text: files.get(path)!, blobSha: "d".repeat(40), sizeBytes: files.get(path)!.length }),
    } as unknown as GitHubContentsAdapter;
    await expect(readLegacyJournalCheckpointRollbackPreview(adapter, checkpointPath)).rejects.toThrow("LEGACY_ROLLBACK_PREVIEW_HEAD_CHANGED");
  });
});
