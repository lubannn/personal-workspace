import { parseRecord, updateWorkspaceRecord, type WorkspaceRecord } from "./protocol";

export const MILESTONE_STATUSES = ["open", "completed", "cancelled"] as const;

export type MilestoneStatus = typeof MILESTONE_STATUSES[number];

export type MilestoneData = {
  project_id: string;
  title: string;
  description: string;
  target_date: string | null;
  status: MilestoneStatus;
  weight: number;
  completed_at: string | null;
  sort_order: number;
};

export type MilestoneRecord = WorkspaceRecord<MilestoneData>;

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
}

function isValidDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function hasValidTimestamp(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
}

export function parseMilestoneRecord(value: string): MilestoneRecord {
  const record = parseRecord(value);
  const data = record.data;
  if (
    record.entity_type !== "milestone"
    || !isStableId(data.project_id)
    || typeof data.title !== "string"
    || !data.title.trim()
    || data.title.length > 300
    || typeof data.description !== "string"
    || data.description.length > 50_000
    || !(data.target_date === null || (typeof data.target_date === "string" && isValidDateOnly(data.target_date)))
    || !MILESTONE_STATUSES.includes(data.status as MilestoneStatus)
    || typeof data.weight !== "number"
    || !Number.isFinite(data.weight)
    || data.weight <= 0
    || !hasValidTimestamp(data.completed_at)
    || !Number.isInteger(data.sort_order)
    || Number(data.sort_order) < 0
    || (data.status === "completed" && data.completed_at === null)
    || (data.status !== "completed" && data.completed_at !== null)
  ) throw new Error("INVALID_MILESTONE_RECORD");
  return record as MilestoneRecord;
}

export function createMilestoneData(input: {
  projectId: string;
  title: string;
  targetDate: string | null;
  sortOrder: number;
}): MilestoneData {
  const title = input.title.trim();
  if (
    !isStableId(input.projectId)
    || !title
    || title.length > 300
    || (input.targetDate !== null && !isValidDateOnly(input.targetDate))
    || !Number.isInteger(input.sortOrder)
    || input.sortOrder < 0
  ) throw new Error("INVALID_MILESTONE_DETAILS");
  return {
    project_id: input.projectId,
    title,
    description: "",
    target_date: input.targetDate,
    status: "open",
    weight: 1,
    completed_at: null,
    sort_order: input.sortOrder,
  };
}

export function setMilestoneStatus(
  current: MilestoneRecord,
  status: MilestoneStatus,
  timestamp = new Date().toISOString(),
): MilestoneRecord {
  if (Number.isNaN(Date.parse(timestamp))) throw new Error("INVALID_MILESTONE_STATUS_TIMESTAMP");
  return updateWorkspaceRecord(current, {
    ...current.data,
    status,
    completed_at: status === "completed" ? timestamp : null,
  }, timestamp);
}

export function milestonesForProject(records: MilestoneRecord[], projectId: string) {
  return records
    .filter((record) => record.deleted_at === null && record.data.project_id === projectId)
    .sort((left, right) => left.data.sort_order - right.data.sort_order || left.created_at.localeCompare(right.created_at));
}
