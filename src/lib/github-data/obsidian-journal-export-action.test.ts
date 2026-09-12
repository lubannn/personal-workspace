import { describe, expect, it } from "vitest";

import { createJournalEntryData } from "./journal-entries";
import { executeObsidianJournalExportAction, obsidianDocumentId, obsidianVaultMappingId, syncConflictDataFromObsidianExportPlan, type ObsidianVaultTextAccess } from "./obsidian-journal-export-action";
import { buildObsidianJournalExportPlan } from "./obsidian-journal-export";
import { obsidianExportManifestPath, parseObsidianExportManifest } from "./obsidian-export-manifest";
import { createJournalRevisionData, sha256JournalRevisionBody } from "./journal-revisions";
import { createWorkspaceRecord } from "./protocol";

describe("Obsidian Journal export action", () => {
  it("derives stable non-path identities for the selected mapping and Journal", async () => {
    const mapping = await obsidianVaultMappingId(" Personal-Vault ", "Personal Workspace");
    expect(mapping).toMatch(/^obsidian_vault_[a-f0-9]{32}$/u);
    await expect(obsidianVaultMappingId("Personal-Vault", "Personal Workspace")).resolves.toBe(mapping);
    await expect(obsidianDocumentId(mapping, "journal_entry_1")).resolves.toMatch(/^obsidian_document_[a-f0-9]{40}$/u);
    await expect(obsidianDocumentId(mapping, "bad/id")).rejects.toThrow("INVALID_OBSIDIAN_DOCUMENT_IDENTITY");
  });

  it("creates one Journal file and a verified metadata-only manifest", async () => {
    const fixture = await canonicalFixture();
    const vault = memoryVaultAccess();
    const mappingId = await obsidianVaultMappingId(fixture.plan.vaultName, fixture.plan.subdirectory);
    const result = await executeObsidianJournalExportAction({ plan: fixture.plan, confirmation: fixture.plan.confirmation, vaultMappingId: mappingId, generatedAt: fixture.exportedAt, access: vault.access });

    expect(result).toMatchObject({ status: "completed", wroteDocument: true, wroteManifest: true, baseline: { documentSha256: fixture.plan.documentSha256 } });
    expect(vault.files.get(fixture.plan.relativePath)).toBe(fixture.plan.markdown);
    const manifest = parseObsidianExportManifest(vault.files.get(obsidianExportManifestPath(fixture.plan.subdirectory))!);
    expect(manifest.vault_mapping_id).toBe(mappingId);
    expect(manifest.documents).toEqual([expect.objectContaining({ journal_entry_id: fixture.entry.id, document_sha256: fixture.plan.documentSha256 })]);
    expect(JSON.stringify(manifest)).not.toContain(fixture.entry.data.body_markdown);
  });

  it("fails before writing when confirmation, target or manifest changed", async () => {
    const fixture = await canonicalFixture();
    const mappingId = await obsidianVaultMappingId(fixture.plan.vaultName, fixture.plan.subdirectory);

    const wrongConfirmation = memoryVaultAccess();
    await expect(executeObsidianJournalExportAction({ plan: fixture.plan, confirmation: "wrong", vaultMappingId: mappingId, generatedAt: fixture.exportedAt, access: wrongConfirmation.access })).rejects.toThrow("OBSIDIAN_EXPORT_CONFIRMATION_MISMATCH");
    expect(wrongConfirmation.writes).toHaveLength(0);

    const changed = memoryVaultAccess([[fixture.plan.relativePath, "external edit\n"]]);
    await expect(executeObsidianJournalExportAction({ plan: fixture.plan, confirmation: fixture.plan.confirmation, vaultMappingId: mappingId, generatedAt: fixture.exportedAt, access: changed.access })).rejects.toThrow("OBSIDIAN_EXPORT_TARGET_CHANGED");
    expect(changed.writes).toHaveLength(0);

    const invalidManifest = memoryVaultAccess([[obsidianExportManifestPath(fixture.plan.subdirectory), "not json\n"]]);
    await expect(executeObsidianJournalExportAction({ plan: fixture.plan, confirmation: fixture.plan.confirmation, vaultMappingId: mappingId, generatedAt: fixture.exportedAt, access: invalidManifest.access })).rejects.toThrow("INVALID_OBSIDIAN_EXPORT_MANIFEST");
    expect(invalidManifest.writes).toHaveLength(0);
  });

  it("recovers safely after the document was written but manifest commit failed", async () => {
    const fixture = await canonicalFixture();
    const mappingId = await obsidianVaultMappingId(fixture.plan.vaultName, fixture.plan.subdirectory);
    const vault = memoryVaultAccess([], obsidianExportManifestPath(fixture.plan.subdirectory));
    await expect(executeObsidianJournalExportAction({ plan: fixture.plan, confirmation: fixture.plan.confirmation, vaultMappingId: mappingId, generatedAt: fixture.exportedAt, access: vault.access })).rejects.toThrow("SIMULATED_WRITE_FAILURE");
    expect(vault.files.get(fixture.plan.relativePath)).toBe(fixture.plan.markdown);

    const retryPlan = await buildObsidianJournalExportPlan({ vaultName: fixture.plan.vaultName, subdirectory: fixture.plan.subdirectory, entry: fixture.entry, revision: fixture.revision, currentMarkdown: vault.files.get(fixture.plan.relativePath)!, baseline: null });
    expect(retryPlan.disposition).toBe("unchanged");
    const retry = await executeObsidianJournalExportAction({ plan: retryPlan, confirmation: retryPlan.confirmation, vaultMappingId: mappingId, generatedAt: "2026-09-12T06:01:00.000Z", access: vault.access });
    expect(retry).toMatchObject({ status: "completed", wroteDocument: false, wroteManifest: true });
  });

  it("rejects a conflict plan without touching the Vault", async () => {
    const fixture = await canonicalFixture("existing private note\n");
    const vault = memoryVaultAccess([[fixture.plan.relativePath, "existing private note\n"]]);
    await expect(executeObsidianJournalExportAction({ plan: fixture.plan, confirmation: fixture.plan.confirmation, vaultMappingId: "obsidian_vault_1", generatedAt: fixture.exportedAt, access: vault.access })).rejects.toThrow("OBSIDIAN_EXPORT_CONFLICT");
    expect(vault.writes).toHaveLength(0);
  });

  it("classifies tracked and untracked conflict evidence without copying正文", async () => {
    const untracked = await canonicalFixture("existing private note\n");
    const untrackedData = syncConflictDataFromObsidianExportPlan({ plan: untracked.plan, vaultMappingId: "obsidian_vault_1", obsidianDocumentId: null, baselineDocumentSha256: null });
    expect(untrackedData).toMatchObject({ conflict_kind: "obsidian_document_untracked", observed_document_sha256: untracked.plan.currentDocumentSha256, baseline_document_sha256: null });
    expect(JSON.stringify(untrackedData)).not.toContain("existing private note");

    const baseline = { formatVersion: 1 as const, relativePath: untracked.plan.relativePath, journalEntryId: untracked.entry.id, revisionId: untracked.revision.id, recordVersion: 1, sourceContentSha256: untracked.revision.data.content_sha256, documentSha256: "b".repeat(64) };
    const missingPlan = await buildObsidianJournalExportPlan({ vaultName: "Personal-Vault", subdirectory: "Personal Workspace", entry: untracked.entry, revision: untracked.revision, currentMarkdown: null, baseline });
    expect(syncConflictDataFromObsidianExportPlan({ plan: missingPlan, vaultMappingId: "obsidian_vault_1", obsidianDocumentId: "obsidian_document_1", baselineDocumentSha256: baseline.documentSha256 })).toMatchObject({ conflict_kind: "obsidian_document_missing", observed_document_sha256: null });
  });
});

