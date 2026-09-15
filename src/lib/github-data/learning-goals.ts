import { parseRecord, updateWorkspaceRecord, type WorkspaceRecord } from "./protocol";

export const LEARNING_GOAL_VERSION = 1 as const;
export const LEARNING_GOAL_STATUSES = ["active", "completed", "archived"] as const;

export type LearningGoalStatus = typeof LEARNING_GOAL_STATUSES[number];
export type LearningGoalData = {
  learning_goal_version: typeof LEARNING_GOAL_VERSION;
  learning_area_id: string;
  title: string;
  description: string;
  target_date: string | null;
  status: LearningGoalStatus;
  success_criteria_markdown: string;
};
export type LearningGoalRecord = WorkspaceRecord<LearningGoalData>;
export type LearningGoalFields = Pick<LearningGoalData,
  "learning_area_id" | "title" | "description" | "target_date" | "success_criteria_markdown"
>;

export function createLearningGoalData(fields: LearningGoalFields): LearningGoalData {
  return validateData({ learning_goal_version: LEARNING_GOAL_VERSION, ...normalizeFields(fields), status: "active" });
}

export function updateLearningGoalDetails(
  current: LearningGoalRecord,
  fields: Omit<LearningGoalFields, "learning_area_id">,
  timestamp = new Date().toISOString(),
) {
  assertInstant(timestamp);
  return updateWorkspaceRecord(current, validateData({
    ...current.data,
    ...normalizeFields({ ...fields, learning_area_id: current.data.learning_area_id }),
  }), timestamp);
}

export function setLearningGoalStatus(
  current: LearningGoalRecord,
  status: LearningGoalStatus,
  timestamp = new Date().toISOString(),
) {
  assertInstant(timestamp);
  if (!LEARNING_GOAL_STATUSES.includes(status)) throw new Error("INVALID_LEARNING_GOAL_STATUS");
  return updateWorkspaceRecord(current, { ...current.data, status }, timestamp);
}

export function parseLearningGoalRecord(value: string): LearningGoalRecord {
  const record = parseRecord(value);
  if (record.entity_type !== "learning_goal") throw new Error("INVALID_LEARNING_GOAL_RECORD");
  try { validateData(record.data as LearningGoalData); }
  catch { throw new Error("INVALID_LEARNING_GOAL_RECORD"); }
  return record as LearningGoalRecord;
}

export function activeLearningGoals(records: LearningGoalRecord[]) {
  return records.filter((record) => record.deleted_at === null && record.data.status === "active")
    .sort(compareGoals);
}

export function completedLearningGoals(records: LearningGoalRecord[]) {
  return records.filter((record) => record.deleted_at === null && record.data.status === "completed")
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at) || compareGoals(left, right));
}

export function archivedLearningGoals(records: LearningGoalRecord[]) {
  return records.filter((record) => record.deleted_at === null && record.data.status === "archived")
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at) || compareGoals(left, right));
}

export function trashedLearningGoals(records: LearningGoalRecord[]) {
  return records.filter((record) => record.deleted_at !== null)
    .sort((left, right) => String(right.deleted_at).localeCompare(String(left.deleted_at)) || compareGoals(left, right));
}

function normalizeFields(fields: LearningGoalFields): LearningGoalFields {
  return {
    learning_area_id: fields.learning_area_id.trim(),
    title: fields.title.trim(),
    description: fields.description,
    target_date: fields.target_date,
    success_criteria_markdown: fields.success_criteria_markdown,
  };
}

function validateData(data: LearningGoalData): LearningGoalData {
  const expectedKeys = "description,learning_area_id,learning_goal_version,status,success_criteria_markdown,target_date,title";
  if (
    Object.keys(data).sort().join(",") !== expectedKeys
    || data.learning_goal_version !== LEARNING_GOAL_VERSION
    || !isStableId(data.learning_area_id)
    || typeof data.title !== "string" || !data.title.trim() || data.title.length > 300
    || typeof data.description !== "string" || data.description.length > 50_000
    || !(data.target_date === null || isDateOnly(data.target_date))
    || !LEARNING_GOAL_STATUSES.includes(data.status)
    || typeof data.success_criteria_markdown !== "string" || data.success_criteria_markdown.length > 50_000
  ) throw new Error("INVALID_LEARNING_GOAL_DETAILS");
  return data;
}

function compareGoals(left: LearningGoalRecord, right: LearningGoalRecord) {
  const leftDate = left.data.target_date ?? "9999-12-31";
  const rightDate = right.data.target_date ?? "9999-12-31";
  return leftDate.localeCompare(rightDate)
    || left.data.title.localeCompare(right.data.title, "zh-CN")
    || left.id.localeCompare(right.id);
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(value);
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function assertInstant(value: string) {
  if (Number.isNaN(Date.parse(value))) throw new Error("INVALID_LEARNING_GOAL_TIMESTAMP");
}
