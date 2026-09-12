import { isObsidianJournalRelativePath } from "./obsidian-documents";
import { normalizeObsidianSubdirectory } from "./obsidian-vault-preflight";

export const OBSIDIAN_EXPORT_MANIFEST_FORMAT = "personal-workspace-obsidian-export" as const;
export const OBSIDIAN_EXPORT_MANIFEST_VERSION = 1 as const;
export const OBSIDIAN_EXPORT_MANIFEST_PATH = "Personal Workspace/personal-workspace-export-manifest.json" as const;

export function obsidianExportManifestPath(subdirectory: string) {
  return `${normalizeObsidianSubdirectory(subdirectory)}/personal-workspace-export-manifest.json`;
}

export type ObsidianExportManifestDocument = {
  relative_path: string;
  journal_entry_id: string;
  source_revision_id: string;
  source_record_version: number;
  source_content_sha256: string;
  document_sha256: string;
  utf8_bytes: number;
};

export type ObsidianExportManifest = {
  format: typeof OBSIDIAN_EXPORT_MANIFEST_FORMAT;
  manifest_version: typeof OBSIDIAN_EXPORT_MANIFEST_VERSION;
  vault_mapping_id: string;
  generated_at: string;
  documents: ObsidianExportManifestDocument[];
};

export function createObsidianExportManifest(input: {
  vaultMappingId: string;
  generatedAt: string;
  documents: ObsidianExportManifestDocument[];
}): ObsidianExportManifest {
  const manifest: ObsidianExportManifest = {
    format: OBSIDIAN_EXPORT_MANIFEST_FORMAT,
    manifest_version: OBSIDIAN_EXPORT_MANIFEST_VERSION,
    vault_mapping_id: input.vaultMappingId,
    generated_at: input.generatedAt,
    documents: input.documents.map((document) => ({ ...document })).sort((left, right) => left.relative_path.localeCompare(right.relative_path)),
  };
  return parseObsidianExportManifest(serializeObsidianExportManifest(manifest));
}

export function parseObsidianExportManifest(value: string): ObsidianExportManifest {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("INVALID_OBSIDIAN_EXPORT_MANIFEST"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_OBSIDIAN_EXPORT_MANIFEST");
  const manifest = parsed as Record<string, unknown>;
  if (
    Object.keys(manifest).sort().join(",") !== "documents,format,generated_at,manifest_version,vault_mapping_id"
    || manifest.format !== OBSIDIAN_EXPORT_MANIFEST_FORMAT
    || manifest.manifest_version !== OBSIDIAN_EXPORT_MANIFEST_VERSION
    || !isStableId(manifest.vault_mapping_id)
    || !isInstant(manifest.generated_at)
    || !Array.isArray(manifest.documents)
    || manifest.documents.length > 100_000
    || manifest.documents.some((document) => !isDocument(document))
  ) throw new Error("INVALID_OBSIDIAN_EXPORT_MANIFEST");
  const documents = manifest.documents as ObsidianExportManifestDocument[];
  if (
    new Set(documents.map((document) => document.relative_path)).size !== documents.length
    || new Set(documents.map((document) => document.journal_entry_id)).size !== documents.length
    || documents.some((document, index) => index > 0 && documents[index - 1]!.relative_path >= document.relative_path)
  ) throw new Error("INVALID_OBSIDIAN_EXPORT_MANIFEST");
  return manifest as ObsidianExportManifest;
}

export function serializeObsidianExportManifest(value: ObsidianExportManifest) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function upsertObsidianExportManifestDocument(
  current: ObsidianExportManifest | null,
  input: {
    vaultMappingId: string;
    generatedAt: string;
    document: ObsidianExportManifestDocument;
  },
) {
  if (current && current.vault_mapping_id !== input.vaultMappingId) throw new Error("OBSIDIAN_EXPORT_MANIFEST_MAPPING_MISMATCH");
  if (current) {
    const pathOwner = current.documents.find((document) => document.relative_path === input.document.relative_path);
    const entryTarget = current.documents.find((document) => document.journal_entry_id === input.document.journal_entry_id);
    if (pathOwner && pathOwner.journal_entry_id !== input.document.journal_entry_id) throw new Error("OBSIDIAN_EXPORT_MANIFEST_PATH_CONFLICT");
    if (entryTarget && entryTarget.relative_path !== input.document.relative_path) throw new Error("OBSIDIAN_EXPORT_MANIFEST_ENTRY_CONFLICT");
  }
  const documents = (current?.documents ?? []).filter((document) => document.journal_entry_id !== input.document.journal_entry_id);
  documents.push(input.document);
  return createObsidianExportManifest({ vaultMappingId: input.vaultMappingId, generatedAt: input.generatedAt, documents });
}

function isDocument(value: unknown): value is ObsidianExportManifestDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  return Object.keys(document).sort().join(",") === "document_sha256,journal_entry_id,relative_path,source_content_sha256,source_record_version,source_revision_id,utf8_bytes"
    && isObsidianJournalRelativePath(document.relative_path)
    && isStableId(document.journal_entry_id)
    && isStableId(document.source_revision_id)
    && Number.isSafeInteger(document.source_record_version)
    && Number(document.source_record_version) >= 1
    && isSha256(document.source_content_sha256)
    && isSha256(document.document_sha256)
    && Number.isSafeInteger(document.utf8_bytes)
    && Number(document.utf8_bytes) > 0;
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isInstant(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