async function canonicalFixture(currentMarkdown: string | null = null) {
  const timestamp = "2026-09-12T06:00:00.000Z";
  const body = "今天完成了单向导出动作层。";
  const revisionId = "journal_revision_20260912060000000_abcd1234";
  const entry = createWorkspaceRecord({
    entityType: "journal_entry",
    id: "journal_entry_20260912060000000_abcd1234",
    ownerId: "github_lubannn",
    timestamp,
    data: { ...createJournalEntryData({ journalDate: "2026-09-12", timezone: "Asia/Shanghai", title: "导出测试", bodyMarkdown: body, timestamp }), current_revision_id: revisionId },
  });
  const revision = createWorkspaceRecord({
    entityType: "journal_revision",
    id: revisionId,
    ownerId: entry.owner_id,
    timestamp,
    data: createJournalRevisionData({ journalEntryId: entry.id, revisionNumber: 1, contentMode: "body", bodyMarkdown: body, contentSha256: await sha256JournalRevisionBody(body), createdAt: timestamp, createdBy: "owner", changeReason: "initial_create" }),
  });
  const plan = await buildObsidianJournalExportPlan({ vaultName: "Personal-Vault", subdirectory: "Personal Workspace", entry, revision, currentMarkdown });
  return { entry, revision, plan, exportedAt: timestamp };
}

function memoryVaultAccess(initial: Array<[string, string]> = [], failOncePath?: string) {
  const files = new Map(initial);
  const writes: string[] = [];
  let pendingFailure = failOncePath;
  const access: ObsidianVaultTextAccess = {
    readText: async (relativePath) => files.get(relativePath) ?? null,
    compareAndWrite: async ({ relativePath, expectedSha256, text }) => {
      const current = files.get(relativePath) ?? null;
      const currentSha256 = current === null ? null : await sha256Text(current);
      if (currentSha256 !== expectedSha256) throw new Error("OBSIDIAN_EXPORT_COMPARE_FAILED");
      if (pendingFailure === relativePath) { pendingFailure = undefined; throw new Error("SIMULATED_WRITE_FAILURE"); }
      files.set(relativePath, text);
      writes.push(relativePath);
    },
  };
  return { access, files, writes };
}

async function sha256Text(value: string) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
