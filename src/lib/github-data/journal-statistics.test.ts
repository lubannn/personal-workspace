import { describe, expect, it } from "vitest";
import { cachedJournalStatistics, journalFileStatistics, journalWordCount, parseJournalStatisticsCache, sumJournalStatistics } from "./journal-statistics";
import { createJournalEntryData, type JournalEntryRecord } from "./journal-entries";
import { createJournalSegmentSnapshot, renderJournalSegmentsMarkdown } from "./journal-segment-codec";

function record(body: string): JournalEntryRecord {
  return { id: "journal_1", deleted_at: null, data: createJournalEntryData({ journalDate: "2026-10-02", timezone: "Asia/Shanghai", timestamp: "2026-10-02T07:20:00Z", bodyMarkdown: body }) } as JournalEntryRecord;
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
});
