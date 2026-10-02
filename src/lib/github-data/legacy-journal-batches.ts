import type { LegacyJournalPreview } from "./legacy-docx-preview";
import { MAX_LEGACY_JOURNAL_ATOMIC_FILES } from "./legacy-journal-atomic-writer";
import { MAX_LEGACY_JOURNAL_DATES_PER_COMMIT } from "./legacy-journal-commit-plan";

export type LegacyJournalDateBatch = {
  index: number;
  dates: string[];
  estimatedFiles: number;
  segmentCount: number;
};

export function buildLegacyJournalDateBatches(entries: LegacyJournalPreview["parse"]["entries"]): LegacyJournalDateBatch[] {
  const ordered = [...entries].sort((left, right) => left.date.localeCompare(right.date));
  if (new Set(ordered.map((entry) => entry.date)).size !== ordered.length) throw new Error("LEGACY_IMPORT_DUPLICATE_PREVIEW_DATE");
  const batches: LegacyJournalDateBatch[] = [];
  let dates: string[] = [];
  let estimatedFiles = 1;
  let segmentCount = 0;

  function flush() {
    if (!dates.length) return;
    batches.push({ index: batches.length + 1, dates, estimatedFiles, segmentCount });
    dates = [];
    estimatedFiles = 1;
    segmentCount = 0;
  }

  for (const entry of ordered) {
    const entryFiles = entry.segments.length + 2;
    if (entryFiles + 1 > MAX_LEGACY_JOURNAL_ATOMIC_FILES) throw new Error("LEGACY_IMPORT_SINGLE_DATE_FILE_LIMIT_EXCEEDED");
    if (dates.length && (dates.length >= MAX_LEGACY_JOURNAL_DATES_PER_COMMIT || estimatedFiles + entryFiles > MAX_LEGACY_JOURNAL_ATOMIC_FILES)) flush();
    dates.push(entry.date);
    estimatedFiles += entryFiles;
    segmentCount += entry.segments.length;
  }
  flush();
  return batches;
}
