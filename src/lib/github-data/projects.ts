import { parseRecord, updateWorkspaceRecord, type WorkspaceRecord } from "./protocol";
import type { TaskRecord } from "./tasks";
import type { MilestoneRecord } from "./milestones";

export const PROJECT_STATUSES = ["planned", "active", "on_hold", "completed", "cancelled", "archived"] as const;
export const PROJECT_PROGRESS_MODES = ["manual", "tasks", "milestones"] as const;

export type ProjectStatus = typeof PROJECT_STATUSES[number];
export type ProjectProgressMode = typeof PROJECT_PROGRESS_MODES[number];

export type ProjectData = {
  name: string;
  description_markdown: string;
  status: ProjectStatus;
  current_phase_id: string | null;
  start_date: string | null;
  target_date: string | null;
  completed_at: string | null;
  progress_mode: ProjectProgressMode;
  manual_progress_percent: number | null;
  visibility_classification: string;
};

export type ProjectRecord = WorkspaceRecord<ProjectData>;
export type ProjectEditableFields = Pick<ProjectData, "name" | "description_markdown" | "start_date" | "target_date"> & {
  progress_mode?: ProjectProgressMode;
};

const CURRENT_PROJECT_STATUSES = new Set<ProjectStatus>(["planned", "active", "on_hold"]);

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isValidDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function hasValidTimestamp(value: string | null) {
  return value === null || !Number.isNaN(Date.parse(value));
}

export function parseProjectRecord(value: string): ProjectRecord {
  const record = parseRecord(value);
  const data = record.data;
  if (
    record.entity_type !== "project"
    || typeof data.name !== "string"
    || !data.name.trim()
    || data.name.length > 300
    || typeof data.description_markdown !== "string"
    || data.description_markdown.length > 50_000
    || !PROJECT_STATUSES.includes(data.status as ProjectStatus)
    || !isNullableString(data.current_phase_id)
    || !isNullableString(data.start_date)
    || !isNullableString(data.target_date)
    || !isNullableString(data.completed_at)
    || !PROJECT_PROGRESS_MODES.includes(data.progress_mode as ProjectProgressMode)
    || !(data.manual_progress_percent === null
      || (Number.isInteger(data.manual_progress_percent) && Number(data.manual_progress_percent) >= 0 && Number(data.manual_progress_percent) <= 100))
    || typeof data.visibility_classification !== "string"
    || !data.visibility_classification.trim()
    || (data.start_date !== null && !isValidDateOnly(data.start_date))
    || (data.target_date !== null && !isValidDateOnly(data.target_date))
    || !hasValidTimestamp(data.completed_at)
    || (data.start_date !== null && data.target_date !== null && data.target_date < data.start_date)
    || (data.status === "completed" && data.completed_at === null)
    || (data.status !== "completed" && data.completed_at !== null)
    || (data.progress_mode === "manual" && data.manual_progress_percent === null)
    || (data.progress_mode !== "manual" && data.manual_progress_percent !== null)
  ) throw new Error("INVALID_PROJECT_RECORD");
  return record as ProjectRecord;
}

export function createProjectData(rawName: string, targetDate: string | null): ProjectData {
  const name = rawName.trim();
  if (!name || name.length > 300 || (targetDate !== null && !isValidDateOnly(targetDate))) {
    throw new Error("INVALID_PROJECT_DETAILS");
  }
  return {
    name,
    description_markdown: "",
    status: "active",
    current_phase_id: null,
    start_date: null,
    target_date: targetDate,
    completed_at: null,
    progress_mode: "tasks",
    manual_progress_percent: null,
    visibility_classification: "confidential",
  };
}

export function currentProjects(records: ProjectRecord[]) {
  return records
    .filter((record) => record.deleted_at === null && CURRENT_PROJECT_STATUSES.has(record.data.status))
    .sort((left, right) => {
      const leftDate = left.data.target_date ?? "9999-12-31";
      const rightDate = right.data.target_date ?? "9999-12-31";
      return leftDate.localeCompare(rightDate) || right.updated_at.localeCompare(left.updated_at);
    });
}

