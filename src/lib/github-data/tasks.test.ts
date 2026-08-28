import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord, setWorkspaceRecordDeleted } from "./protocol";
import {
  archivedTasks,
  cancelledTasks,
  completedTasks,
  openTasks,
  parseTaskRecord,
  setTaskStatus,
  tasksForToday,
  trashedTasks,
  updateTaskDetails,
  type TaskData,
} from "./tasks";

const baseData: TaskData = {
  title: "提交周报",
  category: "work",
  project_id: null,
  parent_task_id: null,
  status: "todo",
  priority: "high",
  planned_start_at: null,
  planned_end_at: null,
  due_at: "2026-08-28",
  due_timezone: "Asia/Shanghai",
  is_due_date_only: true,
  estimated_duration_minutes: 30,
  actual_duration_minutes: null,
  tags: [],
  notes_markdown: "",
  completed_at: null,
  cancelled_at: null,
};

function task(id: string, data: TaskData = baseData) {
  return createWorkspaceRecord({
    entityType: "task",
    id,
    ownerId: "github_lubannn",
    timestamp: "2026-08-28T01:00:00.000Z",
    data,
  });
}

describe("GitHub task records", () => {
  it("round-trips the canonical task shape", () => {
    expect(parseTaskRecord(serializeRecord(task("task_one")))).toMatchObject({
      entity_type: "task",
      data: { title: "提交周报", due_at: "2026-08-28", status: "todo" },
    });
  });

  it("sets and clears completion facts while incrementing the record version", () => {
    const done = setTaskStatus(task("task_status"), "done", "2026-08-28T02:00:00.000Z");
    expect(done).toMatchObject({ version: 2, data: { status: "done", completed_at: "2026-08-28T02:00:00.000Z" } });
    const reopened = setTaskStatus(done, "todo", "2026-08-28T03:00:00.000Z");
    expect(reopened).toMatchObject({ version: 3, data: { status: "todo", completed_at: null } });
  });

  it("sets cancellation facts and clears them when the task is restored or archived", () => {
    const cancelled = setTaskStatus(task("task_cancelled"), "cancelled", "2026-08-28T02:00:00.000Z");
    expect(cancelled).toMatchObject({
      version: 2,
      data: { status: "cancelled", completed_at: null, cancelled_at: "2026-08-28T02:00:00.000Z" },
    });

    const restored = setTaskStatus(cancelled, "todo", "2026-08-28T03:00:00.000Z");
    expect(restored).toMatchObject({ version: 3, data: { status: "todo", cancelled_at: null } });

    const archived = setTaskStatus(cancelled, "archived", "2026-08-28T04:00:00.000Z");
    expect(archived).toMatchObject({ version: 3, data: { status: "archived", completed_at: null, cancelled_at: null } });
  });

  it("edits user-facing task details without changing lifecycle or future fields", () => {
    const done = setTaskStatus(task("task_edit"), "done", "2026-08-28T02:00:00.000Z");
    const edited = updateTaskDetails(done, {
      title: "  提交最终周报  ",
      category: "life",
      priority: "urgent",
      due_at: "2026-08-30",
    }, "2026-08-28T03:00:00.000Z");

    expect(edited).toMatchObject({
      version: 3,
      updated_at: "2026-08-28T03:00:00.000Z",
      data: {
        title: "提交最终周报",
        category: "life",
        priority: "urgent",
        due_at: "2026-08-30",
        status: "done",
        completed_at: "2026-08-28T02:00:00.000Z",
        estimated_duration_minutes: 30,
      },
    });
  });

  it("rejects invalid task edits", () => {
    expect(() => updateTaskDetails(task("task_invalid_edit"), {
      title: "   ",
      category: "work",
      priority: "medium",
      due_at: null,
    })).toThrow("INVALID_TASK_DETAILS");
    expect(() => updateTaskDetails(task("task_invalid_due"), {
      title: "合法标题",
      category: "work",
      priority: "medium",
      due_at: "2026-02-31",
    })).toThrow("INVALID_TASK_DETAILS");
  });

  it("orders overdue and higher-priority open tasks for Today", () => {
    const overdue = task("task_overdue", { ...baseData, title: "逾期", due_at: "2026-08-27", priority: "low" });
    const urgent = task("task_urgent", { ...baseData, title: "紧急", priority: "urgent" });
    const future = task("task_future", { ...baseData, title: "未来", due_at: "2026-08-29" });
    expect(tasksForToday([future, urgent, overdue], "2026-08-28").map((record) => record.id)).toEqual([
      "task_overdue",
      "task_urgent",
    ]);
  });

  it("separates open, completed, cancelled, and archived task views", () => {
    const done = setTaskStatus(task("task_done"), "done", "2026-08-28T02:00:00.000Z");
    const cancelled = setTaskStatus(task("task_cancelled"), "cancelled", "2026-08-28T03:00:00.000Z");
    const archived = setTaskStatus(task("task_archived"), "archived", "2026-08-28T04:00:00.000Z");
    const records = [task("task_open"), done, cancelled, archived];
    expect(openTasks(records).map((record) => record.id)).toEqual(["task_open"]);
    expect(completedTasks(records).map((record) => record.id)).toEqual(["task_done"]);
    expect(cancelledTasks(records).map((record) => record.id)).toEqual(["task_cancelled"]);
    expect(archivedTasks(records).map((record) => record.id)).toEqual(["task_archived"]);
  });

  it("keeps soft-deleted tasks out of lifecycle views and exposes them in trash", () => {
    const done = setTaskStatus(task("task_trashed_done"), "done", "2026-08-28T02:00:00.000Z");
    const trashed = setWorkspaceRecordDeleted(done, "2026-08-28T04:00:00.000Z", "2026-08-28T04:00:00.000Z");
    const records = [task("task_open"), trashed];

    expect(openTasks(records).map((record) => record.id)).toEqual(["task_open"]);
    expect(completedTasks(records)).toEqual([]);
    expect(trashedTasks(records)).toEqual([trashed]);
    expect(trashed).toMatchObject({
      version: 3,
      deleted_at: "2026-08-28T04:00:00.000Z",
      data: { status: "done", completed_at: "2026-08-28T02:00:00.000Z" },
    });
  });

  it("rejects inconsistent completion data", () => {
    const invalid = task("task_invalid", { ...baseData, status: "done", completed_at: null });
    expect(() => parseTaskRecord(serializeRecord(invalid))).toThrow("INVALID_TASK_RECORD");
  });
});
