import { calendarDateRange, type CalendarEventRecord } from "./calendar-events";
import { recordPath } from "./protocol";
import { projectMilestoneProgress, projectTaskProgress, type ProjectRecord } from "./projects";
import type { ActivityEventRecord } from "./activity-events";
import type { MilestoneRecord } from "./milestones";
import type { TaskRecord } from "./tasks";

export type DeterministicReportType = "weekly" | "monthly";

export type ProjectReportSnapshot = {
  record: ProjectRecord;
  percent: number;
  completed: number | null;
  total: number | null;
  progressSource: "manual" | "tasks" | "milestones";
};

export type DeterministicReport = {
  reportType: DeterministicReportType;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  completedTasks: TaskRecord[];
  completedMilestones: MilestoneRecord[];
  calendarEvents: CalendarEventRecord[];
  activityEvents: ActivityEventRecord[];
  projectSnapshots: ProjectReportSnapshot[];
  actualTaskMinutes: number;
  scheduledMinutes: number;
};

export function buildDeterministicReport(input: {
  reportType: DeterministicReportType;
  anchorDate: string;
  timezone: string;
  tasks: TaskRecord[];
  projects: ProjectRecord[];
  milestones: MilestoneRecord[];
  calendarEvents: CalendarEventRecord[];
  activityEvents: ActivityEventRecord[];
}): DeterministicReport {
  assertTimezone(input.timezone);
  const range = calendarDateRange(input.anchorDate, input.reportType === "weekly" ? "week" : "month");
  const inPeriod = (date: string) => date >= range.startDate && date <= range.endDate;
  const completedTasks = input.tasks
    .filter((record) => record.deleted_at === null
      && record.data.status === "done"
      && record.data.completed_at !== null
      && inPeriod(localDateForInstant(record.data.completed_at, input.timezone)))
    .sort((left, right) => String(left.data.completed_at).localeCompare(String(right.data.completed_at)) || left.id.localeCompare(right.id));
  const completedMilestones = input.milestones
    .filter((record) => record.deleted_at === null
      && record.data.status === "completed"
      && record.data.completed_at !== null
      && inPeriod(localDateForInstant(record.data.completed_at, input.timezone)))
    .sort((left, right) => String(left.data.completed_at).localeCompare(String(right.data.completed_at)) || left.id.localeCompare(right.id));
  const calendarEvents = input.calendarEvents
    .filter((record) => record.deleted_at === null
      && record.data.status === "confirmed"
      && record.data.local_start_date <= range.endDate
      && record.data.local_end_date >= range.startDate)
    .sort((left, right) => left.data.start_at.localeCompare(right.data.start_at) || left.id.localeCompare(right.id));
  const activityEvents = input.activityEvents
    .filter((record) => inPeriod(localDateForInstant(record.data.occurred_at, input.timezone)))
    .sort((left, right) => left.data.occurred_at.localeCompare(right.data.occurred_at) || left.id.localeCompare(right.id));
  const projectSnapshots = input.projects
    .filter((record) => record.deleted_at === null && (
      record.data.status === "planned"
      || record.data.status === "active"
      || record.data.status === "on_hold"
      || (record.data.status === "completed"
        && record.data.completed_at !== null
        && inPeriod(localDateForInstant(record.data.completed_at, input.timezone)))
    ))
    .map((record): ProjectReportSnapshot => {
      if (record.data.progress_mode === "manual") {
        return { record, percent: record.data.manual_progress_percent ?? 0, completed: null, total: null, progressSource: "manual" };
      }
      if (record.data.progress_mode === "milestones") {
        const progress = projectMilestoneProgress(record.id, input.milestones);
        return { record, percent: progress.percent, completed: progress.completed, total: progress.total, progressSource: "milestones" };
      }
      const progress = projectTaskProgress(record.id, input.tasks);
      return { record, percent: progress.percent, completed: progress.completed, total: progress.total, progressSource: "tasks" };
    })
    .sort((left, right) => (left.record.data.target_date ?? "9999-12-31").localeCompare(right.record.data.target_date ?? "9999-12-31")
      || left.record.data.name.localeCompare(right.record.data.name)
      || left.record.id.localeCompare(right.record.id));

  return {
    reportType: input.reportType,
    periodStart: range.startDate,
    periodEnd: range.endDate,
    timezone: input.timezone,
    completedTasks,
    completedMilestones,
    calendarEvents,
    activityEvents,
    projectSnapshots,
    actualTaskMinutes: completedTasks.reduce((sum, record) => sum + (record.data.actual_duration_minutes ?? 0), 0),
    scheduledMinutes: calendarEvents.reduce((sum, record) => sum + Math.round((Date.parse(record.data.end_at) - Date.parse(record.data.start_at)) / 60_000), 0),
  };
}

