import { describe, expect, it } from "vitest";

import { entityCsvFileName, serializeProjectsCsv, serializeTasksCsv } from "./entity-csv-export";
import type { MilestoneRecord } from "./milestones";
import type { ProjectRecord } from "./projects";
import type { TaskRecord } from "./tasks";

const base = { schema_version: 1 as const, owner_id: "owner_1", version: 2, created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-30T00:00:00.000Z", deleted_at: null };
const task = (id: string, title: string, status: "todo" | "done" = "todo"): TaskRecord => ({ ...base, entity_type: "task", id, data: { title, category: "work", project_id: "project_1", parent_task_id: null, status, priority: "high", planned_start_at: null, planned_end_at: null, due_at: "2026-09-01", due_timezone: "Asia/Shanghai", is_due_date_only: true, estimated_duration_minutes: 30, actual_duration_minutes: status === "done" ? 25 : null, tags: ["export", "周报"], notes_markdown: "第一行,\n第二行 \"引用\"", completed_at: status === "done" ? "2026-08-30T01:00:00.000Z" : null, cancelled_at: null } });
const project: ProjectRecord = { ...base, entity_type: "project", id: "project_1", data: { name: "=Nexus", description_markdown: "Private,\n说明", status: "active", current_phase_id: null, start_date: "2026-08-01", target_date: "2026-09-30", completed_at: null, progress_mode: "tasks", manual_progress_percent: null, visibility_classification: "confidential" } };
const milestone: MilestoneRecord = { ...base, entity_type: "milestone", id: "milestone_1", data: { project_id: "project_1", title: "M1", description: "", target_date: null, status: "open", weight: 1, completed_at: null, sort_order: 0 } };

describe("entity CSV export", () => {
  it("exports every Task field in stable ID order and safely quotes multiline private text", () => {
    const deleted = { ...task("task_b", "=FORMULA"), deleted_at: "2026-08-30T02:00:00.000Z" };
    const csv = serializeTasksCsv([deleted, task("task_a", "普通任务", "done")]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.indexOf('"task_a"')).toBeLessThan(csv.indexOf('"task_b"'));
    expect(csv).toContain('"data/tasks/task_b.json"');
    expect(csv).toContain('"\'=FORMULA"');
    expect(csv).toContain('"第一行,\n第二行 ""引用"""');
    expect(csv).toContain('"2026-08-30T02:00:00.000Z"');
  });

  it("exports Project canonical fields with derived progress and its source", () => {
    const csv = serializeProjectsCsv({ projects: [project], tasks: [task("task_a", "A", "done"), task("task_b", "B")], milestones: [milestone] });
    expect(csv).toContain('"data/projects/project_1.json"');
    expect(csv).toContain('"\'=Nexus"');
    expect(csv).toContain('"50","tasks","1","2"');
    expect(csv).toContain('"Private,\n说明"');
  });

  it("uses deterministic entity filenames and rejects invalid dates", () => {
    expect(entityCsvFileName("tasks", "2026-08-30")).toBe("personal-workspace-tasks-2026-08-30.csv");
    expect(entityCsvFileName("projects", "2026-08-30")).toBe("personal-workspace-projects-2026-08-30.csv");
    expect(() => entityCsvFileName("tasks", "2026-99-99")).toThrow("INVALID_ENTITY_CSV_DATE");
    expect(() => entityCsvFileName("tasks", "2026-02-31")).toThrow("INVALID_ENTITY_CSV_DATE");
  });
});
