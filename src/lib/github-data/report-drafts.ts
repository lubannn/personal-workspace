import type { DeterministicReport, DeterministicReportAudience } from "./deterministic-reports";
import { parseRecord, type WorkspaceRecord } from "./protocol";

export type ReportDraftStatus = "draft";
export type ReportDraftSourceSnapshot = {
  entity_type: "task" | "milestone" | "calendar_event" | "activity_event" | "project" | "time_entry";
  id: string;
  version: number;
  title: string;
  occurred_at: string | null;
  project_id: string | null;
  status: string;
  value: number | null;
  details: Record<string, string | number | boolean | null>;
};

export type ReportDraftData = {
  report_type: "weekly" | "monthly";
  audience: DeterministicReportAudience;
  period_start: string;
  period_end: string;
  timezone: string;
  scope_json: {
    basis: "workspace-local-calendar";
    source_entity_types: Array<"task" | "project" | "milestone" | "calendar_event" | "activity_event" | "time_entry">;
  };
  facts_snapshot_json: {
    completed_task_count: number;
    completed_milestone_count: number;
    calendar_event_count: number;
    activity_event_count: number;
    project_snapshot_count: number;
    actual_task_minutes: number;
    scheduled_minutes: number;
    time_entry_count?: number;
    tracked_minutes?: number;
    sources: ReportDraftSourceSnapshot[];
  };
  content_markdown: string;
  generation_method: "deterministic";
  ai_run_id: null;
  status: ReportDraftStatus;
};

export type ReportDraftRecord = WorkspaceRecord<ReportDraftData>;

const STABLE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_TYPES = new Set(["task", "milestone", "calendar_event", "activity_event", "project", "time_entry"]);

export function createReportDraftData(
  report: DeterministicReport,
  audience: DeterministicReportAudience,
  contentMarkdown: string,
): ReportDraftData {
  const sources: ReportDraftSourceSnapshot[] = [
    ...report.completedTasks.map((record): ReportDraftSourceSnapshot => ({
      entity_type: "task", id: record.id, version: record.version, title: record.data.title,
      occurred_at: record.data.completed_at, project_id: record.data.project_id, status: record.data.status,
      value: record.data.actual_duration_minutes,
      details: { parent_task_id: record.data.parent_task_id },
    })),
    ...report.completedMilestones.map((record): ReportDraftSourceSnapshot => ({
      entity_type: "milestone", id: record.id, version: record.version, title: record.data.title,
      occurred_at: record.data.completed_at, project_id: record.data.project_id, status: record.data.status,
      value: record.data.weight, details: {},
    })),
    ...report.calendarEvents.map((record): ReportDraftSourceSnapshot => ({
      entity_type: "calendar_event", id: record.id, version: record.version, title: record.data.title,
      occurred_at: record.data.start_at, project_id: null, status: record.data.status,
      value: Math.round((Date.parse(record.data.end_at) - Date.parse(record.data.start_at)) / 60_000),
      details: { event_type: record.data.event_type, local_start_date: record.data.local_start_date, local_end_date: record.data.local_end_date, linked_entity_id: record.data.linked_entity_id },
    })),
    ...report.activityEvents.map((record): ReportDraftSourceSnapshot => ({
      entity_type: "activity_event", id: record.id, version: record.version, title: record.data.event_type,
      occurred_at: record.data.occurred_at, project_id: record.data.entity_id, status: "recorded", value: null,
      details: { source_ref: record.data.source_ref },
    })),
    ...report.projectSnapshots.map((snapshot): ReportDraftSourceSnapshot => ({
      entity_type: "project", id: snapshot.record.id, version: snapshot.record.version, title: snapshot.record.data.name,
      occurred_at: null, project_id: snapshot.record.id, status: snapshot.record.data.status, value: snapshot.percent,
      details: { progress_source: snapshot.progressSource, completed: snapshot.completed, total: snapshot.total },
    })),
    ...report.timeEntries.map((record): ReportDraftSourceSnapshot => ({
      entity_type: "time_entry", id: record.id, version: record.version, title: "手工时间投入", occurred_at: null,
      project_id: record.data.project_id, status: record.data.entry_method, value: record.data.duration_minutes,
      details: { task_id: record.data.task_id, local_date: record.data.local_date },
    })),
  ];
  const data: ReportDraftData = {
    report_type: report.reportType,
    audience,
    period_start: report.periodStart,
    period_end: report.periodEnd,
    timezone: report.timezone,
    scope_json: { basis: "workspace-local-calendar", source_entity_types: ["task", "project", "milestone", "calendar_event", "activity_event", "time_entry"] },
    facts_snapshot_json: {
      completed_task_count: report.completedTasks.length,
      completed_milestone_count: report.completedMilestones.length,
      calendar_event_count: report.calendarEvents.length,
      activity_event_count: report.activityEvents.length,
      project_snapshot_count: report.projectSnapshots.length,
      actual_task_minutes: report.actualTaskMinutes,
      scheduled_minutes: report.scheduledMinutes,
      time_entry_count: report.timeEntries.length,
      tracked_minutes: report.trackedMinutes,
      sources,
    },
    content_markdown: contentMarkdown,
    generation_method: "deterministic",
    ai_run_id: null,
    status: "draft",
  };
  if (!isValidData(data)) throw new Error("INVALID_REPORT_DRAFT_DATA");
  return data;
}

