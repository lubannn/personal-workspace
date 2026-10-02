import { GitHubDataError } from "./github-contents";
import { parseJournalImportCheckpointRecord } from "./journal-import-checkpoints";
import { sha256JournalRevisionBody } from "./journal-revisions";
import type { LegacyDocxPreview } from "./legacy-docx-preview";
import type { LegacyJournalAtomicWriterAdapter, LegacyJournalScopedPlanningSnapshot } from "./legacy-journal-atomic-writer";
import { legacyJournalDryRunIdentity } from "./legacy-journal-dry-run";
import { recordPath } from "./protocol";

/** A matching source and complete, unchanged checkpoint inventory means no new commit is needed. */
export async function isLegacyJournalSourceFullyImported(
  adapter: LegacyJournalAtomicWriterAdapter,
  preview: LegacyDocxPreview,
  snapshot: LegacyJournalScopedPlanningSnapshot,
): Promise<boolean> {
  let files;
  try {
    files = await adapter.listDirectory("data/journal-import-checkpoints", snapshot.headCommitSha);
  } catch (error) {
    if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return false;
    throw error;
  }
  const identity = await legacyJournalDryRunIdentity(preview);
  const matched = [];
  const candidates = files.filter((item) => item.type === "file" && item.name.endsWith(".json"));
  for (let offset = 0; offset < candidates.length; offset += 8) {
    const records = await Promise.all(candidates.slice(offset, offset + 8).map(async (item) => {
      const file = await adapter.readText(item.path, snapshot.headCommitSha);
      const record = parseJournalImportCheckpointRecord(file.text);
      if (recordPath("journal_import_checkpoint", record.id) !== item.path) throw new Error("LEGACY_IMPORT_REMOTE_PATH_MISMATCH");
      return record;
    }));
    matched.push(...records.filter((record) => record.data.dry_run_id === identity.dryRunId && record.data.source_sha256 === preview.source.sha256));
  }
  if (!matched.length) return false;
  const byDate = new Map(snapshot.entries.map((entry) => [entry.data.journal_date, entry]));
  const planned = matched.flatMap((record) => record.data.items);
  const dates = new Set(preview.parse.entries.map((entry) => entry.date));
  if (planned.length !== dates.size || new Set(planned.map((item) => item.date)).size !== planned.length) return false;
  for (const item of planned) {
    const entry = byDate.get(item.date);
    if (!dates.has(item.date) || !entry || entry.id !== item.entry_id || entry.version !== 1 || entry.deleted_at !== null
      || entry.data.current_revision_id !== item.revision_id || !snapshot.existingPaths.has(recordPath("journal_entry", item.entry_id))
      || !snapshot.existingPaths.has(recordPath("journal_revision", item.revision_id))
      || item.segment_ids.some((id) => !snapshot.existingPaths.has(recordPath("journal_segment", id)))) return false;
    if (await sha256JournalRevisionBody(entry.data.body_markdown) !== item.content_sha256) return false;
  }
  return true;
}
