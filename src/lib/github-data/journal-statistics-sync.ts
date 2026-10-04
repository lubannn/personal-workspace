import { GitHubDataError, type GitHubContentsAdapter } from "./github-contents";
import { parseJournalStatisticsCache, type JournalFileStatistics } from "./journal-statistics";

export const JOURNAL_STATISTICS_PATH = "data/journal-statistics/summary-v2.json";
export type SharedJournalStatistics = { files: Record<string, JournalFileStatistics>; blobSha?: string };
const summaryReads = new WeakMap<object, { at: number; pending: boolean; promise: Promise<SharedJournalStatistics> }>();
const SUMMARY_REUSE_MS = 15_000;

export function journalStatisticsSummaryText(files: Record<string, JournalFileStatistics>) {
  return `${JSON.stringify({ counting_rule: "prose-with-punctuation-v2", files: Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) })}\n`;
}

export function readSharedJournalStatistics(adapter: Pick<GitHubContentsAdapter, "readText">, options: { refresh?: boolean } = {}): Promise<SharedJournalStatistics> {
  const cached = summaryReads.get(adapter);
  if (!options.refresh && cached && (cached.pending || Date.now() - cached.at < SUMMARY_REUSE_MS)) return cached.promise;
  const request = { at: Date.now(), pending: true, promise: loadSharedJournalStatistics(adapter) };
  summaryReads.set(adapter, request);
  void request.promise.then(() => { request.pending = false; request.at = Date.now(); }, () => { if (summaryReads.get(adapter) === request) summaryReads.delete(adapter); });
  return request.promise;
}

async function loadSharedJournalStatistics(adapter: Pick<GitHubContentsAdapter, "readText">): Promise<SharedJournalStatistics> {
  try {
    const stored = await adapter.readText(JOURNAL_STATISTICS_PATH);
    const summary = JSON.parse(stored.text);
    if (summary.counting_rule !== "prose-with-punctuation-v2") throw new Error("UNSUPPORTED_JOURNAL_COUNTING_RULE");
    return { files: parseJournalStatisticsCache(JSON.stringify(summary.files)), blobSha: stored.blobSha };
  } catch (error) {
    if (error instanceof GitHubDataError && error.status === 404) return { files: {} };
    throw error;
  }
}

// One version-guarded write of derived counts. Never writes journal content;
// conflicts/unknown network outcomes are re-read before a user retries.
export async function writeSharedJournalStatistics(adapter: Pick<GitHubContentsAdapter, "writeText">, files: Record<string, JournalFileStatistics>, expectedBlobSha?: string): Promise<SharedJournalStatistics> {
  const result = await adapter.writeText({ path: JOURNAL_STATISTICS_PATH, text: journalStatisticsSummaryText(files), expectedBlobSha, message: "journal: update shared incremental statistics" });
  const value = { files, blobSha: result.blobSha };
  summaryReads.set(adapter, { at: Date.now(), pending: false, promise: Promise.resolve(value) });
  return value;
}
