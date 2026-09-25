import { describe, expect, it } from "vitest";

import { buildPortableWorkspaceExport } from "./portable-export";
import { createPortableRestorePlan, type PortableRestoreTarget } from "./portable-restore";
import { createWorkspaceRecord, serializeRecord } from "./protocol";
import { createDefaultDashboardLayout, serializeDashboardLayout } from "./dashboard-layout";
import { confirmWorkoutHealthStaging, createCorosWorkoutStagingData } from "./health-staging-records";
import { createConfirmedWorkoutData } from "./workouts";

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
  const task = createWorkspaceRecord({
    entityType: "task",
    id: "task_restore_test",
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T10:15:00.000Z",
    data: {
      title: "恢复任务",
      category: "life",
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
  });
  return buildPortableWorkspaceExport({
    repository: "lubannn/personal-workspace-data",
    branch: "main",
    generatedAt: "2026-08-27T11:00:00.000Z",
    workspaceFile: storedFile("workspace.json", workspaceText, "workspace-blob"),
    captureFiles: [storedFile("data/captures/capture_restore_test.json", serializeRecord(capture), "capture-blob")],
    dashboardLayoutFile: storedFile(
      "config/dashboard-layout.json",
      serializeDashboardLayout(createDefaultDashboardLayout("github_lubannn", "2026-08-27T10:30:00.000Z")),
      "dashboard-blob",
    ),
    taskFiles: [storedFile("data/tasks/task_restore_test.json", serializeRecord(task), "task-blob")],
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
      counts: { files: 4, captures: 1, tasks: 1 },
      errors: [],
    });
    expect(plan.files.map((file) => file.path)).toEqual([
      "config/dashboard-layout.json",
      "data/captures/capture_restore_test.json",
      "data/tasks/task_restore_test.json",
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
    expect(plan.files).toHaveLength(4);
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

  it("keeps a formal Workout staging record in the create-only restore plan", async () => {
    const timestamp = "2026-09-19T02:00:00.000Z";
    const id = `coros_workout_${"c".repeat(64)}`;
    const staging = createWorkspaceRecord({
      entityType: "health_staging_record", id, ownerId: "github_lubannn", timestamp,
      data: createCorosWorkoutStagingData({
        source: { kind: "coros_file", label: "COROS TCX file", format: "tcx", source_sha256: "a".repeat(64), parser_version: "1", mapping_version: "1", batch_identity: "b".repeat(64) },
        import_key: "c".repeat(64),
        normalized_json: { activity_type: "ride", start_at: "2026-09-19T01:00:00.000Z", end_at: "2026-09-19T01:30:00.000Z", timezone: "Asia/Shanghai", duration_seconds: 1800, distance: 12000, distance_unit: "m", training_load: null, metrics_json: { elapsed_seconds: 1800, moving_seconds: 1750, calories: 320, average_heart_rate_bpm: 138, maximum_heart_rate_bpm: 166, average_cadence_rpm: 84, average_power_watts: 190, trackpoints: 2 } },
        diagnostics_json: [],
      }),
    });
    const exported = await buildPortableWorkspaceExport({
      repository: "lubannn/personal-workspace-data", branch: "main", workspaceFile: storedFile("workspace.json", workspaceText, "workspace-blob"), captureFiles: [],
      healthStagingFiles: [storedFile(`data/health-staging-records/${id}.json`, serializeRecord(staging), "workout-staging-blob")],
    });
    const plan = await createPortableRestorePlan(exported, target());
    expect(plan).toMatchObject({ ready: true, counts: { files: 2, healthStagingRecords: 1 } });
    expect(plan.files.map((file) => file.path)).toContain(`data/health-staging-records/${id}.json`);
  });

  it("restores a confirmed Workout only with its matching staging decision", async () => {
    const timestamp = "2026-09-19T02:00:00.000Z";
    const importKey = "c".repeat(64);
    const pending = createWorkspaceRecord({
      entityType: "health_staging_record", id: `coros_workout_${importKey}`, ownerId: "github_lubannn", timestamp,
      data: createCorosWorkoutStagingData({
        source: { kind: "coros_file", label: "COROS TCX file", format: "tcx", source_sha256: "a".repeat(64), parser_version: "1", mapping_version: "1", batch_identity: "b".repeat(64) },
        import_key: importKey,
        normalized_json: { activity_type: "ride", start_at: "2026-09-19T01:00:00.000Z", end_at: "2026-09-19T01:30:00.000Z", timezone: "Asia/Shanghai", duration_seconds: 1800, distance: 12000, distance_unit: "m", training_load: null, metrics_json: { elapsed_seconds: 1800, moving_seconds: 1750, calories: 320, average_heart_rate_bpm: 138, maximum_heart_rate_bpm: 166, average_cadence_rpm: 84, average_power_watts: 190, trackpoints: 2 } },
        diagnostics_json: [],
      }),
    });
    const reviewed = confirmWorkoutHealthStaging(pending, timestamp);
    const workout = createWorkspaceRecord({ entityType: "workout", id: `workout_${importKey}`, ownerId: pending.owner_id, timestamp, data: createConfirmedWorkoutData(pending, timestamp) });
    const stagingFile = storedFile(`data/health-staging-records/${reviewed.id}.json`, serializeRecord(reviewed), "staging-blob");
    const workoutFile = storedFile(`data/workouts/${workout.id}.json`, serializeRecord(workout), "workout-blob");
    const build = (workoutFiles = [workoutFile]) => buildPortableWorkspaceExport({
      repository: "lubannn/personal-workspace-data", branch: "main", workspaceFile: storedFile("workspace.json", workspaceText, "workspace-blob"), captureFiles: [],
      healthStagingFiles: [stagingFile], workoutFiles,
    });
    const ready = await createPortableRestorePlan(await build(), target());
    expect(ready).toMatchObject({ ready: true, counts: { workouts: 1, healthStagingRecords: 1 } });
    expect(ready.files.map((file) => file.path)).toEqual(expect.arrayContaining([stagingFile.path, workoutFile.path]));

    const incomplete = await createPortableRestorePlan(await build([]), target());
    expect(incomplete.ready).toBe(false);
    expect(incomplete.errors.map((error) => error.code)).toContain("WORKOUT_CANONICAL_MISSING");
    expect(incomplete.files).toEqual([]);
  });
});
