import { describe, expect, it } from "vitest";

import { buildDeterministicReport, renderDeterministicReportMarkdown } from "./deterministic-reports";
import { createWorkspaceRecord, serializeRecord } from "./protocol";
import { createReportDraftData, parseReportDraftRecord } from "./report-drafts";
import type { ProjectRecord } from "./projects";
import type { TaskRecord } from "./tasks";

const base = { schema_version: 1 as const, owner_id: "owner_1", version: 3, created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z", deleted_at: null };
const task: TaskRecord = { ...base, entity_type: "task", id: "task_1", data: { title: "发布 v1", category: "work", project_id: "project_1", parent_task_id: null, status: "done", priority: "high", planned_start_at: null, planned_end_at: null, due_at: null, due_timezone: "Asia/Shanghai", is_due_date_only: true, estimated_duration_minutes: null, actual_duration_minutes: 55, tags: [], notes_markdown: "", completed_at: "2026-09-01T01:00:00.000Z", cancelled_at: null } };
const project: ProjectRecord = { ...base, entity_type: "project", id: "project_1", data: { name: "Nexus", description_markdown: "", status: "active", current_phase_id: null, start_date: null, target_date: null, completed_at: null, progress_mode: "tasks", manual_progress_percent: null, visibility_classification: "confidential" } };

describe("report drafts", () => {
  it("captures immutable source values and versions in a strict canonical record", () => {
    const report = buildDeterministicReport({ reportType: "weekly", anchorDate: "2026-09-02", timezone: "Asia/Shanghai", tasks: [task], projects: [project], milestones: [], calendarEvents: [], activityEvents: [] });
    const markdown = renderDeterministicReportMarkdown(report, "manager");
    const data = createReportDraftData(report, "manager", markdown);
    const record = createWorkspaceRecord({ entityType: "report_draft", id: "report_draft_1", ownerId: "owner_1", data, timestamp: "2026-09-06T12:00:00.000Z" });
    const parsed = parseReportDraftRecord(serializeRecord(record));
    expect(parsed.data.facts_snapshot_json).toMatchObject({ completed_task_count: 1, project_snapshot_count: 1, actual_task_minutes: 55 });
    expect(parsed.data.facts_snapshot_json.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity_type: "task", id: "task_1", version: 3, title: "发布 v1", value: 55 }),
      expect.objectContaining({ entity_type: "project", id: "project_1", version: 3, value: 100 }),
    ]));
    expect(parsed.data.content_markdown).toBe(markdown);
    expect(parsed.data.generation_method).toBe("deterministic");
    expect(parsed.data.ai_run_id).toBeNull();
  });

  it("rejects mismatched snapshot counts and future lifecycle states", () => {
    const report = buildDeterministicReport({ reportType: "weekly", anchorDate: "2026-09-02", timezone: "Asia/Shanghai", tasks: [task], projects: [], milestones: [], calendarEvents: [], activityEvents: [] });
    const record = createWorkspaceRecord({ entityType: "report_draft", id: "report_draft_2", ownerId: "owner_1", data: createReportDraftData(report, "personal", "# draft") });
    const malformed = { ...record, data: { ...record.data, status: "approved", facts_snapshot_json: { ...record.data.facts_snapshot_json, completed_task_count: 9 } } };
    expect(() => parseReportDraftRecord(JSON.stringify(malformed))).toThrow("INVALID_REPORT_DRAFT_RECORD");
    expect(() => parseReportDraftRecord(JSON.stringify({ ...record, version: 2 }))).toThrow("INVALID_REPORT_DRAFT_RECORD");
  });
});
