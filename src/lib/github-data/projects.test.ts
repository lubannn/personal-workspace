import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord, setWorkspaceRecordDeleted } from "./protocol";
import { setTaskStatus, type TaskData } from "./tasks";
import { setMilestoneStatus, type MilestoneData } from "./milestones";
import {
  createProjectData,
  archivedProjects,
  cancelledProjects,
  completedProjects,
  currentProjects,
  parseProjectRecord,
  projectMilestoneProgress,
  projectTaskProgress,
  setProjectStatus,
  trashedProjects,
  updateProjectDetails,
  updateProjectCurrentPhase,
  type ProjectData,
} from "./projects";

const baseProject: ProjectData = {
  name: "PWA 正式主页面",
  description_markdown: "",
  status: "active",
  current_phase_id: null,
  start_date: null,
  target_date: "2026-09-30",
  completed_at: null,
  progress_mode: "tasks",
  manual_progress_percent: null,
  visibility_classification: "confidential",
};

const baseTask: TaskData = {
  title: "实现项目切片",
  category: "work",
  project_id: "project_pwa",
  parent_task_id: null,
  status: "todo",
  priority: "high",
  planned_start_at: null,
  planned_end_at: null,
  due_at: null,
  due_timezone: "Asia/Shanghai",
  is_due_date_only: true,
  estimated_duration_minutes: null,
  actual_duration_minutes: null,
  tags: [],
  notes_markdown: "",
  completed_at: null,
  cancelled_at: null,
};

const baseMilestone: MilestoneData = {
  project_id: "project_pwa",
  title: "完成验收",
  description: "",
  target_date: null,
  status: "open",
  weight: 1,
  completed_at: null,
  sort_order: 10,
};

function project(id: string, data: ProjectData = baseProject) {
  return createWorkspaceRecord({ entityType: "project", id, ownerId: "github_lubannn", data, timestamp: "2026-08-29T01:00:00.000Z" });
}

function task(id: string, data: TaskData = baseTask) {
  return createWorkspaceRecord({ entityType: "task", id, ownerId: "github_lubannn", data, timestamp: "2026-08-29T01:00:00.000Z" });
}

function milestone(id: string, data: MilestoneData = baseMilestone) {
  return createWorkspaceRecord({ entityType: "milestone", id, ownerId: "github_lubannn", data, timestamp: "2026-08-29T01:00:00.000Z" });
}

