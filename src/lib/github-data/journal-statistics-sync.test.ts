import { describe, expect, it, vi } from "vitest";
import { GitHubDataError } from "./github-contents";
import { JOURNAL_STATISTICS_PATH, journalStatisticsSummaryText, readSharedJournalStatistics, writeSharedJournalStatistics } from "./journal-statistics-sync";
import { cachedJournalStatistics, type JournalFileStatistics } from "./journal-statistics";

const counts: JournalFileStatistics = { date: "2026-10-02", blobSha: "entry-sha", entries: 3, words: 20, deleted: false };
const files = { "data/journal-entries/one.json": counts };

describe("cross-browser journal statistics", () => {
  it("loads reusable counts with one summary request and no diary reads", async () => {
    const adapter = { readText: vi.fn().mockResolvedValue({ text: journalStatisticsSummaryText(files), blobSha: "summary-sha" }) };
    const result = await readSharedJournalStatistics(adapter);
    expect(result).toEqual({ files, blobSha: "summary-sha" });
    expect(adapter.readText).toHaveBeenCalledExactlyOnceWith(JOURNAL_STATISTICS_PATH);
    expect(cachedJournalStatistics(result.files, "data/journal-entries/one.json", "entry-sha")).toEqual(counts);
    expect(cachedJournalStatistics(result.files, "data/journal-entries/one.json", "changed-sha")).toBeUndefined();
  });
  it("treats only a missing summary as a first-time setup, not a network or permission failure", async () => {
    await expect(readSharedJournalStatistics({ readText: vi.fn().mockRejectedValue(new GitHubDataError("missing", 404, "GITHUB_NOT_FOUND")) })).resolves.toEqual({ files: {} });
    await expect(readSharedJournalStatistics({ readText: vi.fn().mockRejectedValue(new GitHubDataError("blocked", 403, "GITHUB_FORBIDDEN")) })).rejects.toThrow();
  });
  it("writes a single version-guarded summary containing counts only", async () => {
    const adapter = { writeText: vi.fn().mockResolvedValue({ blobSha: "new-summary-sha" }) };
    await expect(writeSharedJournalStatistics(adapter, files, "old-summary-sha")).resolves.toEqual({ files, blobSha: "new-summary-sha" });
    expect(adapter.writeText).toHaveBeenCalledTimes(1);
    expect(adapter.writeText.mock.calls[0][0]).toMatchObject({ path: JOURNAL_STATISTICS_PATH, expectedBlobSha: "old-summary-sha" });
    expect(adapter.writeText.mock.calls[0][0].text).not.toMatch(/body_markdown|token|正文/u);
  });
  it("does not blindly retry a conflict or unknown network result", async () => {
    const adapter = { writeText: vi.fn().mockRejectedValue(new GitHubDataError("changed", 409, "GITHUB_SYNC_CONFLICT")) };
    await expect(writeSharedJournalStatistics(adapter, files, "old-summary-sha")).rejects.toThrow();
    expect(adapter.writeText).toHaveBeenCalledTimes(1);
  });
  it("uses deterministic key ordering and rejects stale counting rules", async () => {
    expect(journalStatisticsSummaryText({ b: counts, a: counts })).toBe(journalStatisticsSummaryText({ a: counts, b: counts }));
    await expect(readSharedJournalStatistics({ readText: vi.fn().mockResolvedValue({ text: JSON.stringify({ counting_rule: "old", files }), blobSha: "sha" }) })).rejects.toThrow("UNSUPPORTED_JOURNAL_COUNTING_RULE");
  });
});
