import { parseRecord, updateWorkspaceRecord, type WorkspaceRecord } from "./protocol";

export const LEARNING_AREA_VERSION = 1 as const;
export const LEARNING_AREA_STATUSES = ["active", "on_hold", "archived"] as const;

export type LearningAreaStatus = typeof LEARNING_AREA_STATUSES[number];
export type LearningAreaData = {
  learning_area_version: typeof LEARNING_AREA_VERSION;
  name: string;
  description_markdown: string;
  area_type: string;
  icon: string | null;
  color: string | null;
  status: LearningAreaStatus;
  settings_json: Record<string, unknown>;
};
export type LearningAreaRecord = WorkspaceRecord<LearningAreaData>;
export type LearningAreaFields = Pick<LearningAreaData, "name" | "description_markdown" | "area_type" | "icon" | "color">;

export function createLearningAreaData(fields: LearningAreaFields): LearningAreaData {
  return validateData({ learning_area_version: LEARNING_AREA_VERSION, ...normalizeFields(fields), status: "active", settings_json: {} });
}

export function updateLearningAreaDetails(current: LearningAreaRecord, fields: LearningAreaFields, timestamp = new Date().toISOString()) {
  assertInstant(timestamp);
  return updateWorkspaceRecord(current, validateData({ ...current.data, ...normalizeFields(fields) }), timestamp);
}

export function setLearningAreaStatus(current: LearningAreaRecord, status: LearningAreaStatus, timestamp = new Date().toISOString()) {
  assertInstant(timestamp);
  if (!LEARNING_AREA_STATUSES.includes(status)) throw new Error("INVALID_LEARNING_AREA_STATUS");
  return updateWorkspaceRecord(current, { ...current.data, status }, timestamp);
}

export function parseLearningAreaRecord(value: string): LearningAreaRecord {
  const record = parseRecord(value);
  if (record.entity_type !== "learning_area") throw new Error("INVALID_LEARNING_AREA_RECORD");
  try { validateData(record.data as LearningAreaData); }
  catch { throw new Error("INVALID_LEARNING_AREA_RECORD"); }
  return record as LearningAreaRecord;
}

export function activeLearningAreas(records: LearningAreaRecord[]) {
  return records.filter((record) => record.deleted_at === null && record.data.status !== "archived")
    .sort((left, right) => left.data.name.localeCompare(right.data.name, "zh-CN") || left.id.localeCompare(right.id));
}

export function archivedLearningAreas(records: LearningAreaRecord[]) {
  return records.filter((record) => record.deleted_at === null && record.data.status === "archived")
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export function trashedLearningAreas(records: LearningAreaRecord[]) {
  return records.filter((record) => record.deleted_at !== null)
    .sort((left, right) => String(right.deleted_at).localeCompare(String(left.deleted_at)));
}

function normalizeFields(fields: LearningAreaFields): LearningAreaFields {
  return {
    name: fields.name.trim(),
    description_markdown: fields.description_markdown,
    area_type: fields.area_type.trim().toLowerCase(),
    icon: fields.icon?.trim() || null,
    color: fields.color?.trim().toLowerCase() || null,
  };
}

function validateData(data: LearningAreaData): LearningAreaData {
  if (
    Object.keys(data).sort().join(",") !== "area_type,color,description_markdown,icon,learning_area_version,name,settings_json,status"
    || data.learning_area_version !== LEARNING_AREA_VERSION
    || typeof data.name !== "string" || !data.name.trim() || data.name.length > 200
    || typeof data.description_markdown !== "string" || data.description_markdown.length > 50_000
    || typeof data.area_type !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(data.area_type)
    || !(data.icon === null || (typeof data.icon === "string" && data.icon.length <= 32))
    || !(data.color === null || (typeof data.color === "string" && /^#[a-f0-9]{6}$/u.test(data.color)))
    || !LEARNING_AREA_STATUSES.includes(data.status)
    || !isPlainJsonObject(data.settings_json)
    || JSON.stringify(data.settings_json).length > 50_000
  ) throw new Error("INVALID_LEARNING_AREA_DETAILS");
  return data;
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try { return JSON.parse(JSON.stringify(value)) !== null; } catch { return false; }
}

function assertInstant(value: string) {
  if (Number.isNaN(Date.parse(value))) throw new Error("INVALID_LEARNING_AREA_TIMESTAMP");
}