describe("GitHub project records", () => {
  it("creates and round-trips the canonical task-progress project shape", () => {
    const data = createProjectData("  PWA 正式主页面  ", "2026-09-30");
    expect(data).toMatchObject({ name: "PWA 正式主页面", status: "active", progress_mode: "tasks", manual_progress_percent: null });
    expect(parseProjectRecord(serializeRecord(project("project_pwa", data)))).toMatchObject({
      entity_type: "project",
      data: { name: "PWA 正式主页面", visibility_classification: "confidential" },
    });
  });

  it("rejects inconsistent progress and completion facts", () => {
    expect(() => parseProjectRecord(serializeRecord(project("project_manual", {
      ...baseProject,
      progress_mode: "manual",
      manual_progress_percent: null,
    })))).toThrow("INVALID_PROJECT_RECORD");
    expect(() => parseProjectRecord(serializeRecord(project("project_completed", {
      ...baseProject,
      status: "completed",
      completed_at: null,
    })))).toThrow("INVALID_PROJECT_RECORD");
  });

  it("orders current projects by target date and excludes closed or deleted records", () => {
    const later = project("project_later", { ...baseProject, target_date: "2026-10-01" });
    const sooner = project("project_sooner", { ...baseProject, target_date: "2026-09-01" });
    const completed = project("project_done", { ...baseProject, status: "completed", completed_at: "2026-08-29T02:00:00.000Z" });
    const deleted = setWorkspaceRecordDeleted(project("project_deleted"), "2026-08-29T03:00:00.000Z", "2026-08-29T03:00:00.000Z");
    expect(currentProjects([later, completed, deleted, sooner]).map((record) => record.id)).toEqual(["project_sooner", "project_later"]);
  });

  it("sets and clears completion facts while preserving a versioned lifecycle", () => {
    const paused = setProjectStatus(project("project_lifecycle"), "on_hold", "2026-08-29T02:00:00.000Z");
    expect(paused).toMatchObject({ version: 2, data: { status: "on_hold", completed_at: null } });
    const completed = setProjectStatus(paused, "completed", "2026-08-29T03:00:00.000Z");
    expect(completed).toMatchObject({ version: 3, data: { status: "completed", completed_at: "2026-08-29T03:00:00.000Z" } });
    const reopened = setProjectStatus(completed, "active", "2026-08-29T04:00:00.000Z");
    expect(reopened).toMatchObject({ version: 4, data: { status: "active", completed_at: null } });
  });

  it("edits basic information without changing lifecycle or progress provenance", () => {
    const completed = setProjectStatus(project("project_edit"), "completed", "2026-08-29T02:00:00.000Z");
    const edited = updateProjectDetails(completed, {
      name: "  PWA 正式入口  ",
      description_markdown: "## 目标\n\n完成主页面拆分。",
      start_date: "2026-08-01",
      target_date: "2026-10-01",
    }, "2026-08-29T03:00:00.000Z");
    expect(edited).toMatchObject({
      version: 3,
      data: {
        name: "PWA 正式入口",
        status: "completed",
        completed_at: "2026-08-29T02:00:00.000Z",
        progress_mode: "tasks",
        start_date: "2026-08-01",
        target_date: "2026-10-01",
      },
    });
  });

  it("switches between automatic progress sources without inventing a manual percentage", () => {
    const updated = updateProjectDetails(project("project_progress_mode"), {
      name: "PWA 正式主页面",
      description_markdown: "",
      start_date: null,
      target_date: "2026-09-30",
      progress_mode: "milestones",
    }, "2026-08-29T03:00:00.000Z");
    expect(updated).toMatchObject({ version: 2, data: { progress_mode: "milestones", manual_progress_percent: null } });
  });

  it("rejects invalid project details and reversed date ranges", () => {
    expect(() => updateProjectDetails(project("project_invalid_name"), {
      name: "  ", description_markdown: "", start_date: null, target_date: null,
    })).toThrow("INVALID_PROJECT_DETAILS");
    expect(() => updateProjectDetails(project("project_invalid_dates"), {
      name: "合法项目", description_markdown: "", start_date: "2026-10-02", target_date: "2026-10-01",
    })).toThrow("INVALID_PROJECT_DETAILS");
  });

  it("sets a current phase without changing project status or progress mode", () => {
    const updated = updateProjectCurrentPhase(project("project_phase_ref"), "phase_build", "2026-08-29T04:00:00.000Z");
    expect(updated).toMatchObject({
      version: 2,
      data: { current_phase_id: "phase_build", status: "active", progress_mode: "tasks" },
    });
  });

  it("separates current, completed, cancelled, archived, and trashed project views", () => {
    const completed = setProjectStatus(project("project_done"), "completed", "2026-08-29T02:00:00.000Z");
    const cancelled = setProjectStatus(project("project_cancelled"), "cancelled", "2026-08-29T03:00:00.000Z");
    const archived = setProjectStatus(project("project_archived"), "archived", "2026-08-29T04:00:00.000Z");
    const trashed = setWorkspaceRecordDeleted(project("project_trashed"), "2026-08-29T05:00:00.000Z", "2026-08-29T05:00:00.000Z");
    const records = [project("project_active"), completed, cancelled, archived, trashed];
    expect(currentProjects(records).map((record) => record.id)).toEqual(["project_active"]);
    expect(completedProjects(records).map((record) => record.id)).toEqual(["project_done"]);
    expect(cancelledProjects(records).map((record) => record.id)).toEqual(["project_cancelled"]);
    expect(archivedProjects(records).map((record) => record.id)).toEqual(["project_archived"]);
    expect(trashedProjects(records).map((record) => record.id)).toEqual(["project_trashed"]);
  });

  it("derives task progress while excluding deleted, cancelled, and archived tasks", () => {
    const done = setTaskStatus(task("task_done"), "done", "2026-08-29T02:00:00.000Z");
    const cancelled = setTaskStatus(task("task_cancelled"), "cancelled", "2026-08-29T02:00:00.000Z");
    const archived = setTaskStatus(task("task_archived"), "archived", "2026-08-29T02:00:00.000Z");
    const deleted = setWorkspaceRecordDeleted(task("task_deleted"), "2026-08-29T03:00:00.000Z", "2026-08-29T03:00:00.000Z");
    const other = task("task_other", { ...baseTask, project_id: "project_other" });
    expect(projectTaskProgress("project_pwa", [task("task_open"), done, cancelled, archived, deleted, other])).toEqual({
      completed: 1,
      total: 2,
      percent: 50,
    });
  });

  it("derives weighted milestone progress while excluding cancelled, deleted, and other-project milestones", () => {
    const completed = setMilestoneStatus(milestone("milestone_done", { ...baseMilestone, weight: 3 }), "completed", "2026-08-29T02:00:00.000Z");
    const cancelled = setMilestoneStatus(milestone("milestone_cancelled", { ...baseMilestone, weight: 8 }), "cancelled", "2026-08-29T02:00:00.000Z");
    const deleted = setWorkspaceRecordDeleted(milestone("milestone_deleted", { ...baseMilestone, weight: 6 }), "2026-08-29T03:00:00.000Z", "2026-08-29T03:00:00.000Z");
    const other = milestone("milestone_other", { ...baseMilestone, project_id: "project_other", weight: 10 });
    expect(projectMilestoneProgress("project_pwa", [milestone("milestone_open"), completed, cancelled, deleted, other])).toEqual({
      completed: 1,
      total: 2,
      completedWeight: 3,
      totalWeight: 4,
      percent: 75,
    });
  });
});
