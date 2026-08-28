import {
  parseRecord,
  updateWorkspaceRecord,
  type WorkspaceRecord,
} from "./protocol";

export const TASK_CATEGORIES = ["work", "life", "life_goal"] as const;
export const TASK_STATUSES = ["inbox", "todo", "in_progress", "blocked", "done", "cancelled", "archived"] as const;
export const TASK_PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;

export type TaskCategory = typeof TASK_CATEGORIES[number];
export type TaskStatus = typeof TASK_STATUSES[number];
export type TaskPriority = typeof TASK_PRIORITIES[number];

export type TaskData = {
  title: string;
  category: TaskCategory;
  project_id: string | null;
  parent_task_id: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  planned_start_at: string | null;
  planned_end_at: string | null;
  due_at: string | null;
  due_timezone: string;
  is_due_date_only: boolean;
  estimated_duration_minutes: number | null;
  actual_duration_minutes: number | null;
  tags: string[];
  notes_markdown: string;
  completed_at: string | null;
  cancelled_at: string | null;
};

export type TaskRecord = WorkspaceRecord<TaskData>;
export type TaskEditableFields = Pick<
  TaskData,
  | "title"
  | "category"
  | "priority"
  | "due_at"
  | "estimated_duration_minutes"
  | "actual_duration_minutes"
  | "tags"
  | "notes_markdown"
>;

const MAX_TASK_TAGS = 20;
const MAX_TASK_TAG_LENGTH = 50;
const MAX_TASK_NOTES_LENGTH = 50_000;
const MAX_TASK_DURATION_MINUTES = 525_600;

const OPEN_TASK_STATUSES = new Set<TaskStatus>(["inbox", "todo", "in_progress", "blocked"]);
const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableDuration(value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && Number(value) >= 0);
}

function isValidDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function hasValidTimestamp(value: string | null) {
  return value === null || !Number.isNaN(Date.parse(value));
}

export function parseTaskRecord(value: string): TaskRecord {
  const record = parseRecord(value);
  const data = record.data;
  if (
    record.entity_type !== "task"
    || typeof data.title !== "string"
    || !data.title.trim()
    || data.title.length > 300
    || !TASK_CATEGORIES.includes(data.category as TaskCategory)
    || !isNullableString(data.project_id)
    || !isNullableString(data.parent_task_id)
    || !TASK_STATUSES.includes(data.status as TaskStatus)
    || !TASK_PRIORITIES.includes(data.priority as TaskPriority)
    || !isNullableString(data.planned_start_at)
    || !isNullableString(data.planned_end_at)
    || !isNullableString(data.due_at)
    || typeof data.due_timezone !== "string"
    || !data.due_timezone
    || typeof data.is_due_date_only !== "boolean"
    || !isNullableDuration(data.estimated_duration_minutes)
    || !isNullableDuration(data.actual_duration_minutes)
    || !Array.isArray(data.tags)
    || data.tags.some((tag) => typeof tag !== "string")
    || typeof data.notes_markdown !== "string"
    || !isNullableString(data.completed_at)
    || !isNullableString(data.cancelled_at)
    || !hasValidTimestamp(data.planned_start_at)
    || !hasValidTimestamp(data.planned_end_at)
    || !hasValidTimestamp(data.completed_at)
    || !hasValidTimestamp(data.cancelled_at)
    || (data.due_at !== null && (data.is_due_date_only ? !isValidDateOnly(data.due_at) : !hasValidTimestamp(data.due_at)))
    || (data.planned_start_at !== null && data.planned_end_at !== null && data.planned_end_at < data.planned_start_at)
    || (data.status === "done" && data.completed_at === null)
    || (data.status !== "done" && data.completed_at !== null)
    || (data.status === "cancelled" && data.cancelled_at === null)
    || (data.status !== "cancelled" && data.cancelled_at !== null)
  ) throw new Error("INVALID_TASK_RECORD");
  return record as TaskRecord;
}

