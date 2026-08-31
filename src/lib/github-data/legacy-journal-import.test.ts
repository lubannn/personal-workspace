import { describe, expect, it } from "vitest";

import { classifyLegacyWordParagraph, parseLegacyJournalParagraphs, type LegacyWordParagraph } from "./legacy-journal-import";

function paragraph(index: number, text: string, extra: Partial<LegacyWordParagraph> = {}): LegacyWordParagraph {
  return { sourceLocator: `fixture#p${index}`, text, ...extra };
}

describe("Legacy Journal structural preview", () => {
  it("preserves source order while grouping Chinese date and time headings into daily Markdown", () => {
    const preview = parseLegacyJournalParagraphs([
      paragraph(1, "二〇一二年", { styleName: "Heading 1" }),
      paragraph(2, "三月", { styleName: "Heading 2" }),
      paragraph(3, "5日", { bold: true }),
      paragraph(4, "02：23"),
      paragraph(5, "第一段原文。"),
      paragraph(6, ""),
      paragraph(7, "第二段原文 & 符号保持。"),
      paragraph(8, "下午 4:24"),
      paragraph(9, "同日第二个时间片段。"),
      paragraph(10, "6号"),
      paragraph(11, "没有记录时间的正文。"),
    ], { timezone: "Asia/Shanghai", sourceSha256: "a".repeat(64), minimumYear: 2000, maximumYear: 2020 });

    expect(preview.summary).toMatchObject({ dateCount: 2, segmentCount: 3, coveragePercent: 100, errors: 0, blocking: 0 });
    expect(preview.summary.yearRange).toEqual([2012, 2012]);
    expect(preview.entries[0].date).toBe("2012-03-05");
    expect(preview.entries[0].segments.map((segment) => segment.time)).toEqual(["02:23", "16:24"]);
    expect(preview.entries[0].segments[0].bodyMarkdown).toBe("第一段原文。\n\n第二段原文 & 符号保持。");
    expect(preview.entries[0].inheritedContext).toEqual(["年份 2012 来自上文标题", "月份 3 来自上文标题"]);
    expect(preview.entries[0].markdown).toContain("import_batch_identity: \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:legacy-journal-preview-v1:zh-daily-headings-v1\"");
    expect(preview.entries[0].markdown).toContain("## 16:24\n\n同日第二个时间片段。");
    expect(preview.entries[1].segments[0]).toMatchObject({ time: null, bodyMarkdown: "没有记录时间的正文。" });
    expect(preview.dryRunReady).toBe(true);
    expect(preview.commitEnabled).toBe(false);
  });

  it("reports invalid dates, orphan body, unsupported objects and date retreats without dropping source content", () => {
    const preview = parseLegacyJournalParagraphs([
      paragraph(1, "没有日期的正文"),
      paragraph(2, "2012年", { styleName: "Heading 1" }),
      paragraph(3, "2月", { styleName: "Heading 2" }),
      paragraph(4, "30日"),
      paragraph(5, "5日"),
      paragraph(6, "正文 A"),
      paragraph(7, "4日"),
      paragraph(8, "正文 B"),
      paragraph(9, "表格里的内容", { unsupportedObjects: ["table"] }),
    ], { timezone: "Asia/Shanghai" });

    expect(preview.orphanBlocks.map((block) => block.text)).toContain("没有日期的正文");
    expect(preview.orphanBlocks.map((block) => block.text)).toContain("30日");
    expect(preview.unsupportedBlocks).toEqual([{ sourceLocator: "fixture#p9", text: "表格里的内容", objectTypes: ["table"] }]);
    expect(preview.diagnostics.map((issue) => issue.code)).toEqual(expect.arrayContaining(["ORPHAN_BODY", "AMBIGUOUS_STRUCTURE", "DATE_ORDER_RETREAT", "UNSUPPORTED_WORD_OBJECT"]));
    expect(preview.summary).toMatchObject({ coveragePercent: 100, errors: 3, warnings: 1, unsupportedObjects: 1 });
    expect(preview.dryRunReady).toBe(false);
  });

  it("rejects 24:00 and only treats bare numbers as low-confidence months with heading evidence", () => {
    expect(classifyLegacyWordParagraph(paragraph(1, "24:00"), { currentYear: 2012, currentMonth: 3 }).kind).toBe("AMBIGUOUS");
    expect(classifyLegacyWordParagraph(paragraph(2, "4", { styleName: "Heading 2" }), { currentYear: 2012, currentMonth: null })).toMatchObject({ kind: "MONTH_HEADING", confidence: "low", parsed: { month: 4 } });
    expect(classifyLegacyWordParagraph(paragraph(3, "4"), { currentYear: 2012, currentMonth: null }).kind).toBe("BODY");
  });

  it("does not attach body after an invalid structural heading to the previous day", () => {
    const preview = parseLegacyJournalParagraphs([
      paragraph(1, "2012年"),
      paragraph(2, "3月"),
      paragraph(3, "5日"),
      paragraph(4, "原本属于五日"),
      paragraph(5, "24:00"),
      paragraph(6, "时间归属不确定，必须成为 orphan"),
      paragraph(7, "6日"),
      paragraph(8, "六日正文"),
    ], { timezone: "Asia/Shanghai" });

    expect(preview.entries[0].segments[0].bodyMarkdown).toBe("原本属于五日");
    expect(preview.orphanBlocks.map((block) => block.text)).toContain("24:00\n时间归属不确定，必须成为 orphan");
    expect(preview.entries[1].segments[0].bodyMarkdown).toBe("六日正文");
  });
});
