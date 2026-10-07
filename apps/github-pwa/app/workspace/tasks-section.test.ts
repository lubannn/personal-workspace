import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createWorkspaceRecord } from "../../../../src/lib/github-data/protocol";
import { createProjectData } from "../../../../src/lib/github-data/projects";
import { TASK_CATEGORIES, TASK_PRIORITIES } from "../../../../src/lib/github-data/tasks";
import { TasksSection } from "./tasks-section";

function tasks(overrides: Partial<ComponentProps<typeof TasksSection>> = {}) {
  const project = {
    record: createWorkspaceRecord({ entityType: "project", id: "project_synthetic", ownerId: "test_owner", data: createProjectData("合成项目", null) }),
    path: "data/projects/project_synthetic.json", blobSha: "synthetic",
  };
  return renderToStaticMarkup(createElement(TasksSection, {
    connection: { repository: "example/synthetic", ownerId: "test_owner", ownerLogin: "example", timezone: "UTC" },
    online: true, taskTitle: "合成任务", taskCategory: "life_goal", taskPriority: "urgent", taskProjectId: project.record.id,
    taskDueDate: "2026-10-08", taskView: "open", taskFiles: [], projectFiles: [project], selectableProjectFiles: [project],
    openTaskFiles: [], completedTaskFiles: [], cancelledTaskFiles: [], archivedTaskFiles: [], trashedTaskFiles: [], visibleTaskFiles: [],
    currentTaskDate: "2026-10-07", loadingTasks: false, savingTask: false, savingTaskId: null,
    onTaskTitleChange: () => undefined, onTaskCategoryChange: () => undefined, onTaskPriorityChange: () => undefined,
    onTaskProjectIdChange: () => undefined, onTaskDueDateChange: () => undefined, onTaskViewChange: () => undefined,
    onCreateTask: () => undefined, onRefresh: () => undefined, onLifecycleChange: () => undefined, onDeletionChange: () => undefined,
    onEditTask: async () => true, onCreateSubtask: async () => true, ...overrides,
  }));
}

describe("task creation controls", () => {
  it("shows category and priority directly with the existing values and project IDs", () => {
    const html = tasks().match(/<form class="task-create-form"[\s\S]*?<\/form>/)![0];
    expect(html).not.toContain("<details");
    for (const field of ["任务标题", "分类", "优先级", "项目", "截止日期"]) expect(html).toContain(field);
    for (const value of [...TASK_CATEGORIES, ...TASK_PRIORITIES]) expect(html).toContain(`value="${value}"`);
    expect(html).toContain('<option value="life_goal" selected="">人生</option>');
    expect(html).toContain('<option value="urgent" selected="">紧急</option>');
    expect(html).toContain('<option value="project_synthetic" selected="">合成项目</option>');
  });

  it("keeps creation disabled when disconnected, offline, or saving", () => {
    for (const overrides of [{ connection: null }, { online: false }, { savingTask: true }]) {
      expect(tasks(overrides)).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    }
  });
});
