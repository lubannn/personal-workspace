import { describe, expect, it } from "vitest";
import { createJournalSegmentSnapshot, renderJournalSegmentsMarkdown } from "./journal-segment-codec";
import { journalDisplayPreview, journalDisplaySegments } from "./journal-display";

describe("journal reading display", () => {
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
