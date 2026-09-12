import { type JournalEntryRecord } from "./journal-entries";
import { type JournalRevisionRecord, sha256JournalRevisionBody } from "./journal-revisions";
import { normalizeObsidianSubdirectory, normalizeObsidianVaultName } from "./obsidian-vault-preflight";

export const OBSIDIAN_JOURNAL_EXPORT_FORMAT_VERSION = 1 as const;

export type ObsidianJournalExportBaseline = {
  formatVersion: typeof OBSIDIAN_JOURNAL_EXPORT_FORMAT_VERSION;
  relativePath: string;
  journalEntryId: string;
  revisionId: string;
  recordVersion: number;
  sourceContentSha256: string;
  documentSha256: string;
};

export type ObsidianJournalExportDisposition = "create" | "unchanged" | "update" | "conflict";

export type ObsidianJournalExportPlan = {
  formatVersion: typeof OBSIDIAN_JOURNAL_EXPORT_FORMAT_VERSION;
  vaultName: string;
  subdirectory: string;
  relativePath: string;
  confirmation: string;
  markdown: string;
  documentSha256: string;
  utf8Bytes: number;
  disposition: ObsidianJournalExportDisposition;
  currentDocumentSha256: string | null;
  source: {
    journalEntryId: string;
    journalDate: string;
    recordVersion: number;
    revisionId: string;
    revisionNumber: number;
    contentSha256: string;
  };
};

export async function buildObsidianJournalExportPlan(input: {
  vaultName: string;
  subdirectory: string;
  entry: JournalEntryRecord;
  revision: JournalRevisionRecord;
  currentMarkdown: string | null;
  baseline?: ObsidianJournalExportBaseline | null;
}): Promise<ObsidianJournalExportPlan> {
  const vaultName = normalizeObsidianVaultName(input.vaultName);
  const subdirectory = normalizeObsidianSubdirectory(input.subdirectory);
  await assertCanonicalSource(input.entry, input.revision);

  const relativePath = `${subdirectory}/Journal/${input.entry.data.journal_date.slice(0, 4)}/${input.entry.data.journal_date}.md`;
  const markdown = renderObsidianJournalMarkdown(input.entry, input.revision);
  const documentSha256 = await sha256Text(markdown);
  const currentDocumentSha256 = input.currentMarkdown === null ? null : await sha256Text(input.currentMarkdown);
  const baseline = input.baseline ?? null;
  if (baseline) assertBaseline(baseline, input.entry.id, relativePath);

  let disposition: ObsidianJournalExportDisposition;
  if (currentDocumentSha256 === documentSha256) disposition = "unchanged";
  else if (currentDocumentSha256 === null) disposition = baseline ? "conflict" : "create";
  else if (!baseline) disposition = "conflict";
  else disposition = currentDocumentSha256 === baseline.documentSha256 ? "update" : "conflict";

  return {
    formatVersion: OBSIDIAN_JOURNAL_EXPORT_FORMAT_VERSION,
    vaultName,
    subdirectory,
    relativePath,
    confirmation: `${vaultName}/${relativePath}`,
    markdown,
    documentSha256,
    utf8Bytes: new TextEncoder().encode(markdown).byteLength,
    disposition,
    currentDocumentSha256,
    source: {
      journalEntryId: input.entry.id,
      journalDate: input.entry.data.journal_date,
      recordVersion: input.entry.version,
      revisionId: input.revision.id,
      revisionNumber: input.revision.data.revision_number,
      contentSha256: input.revision.data.content_sha256,
    },
  };
}

export function baselineFromObsidianJournalExportPlan(plan: ObsidianJournalExportPlan): ObsidianJournalExportBaseline {
  if (plan.disposition === "conflict") throw new Error("OBSIDIAN_EXPORT_CONFLICT_HAS_NO_BASELINE");
  return {
    formatVersion: OBSIDIAN_JOURNAL_EXPORT_FORMAT_VERSION,
    relativePath: plan.relativePath,
    journalEntryId: plan.source.journalEntryId,
    revisionId: plan.source.revisionId,
    recordVersion: plan.source.recordVersion,
    sourceContentSha256: plan.source.contentSha256,
    documentSha256: plan.documentSha256,
  };
}

function renderObsidianJournalMarkdown(entry: JournalEntryRecord, revision: JournalRevisionRecord) {
  const title = entry.data.title || entry.data.journal_date;
  return [
    "---",
    `personal_workspace_document: ${OBSIDIAN_JOURNAL_EXPORT_FORMAT_VERSION}`,
    'document_kind: "journal_entry"',
    `journal_id: ${JSON.stringify(entry.id)}`,
    `journal_date: ${JSON.stringify(entry.data.journal_date)}`,
    `timezone: ${JSON.stringify(entry.data.timezone)}`,
    `record_version: ${entry.version}`,
    `revision_id: ${JSON.stringify(revision.id)}`,
    `revision_number: ${revision.data.revision_number}`,
    `canonical_content_sha256: ${JSON.stringify(revision.data.content_sha256)}`,
    `sensitivity: ${JSON.stringify(entry.data.sensitivity)}`,
    `mood: ${JSON.stringify(entry.data.mood)}`,
    `weather: ${JSON.stringify(entry.data.weather)}`,
    "---",
    "",
    `# ${escapeMarkdownHeading(title)}`,
    "",
    revision.data.body_markdown,
    "",
  ].join("\n");
}

async function assertCanonicalSource(entry: JournalEntryRecord, revision: JournalRevisionRecord) {
  if (entry.deleted_at !== null) throw new Error("OBSIDIAN_EXPORT_DELETED_ENTRY");
  if (entry.owner_id !== revision.owner_id) throw new Error("OBSIDIAN_EXPORT_OWNER_MISMATCH");
  if (entry.data.current_revision_id === null || entry.data.current_revision_id !== revision.id) throw new Error("OBSIDIAN_EXPORT_REVISION_POINTER_MISMATCH");
  if (revision.data.journal_entry_id !== entry.id) throw new Error("OBSIDIAN_EXPORT_REVISION_ENTRY_MISMATCH");
  if (entry.data.body_markdown !== revision.data.body_markdown) throw new Error("OBSIDIAN_EXPORT_MATERIALIZED_BODY_MISMATCH");
  if (await sha256JournalRevisionBody(revision.data.body_markdown) !== revision.data.content_sha256) throw new Error("OBSIDIAN_EXPORT_CONTENT_HASH_MISMATCH");
}

function assertBaseline(baseline: ObsidianJournalExportBaseline, journalEntryId: string, relativePath: string) {
  if (
    baseline.formatVersion !== OBSIDIAN_JOURNAL_EXPORT_FORMAT_VERSION
    || baseline.journalEntryId !== journalEntryId
    || baseline.relativePath !== relativePath
    || !isStableId(baseline.revisionId)
    || !Number.isSafeInteger(baseline.recordVersion)
    || baseline.recordVersion < 1
    || !isSha256(baseline.sourceContentSha256)
    || !isSha256(baseline.documentSha256)
  ) throw new Error("INVALID_OBSIDIAN_EXPORT_BASELINE");
}

function isStableId(value: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(value);
}

function isSha256(value: string) {
  return /^[a-f0-9]{64}$/u.test(value);
}

function escapeMarkdownHeading(value: string) {
  return value.replace(/\s+/g, " ").trim().replace(/([\\`*_{}\[\]()<>#+.!|\-])/g, "\\$1");
}

async function sha256Text(value: string) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
