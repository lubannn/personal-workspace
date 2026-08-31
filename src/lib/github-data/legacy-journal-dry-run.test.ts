import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { previewLegacyJournalDocx } from "./legacy-docx-preview";
import { buildLegacyJournalDryRun, type LegacyJournalDryRunManifest } from "./legacy-journal-dry-run";

const cleanDocumentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
  <w:p><w:r><w:t>2012年</w:t></w:r></w:p>
  <w:p><w:r><w:t>3月</w:t></w:r></w:p>
  <w:p><w:r><w:t>5日</w:t></w:r></w:p>
  <w:p><w:r><w:t>02:23</w:t></w:r></w:p>
  <w:p><w:r><w:t>不应进入 Import Log 的正文</w:t></w:r></w:p>
</w:body></w:document>`;

function docxFile(xml: string, extra: Record<string, Uint8Array> = {}) {
  const bytes = zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8(xml), ...extra }, { mtime: new Date("1980-01-01T00:00:00.000Z") });
  return { name: "sanitized.docx", size: bytes.byteLength, lastModified: 0, arrayBuffer: async () => bytes.slice().buffer };
}

describe("Legacy Journal deterministic dry run", () => {
  it("produces a deterministic ZIP, manifest and body-free Import Log for the same batch", async () => {
    const preview = await previewLegacyJournalDocx(docxFile(cleanDocumentXml), { timezone: "Asia/Shanghai" });
    const first = await buildLegacyJournalDryRun(preview, { generatedAt: "2026-08-31T10:00:00.000Z" });
    const second = await buildLegacyJournalDryRun(preview, { generatedAt: "2026-08-31T10:00:00.000Z" });
    const files = unzipSync(first.bytes);
    const manifest = JSON.parse(strFromU8(files["manifest.json"])) as LegacyJournalDryRunManifest;

    expect(first.sha256).toBe(second.sha256);
    expect(first.bytes).toEqual(second.bytes);
    expect(first.fileName).toMatch(/^legacy-journal-dry-run-[0-9a-f]{12}-[0-9a-f]{8}\.zip$/u);
    expect(manifest).toMatchObject({ manifest_version: 2, batch_identity: preview.batchIdentity, correction_set_sha256: expect.stringMatching(/^[0-9a-f]{64}$/u), generated_at: "2026-08-31T10:00:00.000Z", counts: { journal_files: 1, segments: 1, corrections: 0 }, commit_enabled: false });
    expect(manifest.entries[0]).toMatchObject({ staging_id: expect.stringContaining("2012-03-05"), target_journal_id: null, relative_output_path: "Journal/2012/2012-03-05.md", status: "pending", manual_edit: false });
    expect(manifest.entries[0].output_sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(strFromU8(files["staging/Journal/2012/2012-03-05.md"])).toContain("不应进入 Import Log 的正文");
    expect(strFromU8(files["import-log.md"])).not.toContain("不应进入 Import Log 的正文");
    expect(first.commitEnabled).toBe(false);
  });

  it("uses a stable audit timestamp when the caller does not supply one", async () => {
    const preview = await previewLegacyJournalDocx(docxFile(cleanDocumentXml), { timezone: "Asia/Shanghai" });
    const first = await buildLegacyJournalDryRun(preview);
    const second = await buildLegacyJournalDryRun(preview);

    expect(first.manifest.generated_at).toBe("1980-01-01T00:00:00.000Z");
    expect(first.sha256).toBe(second.sha256);
    expect(first.bytes).toEqual(second.bytes);
  });

  it("records the full correction chain while marking affected output as manually edited", async () => {
    const xml = cleanDocumentXml.replace("<w:p><w:r><w:t>2012年</w:t></w:r></w:p>", "<w:p><w:r><w:t>孤立正文</w:t></w:r></w:p><w:p><w:r><w:t>2012年</w:t></w:r></w:p>");
    const preview = await previewLegacyJournalDocx(docxFile(xml), {
      timezone: "Asia/Shanghai",
      corrections: [{ id: "assign-orphan", sourceLocator: "word/document.xml#p1", action: "assign-body", date: "2012-03-04", time: null, reason: "根据脱敏页码确认日期", recordedAt: "2026-08-31T10:00:00.000Z" }],
    });
    const dryRun = await buildLegacyJournalDryRun(preview, { generatedAt: "2026-08-31T10:02:00.000Z" });

    expect(dryRun.manifest.counts).toMatchObject({ journal_files: 2, corrections: 1 });
    expect(dryRun.manifest.corrections[0]).toMatchObject({ id: "assign-orphan", reason: "根据脱敏页码确认日期" });
    expect(dryRun.manifest.entries.find((entry) => entry.date === "2012-03-04")?.manual_edit).toBe(true);
    expect(dryRun.importLogMarkdown).toContain("assign-orphan");
    expect(dryRun.importLogMarkdown).not.toContain("孤立正文");
  });

  it("changes the dry run identity when the audited correction chain changes", async () => {
    const base = await previewLegacyJournalDocx(docxFile(cleanDocumentXml), { timezone: "Asia/Shanghai" });
    const corrected = await previewLegacyJournalDocx(docxFile(cleanDocumentXml), {
      timezone: "Asia/Shanghai",
      corrections: [{ id: "body-override", sourceLocator: "word/document.xml#p5", action: "set-body", reason: "显式确认是正文", recordedAt: "2026-08-31T10:00:00.000Z" }],
    });
    const first = await buildLegacyJournalDryRun(base, { generatedAt: "2026-08-31T10:02:00.000Z" });
    const second = await buildLegacyJournalDryRun(corrected, { generatedAt: "2026-08-31T10:02:00.000Z" });

    expect(first.dryRunId).not.toBe(second.dryRunId);
    expect(first.manifest.correction_set_sha256).not.toBe(second.manifest.correction_set_sha256);
    expect(first.fileName).not.toBe(second.fileName);
  });

  it("refuses dry run when archive diagnostics contain an unhandled object", async () => {
    const preview = await previewLegacyJournalDocx(docxFile(cleanDocumentXml, { "word/media/image1.png": new Uint8Array([1, 2, 3]) }), { timezone: "Asia/Shanghai" });
    await expect(buildLegacyJournalDryRun(preview, { generatedAt: "2026-08-31T10:00:00.000Z" })).rejects.toThrow("LEGACY_IMPORT_DRY_RUN_NOT_READY");
  });
});
