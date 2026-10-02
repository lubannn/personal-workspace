import type { JournalEntryRecord } from "./journal-entries";
import { parseJournalSegmentsMarkdown } from "./journal-segment-codec";

export type JournalFileStatistics = { blobSha: string; date: string; entries: number; words: number; deleted: boolean };

// Count prose, not Markdown syntax or URLs. Han characters count individually;
// a Latin word (including internal apostrophes/hyphens) counts as one unit.
export function journalWordCount(markdown: string): number {
  const prose = markdown
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/https?:\/\/\S+/gu, "")
    .replace(/^\s*\d+[.)]\s+/gmu, "")
    .replace(/^\s*\[[ xX]\]\s*/gmu, "");
  return (prose.match(/\p{Script=Han}|[\p{Script=Latin}\p{N}]+(?:['’\-][\p{Script=Latin}\p{N}]+)*|[^\p{Script=Han}\p{Script=Latin}\p{N}\p{P}\p{S}\p{Z}\p{C}\p{M}]/gu) ?? []).length;
}

export function journalFileStatistics(record: JournalEntryRecord, blobSha: string): JournalFileStatistics {
  const segments = record.data.body_markdown.startsWith("<!-- pw-journal-segments:v1:")
    ? parseJournalSegmentsMarkdown(record.data.body_markdown).segments.map((segment) => segment.body_markdown)
    : [record.data.body_markdown];
  return { blobSha, date: record.data.journal_date, entries: segments.length, words: segments.reduce((sum, body) => sum + journalWordCount(body), 0), deleted: record.deleted_at !== null };
}

export function sumJournalStatistics(files: JournalFileStatistics[]) {
  const active = files.filter((file) => !file.deleted);
  return { days: new Set(active.map((file) => file.date)).size, entries: active.reduce((sum, file) => sum + file.entries, 0), words: active.reduce((sum, file) => sum + file.words, 0) };
}

export function parseJournalStatisticsCache(text: string): Record<string, JournalFileStatistics> {
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("INVALID_JOURNAL_STATISTICS_CACHE");
  for (const value of Object.values(data)) {
    if (!value || typeof value !== "object" || typeof value.blobSha !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value.date) || typeof value.deleted !== "boolean" || !Number.isSafeInteger(value.entries) || value.entries < 0 || !Number.isSafeInteger(value.words) || value.words < 0) throw new Error("INVALID_JOURNAL_STATISTICS_CACHE");
  }
  return data as Record<string, JournalFileStatistics>;
}
