import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord } from "./protocol";
import {
  completedTasks,
  openTasks,
  parseTaskRecord,
  setTaskStatus,
  tasksForToday,
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

  it("orders overdue and higher-priority open tasks for Today", () => {
    const overdue = task("task_overdue", { ...baseData, title: "逾期", due_at: "2026-08-27", priority: "low" });
    const urgent = task("task_urgent", { ...baseData, title: "紧急", priority: "urgent" });
    const future = task("task_future", { ...baseData, title: "未来", due_at: "2026-08-29" });
    expect(tasksForToday([future, urgent, overdue], "2026-08-28").map((record) => record.id)).toEqual([
      "task_overdue",
      "task_urgent",
    ]);
  });

  it("separates open and completed task views", () => {
    const done = setTaskStatus(task("task_done"), "done", "2026-08-28T02:00:00.000Z");
    expect(openTasks([task("task_open"), done]).map((record) => record.id)).toEqual(["task_open"]);
    expect(completedTasks([task("task_open"), done]).map((record) => record.id)).toEqual(["task_done"]);
  });

  it("rejects inconsistent completion data", () => {
    const invalid = task("task_invalid", { ...baseData, status: "done", completed_at: null });
    expect(() => parseTaskRecord(serializeRecord(invalid))).toThrow("INVALID_TASK_RECORD");
  });
});
