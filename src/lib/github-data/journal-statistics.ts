import { parseJournalEntryRecord, type JournalEntryRecord } from "./journal-entries";
import { GitHubDataError } from "./github-contents";
import { parseJournalSegmentsMarkdown } from "./journal-segment-codec";

export type JournalFileStatistics = { blobSha: string; date: string; entries: number; words: number; deleted: boolean };

// Count prose, not Markdown syntax or URLs. Han characters count individually;
// a Latin word (including internal apostrophes/hyphens) counts as one unit.
// Punctuation counts separately; whitespace and formatting markers do not.
export function journalWordCount(markdown: string): number {
  const prose = markdown
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/https?:\/\/\S+/gu, "")
    .replace(/^\s*\d+[.)]\s+/gmu, "")
    .replace(/^\s*(?:#{1,6}|>|[-+*])\s+/gmu, "")
    .replace(/^\s*\[[ xX]\]\s*/gmu, "")
    .replace(/(\*\*|__|~~|`+)(.*?)\1/gsu, "$2");
  const words = (prose.match(/\p{Script=Han}|[\p{Script=Latin}\p{N}]+(?:['’\-][\p{Script=Latin}\p{N}]+)*|[^\p{Script=Han}\p{Script=Latin}\p{N}\p{P}\p{S}\p{Z}\p{C}\p{M}\s]/gu) ?? []).length;
  return words + (prose.match(/\p{P}/gu) ?? []).length;
}

export function cachedJournalStatistics(cache: Record<string, JournalFileStatistics>, path: string, blobSha: string) {
  return cache[path]?.blobSha === blobSha ? cache[path] : undefined;
}

export async function collectJournalStatistics(input: {
  files: { path: string; blobSha: string }[];
  cache: Record<string, JournalFileStatistics>;
  read: (path: string, blobSha: string) => Promise<{ text: string; blobSha: string }>;
  cancelled: () => boolean;
  checkpoint: (cache: Record<string, JournalFileStatistics>) => void;
}) {
  const cache = { ...input.cache };
  const pending = input.files.filter((file) => !cachedJournalStatistics(cache, file.path, file.blobSha));
  let failures = 0;
  for (let offset = 0; offset < pending.length && !input.cancelled(); offset += 6) {
    let completed = 0;
    let blocked = false;
    await Promise.all(pending.slice(offset, offset + 6).map(async (file) => {
      try {
        let stored;
        for (let attempt = 0; ; attempt += 1) {
          if (input.cancelled()) return;
          try { stored = await input.read(file.path, file.blobSha); break; }
          catch (error) {
            const transient = error instanceof GitHubDataError && (error.status === 0 || error.status >= 500);
            if (!transient || attempt >= 1 || input.cancelled()) throw error;
          }
        }
        if (stored.blobSha !== file.blobSha) throw new Error("JOURNAL_STATISTICS_VERSION_CHANGED");
        cache[file.path] = journalFileStatistics(parseJournalEntryRecord(stored.text), stored.blobSha);
        completed += 1;
      } catch (error) {
        failures += 1;
        if (error instanceof GitHubDataError && [401, 403, 429].includes(error.status)) blocked = true;
      }
    }));
    // Keep every completed small batch, even if a sibling read fails or the
    // user pauses/saves while it is in flight. Never discard successful counts.
    input.checkpoint({ ...cache });
    if (blocked || completed === 0) break;
  }
  return { cache, failures };
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
