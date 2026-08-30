import type { MilestoneRecord } from "./milestones";
import { recordPath } from "./protocol";
import { projectMilestoneProgress, projectTaskProgress, type ProjectRecord } from "./projects";
import type { TaskRecord } from "./tasks";
import type { TimeEntryRecord } from "./time-entries";

export function serializeTasksCsv(records: TaskRecord[]) {
  const header = [
    "schema_version", "entity_type", "id", "owner_id", "version", "created_at", "updated_at", "deleted_at", "source_path",
    "title", "category", "project_id", "parent_task_id", "status", "priority", "planned_start_at", "planned_end_at", "due_at", "due_timezone",
    "is_due_date_only", "estimated_duration_minutes", "actual_duration_minutes", "tags_json", "notes_markdown", "completed_at", "cancelled_at",
  ];
  const rows = [...records].sort((left, right) => left.id.localeCompare(right.id)).map((record) => [
    record.schema_version, record.entity_type, record.id, record.owner_id, record.version, record.created_at, record.updated_at, record.deleted_at ?? "", recordPath("task", record.id),
    record.data.title, record.data.category, record.data.project_id ?? "", record.data.parent_task_id ?? "", record.data.status, record.data.priority,
    record.data.planned_start_at ?? "", record.data.planned_end_at ?? "", record.data.due_at ?? "", record.data.due_timezone, record.data.is_due_date_only,
    record.data.estimated_duration_minutes ?? "", record.data.actual_duration_minutes ?? "", JSON.stringify(record.data.tags), record.data.notes_markdown,
    record.data.completed_at ?? "", record.data.cancelled_at ?? "",
  ]);
  return serializeCsv(header, rows);
}

export function serializeProjectsCsv(input: { projects: ProjectRecord[]; tasks: TaskRecord[]; milestones: MilestoneRecord[] }) {
  const header = [
    "schema_version", "entity_type", "id", "owner_id", "version", "created_at", "updated_at", "deleted_at", "source_path",
    "name", "description_markdown", "status", "current_phase_id", "start_date", "target_date", "completed_at", "progress_mode", "manual_progress_percent",
    "progress_percent", "progress_source", "progress_completed", "progress_total", "visibility_classification",
  ];
  const rows = [...input.projects].sort((left, right) => left.id.localeCompare(right.id)).map((record) => {
    const progress = projectProgressColumns(record, input.tasks, input.milestones);
    return [
      record.schema_version, record.entity_type, record.id, record.owner_id, record.version, record.created_at, record.updated_at, record.deleted_at ?? "", recordPath("project", record.id),
      record.data.name, record.data.description_markdown, record.data.status, record.data.current_phase_id ?? "", record.data.start_date ?? "", record.data.target_date ?? "",
      record.data.completed_at ?? "", record.data.progress_mode, record.data.manual_progress_percent ?? "", progress.percent, progress.source,
      progress.completed ?? "", progress.total ?? "", record.data.visibility_classification,
    ];
  });
  return serializeCsv(header, rows);
}

export function serializeTimeEntriesCsv(records: TimeEntryRecord[]) {
  const header = ["schema_version", "entity_type", "id", "owner_id", "version", "created_at", "updated_at", "deleted_at", "source_path", "task_id", "project_id", "local_date", "timezone", "started_at", "ended_at", "duration_minutes", "entry_method", "notes_markdown", "source_ref"];
  const rows = [...records].sort((left, right) => left.id.localeCompare(right.id)).map((record) => [record.schema_version, record.entity_type, record.id, record.owner_id, record.version, record.created_at, record.updated_at, record.deleted_at ?? "", recordPath("time_entry", record.id), record.data.task_id, record.data.project_id ?? "", record.data.local_date, record.data.timezone, "", "", record.data.duration_minutes, record.data.entry_method, record.data.notes_markdown, ""]);
  return serializeCsv(header, rows);
}

export function entityCsvFileName(entity: "tasks" | "projects" | "time-entries", localDate: string) {
  const parsed = new Date(`${localDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== localDate) {
    throw new Error("INVALID_ENTITY_CSV_DATE");
  }
  return `personal-workspace-${entity}-${localDate}.csv`;
}

function projectProgressColumns(record: ProjectRecord, tasks: TaskRecord[], milestones: MilestoneRecord[]) {
  if (record.data.progress_mode === "manual") {
    return { percent: record.data.manual_progress_percent ?? 0, source: "manual", completed: null, total: null };
  }
  if (record.data.progress_mode === "milestones") {
    const progress = projectMilestoneProgress(record.id, milestones);
    return { percent: progress.percent, source: "milestones", completed: progress.completed, total: progress.total };
  }
  const progress = projectTaskProgress(record.id, tasks);
  return { percent: progress.percent, source: "tasks", completed: progress.completed, total: progress.total };
}

function serializeCsv(header: string[], rows: Array<Array<string | number | boolean>>) {
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function csvCell(value: string | number | boolean) {
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
