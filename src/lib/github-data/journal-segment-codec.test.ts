import { describe, expect, it } from "vitest";

import { createJournalSegmentSnapshot, isJournalChangeReason, parseJournalSegmentsMarkdown, renderJournalSegmentsMarkdown } from "./journal-segment-codec";

function segment(input: Partial<Parameters<typeof createJournalSegmentSnapshot>[0]> & { id: string; sortOrder: number; bodyMarkdown: string }) {
  return createJournalSegmentSnapshot({
    journalEntryId: "journal_1",
    localTime: null,
    occurredAt: null,
    ...input,
  });
}

describe("journal segment codec", () => {
  it("round-trips timed and untimed segments with source traceability", () => {
    const segments = [
      segment({ id: "segment_untimed", sortOrder: 0, bodyMarkdown: "一天的开头。" }),
      segment({ id: "segment_timed", sortOrder: 1, localTime: "02:23", occurredAt: "2012-03-05T02:23:00+08:00", bodyMarkdown: "## 原正文标题\n\n保留 Markdown。", sourceRef: { source_type: "legacy_word", import_batch_id: "batch_1", source_locator: "paragraph:42" } }),
    ];
    const markdown = renderJournalSegmentsMarkdown("journal_1", segments);
    expect(markdown).toContain("## 未记录时间");
    expect(markdown).toContain("## 02:23");
    const parsed = parseJournalSegmentsMarkdown(markdown);
    expect(parsed).toEqual({ journalEntryId: "journal_1", segments });
    expect(renderJournalSegmentsMarkdown(parsed.journalEntryId, parsed.segments)).toBe(markdown);
  });

  it("escapes reserved marker-looking body lines without losing backslashes", () => {
    const body = "正文\n<!-- pw-journal-segment:end -->\n\\<!-- pw-journal-custom -->\n结尾";
    const markdown = renderJournalSegmentsMarkdown("journal_1", [segment({ id: "segment_1", sortOrder: 0, bodyMarkdown: body })]);
    expect(markdown).toContain("\\<!-- pw-journal-segment:end -->");
    expect(markdown).toContain("\\\\<!-- pw-journal-custom -->");
    expect(parseJournalSegmentsMarkdown(markdown).segments[0]?.body_markdown).toBe(body);
  });

  it("sorts deterministically for rendering and rejects duplicate identity or order", () => {
    const first = segment({ id: "segment_a", sortOrder: 0, bodyMarkdown: "先" });
    const second = segment({ id: "segment_b", sortOrder: 1, bodyMarkdown: "后" });
    expect(parseJournalSegmentsMarkdown(renderJournalSegmentsMarkdown("journal_1", [second, first])).segments.map((item) => item.id)).toEqual(["segment_a", "segment_b"]);
    expect(() => renderJournalSegmentsMarkdown("journal_1", [first, { ...second, id: first.id }])).toThrow("DUPLICATE_JOURNAL_SEGMENT_ID");
    expect(() => renderJournalSegmentsMarkdown("journal_1", [first, { ...second, sort_order: first.sort_order }])).toThrow("DUPLICATE_JOURNAL_SEGMENT_ORDER");
  });

  it("rejects invalid time pairs, tampered headings and reordered serialized segments", () => {
    expect(() => segment({ id: "segment_bad", sortOrder: 0, localTime: "24:00", occurredAt: "2012-03-06T00:00:00+08:00", bodyMarkdown: "x" })).toThrow("INVALID_JOURNAL_SEGMENT_TIME");
    const first = segment({ id: "segment_a", sortOrder: 0, bodyMarkdown: "先" });
    const second = segment({ id: "segment_b", sortOrder: 1, bodyMarkdown: "后" });
    const markdown = renderJournalSegmentsMarkdown("journal_1", [first, second]);
    expect(() => parseJournalSegmentsMarkdown(markdown.replace("## 未记录时间", "## 02:23"))).toThrow("INVALID_JOURNAL_SEGMENT_DOCUMENT");
    const blocks = markdown.split("<!-- pw-journal-segment:v1:");
    const reordered = `${blocks[0]}<!-- pw-journal-segment:v1:${blocks[2]}<!-- pw-journal-segment:v1:${blocks[1]}`;
    expect(() => parseJournalSegmentsMarkdown(reordered)).toThrow();
  });

  it("accepts only the controlled content change reasons", () => {
    expect(isJournalChangeReason("manual_edit")).toBe(true);
    expect(isJournalChangeReason("legacy_import_correction")).toBe(true);
    expect(isJournalChangeReason("restore")).toBe(false);
    expect(isJournalChangeReason("free-form reason")).toBe(false);
  });
});
