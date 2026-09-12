import {
  baselineFromObsidianJournalExportPlan,
  type ObsidianJournalExportBaseline,
  type ObsidianJournalExportPlan,
} from "./obsidian-journal-export";
import {
  obsidianExportManifestPath,
  parseObsidianExportManifest,
  serializeObsidianExportManifest,
  upsertObsidianExportManifestDocument,
  type ObsidianExportManifest,
} from "./obsidian-export-manifest";
import { normalizeObsidianSubdirectory, normalizeObsidianVaultName } from "./obsidian-vault-preflight";
import type { SyncConflictData } from "./sync-conflicts";

export type ObsidianVaultTextAccess = {
  readText: (relativePath: string) => Promise<string | null>;
  compareAndWrite: (input: { relativePath: string; expectedSha256: string | null; text: string }) => Promise<void>;
};

export type ObsidianJournalExportActionResult = {
  status: "completed";
  wroteDocument: boolean;
  wroteManifest: boolean;
  manifestPath: string;
  manifest: ObsidianExportManifest;
  baseline: ObsidianJournalExportBaseline;
};

export async function obsidianVaultMappingId(vaultName: string, subdirectory: string) {
  const normalizedVaultName = normalizeObsidianVaultName(vaultName);
  const normalizedSubdirectory = normalizeObsidianSubdirectory(subdirectory);
  const digest = await sha256Text(`${normalizedVaultName}\n${normalizedSubdirectory}`);
  return `obsidian_vault_${digest.slice(0, 32)}`;
}

export async function obsidianDocumentId(vaultMappingId: string, journalEntryId: string) {
  if (!isStableId(vaultMappingId) || !isStableId(journalEntryId)) throw new Error("INVALID_OBSIDIAN_DOCUMENT_IDENTITY");
  const digest = await sha256Text(`${vaultMappingId}\n${journalEntryId}`);
  return `obsidian_document_${digest.slice(0, 40)}`;
}

export function syncConflictDataFromObsidianExportPlan(input: {
  plan: ObsidianJournalExportPlan;
  vaultMappingId: string;
  obsidianDocumentId: string | null;
  baselineDocumentSha256: string | null;
}): Omit<SyncConflictData, "conflict_version" | "status" | "detected_at"> {
  const { plan } = input;
  if (plan.disposition !== "conflict") throw new Error("OBSIDIAN_EXPORT_PLAN_HAS_NO_CONFLICT");
  const tracked = input.obsidianDocumentId !== null;
  if (tracked !== (input.baselineDocumentSha256 !== null)) throw new Error("INVALID_OBSIDIAN_EXPORT_CONFLICT_BASELINE");
  if (tracked && plan.currentDocumentSha256 === input.baselineDocumentSha256) throw new Error("INVALID_OBSIDIAN_EXPORT_CONFLICT");
  if (!tracked && plan.currentDocumentSha256 === null) throw new Error("INVALID_OBSIDIAN_EXPORT_CONFLICT");
  const conflictKind = tracked
    ? plan.currentDocumentSha256 === null ? "obsidian_document_missing" : "obsidian_document_changed"
    : "obsidian_document_untracked";
  return {
    conflict_kind: conflictKind,
    vault_mapping_id: input.vaultMappingId,
    obsidian_document_id: input.obsidianDocumentId,
    journal_entry_id: plan.source.journalEntryId,
    source_revision_id: plan.source.revisionId,
    relative_path: plan.relativePath,
    baseline_document_sha256: input.baselineDocumentSha256,
    observed_document_sha256: plan.currentDocumentSha256,
    planned_document_sha256: plan.documentSha256,
  };
}

export async function executeObsidianJournalExportAction(input: {
  plan: ObsidianJournalExportPlan;
  confirmation: string;
  vaultMappingId: string;
  generatedAt: string;
  access: ObsidianVaultTextAccess;
}): Promise<ObsidianJournalExportActionResult> {
  if (input.confirmation !== input.plan.confirmation) throw new Error("OBSIDIAN_EXPORT_CONFIRMATION_MISMATCH");
  if (input.plan.disposition === "conflict") throw new Error("OBSIDIAN_EXPORT_CONFLICT");
  if (!isStableId(input.vaultMappingId) || !isInstant(input.generatedAt)) throw new Error("INVALID_OBSIDIAN_EXPORT_ACTION");

  const currentDocument = await input.access.readText(input.plan.relativePath);
  const currentDocumentSha256 = currentDocument === null ? null : await sha256Text(currentDocument);
  if (currentDocumentSha256 !== input.plan.currentDocumentSha256) throw new Error("OBSIDIAN_EXPORT_TARGET_CHANGED");

  const manifestPath = obsidianExportManifestPath(input.plan.subdirectory);
  const currentManifestText = await input.access.readText(manifestPath);
  const currentManifest = currentManifestText === null ? null : parseObsidianExportManifest(currentManifestText);
  const currentManifestSha256 = currentManifestText === null ? null : await sha256Text(currentManifestText);
  const manifest = upsertObsidianExportManifestDocument(currentManifest, {
    vaultMappingId: input.vaultMappingId,
    generatedAt: input.generatedAt,
    document: {
      relative_path: input.plan.relativePath,
      journal_entry_id: input.plan.source.journalEntryId,
      source_revision_id: input.plan.source.revisionId,
      source_record_version: input.plan.source.recordVersion,
      source_content_sha256: input.plan.source.contentSha256,
      document_sha256: input.plan.documentSha256,
      utf8_bytes: input.plan.utf8Bytes,
    },
  });
  const manifestText = serializeObsidianExportManifest(manifest);

  const wroteDocument = currentDocumentSha256 !== input.plan.documentSha256;
  if (wroteDocument) {
    await input.access.compareAndWrite({ relativePath: input.plan.relativePath, expectedSha256: currentDocumentSha256, text: input.plan.markdown });
  }
  const verifiedDocument = await input.access.readText(input.plan.relativePath);
  if (verifiedDocument !== input.plan.markdown) throw new Error("OBSIDIAN_EXPORT_DOCUMENT_VERIFY_FAILED");

  const wroteManifest = currentManifestText !== manifestText;
  if (wroteManifest) {
    await input.access.compareAndWrite({ relativePath: manifestPath, expectedSha256: currentManifestSha256, text: manifestText });
  }
  const verifiedManifest = await input.access.readText(manifestPath);
  if (verifiedManifest !== manifestText) throw new Error("OBSIDIAN_EXPORT_MANIFEST_VERIFY_FAILED");

  return {
    status: "completed",
    wroteDocument,
    wroteManifest,
    manifestPath,
    manifest,
    baseline: baselineFromObsidianJournalExportPlan(input.plan),
  };
}

async function sha256Text(value: string) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isStableId(value: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(value);
}

function isInstant(value: string) {
  return !Number.isNaN(Date.parse(value));
}
