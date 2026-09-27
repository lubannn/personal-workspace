import { describe, expect, it } from "vitest";

import { previewLegacyJournalText } from "./legacy-text-preview";

function textFile(text: string, name = "Dairy.txt") {
  const bytes = new TextEncoder().encode(text.replace(/\n/gu, "\r\n"));
  return { name, size: bytes.byteLength, lastModified: Date.UTC(2026, 8, 27), arrayBuffer: async () => bytes.slice().buffer };
}

describe("read-only Legacy TXT preview", () => {
  it("parses complete monthly exports while excluding calendar indexes", async () => {
    const preview = await previewLegacyJournalText(textFile([
      "首页 我的主页 此刻写日记 设置 退出",
      "2026年07月的日记",
      "七", "01", "08:39", "* 正文提到 3:00 起床，但不是标题。", "09:38", "第二条。",
      "七", "02", "01:15", "次日正文。",
      "< 07月 ><< 2026 >>", "一\t二\t三\t四\t五\t六\t日", "1", "2", "© export",
      "2026年08月的日记",
      "八", "31", "22:03", "八月正文。",
      "< 08月 ><< 2026 >>", "一\t二\t三\t四\t五\t六\t日", "31", "© export",
    ].join("\n")), { timezone: "Asia/Shanghai" });

    expect(preview.source).toMatchObject({ fileName: "Dairy.txt", format: "txt" });
    expect(preview.parse.summary).toMatchObject({ dateCount: 3, segmentCount: 4, errors: 0, blocking: 0 });
    expect(preview.parse.entries.map((entry) => entry.date)).toEqual(["2026-07-01", "2026-07-02", "2026-08-31"]);
    expect(preview.parse.entries[0]!.segments[0]!.bodyMarkdown).toContain("3:00 起床");
    expect(preview.parse.entries.flatMap((entry) => entry.segments).some((segment) => segment.bodyMarkdown.includes("© export"))).toBe(false);
    expect(preview.parse.dryRunReady).toBe(true);
  });

  it("blocks duplicate or missing month sections", async () => {
    const preview = await previewLegacyJournalText(textFile([
      "2026年04月的日记", "< 04月 ><< 2026 >>",
      "2026年04月的日记", "< 04月 ><< 2026 >>",
      "2026年06月的日记", "< 06月 ><< 2026 >>",
    ].join("\n")), { timezone: "Asia/Shanghai" });

    expect(preview.parse.diagnostics.map((issue) => issue.code)).toEqual(expect.arrayContaining(["TEXT_MONTH_DUPLICATE_OR_RETREAT", "TEXT_MONTH_SEQUENCE_GAP"]));
    expect(preview.parse.dryRunReady).toBe(false);
  });

  it("accepts known empty-month banners without treating them as diary content", async () => {
    const preview = await previewLegacyJournalText(textFile([
      "2026年07月的日记", "这个月没有日记哦～", "< 07月 ><< 2026 >>",
      "2026年08月的日记", "八", "31", "22:03", "八月正文。", "< 08月 ><< 2026 >>",
    ].join("\n")), { timezone: "Asia/Shanghai" });

    expect(preview.parse.entries.map((entry) => entry.date)).toEqual(["2026-08-31"]);
    expect(preview.parse.diagnostics).not.toContainEqual(expect.objectContaining({ code: "TEXT_CONTENT_OUTSIDE_DAY" }));
    expect(preview.parse.summary.errors).toBe(0);
    expect(preview.parse.dryRunReady).toBe(true);
  });

  it("preserves exact duplicate entries but reports them", async () => {
    const preview = await previewLegacyJournalText(textFile([
      "2026年07月的日记", "七", "01", "08:39", "相同正文", "08:39", "相同正文", "< 07月 ><< 2026 >>",
    ].join("\n")), { timezone: "Asia/Shanghai" });

    expect(preview.parse.entries[0]!.segments).toHaveLength(2);
    expect(preview.parse.diagnostics).toContainEqual(expect.objectContaining({
      code: "TEXT_EXACT_DUPLICATE_ENTRIES_PRESERVED",
      severity: "warning",
      duplicateGroups: [{
        date: "2026-07-01",
        time: "08:39",
        bodyMarkdown: "相同正文",
        occurrences: [{ sourceLocators: ["text#line4", "text#line5"] }, { sourceLocators: ["text#line6", "text#line7"] }],
      }],
    }));
    expect(preview.parse.dryRunReady).toBe(true);
  });
});
