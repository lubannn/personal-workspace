import { describe, expect, it } from "vitest";
import type { GitHubDirectoryItem } from "./github-contents";
import type { JournalFileStatistics } from "./journal-statistics";
import { journalStatisticsView } from "./journal-statistics-view";

const path = "data/journal-entries/one.json";
const otherPath = "data/journal-entries/two.json";
const counts: JournalFileStatistics = { blobSha: "one-sha", date: "2026-10-03", entries: 3, words: 20, deleted: false };
const file: GitHubDirectoryItem = { type: "file", name: "one.json", path, blobSha: counts.blobSha, sizeBytes: 100 };
const initial = { catalog: [] as GitHubDirectoryItem[], catalogReady: false, loaded: {}, cache: {}, shared: null };

describe("journal statistics before and after directory verification", () => {
  it("shows the saved summary immediately before any directory or body is available", () => {
    const result = journalStatisticsView({ ...initial, shared: { [path]: counts } });
    expect(result.phase).toBe("snapshot");
    expect(result.totals).toEqual({ days: 1, entries: 3, words: 20 });
    expect(result.files).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it("does not present zero or unverified browser-cache totals when no summary is available", () => {
    for (const shared of [null, {}]) {
      const result = journalStatisticsView({ ...initial, cache: { [path]: counts }, shared });
      expect(result.phase).toBe("waiting");
      expect(result.totals).toBeNull();
    }
  });

  it("excludes deleted and unrelated records from the provisional snapshot", () => {
    const result = journalStatisticsView({ ...initial, shared: {
      [path]: counts,
      [otherPath]: { ...counts, date: "2026-10-02", deleted: true },
      "data/tasks/one.json": counts,
    } });
    expect(result.totals).toEqual({ days: 1, entries: 3, words: 20 });
  });

  it("overlays a saved entry on its older provisional summary without counting it twice", () => {
    const result = journalStatisticsView({ ...initial, shared: { [path]: counts }, loaded: {
      [path]: { ...counts, blobSha: "saved-sha", entries: 4, words: 30 },
    } });
    expect(result.phase).toBe("snapshot");
    expect(result.totals).toEqual({ days: 1, entries: 4, words: 30 });
  });

  it("shows verified complete counts from the directory and summary with no downloaded bodies", () => {
    const result = journalStatisticsView({ ...initial, catalogReady: true, catalog: [file], shared: { [path]: counts } });
    expect(result.phase).toBe("complete");
    expect(result.totals).toEqual({ days: 1, entries: 3, words: 20 });
    expect(result.missing).toEqual([]);
  });

  it("treats a verified empty directory as zero even when every cache still contains removed files", () => {
    const result = journalStatisticsView({ ...initial, catalogReady: true,
      shared: { [path]: counts }, loaded: { [path]: counts }, cache: { [path]: counts },
    });
    expect(result.phase).toBe("complete");
    expect(result.totals).toEqual({ days: 0, entries: 0, words: 0 });
    expect(result.files).toEqual([]);
  });

  it("rejects changed SHAs in the summary, browser cache, and still-visible old loaded entry", () => {
    const result = journalStatisticsView({ ...initial, catalogReady: true, catalog: [{ ...file, blobSha: "new-sha" }],
      shared: { [path]: counts }, cache: { [path]: counts }, loaded: { [path]: counts },
    });
    expect(result.phase).toBe("waiting");
    expect(result.totals).toBeNull();
    expect(result.missing.map((item) => item.path)).toEqual([path]);
  });

  it("uses the new loaded version matching the directory rather than stale summary counts", () => {
    const latest = { ...counts, blobSha: "new-sha", words: 25 };
    const result = journalStatisticsView({ ...initial, catalogReady: true, catalog: [{ ...file, blobSha: latest.blobSha }],
      shared: { [path]: counts }, cache: { [path]: counts }, loaded: { [path]: latest },
    });
    expect(result.phase).toBe("complete");
    expect(result.totals?.words).toBe(25);
  });

  it("keeps verified partial counts while reporting only the missing current files", () => {
    const result = journalStatisticsView({ ...initial, catalogReady: true, catalog: [file, { ...file, name: "two.json", path: otherPath, blobSha: "two-sha" }], shared: { [path]: counts } });
    expect(result.phase).toBe("partial");
    expect(result.totals).toEqual({ days: 1, entries: 3, words: 20 });
    expect(result.missing.map((item) => item.path)).toEqual([otherPath]);
  });
});
