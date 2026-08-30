import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord } from "./protocol";
import {
  createProjectFileReferenceData,
  parseProjectFileReferenceRecord,
  projectFileReferences,
  updateProjectFileReference,
} from "./project-file-references";

const baseFields = {
  title: "产品需求文档",
  source_url: "https://example.com/files/spec.pdf",
  original_filename: "spec.pdf",
  mime_type: "application/pdf",
  size_bytes: 2048,
  sha256: "a".repeat(64),
  purpose: "需求基线",
  sort_order: 1,
};

describe("project file references", () => {
  it("creates and parses independently versioned metadata", () => {
    const record = createWorkspaceRecord({
      entityType: "project_file_reference",
      id: "project_file_1",
      ownerId: "owner_1",
      timestamp: "2026-08-30T01:00:00.000Z",
      data: createProjectFileReferenceData("project_1", baseFields),
    });
    expect(parseProjectFileReferenceRecord(serializeRecord(record))).toEqual(record);
  });

  it("requires a safe HTTPS URL and valid optional metadata", () => {
    expect(() => createProjectFileReferenceData("project_1", { ...baseFields, source_url: "http://example.com/a" })).toThrow("INVALID_PROJECT_FILE_REFERENCE_DETAILS");
    expect(() => createProjectFileReferenceData("project_1", { ...baseFields, source_url: "https://user:pass@example.com/a" })).toThrow("INVALID_PROJECT_FILE_REFERENCE_DETAILS");
    expect(() => createProjectFileReferenceData("project_1", { ...baseFields, sha256: "nope" })).toThrow("INVALID_PROJECT_FILE_REFERENCE_DETAILS");
    expect(() => createProjectFileReferenceData("bad id", baseFields)).toThrow("INVALID_PROJECT_FILE_REFERENCE_DETAILS");
  });

  it("updates with a version bump and sorts active references deterministically", () => {
    const first = createWorkspaceRecord({ entityType: "project_file_reference", id: "ref_1", ownerId: "owner_1", data: createProjectFileReferenceData("project_1", baseFields), timestamp: "2026-08-30T01:00:00.000Z" });
    const second = createWorkspaceRecord({ entityType: "project_file_reference", id: "ref_2", ownerId: "owner_1", data: createProjectFileReferenceData("project_1", { ...baseFields, title: "设计稿", sort_order: 0 }), timestamp: "2026-08-30T01:00:00.000Z" });
    const updated = updateProjectFileReference(first, { ...baseFields, title: "需求文档 v2" }, "2026-08-30T02:00:00.000Z");
    expect(updated.version).toBe(2);
    expect(updated.data.title).toBe("需求文档 v2");
    expect(projectFileReferences("project_1", [updated, second]).map((record) => record.id)).toEqual(["ref_2", "ref_1"]);
  });
});