export function serializeDeterministicReportCsv(report: DeterministicReport) {
  const header = ["report_type", "period_start", "period_end", "timezone", "fact_type", "source_entity", "source_id", "source_path", "project_id", "occurred_on", "title", "status", "value", "details"];
  const prefix = [report.reportType, report.periodStart, report.periodEnd, report.timezone];
  const rows: Array<Array<string | number>> = [];
  for (const record of report.completedTasks) rows.push([
    ...prefix, "completed_task", "task", record.id, recordPath("task", record.id), record.data.project_id ?? "",
    localDateForInstant(String(record.data.completed_at), report.timezone), record.data.title, record.data.status,
    record.data.actual_duration_minutes ?? "", record.data.parent_task_id ? `parent_task_id=${record.data.parent_task_id}` : "",
  ]);
  for (const record of report.completedMilestones) rows.push([
    ...prefix, "completed_milestone", "milestone", record.id, recordPath("milestone", record.id), record.data.project_id,
    localDateForInstant(String(record.data.completed_at), report.timezone), record.data.title, record.data.status, record.data.weight, "",
  ]);
  for (const record of report.calendarEvents) rows.push([
    ...prefix, "calendar_event", "calendar_event", record.id, recordPath("calendar_event", record.id), "",
    record.data.local_start_date, record.data.title, record.data.event_type,
    Math.round((Date.parse(record.data.end_at) - Date.parse(record.data.start_at)) / 60_000), record.data.linked_entity_id ? `linked_task_id=${record.data.linked_entity_id}` : "",
  ]);
  for (const record of report.activityEvents) rows.push([
    ...prefix, "project_activity", "activity_event", record.id, recordPath("activity_event", record.id), record.data.entity_id,
    localDateForInstant(record.data.occurred_at, report.timezone), record.data.event_type, record.data.event_type, "", serializeActivitySummary(record.data.change_summary_json),
  ]);
  for (const snapshot of report.projectSnapshots) rows.push([
    ...prefix, "project_snapshot", "project", snapshot.record.id, recordPath("project", snapshot.record.id), snapshot.record.id,
    report.periodEnd, snapshot.record.data.name, snapshot.record.data.status, snapshot.percent,
    snapshot.completed === null ? `progress_source=${snapshot.progressSource}` : `progress_source=${snapshot.progressSource}; completed=${snapshot.completed}; total=${snapshot.total}`,
  ]);
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function deterministicReportFileName(report: DeterministicReport) {
  return `personal-workspace-${report.reportType}-${report.periodStart}-${report.periodEnd}.csv`;
}

export function localDateForInstant(value: string, timezone: string) {
  if (Number.isNaN(Date.parse(value))) throw new Error("INVALID_REPORT_INSTANT");
  assertTimezone(timezone);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function assertTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw new Error("INVALID_REPORT_TIMEZONE");
  }
}

function serializeActivitySummary(summary: ActivityEventRecord["data"]["change_summary_json"]) {
  return Object.entries(summary).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${String(value)}`).join("; ");
}

function csvCell(value: string | number) {
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
