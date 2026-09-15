import { parseRecord, updateWorkspaceRecord, type WorkspaceRecord } from "./protocol";

export const LEARNING_RESOURCE_VERSION = 1 as const;
export const LEARNING_RESOURCE_STATUSES = ["active", "completed", "archived"] as const;

export type LearningResourceStatus = typeof LEARNING_RESOURCE_STATUSES[number];
export type LearningResourceData = {
  learning_resource_version: typeof LEARNING_RESOURCE_VERSION;
  learning_area_id: string;
  title: string;
  resource_type: string;
  url: string;
  notes_markdown: string;
  status: LearningResourceStatus;
};
export type LearningResourceRecord = WorkspaceRecord<LearningResourceData>;
export type LearningResourceFields = Pick<LearningResourceData, "learning_area_id" | "title" | "resource_type" | "url" | "notes_markdown">;

export function createLearningResourceData(fields: LearningResourceFields): LearningResourceData {
  return validateData({ learning_resource_version: LEARNING_RESOURCE_VERSION, ...normalizeFields(fields), status: "active" });
}

export function updateLearningResourceDetails(current: LearningResourceRecord, fields: Omit<LearningResourceFields, "learning_area_id">, timestamp = new Date().toISOString()) {
  assertInstant(timestamp);
  return updateWorkspaceRecord(current, validateData({ ...current.data, ...normalizeFields({ ...fields, learning_area_id: current.data.learning_area_id }) }), timestamp);
}

export function setLearningResourceStatus(current: LearningResourceRecord, status: LearningResourceStatus, timestamp = new Date().toISOString()) {
  assertInstant(timestamp);
  if (!LEARNING_RESOURCE_STATUSES.includes(status)) throw new Error("INVALID_LEARNING_RESOURCE_STATUS");
  return updateWorkspaceRecord(current, { ...current.data, status }, timestamp);
}

export function parseLearningResourceRecord(value: string): LearningResourceRecord {
  const record = parseRecord(value);
  if (record.entity_type !== "learning_resource") throw new Error("INVALID_LEARNING_RESOURCE_RECORD");
  try { validateData(record.data as LearningResourceData); }
  catch { throw new Error("INVALID_LEARNING_RESOURCE_RECORD"); }
  return record as LearningResourceRecord;
}

export function activeLearningResources(records: LearningResourceRecord[]) { return records.filter((record) => record.deleted_at === null && record.data.status === "active").sort(compareResources); }
export function completedLearningResources(records: LearningResourceRecord[]) { return records.filter((record) => record.deleted_at === null && record.data.status === "completed").sort(compareUpdated); }
export function archivedLearningResources(records: LearningResourceRecord[]) { return records.filter((record) => record.deleted_at === null && record.data.status === "archived").sort(compareUpdated); }
export function trashedLearningResources(records: LearningResourceRecord[]) { return records.filter((record) => record.deleted_at !== null).sort((left, right) => String(right.deleted_at).localeCompare(String(left.deleted_at)) || compareResources(left, right)); }

function normalizeFields(fields: LearningResourceFields): LearningResourceFields {
  return { learning_area_id: fields.learning_area_id.trim(), title: fields.title.trim(), resource_type: fields.resource_type.trim().toLowerCase(), url: fields.url.trim(), notes_markdown: fields.notes_markdown };
}

function validateData(data: LearningResourceData): LearningResourceData {
  if (
    Object.keys(data).sort().join(",") !== "learning_area_id,learning_resource_version,notes_markdown,resource_type,status,title,url"
    || data.learning_resource_version !== LEARNING_RESOURCE_VERSION
    || !isStableId(data.learning_area_id)
    || typeof data.title !== "string" || !data.title.trim() || data.title.length > 300
    || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(data.resource_type)
    || !isWebUrl(data.url) || data.url.length > 2_000
    || typeof data.notes_markdown !== "string" || data.notes_markdown.length > 50_000
    || !LEARNING_RESOURCE_STATUSES.includes(data.status)
  ) throw new Error("INVALID_LEARNING_RESOURCE_DETAILS");
  return data;
}

function isStableId(value: unknown): value is string { return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(value); }
function isWebUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try { const url = new URL(value); return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname); }
  catch { return false; }
}
function compareResources(left: LearningResourceRecord, right: LearningResourceRecord) { return left.data.title.localeCompare(right.data.title, "zh-CN") || left.id.localeCompare(right.id); }
function compareUpdated(left: LearningResourceRecord, right: LearningResourceRecord) { return right.updated_at.localeCompare(left.updated_at) || compareResources(left, right); }
function assertInstant(value: string) { if (Number.isNaN(Date.parse(value))) throw new Error("INVALID_LEARNING_RESOURCE_TIMESTAMP"); }
