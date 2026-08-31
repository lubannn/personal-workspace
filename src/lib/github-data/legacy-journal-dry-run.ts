import { strToU8, zipSync, type Zippable } from "fflate";

import type { LegacyDocxPreview } from "./legacy-docx-preview";
import type { LegacyImportDiagnostic } from "./legacy-journal-import";

export const LEGACY_JOURNAL_DRY_RUN_MANIFEST_VERSION = 1 as const;
const DETERMINISTIC_ZIP_MTIME = new Date("1980-01-01T00:00:00.000Z");

export type LegacyJournalDryRunManifest = {
  manifest_version: typeof LEGACY_JOURNAL_DRY_RUN_MANIFEST_VERSION;
  dry_run_id: string;
  batch_identity: string;
  generated_at: string;
  source: LegacyDocxPreview["source"];
  parser_version: string;
  mapping_version: string;
  timezone: string;
  counts: {
    journal_files: number;
    segments: number;
    body_characters: number;
    corrections: number;
    skipped_paragraphs: number;
    warnings: number;
  };
  entries: Array<{
    staging_id: string;
    target_journal_id: null;
    date: string;
    relative_output_path: string;
    source_locators: string[];
    output_sha256: string;
    status: "pending";
    manual_edit: boolean;
  }>;
  skipped: Array<{
    source_locator: string;
    reason: string;
    correction_id: string;
  }>;
  corrections: LegacyDocxPreview["parse"]["corrections"];
  diagnostics: Array<Pick<LegacyImportDiagnostic, "code" | "severity" | "message" | "sourceLocator">>;
  commit_enabled: false;
};

export type LegacyJournalDryRunPackage = {
  dryRunId: string;
  fileName: string;
  bytes: Uint8Array;
  sha256: string;
  manifest: LegacyJournalDryRunManifest;
  importLogMarkdown: string;
  commitEnabled: false;
};

export async function buildLegacyJournalDryRun(preview: LegacyDocxPreview, options: { generatedAt?: string } = {}): Promise<LegacyJournalDryRunPackage> {
  const blockingArchiveIssue = preview.archiveDiagnostics.some((issue) => issue.severity === "error" || issue.severity === "blocking");
  if (!preview.parse.dryRunReady || blockingArchiveIssue) throw new Error("LEGACY_IMPORT_DRY_RUN_NOT_READY");
  if (preview.commitEnabled || preview.parse.commitEnabled) throw new Error("LEGACY_IMPORT_COMMIT_MUST_REMAIN_DISABLED");
  const generatedAt = normalizeTimestamp(
    options.generatedAt
      ?? preview.parse.corrections.at(-1)?.recordedAt
      ?? preview.source.lastModified
      ?? DETERMINISTIC_ZIP_MTIME.toISOString(),
  );
  const dryRunId = `legacy-journal:${preview.source.sha256}:${preview.parserVersion}:${preview.mappingVersion}`;
  const sortedEntries = [...preview.parse.entries].sort((left, right) => left.outputPath.localeCompare(right.outputPath));
  if (new Set(sortedEntries.map((entry) => entry.outputPath)).size !== sortedEntries.length) throw new Error("LEGACY_IMPORT_DUPLICATE_OUTPUT_PATH");
  const manifestEntries = await Promise.all(sortedEntries.map(async (entry) => ({
    staging_id: `legacy-${preview.source.sha256.slice(0, 16)}-${entry.date}`,
    target_journal_id: null,
    date: entry.date,
    relative_output_path: entry.outputPath,
    source_locators: entry.sourceLocators,
    output_sha256: await sha256Text(entry.markdown),
    status: "pending" as const,
    manual_edit: entry.sourceLocators.some((locator) => preview.parse.corrections.some((correction) => correction.sourceLocator === locator)),
  })));
  const diagnostics = [...preview.archiveDiagnostics, ...preview.parse.diagnostics];
  const manifest: LegacyJournalDryRunManifest = {
    manifest_version: LEGACY_JOURNAL_DRY_RUN_MANIFEST_VERSION,
    dry_run_id: dryRunId,
    batch_identity: preview.batchIdentity,
    generated_at: generatedAt,
    source: preview.source,
    parser_version: preview.parserVersion,
    mapping_version: preview.mappingVersion,
    timezone: preview.parse.timezone,
    counts: {
      journal_files: manifestEntries.length,
      segments: preview.parse.summary.segmentCount,
      body_characters: preview.parse.summary.bodyCharacters,
      corrections: preview.parse.corrections.length,
      skipped_paragraphs: preview.parse.skippedBlocks.length,
      warnings: diagnostics.filter((issue) => issue.severity === "warning").length,
    },
    entries: manifestEntries,
    skipped: preview.parse.skippedBlocks.map((block) => ({ source_locator: block.sourceLocator, reason: block.reason, correction_id: block.correctionId })),
    corrections: preview.parse.corrections,
    diagnostics: diagnostics.map(({ code, severity, message, sourceLocator }) => ({ code, severity, message, sourceLocator })),
    commit_enabled: false,
  };
  const importLogMarkdown = renderImportLog(manifest);
  const files: Zippable = {};
  for (const entry of sortedEntries) files[`staging/${entry.outputPath}`] = [strToU8(entry.markdown), { mtime: DETERMINISTIC_ZIP_MTIME }];
  files["manifest.json"] = [strToU8(`${JSON.stringify(manifest, null, 2)}\n`), { mtime: DETERMINISTIC_ZIP_MTIME }];
  files["import-log.md"] = [strToU8(importLogMarkdown), { mtime: DETERMINISTIC_ZIP_MTIME }];
  const bytes = zipSync(files, { level: 6, mtime: DETERMINISTIC_ZIP_MTIME });
  return {
    dryRunId,
    fileName: `legacy-journal-dry-run-${preview.source.sha256.slice(0, 12)}.zip`,
    bytes,
    sha256: await sha256Bytes(bytes),
    manifest,
    importLogMarkdown,
    commitEnabled: false,
  };
}

