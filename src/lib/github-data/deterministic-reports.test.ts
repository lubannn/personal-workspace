import { describe, expect, it } from "vitest";

import { buildDeterministicReport, deterministicReportFileName, serializeDeterministicReportCsv } from "./deterministic-reports";
import type { ActivityEventRecord } from "./activity-events";
import type { CalendarEventRecord } from "./calendar-events";
import type { MilestoneRecord } from "./milestones";
import type { ProjectRecord } from "./projects";
import type { TaskRecord } from "./tasks";

const base = { schema_version: 1 as const, owner_id: "owner_1", version: 1, created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z", deleted_at: null };
const task = (id: string, title: string, completedAt: string | null, projectId = "project_1"): TaskRecord => ({ ...base, entity_type: "task", id, data: { title, category: "work", project_id: projectId, parent_task_id: null, status: completedAt ? "done" : "todo", priority: "medium", planned_start_at: null, planned_end_at: null, due_at: null, due_timezone: "Asia/Shanghai", is_due_date_only: true, estimated_duration_minutes: null, actual_duration_minutes: completedAt ? 45 : null, tags: [], notes_markdown: "", completed_at: completedAt, cancelled_at: null } });
const project: ProjectRecord = { ...base, entity_type: "project", id: "project_1", data: { name: "Nexus", description_markdown: "", status: "active", current_phase_id: null, start_date: null, target_date: "2026-09-30", completed_at: null, progress_mode: "tasks", manual_progress_percent: null, visibility_classification: "confidential" } };
const milestone: MilestoneRecord = { ...base, entity_type: "milestone", id: "milestone_1", data: { project_id: "project_1", title: "上线提醒", description: "", target_date: "2026-09-02", status: "completed", weight: 2, completed_at: "2026-09-02T02:00:00.000Z", sort_order: 0 } };
const calendarEvent: CalendarEventRecord = { ...base, entity_type: "calendar_event", id: "calendar_1", data: { calendar_id: "internal-default", title: "评审", description_markdown: "", event_type: "time_block", start_at: "2026-09-03T01:00:00.000Z", end_at: "2026-09-03T02:30:00.000Z", timezone: "Asia/Shanghai", all_day: false, local_start_date: "2026-09-03", local_end_date: "2026-09-03", location: "", status: "confirmed", linked_entity_type: null, linked_entity_id: null, external_uid: null, external_etag: null, sync_status: "internal", recurrence_rule: null, recurrence_timezone: null, reminder_offsets_minutes: [], reminder_delivery: "foreground_notification" } };
const activity: ActivityEventRecord = { ...base, entity_type: "activity_event", id: "activity_1", data: { entity_type: "project", entity_id: "project_1", event_type: "project_updated", occurred_at: "2026-09-04T03:00:00.000Z", actor_type: "user", actor_id: "owner_1", change_summary_json: { status: "active", name: "Nexus" }, source_ref: null } };

describe("deterministic reports", () => {
  it("builds a timezone-aware Monday-to-Sunday report with traceable facts", () => {
    const report = buildDeterministicReport({
      reportType: "weekly", anchorDate: "2026-09-02", timezone: "Asia/Shanghai",
      tasks: [task("task_in", "完成发布", "2026-08-30T16:30:00.000Z"), task("task_out", "上周事项", "2026-08-30T15:59:59.000Z"), task("task_open", "待办", null)],
      projects: [project], milestones: [milestone], calendarEvents: [calendarEvent], activityEvents: [activity],
    });
    expect(report.periodStart).toBe("2026-08-31");
    expect(report.periodEnd).toBe("2026-09-06");
    expect(report.completedTasks.map((record) => record.id)).toEqual(["task_in"]);
    expect(report.completedMilestones).toHaveLength(1);
    expect(report.calendarEvents).toHaveLength(1);
    expect(report.activityEvents).toHaveLength(1);
    expect(report.projectSnapshots[0]).toMatchObject({ percent: 67, completed: 2, total: 3, progressSource: "tasks" });
    expect(report.actualTaskMinutes).toBe(45);
    expect(report.scheduledMinutes).toBe(90);
    expect(deterministicReportFileName(report)).toBe("personal-workspace-weekly-2026-08-31-2026-09-06.csv");
  });

  it("exports stable CSV rows and neutralizes spreadsheet formulas", () => {
    const report = buildDeterministicReport({ reportType: "monthly", anchorDate: "2026-09-15", timezone: "Asia/Shanghai", tasks: [task("task_formula", "=SUM(1,1)", "2026-09-01T01:00:00.000Z")], projects: [project], milestones: [], calendarEvents: [], activityEvents: [] });
    const csv = serializeDeterministicReportCsv(report);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"completed_task","task","task_formula","data/tasks/task_formula.json"');
    expect(csv).toContain('"\'=SUM(1,1)"');
    expect(csv).toContain('"project_snapshot","project","project_1","data/projects/project_1.json"');
  });

  it("rejects invalid report timezones", () => {
    expect(() => buildDeterministicReport({ reportType: "weekly", anchorDate: "2026-09-02", timezone: "Mars/Olympus", tasks: [], projects: [], milestones: [], calendarEvents: [], activityEvents: [] })).toThrow("INVALID_REPORT_TIMEZONE");
  });
});
