import { normalizeObsidianSubdirectory } from "./obsidian-vault-preflight";
import { parseRecord, updateWorkspaceRecord, type WorkspaceRecord } from "./protocol";

export const OBSIDIAN_DOCUMENT_VERSION = 1 as const;

export type ObsidianDocumentData = {
  document_version: typeof OBSIDIAN_DOCUMENT_VERSION;
  document_kind: "journal_entry";
  vault_mapping_id: string;
  journal_entry_id: string;
  relative_path: string;
  export_format_version: 1;
  source_revision_id: string;
  source_record_version: number;
  source_content_sha256: string;
  document_sha256: string;
  exported_at: string;
};

export type ObsidianDocumentRecord = WorkspaceRecord<ObsidianDocumentData>;

export function createObsidianDocumentData(input: Omit<ObsidianDocumentData, "document_version" | "document_kind" | "export_format_version">): ObsidianDocumentData {
  const data: ObsidianDocumentData = {
    document_version: OBSIDIAN_DOCUMENT_VERSION,
    document_kind: "journal_entry",
    export_format_version: 1,
    ...input,
  };
  if (!isValidData(data)) throw new Error("INVALID_OBSIDIAN_DOCUMENT_DETAILS");
  return data;
}

export function updateObsidianDocumentRecord(current: ObsidianDocumentRecord, input: {
  sourceRevisionId: string;
  sourceRecordVersion: number;
  sourceContentSha256: string;
  documentSha256: string;
  exportedAt: string;
}) {
  const data = createObsidianDocumentData({
    vault_mapping_id: current.data.vault_mapping_id,
    journal_entry_id: current.data.journal_entry_id,
    relative_path: current.data.relative_path,
    source_revision_id: input.sourceRevisionId,
    source_record_version: input.sourceRecordVersion,
    source_content_sha256: input.sourceContentSha256,
    document_sha256: input.documentSha256,
    exported_at: input.exportedAt,
  });
  if (Date.parse(data.exported_at) < Date.parse(current.data.exported_at)) throw new Error("INVALID_OBSIDIAN_DOCUMENT_DETAILS");
  return updateWorkspaceRecord(current, data, input.exportedAt);
}

export function parseObsidianDocumentRecord(value: string): ObsidianDocumentRecord {
  const record = parseRecord(value);
  if (record.entity_type !== "obsidian_document" || !isStableId(record.owner_id) || !isValidData(record.data)) {
    throw new Error("INVALID_OBSIDIAN_DOCUMENT_RECORD");
  }
  return record as ObsidianDocumentRecord;
}

export function expectedObsidianJournalRelativePath(subdirectory: string, journalDate: string) {
  if (!isDate(journalDate)) throw new Error("INVALID_OBSIDIAN_JOURNAL_DATE");
  return `${normalizeObsidianSubdirectory(subdirectory)}/Journal/${journalDate.slice(0, 4)}/${journalDate}.md`;
}

function isValidData(value: Record<string, unknown>): value is ObsidianDocumentData {
  return Object.keys(value).sort().join(",") === [
    "document_kind", "document_sha256", "document_version", "export_format_version", "exported_at",
    "journal_entry_id", "relative_path", "source_content_sha256", "source_record_version", "source_revision_id",
    "vault_mapping_id",
  ].join(",")
    && value.document_version === OBSIDIAN_DOCUMENT_VERSION
    && value.document_kind === "journal_entry"
    && value.export_format_version === 1
    && isStableId(value.vault_mapping_id)
    && isStableId(value.journal_entry_id)
    && isObsidianJournalRelativePath(value.relative_path)
    && isStableId(value.source_revision_id)
    && Number.isSafeInteger(value.source_record_version)
    && Number(value.source_record_version) >= 1
    && isSha256(value.source_content_sha256)
    && isSha256(value.document_sha256)
    && isInstant(value.exported_at);
}

export function isObsidianJournalRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 300 || value.includes("\\") || value.startsWith("/") || value.endsWith("/")) return false;
  const match = /^(.*)\/Journal\/(\d{4})\/(\d{4}-\d{2}-\d{2})\.md$/u.exec(value);
  if (!match || match[2] !== match[3]!.slice(0, 4) || !isDate(match[3]!)) return false;
  try { return normalizeObsidianSubdirectory(match[1]!) === match[1]; } catch { return false; }
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

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
