import { describe, expect, it } from "vitest";

import { buildPortableWorkspaceExport } from "./portable-export";
import { createPortableRestorePlan, type PortableRestoreTarget } from "./portable-restore";
import { createWorkspaceRecord, serializeRecord } from "./protocol";

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
    id: "capture_restore_test",
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T10:00:00.000Z",
    data: { raw_text: "恢复演练", status: "inbox" as const },
  });
  return buildPortableWorkspaceExport({
    repository: "lubannn/personal-workspace-data",
    branch: "main",
    generatedAt: "2026-08-27T11:00:00.000Z",
    workspaceFile: storedFile("workspace.json", workspaceText, "workspace-blob"),
    captureFiles: [storedFile("data/captures/capture_restore_test.json", serializeRecord(capture), "capture-blob")],
  });
}

function target(overrides: Partial<PortableRestoreTarget> = {}): PortableRestoreTarget {
  return {
    repository: {
      fullName: "lubannn/personal-workspace-restore-test",
      private: true,
      visibility: "private",
      defaultBranch: "main",
    },
    branch: { branch: "main", headCommitSha: "head-one", rootTreeSha: "tree-one" },
    rootEntries: [{ type: "file", name: "README.md", path: "README.md", blobSha: "readme", sizeBytes: 10 }],
    ...overrides,
  };
}

describe("portable restore planning", () => {
  it("builds a create-only atomic plan for an initialized data-empty private repository", async () => {
    const plan = await createPortableRestorePlan(await sampleExport(), target());
    expect(plan).toMatchObject({
      ready: true,
      sourceRepository: "lubannn/personal-workspace-data",
      targetRepository: "lubannn/personal-workspace-restore-test",
      branch: "main",
      expectedHeadCommitSha: "head-one",
      baseTreeSha: "tree-one",
      counts: { files: 2, captures: 1 },
      errors: [],
    });
    expect(plan.files.map((file) => file.path)).toEqual([
      "data/captures/capture_restore_test.json",
      "workspace.json",
    ]);
    expect(plan.warnings.map((warning) => warning.code)).toContain("RESTORE_TARGET_NON_DATA_FILES_PRESERVED");
  });

  it("rejects the source repository and targets that already contain workspace data", async () => {
    const exported = await sampleExport();
    const plan = await createPortableRestorePlan(exported, target({
      repository: {
        fullName: "lubannn/personal-workspace-data",
        private: true,
        visibility: "private",
        defaultBranch: "main",
      },
      rootEntries: [
        { type: "file", name: "workspace.json", path: "workspace.json", blobSha: "existing", sizeBytes: 100 },
        { type: "directory", name: "data", path: "data", blobSha: "data-tree", sizeBytes: 0 },
      ],
    }));

    expect(plan.ready).toBe(false);
    expect(plan.files).toHaveLength(2);
    expect(plan.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      "RESTORE_TARGET_IS_SOURCE",
      "RESTORE_TARGET_HAS_WORKSPACE_DATA",
    ]));
  });

  it("rejects invalid exports, public targets, owner mismatches and non-default branches", async () => {
    const exported = await sampleExport() as unknown as Record<string, unknown>;
    exported.export_version = 99;
    const plan = await createPortableRestorePlan(exported, target({
      repository: {
        fullName: "someone-else/restore-test",
        private: false,
        visibility: "public",
        defaultBranch: "main",
      },
      branch: { branch: "restore", headCommitSha: "head-one", rootTreeSha: "tree-one" },
      rootEntries: [],
    }));

    expect(plan.ready).toBe(false);
    expect(plan.files).toEqual([]);
    expect(plan.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      "UNSUPPORTED_EXPORT_VERSION",
      "RESTORE_TARGET_NOT_PRIVATE",
      "RESTORE_TARGET_OWNER_MISMATCH",
      "RESTORE_BRANCH_MISMATCH",
    ]));
  });
});
