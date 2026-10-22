import { describe, expect, it } from "vitest";
import { createWorkspaceRecord, recordPath, serializeRecord, setWorkspaceRecordDeleted } from "./protocol";
import { createCalendarEventData, parseCalendarEventRecord, setCalendarEventStatus, updateCalendarEventDetails } from "./calendar-events";
import { calendarEventProjectId, calendarEventsForProject, canLinkCalendarProject } from "./calendar-projects";
import { createProjectData } from "./projects";
import type { TaskData } from "./tasks";
import { buildDeterministicReport, renderDeterministicReportMarkdown, serializeDeterministicReportCsv } from "./deterministic-reports";
import { createReportDraftData, parseReportDraftRecord } from "./report-drafts";
import { buildPortableWorkspaceExport, inspectPortableWorkspaceExport } from "./portable-export";
import { createPortableRestorePlan } from "./portable-restore";
import { dryRunPortableWorkspaceMigrations } from "./schema-migrations";

const ownerId = "test_owner", timestamp = "2026-10-22T01:00:00Z";
const project = (id = "project_alpha") => createWorkspaceRecord({ entityType: "project", id, ownerId, timestamp, data: createProjectData(id === "project_alpha" ? "合成项目 Alpha" : "合成项目 Beta", null) });
const task = (id = "task_alpha", projectId = "project_alpha") => createWorkspaceRecord<TaskData>({ entityType: "task", id, ownerId, timestamp, data: { title: id, category: "work", project_id: projectId, parent_task_id: null, status: "todo", priority: "medium", planned_start_at: null, planned_end_at: null, due_at: null, due_timezone: "Asia/Shanghai", is_due_date_only: true, estimated_duration_minutes: null, actual_duration_minutes: null, tags: [], notes_markdown: "", completed_at: null, cancelled_at: null } });
function event(id = "calendar_alpha", projectId: string | null | undefined = "project_alpha", taskId: string | null = null) {
  return createWorkspaceRecord({ entityType: "calendar_event", id, ownerId, timestamp, data: createCalendarEventData({ title: "合成项目评审", eventType: "event", startAt: timestamp, endAt: "2026-10-22T02:00:00Z", timezone: "Asia/Shanghai", localDate: "2026-10-22", projectId, linkedTaskId: taskId }) });
}
const reportInput = { reportType: "weekly" as const, anchorDate: "2026-10-22", timezone: "Asia/Shanghai", projects: [project(), project("project_beta")], tasks: [task(), task("task_beta", "project_beta")], milestones: [], activityEvents: [] };
function legacyEvent() { const legacy = event("calendar_legacy", null, "task_alpha"); delete legacy.data.project_id; return legacy; }
function stored(path: string, text: string) { return { path, text, blobSha: "synthetic", sizeBytes: new TextEncoder().encode(text).byteLength }; }
async function portable(record = event(), projects = [project()]) {
  return buildPortableWorkspaceExport({ repository: "example/synthetic-source", branch: "main", workspaceFile: stored("workspace.json", JSON.stringify({ schema_version: 1, workspace_id: "personal-workspace", owner_id: ownerId, owner_login: "example", locale: "zh-CN", timezone: "Asia/Shanghai" })), captureFiles: [], projectFiles: projects.map((item) => stored(recordPath("project", item.id), serializeRecord(item))), calendarEventFiles: [stored(recordPath("calendar_event", record.id), serializeRecord(record))] });
}

