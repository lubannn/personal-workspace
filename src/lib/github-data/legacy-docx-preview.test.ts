import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { extractLegacyWordParagraphs, previewLegacyJournalDocx } from "./legacy-docx-preview";

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/><w:outlineLvl w:val="0"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>2012年</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>3月</w:t></w:r></w:p>
  <w:p><w:r><w:t>5日</w:t></w:r></w:p>
  <w:p><w:r><w:t>02:23</w:t></w:r></w:p>
  <w:p><w:r><w:t xml:space="preserve">正文 &amp; </w:t><w:tab/><w:t>保留</w:t><w:br/><w:t>换行</w:t></w:r></w:p>
  <w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格内容</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
</w:body></w:document>`;

describe("read-only Legacy DOCX preview", () => {
  it("extracts sanitized OOXML paragraphs with style hints and unsupported containers", () => {
    const paragraphs = extractLegacyWordParagraphs(documentXml);
    expect(paragraphs).toHaveLength(6);
    expect(paragraphs[0]).toMatchObject({ text: "2012年", styleName: "Heading1", outlineLevel: 0, bold: true, fontSizePt: 16 });
    expect(paragraphs[4].text).toBe("正文 & \t保留\n换行");
    expect(paragraphs[5]).toMatchObject({ text: "表格内容", unsupportedObjects: ["table"] });
  });

  it("fingerprints and previews only the document XML while reporting skipped media", async () => {
    const bytes = zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "word/document.xml": strToU8(documentXml),
      "word/media/image1.png": new Uint8Array([1, 2, 3]),
    });
    const file = {
      name: "sanitized-journal.docx",
      size: bytes.byteLength,
      lastModified: Date.UTC(2026, 7, 24),
      arrayBuffer: async () => bytes.slice().buffer,
    };
    const preview = await previewLegacyJournalDocx(file, { timezone: "Asia/Shanghai", minimumYear: 2000, maximumYear: 2020 });

    expect(preview.source).toMatchObject({ fileName: "sanitized-journal.docx", byteSize: bytes.byteLength, lastModified: "2026-08-24T00:00:00.000Z" });
    expect(preview.source.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(preview.batchIdentity).toContain(preview.source.sha256);
    expect(preview.archiveEntryCount).toBe(3);
    expect(preview.archiveDiagnostics).toEqual([expect.objectContaining({ code: "DOCX_MEDIA_PRESENT", severity: "error" })]);
    expect(preview.parse.entries[0]).toMatchObject({ date: "2012-03-05", outputPath: "Journal/2012/2012-03-05.md" });
    expect(preview.parse.unsupportedBlocks[0]).toMatchObject({ text: "表格内容", objectTypes: ["table"] });
    expect(preview.localOnly).toBe(true);
    expect(preview.sourceModified).toBe(false);
    expect(preview.commitEnabled).toBe(false);
  });

  it("rejects non-DOCX input before parsing", async () => {
    await expect(previewLegacyJournalDocx({ name: "legacy.doc", size: 1, lastModified: 0, arrayBuffer: async () => new Uint8Array([0]).buffer }, { timezone: "Asia/Shanghai" }))
      .rejects.toThrow("LEGACY_IMPORT_DOCX_REQUIRED");
  });
});
