import { describe, expect, it } from "vitest";
import { createWorkspaceRecord } from "../../../../src/lib/github-data/protocol";
import { createProjectData, type ProjectData } from "../../../../src/lib/github-data/projects";
import { createMilestoneData } from "../../../../src/lib/github-data/milestones";
import type { TaskData } from "../../../../src/lib/github-data/tasks";
import { filterProjectList, projectDueLabel, projectNeedsAttention, projectProgress, projectTasks } from "./projects-presentation";
import type { SyncedProject } from "./page-model";

function project(id: string, fields: Partial<ProjectData> = {}, updated = "2026-10-01T00:00:00Z"): SyncedProject {
  return { record: createWorkspaceRecord({ entityType: "project", id, ownerId: "test_owner", data: { ...createProjectData(id, null), ...fields }, timestamp: updated }), path: "synthetic", blobSha: "synthetic" };
}
function task(id: string, status: TaskData["status"], projectId = "project_alpha", deleted = false) {
  const data: TaskData = { title: id, category: "work", project_id: projectId, parent_task_id: null, status, priority: "medium", planned_start_at: null, planned_end_at: null, due_at: null, due_timezone: "UTC", is_due_date_only: true, estimated_duration_minutes: null, actual_duration_minutes: null, tags: [], notes_markdown: "", completed_at: status === "done" ? "2026-10-20T00:00:00Z" : null, cancelled_at: null };
  const record = createWorkspaceRecord({ entityType: "task", id, ownerId: "test_owner", data });
  return { record: { ...record, deleted_at: deleted ? "2026-10-21T00:00:00Z" : null }, path: "synthetic", blobSha: "synthetic" };
}

describe("project overview presentation", () => {
  it("flags overdue current projects without treating completed, cancelled, archived or deleted projects as late", () => {
    for (const status of ["active", "planned", "on_hold"] as const) expect(projectNeedsAttention(project("project_a", { status, target_date: "2026-10-21" }), "2026-10-22")).toBe(true);
    for (const status of ["completed", "cancelled", "archived"] as const) expect(projectNeedsAttention(project("project_a", { status, target_date: "2026-10-21" }), "2026-10-22")).toBe(false);
    const deleted = project("project_a", { target_date: "2026-10-21" }); deleted.record.deleted_at = "2026-10-21T00:00:00Z";
    expect(projectNeedsAttention(deleted, "2026-10-22")).toBe(false);
    expect(projectNeedsAttention(project("project_a", { target_date: "2026-10-22" }), "2026-10-22")).toBe(false);
    expect(projectDueLabel(project("project_a", { target_date: "2026-10-22" }), "2026-10-22")).toBe("今天到期");
    expect(projectDueLabel(project("project_a", { target_date: "2027-01-02" }), "2026-10-22")).toBe("2027/01/02");
    expect(projectDueLabel(project("project_a"), "2026-10-22")).toBe("未设日期");
  });
  it("searches names and descriptions, sorts undated projects last, and preserves the source order", () => {
    const undated = project("project_a", { name: "Alpha" });
    const late = project("project_b", { name: "Beta", description_markdown: "Alpha launch", target_date: "2026-11-02" });
    const early = project("project_c", { target_date: "2026-10-01" }, "2026-10-20T00:00:00Z");
    const items = [undated, late, early];
    expect(filterProjectList(items, "  ALPHA ", "target", false, "2026-10-22")).toEqual([late, undated]);
    expect(filterProjectList(items, "", "target", true, "2026-10-22")).toEqual([early]);
    expect(filterProjectList(items, "", "updated", false, "2026-10-22")[0]).toBe(early);
    expect(filterProjectList(items, "missing", "name", false, "2026-10-22")).toEqual([]);
    expect(items).toEqual([undated, late, early]);
  });
  it("shows only related live tasks and suggests unfinished work before completed work", () => {
    const done = task("task_done", "done"); const todo = task("task_todo", "todo"); const doing = task("task_doing", "in_progress");
    const items = [done, task("task_deleted", "todo", "project_alpha", true), todo, task("task_other", "todo", "project_other"), task("task_cancelled", "cancelled"), task("task_archived", "archived"), doing];
    expect(projectTasks("project_alpha", items)).toEqual([doing, todo, done]);
    expect(projectProgress(project("project_alpha"), items, [])).toEqual({ completed: 1, total: 3, percent: 33 });
  });
  it("preserves manual and weighted milestone progress instead of substituting task progress", () => {
    const item = project("project_alpha", { progress_mode: "manual", manual_progress_percent: 65 });
    expect(projectProgress(item, [], []).percent).toBe(65);
    const milestone = (id: string, weight: number, completed: boolean) => ({ record: createWorkspaceRecord({ entityType: "milestone", id, ownerId: "test_owner", data: { ...createMilestoneData({ projectId: "project_alpha", title: id, targetDate: null, sortOrder: 10 }), weight, status: completed ? "completed" as const : "open" as const, completed_at: completed ? "2026-10-21T00:00:00Z" : null } }), path: "synthetic", blobSha: "synthetic" });
    expect(projectProgress(project("project_alpha", { progress_mode: "milestones" }), [task("task_done", "done")], [milestone("milestone_a", 3, true), milestone("milestone_b", 1, false)]).percent).toBe(75);
  });
});
