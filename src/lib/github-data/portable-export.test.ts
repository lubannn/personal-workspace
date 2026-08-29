import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord } from "./protocol";
import { createDefaultDashboardLayout, serializeDashboardLayout } from "./dashboard-layout";
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
  const taskText = serializeRecord(createWorkspaceRecord({
    entityType: "task",
    id: "task_20260827013000000_abcd1234",
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T01:30:00.000Z",
    data: {
      title: "测试开放任务",
      category: "work",
      project_id: null,
      parent_task_id: null,
      status: "todo",
      priority: "medium",
      planned_start_at: null,
      planned_end_at: null,
      due_at: "2026-08-27",
      due_timezone: "Asia/Shanghai",
      is_due_date_only: true,
      estimated_duration_minutes: null,
      actual_duration_minutes: null,
      tags: [],
      notes_markdown: "",
      completed_at: null,
      cancelled_at: null,
    },
  }));
  const dashboardText = serializeDashboardLayout(createDefaultDashboardLayout(
    "github_lubannn",
    "2026-08-27T01:30:00.000Z",
  ));
  const projectText = serializeRecord(createWorkspaceRecord({
    entityType: "project",
    id: "project_20260827014500000_abcd1234",
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T01:45:00.000Z",
    data: {
      name: "开放项目",
      description_markdown: "",
      status: "active",
      current_phase_id: null,
      start_date: null,
      target_date: "2026-09-30",
      completed_at: null,
      progress_mode: "tasks",
      manual_progress_percent: null,
      visibility_classification: "confidential",
    },
  }));
  const projectPhaseText = serializeRecord(createWorkspaceRecord({
    entityType: "project_phase",
    id: "phase_20260827015000000_abcd1234",
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T01:50:00.000Z",
    data: {
      project_id: "project_20260827014500000_abcd1234",
      name: "开发与验收",
      description: "",
      sort_order: 10,
      started_at: "2026-08-27T01:50:00.000Z",
      completed_at: null,
      status: "active",
    },
  }));
  const milestoneText = serializeRecord(createWorkspaceRecord({
    entityType: "milestone",
    id: "milestone_20260827015500000_abcd1234",
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T01:55:00.000Z",
    data: {
      project_id: "project_20260827014500000_abcd1234",
      title: "正式页面验收",
      description: "",
      target_date: "2026-09-15",
      status: "open",
      weight: 1,
      completed_at: null,
      sort_order: 10,
    },
  }));
  return buildPortableWorkspaceExport({
    repository: "lubannn/personal-workspace-data",
    branch: "main",
    generatedAt: "2026-08-27T02:00:00.000Z",
    workspaceFile: storedFile("workspace.json", workspaceText, "workspace-blob"),
    captureFiles: [storedFile("data/captures/capture_20260827010000000_abcd1234.json", captureText, "capture-blob")],
    dashboardLayoutFile: storedFile("config/dashboard-layout.json", dashboardText, "dashboard-blob"),
    taskFiles: [storedFile("data/tasks/task_20260827013000000_abcd1234.json", taskText, "task-blob")],
    projectFiles: [storedFile("data/projects/project_20260827014500000_abcd1234.json", projectText, "project-blob")],
    projectPhaseFiles: [storedFile("data/project-phases/phase_20260827015000000_abcd1234.json", projectPhaseText, "phase-blob")],
    milestoneFiles: [storedFile("data/milestones/milestone_20260827015500000_abcd1234.json", milestoneText, "milestone-blob")],
  });
}

describe("portable GitHub workspace export", () => {
  it("builds a deterministic manifest and passes restore preflight", async () => {
    const exported = await sampleExport();
    expect(exported.manifest.counts).toEqual({ files: 7, captures: 1, dashboard_layouts: 1, tasks: 1, projects: 1, project_phases: 1, milestones: 1 });
    expect(exported.manifest.files.map((file) => file.path)).toEqual([
      "config/dashboard-layout.json",
      "data/captures/capture_20260827010000000_abcd1234.json",
      "data/milestones/milestone_20260827015500000_abcd1234.json",
      "data/project-phases/phase_20260827015000000_abcd1234.json",
      "data/projects/project_20260827014500000_abcd1234.json",
      "data/tasks/task_20260827013000000_abcd1234.json",
      "workspace.json",
    ]);
    expect(serializePortableWorkspaceExport(exported)).not.toContain("test-token");

    await expect(inspectPortableWorkspaceExport(exported)).resolves.toMatchObject({
      valid: true,
      repository: "lubannn/personal-workspace-data",
      counts: { files: 7, captures: 1, dashboardLayouts: 1, tasks: 1, projects: 1, projectPhases: 1, milestones: 1 },
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

  it("rejects project phases whose parent project is missing", async () => {
    const exported = await sampleExport();
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/projects/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/projects/"));
    exported.manifest.counts.files -= 1;
    exported.manifest.counts.projects = 0;
    const inspection = await inspectPortableWorkspaceExport(exported);
    expect(inspection.errors.map((error) => error.code)).toContain("PROJECT_PHASE_PROJECT_MISSING");
    expect(inspection.errors.map((error) => error.code)).toContain("MILESTONE_PROJECT_MISSING");
  });

  it("continues to accept version 1 exports created before dashboard layouts existed", async () => {
    const exported = await sampleExport();
    exported.files = exported.files.filter((file) => file.path !== "config/dashboard-layout.json");
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/tasks/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/projects/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/project-phases/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/milestones/"));
    exported.manifest.files = exported.manifest.files.filter((file) => file.path !== "config/dashboard-layout.json");
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/tasks/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/projects/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/project-phases/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/milestones/"));
    exported.manifest.scope.modules = ["workspace", "captures"];
    exported.manifest.counts = { files: 2, captures: 1 } as typeof exported.manifest.counts;
    await expect(inspectPortableWorkspaceExport(exported)).resolves.toMatchObject({
      valid: true,
      counts: { files: 2, captures: 1, dashboardLayouts: 0, tasks: 0, projects: 0, projectPhases: 0, milestones: 0 },
    });
  });
});
