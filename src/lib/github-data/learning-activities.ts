import { parseRecord, updateWorkspaceRecord, type WorkspaceRecord } from "./protocol";

export const LEARNING_ACTIVITY_VERSION = 1 as const;

export type LearningActivityData = {
  learning_activity_version: typeof LEARNING_ACTIVITY_VERSION;
  learning_area_id: string;
  goal_id: string | null;
  activity_type: string;
  title: string;
  occurred_at: string;
  duration_minutes: number;
  quantity: number | null;
  unit: string | null;
  notes_markdown: string;
  linked_task_id: string | null;
  source_ref: string | null;
};
export type LearningActivityRecord = WorkspaceRecord<LearningActivityData>;
export type LearningActivityFields = Omit<LearningActivityData, "learning_activity_version">;

export function createLearningActivityData(fields: LearningActivityFields): LearningActivityData {
  return validateData({ learning_activity_version: LEARNING_ACTIVITY_VERSION, ...normalizeFields(fields) });
}

export function updateLearningActivityDetails(
  current: LearningActivityRecord,
  fields: Omit<LearningActivityFields, "learning_area_id" | "goal_id">,
  timestamp = new Date().toISOString(),
) {
  assertInstant(timestamp);
  return updateWorkspaceRecord(current, validateData({
    ...current.data,
    ...normalizeFields({ ...fields, learning_area_id: current.data.learning_area_id, goal_id: current.data.goal_id }),
  }), timestamp);
}

export function parseLearningActivityRecord(value: string): LearningActivityRecord {
  const record = parseRecord(value);
  if (record.entity_type !== "learning_activity") throw new Error("INVALID_LEARNING_ACTIVITY_RECORD");
  try { validateData(record.data as LearningActivityData); }
  catch { throw new Error("INVALID_LEARNING_ACTIVITY_RECORD"); }
  return record as LearningActivityRecord;
}

export function activeLearningActivities(records: LearningActivityRecord[]) {
  return records.filter((record) => record.deleted_at === null).sort(compareActivities);
}

export function trashedLearningActivities(records: LearningActivityRecord[]) {
  return records.filter((record) => record.deleted_at !== null)
    .sort((left, right) => String(right.deleted_at).localeCompare(String(left.deleted_at)) || compareActivities(left, right));
}

function normalizeFields(fields: LearningActivityFields): LearningActivityFields {
  return {
    learning_area_id: fields.learning_area_id.trim(),
    goal_id: fields.goal_id,
    activity_type: fields.activity_type.trim(),
    title: fields.title.trim(),
    occurred_at: fields.occurred_at,
    duration_minutes: fields.duration_minutes,
    quantity: fields.quantity,
    unit: fields.unit === null ? null : fields.unit.trim(),
    notes_markdown: fields.notes_markdown,
    linked_task_id: fields.linked_task_id,
    source_ref: fields.source_ref === null ? null : fields.source_ref.trim(),
  };
}

function validateData(data: LearningActivityData): LearningActivityData {
  const expectedKeys = "activity_type,duration_minutes,goal_id,learning_activity_version,learning_area_id,linked_task_id,notes_markdown,occurred_at,quantity,source_ref,title,unit";
  const quantityPair = (data.quantity === null && data.unit === null)
    || (typeof data.quantity === "number" && Number.isFinite(data.quantity) && data.quantity > 0 && typeof data.unit === "string" && Boolean(data.unit) && data.unit.length <= 64);
  if (
    Object.keys(data).sort().join(",") !== expectedKeys
    || data.learning_activity_version !== LEARNING_ACTIVITY_VERSION
    || !isStableId(data.learning_area_id)
    || !(data.goal_id === null || isStableId(data.goal_id))
    || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(data.activity_type)
    || typeof data.title !== "string" || !data.title.trim() || data.title.length > 300
    || !isInstant(data.occurred_at)
    || !Number.isSafeInteger(data.duration_minutes) || data.duration_minutes < 1 || data.duration_minutes > 10_080
    || !quantityPair
    || typeof data.notes_markdown !== "string" || data.notes_markdown.length > 50_000
    || !(data.linked_task_id === null || isStableId(data.linked_task_id))
    || !(data.source_ref === null || (typeof data.source_ref === "string" && Boolean(data.source_ref) && data.source_ref.length <= 2_000))
  ) throw new Error("INVALID_LEARNING_ACTIVITY_DETAILS");
  return data;
}

function compareActivities(left: LearningActivityRecord, right: LearningActivityRecord) {
  return right.data.occurred_at.localeCompare(left.data.occurred_at) || right.id.localeCompare(left.id);
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(value);
}

function isInstant(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function assertInstant(value: string) {
  if (!isInstant(value)) throw new Error("INVALID_LEARNING_ACTIVITY_TIMESTAMP");
}
