import { describe, expect, it } from "vitest";
import { createJournalSegmentSnapshot, renderJournalSegmentsMarkdown } from "./journal-segment-codec";
import { journalDisplayPreview, journalDisplaySegments, journalDisplayTimeline, searchJournalDisplaySegments } from "./journal-display";
import { createJournalEntryData, journalEntrySubmittedTime } from "./journal-entries";
import { createWorkspaceRecord } from "./protocol";

function timelineEntry(id: string, date: string, timestamp: string, body = id) {
  const record = createWorkspaceRecord({ entityType: "journal_entry", id, ownerId: "owner_1", timestamp,
    data: createJournalEntryData({ journalDate: date, timezone: "Asia/Shanghai", timestamp, bodyMarkdown: body }) });
  return { record, segments: journalDisplaySegments(body, journalEntrySubmittedTime(record).slice(0, 5)) };
}

describe("journal displayed-time reading order", () => {
  it("places a next-day 09:21 backfill after the same day's 22:08 entry in descending displayed time", () => {
    const morning = timelineEntry("morning_backfill", "2026-10-27", "2026-10-28T01:21:00Z");
    const evening = timelineEntry("evening", "2026-10-27", "2026-10-27T14:08:00Z");
    expect(journalDisplayTimeline([evening, morning]).map((row) => [row.segment.time, row.entry.record.id]))
      .toEqual([["22:08", "evening"], ["09:21", "morning_backfill"]]);
  });
  it("interleaves imported segments and modern entries, while keeping newer dates first", () => {
    const importedBody = renderJournalSegmentsMarkdown("imported", [
      createJournalSegmentSnapshot({ id: "late", journalEntryId: "imported", localTime: "22:08", occurredAt: "2026-10-27T22:08:00+08:00", bodyMarkdown: "晚上", sortOrder: 0 }),
      createJournalSegmentSnapshot({ id: "early", journalEntryId: "imported", localTime: "07:00", occurredAt: "2026-10-27T07:00:00+08:00", bodyMarkdown: "清晨", sortOrder: 1 }),
    ]);
    const imported = timelineEntry("imported", "2026-10-27", "2026-10-28T09:00:00Z", importedBody);
    const backfill = timelineEntry("backfill", "2026-10-27", "2026-10-28T01:21:00Z");
    const today = timelineEntry("today", "2026-10-28", "2026-10-28T00:00:00Z");
    const entries = [imported, today, backfill];
    const snapshot = JSON.stringify(entries);
    const rows = journalDisplayTimeline(entries);
    expect(rows.map((row) => [row.entry.record.data.journal_date, row.segment.time, row.segment.body]))
      .toEqual([["2026-10-28", "08:00", "today"], ["2026-10-27", "22:08", "晚上"], ["2026-10-27", "09:21", "backfill"], ["2026-10-27", "07:00", "清晨"]]);
    expect(rows[1].entry).toBe(imported);
    expect(rows[1].segmentIndex).toBe(0);
    expect(JSON.stringify(entries)).toBe(snapshot);
  });
  it("keeps duplicate displayed minutes and deterministically orders them without merging", () => {
    const early = timelineEntry("early", "2026-10-27", "2026-10-27T01:21:02Z");
    const later = timelineEntry("later", "2026-10-27", "2026-10-28T01:21:00Z");
    const sameInstant = timelineEntry("aaa", "2026-10-27", "2026-10-27T01:21:02Z");
    const rows = journalDisplayTimeline([later, early, sameInstant]);
    expect(rows.map((row) => row.entry.record.id)).toEqual(["aaa", "early", "later"]);
    expect(rows.every((row) => row.segment.time === "09:21")).toBe(true);
    expect(journalDisplayTimeline([sameInstant, later, early])).toEqual(rows);
  });
  it("does not invent times for untimed imports and retains all repeated-time segments", () => {
    const entry = timelineEntry("imported", "2026-10-27", "2026-10-28T01:21:00Z");
    entry.segments = [{ time: null, body: "未记时间" }, { time: "15:20", body: "第二段" }, { time: "00:00", body: "午夜" }, { time: "15:20", body: "第三段" }];
    expect(journalDisplayTimeline([entry]).map((row) => row.segment.body)).toEqual(["第二段", "第三段", "午夜", "未记时间"]);
  });
  it("sorts only the matching search results and does not bring back other segments", () => {
    const entry = timelineEntry("entry", "2026-10-27", "2026-10-28T01:21:00Z");
    entry.segments = [{ time: "22:08", body: "搜索命中" }, { time: "07:00", body: "清晨也搜索命中" }];
    expect(journalDisplayTimeline([entry]).map((row) => row.segment.time)).toEqual(["22:08", "07:00"]);
    expect(journalDisplayTimeline([])).toEqual([]);
  });
});