export function completedProjects(records: ProjectRecord[]) {
  return records
    .filter((record) => record.deleted_at === null && record.data.status === "completed")
    .sort((left, right) => String(right.data.completed_at).localeCompare(String(left.data.completed_at)));
}

export function cancelledProjects(records: ProjectRecord[]) {
  return records
    .filter((record) => record.deleted_at === null && record.data.status === "cancelled")
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export function archivedProjects(records: ProjectRecord[]) {
  return records
    .filter((record) => record.deleted_at === null && record.data.status === "archived")
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export function trashedProjects(records: ProjectRecord[]) {
  return records
    .filter((record) => record.deleted_at !== null)
    .sort((left, right) => String(right.deleted_at).localeCompare(String(left.deleted_at)));
}

export function setProjectStatus(
  current: ProjectRecord,
  status: ProjectStatus,
  timestamp = new Date().toISOString(),
): ProjectRecord {
  if (Number.isNaN(Date.parse(timestamp))) throw new Error("INVALID_PROJECT_STATUS_TIMESTAMP");
  return updateWorkspaceRecord(current, {
    ...current.data,
    status,
    completed_at: status === "completed" ? timestamp : null,
  }, timestamp);
}

export function updateProjectDetails(
  current: ProjectRecord,
  details: ProjectEditableFields,
  timestamp = new Date().toISOString(),
): ProjectRecord {
  const name = details.name.trim();
  const progressMode = details.progress_mode ?? current.data.progress_mode;
  if (
    !name
    || name.length > 300
    || typeof details.description_markdown !== "string"
    || details.description_markdown.length > 50_000
    || (details.start_date !== null && !isValidDateOnly(details.start_date))
    || (details.target_date !== null && !isValidDateOnly(details.target_date))
    || (details.start_date !== null && details.target_date !== null && details.target_date < details.start_date)
    || !PROJECT_PROGRESS_MODES.includes(progressMode)
    || Number.isNaN(Date.parse(timestamp))
  ) throw new Error("INVALID_PROJECT_DETAILS");
  return updateWorkspaceRecord(current, {
    ...current.data,
    name,
    description_markdown: details.description_markdown,
    start_date: details.start_date,
    target_date: details.target_date,
    progress_mode: progressMode,
    manual_progress_percent: progressMode === "manual" ? current.data.manual_progress_percent : null,
  }, timestamp);
}

export function updateProjectCurrentPhase(
  current: ProjectRecord,
  phaseId: string | null,
  timestamp = new Date().toISOString(),
): ProjectRecord {
  if (
    (phaseId !== null && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(phaseId))
    || Number.isNaN(Date.parse(timestamp))
  ) throw new Error("INVALID_PROJECT_PHASE_REFERENCE");
  return updateWorkspaceRecord(current, { ...current.data, current_phase_id: phaseId }, timestamp);
}

export function projectTaskProgress(projectId: string, tasks: TaskRecord[]) {
  const included = tasks.filter((task) => (
    task.deleted_at === null
    && task.data.project_id === projectId
    && task.data.status !== "cancelled"
    && task.data.status !== "archived"
  ));
  const completed = included.filter((task) => task.data.status === "done").length;
  return {
    completed,
    total: included.length,
    percent: included.length === 0 ? 0 : Math.round((completed / included.length) * 100),
  };
}

export function projectMilestoneProgress(projectId: string, milestones: MilestoneRecord[]) {
  const included = milestones.filter((milestone) => (
    milestone.deleted_at === null
    && milestone.data.project_id === projectId
    && milestone.data.status !== "cancelled"
  ));
  const completed = included.filter((milestone) => milestone.data.status === "completed");
  const totalWeight = included.reduce((sum, milestone) => sum + milestone.data.weight, 0);
  const completedWeight = completed.reduce((sum, milestone) => sum + milestone.data.weight, 0);
  return {
    completed: completed.length,
    total: included.length,
    completedWeight,
    totalWeight,
    percent: totalWeight === 0 ? 0 : Math.round((completedWeight / totalWeight) * 100),
  };
}