function renderImportLog(manifest: LegacyJournalDryRunManifest) {
  const lines = [
    "# Legacy Journal Dry Run Import Log",
    "",
    `- Dry run ID: \`${manifest.dry_run_id}\``,
    `- Generated at: ${manifest.generated_at}`,
    `- Source file: ${manifest.source.fileName}`,
    `- Source SHA-256: \`${manifest.source.sha256}\``,
    `- Parser / mapping: ${manifest.parser_version} / ${manifest.mapping_version}`,
    `- Timezone: ${manifest.timezone}`,
    `- Planned Journal files: ${manifest.counts.journal_files}`,
    `- Segments: ${manifest.counts.segments}`,
    `- Manual corrections: ${manifest.counts.corrections}`,
    `- Skipped paragraphs: ${manifest.counts.skipped_paragraphs}`,
    "- Commit enabled: false",
    "",
    "## Planned outputs",
    "",
    ...manifest.entries.map((entry) => `- \`${entry.relative_output_path}\` · ${entry.date} · SHA-256 \`${entry.output_sha256}\` · ${entry.status}`),
  ];
  if (manifest.corrections.length) lines.push("", "## Manual corrections", "", ...manifest.corrections.map((correction) => `- \`${correction.id}\` · \`${correction.sourceLocator}\` · ${correction.action} · ${correction.reason} · ${correction.recordedAt}`));
  if (manifest.skipped.length) lines.push("", "## Skipped source paragraphs", "", ...manifest.skipped.map((item) => `- \`${item.source_locator}\` · ${item.reason} · correction \`${item.correction_id}\``));
  if (manifest.diagnostics.length) lines.push("", "## Diagnostics", "", ...manifest.diagnostics.map((issue) => `- ${issue.severity} · ${issue.code}${issue.sourceLocator ? ` · \`${issue.sourceLocator}\`` : ""} · ${issue.message}`));
  lines.push("", "This dry run is local-only. It does not create Journal records, write GitHub, or touch an Obsidian Vault.", "");
  return lines.join("\n");
}

function normalizeTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) throw new Error("INVALID_LEGACY_DRY_RUN_TIMESTAMP");
  return date.toISOString();
}

async function sha256Text(value: string) {
  return sha256Bytes(strToU8(value));
}

async function sha256Bytes(bytes: Uint8Array) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