describe("journal reading display", () => {
  it("searches each imported time entry independently, not the entire day", () => {
    const body = renderJournalSegmentsMarkdown("journal_1", [
      createJournalSegmentSnapshot({ id: "segment_1", journalEntryId: "journal_1", localTime: "09:55", occurredAt: "2026-08-12T09:55:00+08:00", bodyMarkdown: "今天去游泳。", sortOrder: 0 }),
      createJournalSegmentSnapshot({ id: "segment_2", journalEntryId: "journal_1", localTime: "12:20", occurredAt: "2026-08-12T12:20:00+08:00", bodyMarkdown: "中午吃饭。", sortOrder: 1 }),
    ]);
    expect(searchJournalDisplaySegments(body, "游泳")).toEqual([{ time: "09:55", body: "今天去游泳。" }]);
    expect(searchJournalDisplaySegments(body, "游泳 吃饭")).toEqual([]);
    expect(searchJournalDisplaySegments(body, "pw-journal")).toEqual([]);
    expect(searchJournalDisplaySegments(body, "2026-08-12")).toEqual([]);
    expect(searchJournalDisplaySegments(body, "   ")).toEqual(journalDisplaySegments(body));
  });
  it("keeps a matching new submission intact and normalizes case and full-width text", () => {
    expect(searchJournalDisplaySegments("Hello，WORLD！\n另一段正文。", " ｈｅｌｌｏ world ", "15:20")).toEqual([{ time: "15:20", body: "Hello，WORLD！\n另一段正文。" }]);
    expect(searchJournalDisplaySegments("普通正文", "没有出现的内容", "15:20")).toEqual([]);
  });
  it("shows imported diary segments as time and prose without metadata markers", () => {
    const body = renderJournalSegmentsMarkdown("journal_1", [createJournalSegmentSnapshot({ id: "segment_1", journalEntryId: "journal_1", localTime: "09:55", occurredAt: "2026-08-12T09:55:00+08:00", bodyMarkdown: "今天的正文。", sortOrder: 0 })]);
    expect(journalDisplaySegments(body)).toEqual([{ time: "09:55", body: "今天的正文。" }]);
    expect(journalDisplayPreview(body)).toBe("今天的正文。");
    expect(journalDisplayPreview(body)).not.toContain("pw-journal");
  });

  it("keeps modern diary prose unchanged and hides malformed internal markers", () => {
    expect(journalDisplaySegments("普通正文")).toEqual([{ time: null, body: "普通正文" }]);
    expect(journalDisplaySegments("<!-- pw-journal-segments:v1:bad -->")[0]?.body).not.toContain("pw-journal");
  });

  it("places a new diary's submission time beside its unchanged body", () => {
    expect(journalDisplaySegments("* 今天的日记。\n第二行。", "15:20")).toEqual([{ time: "15:20", body: "* 今天的日记。\n第二行。" }]);
  });

  it("does not replace imported times or invent times for untimed imported segments", () => {
    const body = renderJournalSegmentsMarkdown("journal_1", [
      createJournalSegmentSnapshot({ id: "segment_1", journalEntryId: "journal_1", localTime: "09:55", occurredAt: "2026-08-12T09:55:00+08:00", bodyMarkdown: "第一段。", sortOrder: 0 }),
      createJournalSegmentSnapshot({ id: "segment_2", journalEntryId: "journal_1", localTime: null, occurredAt: null, bodyMarkdown: "没有时间的段落。", sortOrder: 1 }),
    ]);
    expect(journalDisplaySegments(body, "15:20")).toEqual([{ time: "09:55", body: "第一段。" }, { time: null, body: "没有时间的段落。" }]);
  });
});
