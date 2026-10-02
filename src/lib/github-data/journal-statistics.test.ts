import { describe, expect, it } from "vitest";
import { cachedJournalStatistics, collectJournalStatistics, journalFileStatistics, journalWordCount, parseJournalStatisticsCache, sumJournalStatistics } from "./journal-statistics";
import { createJournalEntryData, type JournalEntryRecord } from "./journal-entries";
import { createJournalSegmentSnapshot, renderJournalSegmentsMarkdown } from "./journal-segment-codec";
import { createWorkspaceRecord } from "./protocol";

function record(body: string): JournalEntryRecord {
  return createWorkspaceRecord({ entityType: "journal_entry", id: "journal_1", ownerId: "owner_1", timestamp: "2026-10-02T07:20:00Z", data: createJournalEntryData({ journalDate: "2026-10-02", timezone: "Asia/Shanghai", timestamp: "2026-10-02T07:20:00Z", bodyMarkdown: body }) });
}

describe("journal statistics", () => {
  it("counts punctuation but not spaces, line breaks, English letters, or Markdown formatting", () => {
    expect(journalWordCount("* 今天 happy birthday！")).toBe(5);
    expect(journalWordCount("## **你好** [hello world](https://example.com)\n1. don't re-read 123")).toBe(9);
    expect(journalWordCount("<!-- metadata --> 😀，。\n")).toBe(2);
    expect(journalWordCount("你好，world！\n\t ")).toBe(5);
    expect(journalWordCount(" 　\n\t")).toBe(0);
    expect(journalWordCount("Hello, world... (yes?)")).toBe(10);
  });
  it("counts each submitted entry once even when its body has multiple paragraphs", () => {
    const result = journalFileStatistics(record("今天\n\nhello world"), "sha");
    expect(result).toEqual({ blobSha: "sha", date: "2026-10-02", entries: 1, words: 4, deleted: false });
  });
  it("counts imported time segments separately, including repeated times, without counting internal markers", () => {
    const body = renderJournalSegmentsMarkdown("journal_1", [0, 1].map((sortOrder) => createJournalSegmentSnapshot({ id: `segment_${sortOrder}`, journalEntryId: "journal_1", localTime: "15:20", occurredAt: "2026-10-02T15:20:00+08:00", bodyMarkdown: "今天 hello", sortOrder })));
    expect(journalFileStatistics(record(body), "sha").entries).toBe(2);
    expect(journalFileStatistics(record(body), "sha").words).toBe(6);
  });
  it("counts unique days and excludes deleted entries", () => {
    const item = journalFileStatistics(record("今天"), "sha");
    expect(sumJournalStatistics([item, item, { ...item, deleted: true, date: "2026-10-01" }])).toEqual({ days: 1, entries: 2, words: 4 });
  });
  it("rejects corrupt count caches", () => {
    expect(parseJournalStatisticsCache(JSON.stringify({ path: journalFileStatistics(record("正文"), "sha") })).path.words).toBe(2);
    expect(() => parseJournalStatisticsCache('{"path":{"entries":-1}}')).toThrow();
  });
  it("reuses unchanged file counts and requests only added or changed files", () => {
    const item = journalFileStatistics(record("正文。"), "sha");
    const cache = { old: item };
    expect(cachedJournalStatistics(cache, "old", "sha")).toBe(item);
    expect(cachedJournalStatistics(cache, "old", "new-sha")).toBeUndefined();
    expect(cachedJournalStatistics(cache, "new", "sha")).toBeUndefined();
    expect(cachedJournalStatistics(parseJournalStatisticsCache(JSON.stringify(cache)), "old", "sha")).toEqual(item);
  });
  it("reads in parallel, saves every small batch and resumes only missing records after a failure", async () => {
    const files = Array.from({ length: 13 }, (_, index) => ({ path: `path_${index}`, blobSha: `sha_${index}` }));
    let concurrency = 0; let peak = 0; let checkpoints = 0;
    const read = async (path: string, blobSha: string) => {
      concurrency += 1; peak = Math.max(peak, concurrency);
      await Promise.resolve(); concurrency -= 1;
      if (path === "path_2") throw new Error("network failed");
      return { text: JSON.stringify(record("正文。")), blobSha };
    };
    const first = await collectJournalStatistics({ files, cache: {}, read, cancelled: () => false, checkpoint: () => { checkpoints += 1; } });
    expect(peak).toBe(6); expect(checkpoints).toBe(3);
    expect(first.failures).toBe(1); expect(Object.keys(first.cache)).toHaveLength(12);
    const requested: string[] = [];
    const resumed = await collectJournalStatistics({ files, cache: first.cache, read: async (path, blobSha) => { requested.push(path); return { text: JSON.stringify(record("正文。")), blobSha }; }, cancelled: () => false, checkpoint: () => {} });
    expect(requested).toEqual(["path_2"]); expect(Object.keys(resumed.cache)).toHaveLength(13);
  });
  it("keeps successful in-flight counts when the scan is paused", async () => {
    let paused = false;
    let saved = {};
    const result = await collectJournalStatistics({ files: Array.from({ length: 9 }, (_, index) => ({ path: `path_${index}`, blobSha: `sha_${index}` })), cache: {}, read: async (_path, blobSha) => { await Promise.resolve(); paused = true; return { text: JSON.stringify(record("正文。")), blobSha }; }, cancelled: () => paused, checkpoint: (cache) => { saved = cache; } });
    expect(Object.keys(result.cache)).toHaveLength(6); expect(Object.keys(saved)).toHaveLength(6);
  });
});
