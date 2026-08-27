import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord } from "./protocol";
import {
  buildPortableWorkspaceExport,
  inspectPortableWorkspaceExport,
  serializePortableWorkspaceExport,
} from "./portable-export";

const workspaceText = `${JSON.stringify({
  schema_version: 1,
  workspace_id: "personal-workspace",
  owner_id: "github_lubannn",
  owner_login: "lubannn",
  locale: "zh-CN",
  timezone: "Asia/Shanghai",
}, null, 2)}\n`;

function storedFile(path: string, text: string, blobSha: string) {
  return { path, text, blobSha, sizeBytes: new TextEncoder().encode(text).byteLength };
}

async function sampleExport() {
  const capture = createWorkspaceRecord({
    entityType: "capture",
    id: "capture_20260827010000000_abcd1234",
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T01:00:00.000Z",
    data: { raw_text: "可迁移的数据", status: "inbox" as const },
  });
  const captureText = serializeRecord(capture);
  return buildPortableWorkspaceExport({
    repository: "lubannn/personal-workspace-data",
    branch: "main",
    generatedAt: "2026-08-27T02:00:00.000Z",
    workspaceFile: storedFile("workspace.json", workspaceText, "workspace-blob"),
    captureFiles: [storedFile("data/captures/capture_20260827010000000_abcd1234.json", captureText, "capture-blob")],
  });
}

describe("portable GitHub workspace export", () => {
  it("builds a deterministic manifest and passes restore preflight", async () => {
    const exported = await sampleExport();
    expect(exported.manifest.counts).toEqual({ files: 2, captures: 1 });
    expect(exported.manifest.files.map((file) => file.path)).toEqual([
      "data/captures/capture_20260827010000000_abcd1234.json",
      "workspace.json",
    ]);
    expect(serializePortableWorkspaceExport(exported)).not.toContain("test-token");

    await expect(inspectPortableWorkspaceExport(exported)).resolves.toMatchObject({
      valid: true,
      repository: "lubannn/personal-workspace-data",
      counts: { files: 2, captures: 1 },
      errors: [],
      workspace: { owner_id: "github_lubannn" },
    });
  });

  it("detects modified content by size and SHA-256", async () => {
    const exported = await sampleExport();
    exported.files[0]!.content += "tampered";
    const inspection = await inspectPortableWorkspaceExport(exported);
    expect(inspection.valid).toBe(false);
    expect(inspection.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      "FILE_SIZE_MISMATCH",
      "FILE_HASH_MISMATCH",
    ]));
  });

  it("rejects owner and path mismatches even when hashes are rebuilt", async () => {
    const exported = await sampleExport();
    const capture = createWorkspaceRecord({
      entityType: "capture",
      id: "capture_different",
      ownerId: "another_owner",
      data: { raw_text: "错误所有者", status: "inbox" as const },
      timestamp: "2026-08-27T03:00:00.000Z",
    });
    const rebuilt = await buildPortableWorkspaceExport({
      repository: exported.source.repository,
      branch: exported.source.branch,
      generatedAt: exported.generated_at,
      workspaceFile: storedFile("workspace.json", workspaceText, "workspace-blob"),
      captureFiles: [storedFile("data/captures/wrong_path.json", serializeRecord(capture), "capture-blob")],
    });
    const inspection = await inspectPortableWorkspaceExport(rebuilt);
    expect(inspection.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      "OWNER_MISMATCH",
      "CAPTURE_PATH_MISMATCH",
    ]));
  });

  it("rejects unsupported versions and missing workspace descriptors", async () => {
    const exported = await sampleExport() as unknown as Record<string, unknown>;
    exported.export_version = 99;
    const files = exported.files as Array<{ path: string }>;
    exported.files = files.filter((file) => file.path !== "workspace.json");
    const inspection = await inspectPortableWorkspaceExport(exported);
    expect(inspection.valid).toBe(false);
    expect(inspection.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      "UNSUPPORTED_EXPORT_VERSION",
      "WORKSPACE_FILE_MISSING",
    ]));
  });
});
