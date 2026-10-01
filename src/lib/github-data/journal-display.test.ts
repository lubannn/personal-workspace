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
});
