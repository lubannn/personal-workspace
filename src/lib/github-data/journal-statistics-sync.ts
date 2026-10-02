import { GitHubDataError, type GitHubContentsAdapter } from "./github-contents";
import { parseJournalStatisticsCache, type JournalFileStatistics } from "./journal-statistics";

export const JOURNAL_STATISTICS_PATH = "data/journal-statistics/summary-v2.json";
export type SharedJournalStatistics = { files: Record<string, JournalFileStatistics>; blobSha?: string };

export function journalStatisticsSummaryText(files: Record<string, JournalFileStatistics>) {
  return `${JSON.stringify({ counting_rule: "prose-with-punctuation-v2", files: Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) })}\n`;
}

export async function readSharedJournalStatistics(adapter: Pick<GitHubContentsAdapter, "readText">): Promise<SharedJournalStatistics> {
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
  return { files, blobSha: result.blobSha };
}