export function parseReportDraftRecord(value: string): ReportDraftRecord {
  const record = parseRecord(value);
  if (record.entity_type !== "report_draft" || record.version !== 1 || record.deleted_at !== null || !isValidData(record.data)) throw new Error("INVALID_REPORT_DRAFT_RECORD");
  return record as ReportDraftRecord;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validTimezone(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 100) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}

function isValidSource(value: unknown): value is ReportDraftSourceSnapshot {
  if (!isObject(value) || typeof value.entity_type !== "string" || !SOURCE_TYPES.has(value.entity_type)) return false;
  return typeof value.id === "string" && STABLE_ID.test(value.id)
    && Number.isInteger(value.version) && Number(value.version) >= 1
    && typeof value.title === "string" && value.title.length <= 100_000
    && (value.occurred_at === null || (typeof value.occurred_at === "string" && !Number.isNaN(Date.parse(value.occurred_at))))
    && (value.project_id === null || (typeof value.project_id === "string" && STABLE_ID.test(value.project_id)))
    && typeof value.status === "string" && value.status.length <= 100
    && (value.value === null || (typeof value.value === "number" && Number.isFinite(value.value)))
    && isObject(value.details) && Object.keys(value.details).length <= 20
    && Object.values(value.details).every((detail) => detail === null || ["string", "number", "boolean"].includes(typeof detail));
}

function isValidData(data: Record<string, unknown>): data is ReportDraftData {
  if (!isObject(data.scope_json) || !isObject(data.facts_snapshot_json)) return false;
  const snapshot = data.facts_snapshot_json;
  const counts = ["completed_task_count", "completed_milestone_count", "calendar_event_count", "activity_event_count", "project_snapshot_count", "actual_task_minutes", "scheduled_minutes"];
  const sourceEntityTypes = Array.isArray(data.scope_json.source_entity_types) ? data.scope_json.source_entity_types.join(",") : "";
  const hasTimeEntries = sourceEntityTypes.endsWith(",time_entry");
  const timeEntrySources = Array.isArray(snapshot.sources) ? snapshot.sources.filter((source) => isObject(source) && source.entity_type === "time_entry") : [];
  return (data.report_type === "weekly" || data.report_type === "monthly")
    && (data.audience === "personal" || data.audience === "manager")
    && typeof data.period_start === "string" && DATE_ONLY.test(data.period_start)
    && typeof data.period_end === "string" && DATE_ONLY.test(data.period_end) && data.period_end >= data.period_start
    && validTimezone(data.timezone)
    && data.scope_json.basis === "workspace-local-calendar"
    && Array.isArray(data.scope_json.source_entity_types)
    && (sourceEntityTypes === "task,project,milestone,calendar_event,activity_event"
      || sourceEntityTypes === "task,project,milestone,calendar_event,activity_event,time_entry")
    && counts.every((key) => Number.isInteger(snapshot[key]) && Number(snapshot[key]) >= 0)
    && Array.isArray(snapshot.sources) && snapshot.sources.length <= 50_000 && snapshot.sources.every(isValidSource)
    && snapshot.completed_task_count === snapshot.sources.filter((source) => source.entity_type === "task").length
    && snapshot.completed_milestone_count === snapshot.sources.filter((source) => source.entity_type === "milestone").length
    && snapshot.calendar_event_count === snapshot.sources.filter((source) => source.entity_type === "calendar_event").length
    && snapshot.activity_event_count === snapshot.sources.filter((source) => source.entity_type === "activity_event").length
    && snapshot.project_snapshot_count === snapshot.sources.filter((source) => source.entity_type === "project").length
    && (hasTimeEntries
      ? Number.isInteger(snapshot.time_entry_count) && snapshot.time_entry_count === timeEntrySources.length
        && Number.isInteger(snapshot.tracked_minutes) && snapshot.tracked_minutes === timeEntrySources.reduce((sum, source) => sum + (typeof source.value === "number" ? source.value : 0), 0)
      : snapshot.time_entry_count === undefined && snapshot.tracked_minutes === undefined && timeEntrySources.length === 0)
    && typeof data.content_markdown === "string" && data.content_markdown.length > 0 && data.content_markdown.length <= 2_000_000
    && data.generation_method === "deterministic" && data.ai_run_id === null && data.status === "draft";
}
