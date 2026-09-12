import { describe, expect, it } from "vitest";

import { createObsidianExportManifest, obsidianExportManifestPath, parseObsidianExportManifest, serializeObsidianExportManifest, upsertObsidianExportManifestDocument } from "./obsidian-export-manifest";

const document = (date: string, suffix: string) => ({
  relative_path: `Personal Workspace/Journal/${date.slice(0, 4)}/${date}.md`,
  journal_entry_id: `journal_${suffix}`,
  source_revision_id: `revision_${suffix}`,
  source_record_version: 1,
  source_content_sha256: suffix.repeat(64).slice(0, 64),
  document_sha256: suffix.repeat(64).slice(0, 64),
  utf8_bytes: 512,
});

describe("recoverable Obsidian export manifest", () => {
  it("derives the manifest path from the same safe subdirectory", () => {
    expect(obsidianExportManifestPath("Personal Workspace")).toBe("Personal Workspace/personal-workspace-export-manifest.json");
    expect(() => obsidianExportManifestPath("../Private")).toThrow("INVALID_OBSIDIAN_SUBDIRECTORY");
  });

  it("sorts documents deterministically and round-trips without正文", () => {
    const manifest = createObsidianExportManifest({
      vaultMappingId: "onedrive_personal_vault",
      generatedAt: "2026-09-12T05:00:00.000Z",
      documents: [document("2026-09-12", "b"), document("2026-09-11", "a")],
    });
    expect(manifest.documents.map((item) => item.relative_path)).toEqual([
      "Personal Workspace/Journal/2026/2026-09-11.md",
      "Personal Workspace/Journal/2026/2026-09-12.md",
    ]);
    expect(parseObsidianExportManifest(serializeObsidianExportManifest(manifest))).toEqual(manifest);
    expect(JSON.stringify(manifest)).not.toContain("body_markdown");
  });

  it("rejects duplicate paths, duplicate Journal IDs, unsafe paths and unsorted input", () => {
    const a = document("2026-09-11", "a");
    const b = document("2026-09-12", "b");
    const valid = createObsidianExportManifest({ vaultMappingId: "onedrive_personal_vault", generatedAt: "2026-09-12T05:00:00.000Z", documents: [a, b] });
    expect(() => parseObsidianExportManifest(JSON.stringify({ ...valid, documents: [a, a] }))).toThrow("INVALID_OBSIDIAN_EXPORT_MANIFEST");
    expect(() => parseObsidianExportManifest(JSON.stringify({ ...valid, documents: [a, { ...b, journal_entry_id: a.journal_entry_id }] }))).toThrow("INVALID_OBSIDIAN_EXPORT_MANIFEST");
    expect(() => parseObsidianExportManifest(JSON.stringify({ ...valid, documents: [b, a] }))).toThrow("INVALID_OBSIDIAN_EXPORT_MANIFEST");
    expect(() => parseObsidianExportManifest(JSON.stringify({ ...valid, documents: [{ ...a, relative_path: "../private.md" }, b] }))).toThrow("INVALID_OBSIDIAN_EXPORT_MANIFEST");
  });

  it("upserts one document without taking over another entry or path", () => {
    const a = document("2026-09-11", "a");
    const b = document("2026-09-12", "b");
    const current = createObsidianExportManifest({ vaultMappingId: "onedrive_personal_vault", generatedAt: "2026-09-12T05:00:00.000Z", documents: [a, b] });
    const updated = upsertObsidianExportManifestDocument(current, { vaultMappingId: "onedrive_personal_vault", generatedAt: "2026-09-12T06:00:00.000Z", document: { ...a, source_record_version: 2, document_sha256: "c".repeat(64) } });
    expect(updated.documents).toHaveLength(2);
    expect(updated.documents.find((item) => item.journal_entry_id === a.journal_entry_id)).toMatchObject({ source_record_version: 2, document_sha256: "c".repeat(64) });
    expect(() => upsertObsidianExportManifestDocument(current, { vaultMappingId: "other_vault", generatedAt: "2026-09-12T06:00:00.000Z", document: a })).toThrow("OBSIDIAN_EXPORT_MANIFEST_MAPPING_MISMATCH");
    expect(() => upsertObsidianExportManifestDocument(current, { vaultMappingId: "onedrive_personal_vault", generatedAt: "2026-09-12T06:00:00.000Z", document: { ...a, journal_entry_id: "journal_other" } })).toThrow("OBSIDIAN_EXPORT_MANIFEST_PATH_CONFLICT");
    expect(() => upsertObsidianExportManifestDocument(current, { vaultMappingId: "onedrive_personal_vault", generatedAt: "2026-09-12T06:00:00.000Z", document: { ...a, relative_path: "Personal Workspace/Journal/2026/2026-09-13.md" } })).toThrow("OBSIDIAN_EXPORT_MANIFEST_ENTRY_CONFLICT");
  });
});
