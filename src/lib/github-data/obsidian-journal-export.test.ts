import { describe, expect, it } from "vitest";

import { createJournalEntryData } from "./journal-entries";
import { createJournalRevisionData, sha256JournalRevisionBody } from "./journal-revisions";
import { baselineFromObsidianJournalExportPlan, buildObsidianJournalExportPlan } from "./obsidian-journal-export";
import { createWorkspaceRecord, setWorkspaceRecordDeleted, updateWorkspaceRecord } from "./protocol";

const timestamp = "2026-09-12T03:00:00.000Z";

async function source(input: { version?: number; revisionNumber?: number; body?: string; title?: string } = {}) {
  const body = input.body ?? "## 今日\n\n完成了单向导出计划。";
  const revisionNumber = input.revisionNumber ?? 1;
  const revisionId = `revision_${revisionNumber}`;
  let entry = createWorkspaceRecord({
    entityType: "journal_entry",
    id: "journal_20260912",
    ownerId: "owner_1",
    timestamp,
    data: createJournalEntryData({
      journalDate: "2026-09-12",
      timezone: "Asia/Shanghai",
      title: input.title ?? "*周六* [复盘]",
      bodyMarkdown: body,
      mood: "平静",
      weather: "晴",
      currentRevisionId: revisionId,
      timestamp,
    }),
  });
  while (entry.version < (input.version ?? 1)) entry = updateWorkspaceRecord(entry, entry.data, timestamp);
  const revision = createWorkspaceRecord({
    entityType: "journal_revision",
    id: revisionId,
    ownerId: "owner_1",
    timestamp,
    data: createJournalRevisionData({
      journalEntryId: entry.id,
      revisionNumber,
      contentMode: "body",
      bodyMarkdown: body,
      contentSha256: await sha256JournalRevisionBody(body),
      createdAt: timestamp,
      createdBy: "owner",
      changeReason: revisionNumber === 1 ? "initial_create" : "manual_edit",
    }),
  });
  return { entry, revision };
}

async function plan(overrides: Partial<Parameters<typeof buildObsidianJournalExportPlan>[0]> = {}) {
  const records = await source();
  return buildObsidianJournalExportPlan({
    vaultName: "Personal-Vault",
    subdirectory: "Personal Workspace",
    entry: records.entry,
    revision: records.revision,
    currentMarkdown: null,
    ...overrides,
  });
}

describe("Obsidian Journal one-way export plan", () => {
  it("builds deterministic UTF-8/LF Markdown with traceable frontmatter", async () => {
    const first = await plan();
    const second = await plan();
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      relativePath: "Personal Workspace/Journal/2026/2026-09-12-journal_20260912.md",
      confirmation: "Personal-Vault/Personal Workspace/Journal/2026/2026-09-12-journal_20260912.md",
      disposition: "create",
      currentDocumentSha256: null,
    });
    expect(first.markdown).toContain('journal_id: "journal_20260912"');
    expect(first.markdown).toContain('revision_id: "revision_1"');
    expect(first.markdown).toContain("# \\*周六\\* \\[复盘\\]");
    expect(first.markdown).toContain("## 今日\n\n完成了单向导出计划。\n");
    expect(first.markdown).not.toContain("\r");
    expect(first.utf8Bytes).toBe(new TextEncoder().encode(first.markdown).byteLength);
  });

  it("recognizes an exact existing document as unchanged without requiring a baseline", async () => {
    const initial = await plan();
    const repeated = await plan({ currentMarkdown: initial.markdown });
    expect(repeated.disposition).toBe("unchanged");
    expect(repeated.currentDocumentSha256).toBe(initial.documentSha256);
  });

  it("allows replacement only when the existing document matches the prior baseline", async () => {
    const initial = await plan();
    const next = await source({ version: 2, revisionNumber: 2, body: "修订后的正文。" });
    const updated = await plan({
      entry: next.entry,
      revision: next.revision,
      currentMarkdown: initial.markdown,
      baseline: baselineFromObsidianJournalExportPlan(initial),
    });
    expect(updated.disposition).toBe("update");
    expect(updated.documentSha256).not.toBe(initial.documentSha256);
    expect(updated.source).toMatchObject({ recordVersion: 2, revisionId: "revision_2", revisionNumber: 2 });
  });

  it("preserves the legacy date-only path for an already exported entry", async () => {
    const initial = await plan();
    const legacyBaseline = { ...baselineFromObsidianJournalExportPlan(initial), relativePath: "Personal Workspace/Journal/2026/2026-09-12.md" };
    const next = await plan({ baseline: legacyBaseline, currentMarkdown: initial.markdown });
    expect(next.relativePath).toBe(legacyBaseline.relativePath);
  });

  it("fails closed for external edits, untracked files and externally removed managed files", async () => {
    const initial = await plan();
    const baseline = baselineFromObsidianJournalExportPlan(initial);
    await expect(plan({ currentMarkdown: `${initial.markdown}external edit\n`, baseline })).resolves.toMatchObject({ disposition: "conflict" });
    await expect(plan({ currentMarkdown: "unmanaged note\n" })).resolves.toMatchObject({ disposition: "conflict" });
    await expect(plan({ currentMarkdown: null, baseline })).resolves.toMatchObject({ disposition: "conflict" });
  });

  it("rejects stale, tampered or deleted canonical sources", async () => {
    const records = await source();
    const staleRevision = { ...records.revision, id: "revision_stale" };
    await expect(plan({ entry: records.entry, revision: staleRevision })).rejects.toThrow("OBSIDIAN_EXPORT_REVISION_POINTER_MISMATCH");
    const tamperedRevision = { ...records.revision, data: { ...records.revision.data, content_sha256: "a".repeat(64) } };
    await expect(plan({ entry: records.entry, revision: tamperedRevision })).rejects.toThrow("OBSIDIAN_EXPORT_CONTENT_HASH_MISMATCH");
    const deleted = setWorkspaceRecordDeleted(records.entry, timestamp, timestamp);
    await expect(plan({ entry: deleted, revision: records.revision })).rejects.toThrow("OBSIDIAN_EXPORT_DELETED_ENTRY");
  });

  it("rejects unsafe cross-platform paths and mismatched baselines", async () => {
    await expect(plan({ subdirectory: "Personal Workspace/../Private" })).rejects.toThrow("INVALID_OBSIDIAN_SUBDIRECTORY");
    const initial = await plan();
    const baseline = { ...baselineFromObsidianJournalExportPlan(initial), relativePath: "different.md" };
    await expect(plan({ currentMarkdown: initial.markdown, baseline })).rejects.toThrow("INVALID_OBSIDIAN_EXPORT_BASELINE");
  });
});