export function setTaskStatus(
  current: TaskRecord,
  status: TaskStatus,
  timestamp = new Date().toISOString(),
): TaskRecord {
  if (Number.isNaN(Date.parse(timestamp))) throw new Error("INVALID_TASK_STATUS_TIMESTAMP");
  return updateWorkspaceRecord(current, {
    ...current.data,
    status,
    completed_at: status === "done" ? timestamp : null,
    cancelled_at: status === "cancelled" ? timestamp : null,
  }, timestamp);
}

export function updateTaskDetails(
  current: TaskRecord,
  details: TaskEditableFields,
  timestamp = new Date().toISOString(),
): TaskRecord {
  const title = details.title.trim();
  const tags = [...new Set(details.tags.map((tag) => tag.trim()).filter(Boolean))];
  if (
    !title
    || title.length > 300
    || !TASK_CATEGORIES.includes(details.category)
    || !TASK_PRIORITIES.includes(details.priority)
    || (details.due_at !== null && !isValidDateOnly(details.due_at))
    || tags.length > MAX_TASK_TAGS
    || tags.some((tag) => tag.length > MAX_TASK_TAG_LENGTH)
    || typeof details.notes_markdown !== "string"
    || details.notes_markdown.length > MAX_TASK_NOTES_LENGTH
    || !isEditableDuration(details.estimated_duration_minutes)
    || !isEditableDuration(details.actual_duration_minutes)
    || Number.isNaN(Date.parse(timestamp))
  ) throw new Error("INVALID_TASK_DETAILS");

  return updateWorkspaceRecord(current, {
    ...current.data,
    title,
    category: details.category,
    priority: details.priority,
    due_at: details.due_at,
    is_due_date_only: true,
    estimated_duration_minutes: details.estimated_duration_minutes,
    actual_duration_minutes: details.actual_duration_minutes,
    tags,
    notes_markdown: details.notes_markdown,
  }, timestamp);
}

function isEditableDuration(value: number | null) {
  return isNullableDuration(value) && (value === null || value <= MAX_TASK_DURATION_MINUTES);
}

export function openTasks(records: TaskRecord[]) {
  return [...records]
    .filter((record) => record.deleted_at === null && OPEN_TASK_STATUSES.has(record.data.status))
    .sort(compareTasks);
}

export function completedTasks(records: TaskRecord[]) {
  return [...records]
    .filter((record) => record.deleted_at === null && record.data.status === "done")
    .sort((left, right) => String(right.data.completed_at).localeCompare(String(left.data.completed_at)));
}

export function cancelledTasks(records: TaskRecord[]) {
  return [...records]
    .filter((record) => record.deleted_at === null && record.data.status === "cancelled")
    .sort((left, right) => String(right.data.cancelled_at).localeCompare(String(left.data.cancelled_at)));
}

export function archivedTasks(records: TaskRecord[]) {
  return [...records]
    .filter((record) => record.deleted_at === null && record.data.status === "archived")
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export function trashedTasks(records: TaskRecord[]) {
  return [...records]
    .filter((record) => record.deleted_at !== null)
    .sort((left, right) => String(right.deleted_at).localeCompare(String(left.deleted_at)));
}

export function tasksForToday(records: TaskRecord[], localDate: string) {
  if (!isValidDateOnly(localDate)) throw new Error("INVALID_TASK_LOCAL_DATE");
  return openTasks(records).filter((record) => {
    const dueAt = record.data.due_at;
    return dueAt !== null && dueAt.slice(0, 10) <= localDate;
  });
}

function compareTasks(left: TaskRecord, right: TaskRecord) {
  const leftDue = left.data.due_at?.slice(0, 10) ?? "9999-12-31";
  const rightDue = right.data.due_at?.slice(0, 10) ?? "9999-12-31";
  return leftDue.localeCompare(rightDue)
    || PRIORITY_WEIGHT[right.data.priority] - PRIORITY_WEIGHT[left.data.priority]
    || right.created_at.localeCompare(left.created_at);
}