describe("calendar project relationships", () => {
  it("round-trips direct links, accepts legacy records, and rejects malformed IDs", () => {
    expect(parseCalendarEventRecord(serializeRecord(event())).data.project_id).toBe("project_alpha");
    const legacy = legacyEvent(); const text = serializeRecord(legacy);
    expect(parseCalendarEventRecord(text).data.project_id).toBeUndefined();
    expect(serializeRecord(legacy)).toBe(text);
    for (const value of ["bad id", "", 3, false]) expect(() => parseCalendarEventRecord(JSON.stringify({ ...event(), data: { ...event().data, project_id: value } }))).toThrow("INVALID_CALENDAR_EVENT_RECORD");
  });
  it("resolves legacy task links while respecting an explicit project or unlink", () => {
    expect(calendarEventProjectId(legacyEvent(), [task()])).toBe("project_alpha");
    expect(calendarEventProjectId(legacyEvent(), [])).toBeNull();
    expect(calendarEventProjectId(event("calendar_beta", "project_beta", "task_alpha"), [task()])).toBe("project_beta");
    expect(calendarEventProjectId(event("calendar_unlinked", null, "task_alpha"), [task()])).toBeNull();
  });
  it("can reassign or remove a project without changing the linked task, times or completion", () => {
    const original = event("calendar_original", "project_alpha", "task_alpha");
    const fields = { title: original.data.title, eventType: original.data.event_type, startAt: original.data.start_at, endAt: original.data.end_at, timezone: original.data.timezone, localDate: original.data.local_start_date, linkedTaskId: "task_alpha" };
    const moved = updateCalendarEventDetails(original, { ...fields, projectId: "project_beta" });
    expect(moved).toMatchObject({ version: 2, data: { project_id: "project_beta", linked_entity_id: "task_alpha", start_at: timestamp, completed: false } });
    expect(updateCalendarEventDetails(moved, fields).data.project_id).toBe("project_beta");
    const cleared = updateCalendarEventDetails(moved, { ...fields, projectId: null });
    expect(calendarEventProjectId(cleared, [task()])).toBeNull();
    expect(original.data.project_id).toBe("project_alpha");
  });
  it("excludes cancelled and trashed schedules without duplicating direct + task links", () => {
    const direct = event("calendar_direct", "project_alpha", "task_alpha"); const legacy = legacyEvent();
    const cancelled = setCalendarEventStatus(event("calendar_cancelled"), "cancelled");
    const deleted = setWorkspaceRecordDeleted(event("calendar_deleted"), timestamp);
    expect(calendarEventsForProject("project_alpha", [direct, legacy, cancelled, deleted, event("calendar_other", "project_beta")], [task()]).map((item) => item.id)).toEqual(["calendar_direct", "calendar_legacy"]);
    expect(canLinkCalendarProject("project_missing", [project()])).toBe(false);
    expect(canLinkCalendarProject("project_alpha", [setWorkspaceRecordDeleted(project(), timestamp)])).toBe(false);
    expect(canLinkCalendarProject("project_alpha", [], "project_alpha")).toBe(true);
  });
  it("filters report facts by project and carries resolved event relationships into CSV, Markdown and immutable snapshots", () => {
    const report = buildDeterministicReport({ ...reportInput, projectId: "project_alpha", calendarEvents: [event(), legacyEvent(), event("calendar_other", "project_beta"), event("calendar_unlinked", null)] });
    expect(report.calendarEvents.map((item) => item.id)).toEqual(["calendar_alpha", "calendar_legacy"]);
    expect(report.scheduledMinutes).toBe(120);
    expect(report.projectSnapshots.map((item) => item.record.id)).toEqual(["project_alpha"]);
    expect(report.calendarEventProjectIds.calendar_legacy).toBe("project_alpha");
    expect(serializeDeterministicReportCsv(report)).toContain('"data/calendar-events/calendar_legacy.json","project_alpha"');
    const markdown = renderDeterministicReportMarkdown(report, "personal");
    expect(markdown).toContain("项目：合成项目 Alpha");
    expect(markdown).toContain("`calendar_event:calendar_legacy` · `project:project_alpha`");
    const data = createReportDraftData(report, "personal", markdown);
    expect(data.scope_json.project_id).toBe("project_alpha");
    expect(data.facts_snapshot_json.sources.filter((item) => item.entity_type === "calendar_event").every((item) => item.project_id === "project_alpha")).toBe(true);
    const draft = createWorkspaceRecord({ entityType: "report_draft", id: "report_alpha", ownerId, timestamp, data });
    expect(parseReportDraftRecord(serializeRecord(draft)).data.scope_json.project_id).toBe("project_alpha");
    const changedTasks = reportInput.tasks.map((item) => ({ ...item, data: { ...item.data, project_id: "project_beta" } }));
    const later = buildDeterministicReport({ ...reportInput, tasks: changedTasks, calendarEvents: [legacyEvent()] });
    expect(later.calendarEventProjectIds.calendar_legacy).toBe("project_beta");
    expect(data.facts_snapshot_json.sources.find((item) => item.id === "calendar_legacy")?.project_id).toBe("project_alpha");
  });
  it("preserves direct project links through export, inspection, migration dry-run and restore planning", async () => {
    const exported = await portable();
    expect(await inspectPortableWorkspaceExport(exported)).toMatchObject({ valid: true, counts: { projects: 1, calendarEvents: 1 } });
    expect(await dryRunPortableWorkspaceMigrations(exported)).toMatchObject({ valid: true, counts: { steps: 0, blocked: 0 } });
    const restore = await createPortableRestorePlan(exported, { repository: { fullName: "example/synthetic-target", private: true, visibility: "private", defaultBranch: "main" }, branch: { branch: "main", headCommitSha: "head", rootTreeSha: "tree" }, rootEntries: [] });
    expect(restore.ready).toBe(true);
    const text = restore.files.find((file) => file.path === recordPath("calendar_event", "calendar_alpha"))!.text;
    expect(parseCalendarEventRecord(text).data.project_id).toBe("project_alpha");
    expect(text).toBe(serializeRecord(event()));
  });
  it("blocks an export with a dangling direct project reference", async () => {
    const inspection = await inspectPortableWorkspaceExport(await portable(event("calendar_orphan", "project_missing")));
    expect(inspection.valid).toBe(false);
    expect(inspection.errors).toContainEqual(expect.objectContaining({ code: "CALENDAR_EVENT_PROJECT_MISSING" }));
  });
});
