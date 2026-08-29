import { parseRecord, type WorkspaceRecord } from "./protocol";

export type ActivityChangeValue = string | number | boolean | null;
export type ActivityChangeSummary = Record<string, ActivityChangeValue>;

export type ActivityEventData = {
  entity_type: "project";
  entity_id: string;
  event_type: string;
  occurred_at: string;
  actor_type: "user" | "system";
  actor_id: string;
  change_summary_json: ActivityChangeSummary;
  source_ref: string | null;
};

export type ActivityEventRecord = WorkspaceRecord<ActivityEventData>;

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
}

function isValidSummary(value: unknown): value is ActivityChangeSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 50 && entries.every(([key, item]) => (
    Boolean(key)
    && key.length <= 100
    && (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean")
    && (typeof item !== "string" || item.length <= 5_000)
    && (typeof item !== "number" || Number.isFinite(item))
  ));
}

export function parseActivityEventRecord(value: string): ActivityEventRecord {
  const record = parseRecord(value);
  const data = record.data;
  if (
    record.entity_type !== "activity_event"
    || record.version !== 1
    || record.deleted_at !== null
    || data.entity_type !== "project"
    || !isStableId(data.entity_id)
    || typeof data.event_type !== "string"
    || !data.event_type.trim()
    || data.event_type.length > 100
    || typeof data.occurred_at !== "string"
    || Number.isNaN(Date.parse(data.occurred_at))
    || (data.actor_type !== "user" && data.actor_type !== "system")
    || !isStableId(data.actor_id)
    || !isValidSummary(data.change_summary_json)
    || !(data.source_ref === null || (typeof data.source_ref === "string" && data.source_ref.length <= 500))
  ) throw new Error("INVALID_ACTIVITY_EVENT_RECORD");
  return record as ActivityEventRecord;
}

export function createActivityEventData(input: {
  projectId: string;
  eventType: string;
  occurredAt: string;
  actorId: string;
  changeSummary: ActivityChangeSummary;
  sourceRef?: string | null;
}): ActivityEventData {
  const data: ActivityEventData = {
    entity_type: "project",
    entity_id: input.projectId,
    event_type: input.eventType.trim(),
    occurred_at: input.occurredAt,
    actor_type: "user",
    actor_id: input.actorId,
    change_summary_json: input.changeSummary,
    source_ref: input.sourceRef ?? null,
  };
  if (!isStableId(input.projectId) || !isStableId(input.actorId)) throw new Error("INVALID_ACTIVITY_EVENT_DETAILS");
  const synthetic = JSON.stringify({
    schema_version: 1,
    entity_type: "activity_event",
    id: "activity_validation",
    owner_id: input.actorId,
    version: 1,
    created_at: input.occurredAt,
    updated_at: input.occurredAt,
    deleted_at: null,
    data,
  });
  try {
    parseActivityEventRecord(synthetic);
  } catch {
    throw new Error("INVALID_ACTIVITY_EVENT_DETAILS");
  }
  return data;
}

export function activityEventsForProject(records: ActivityEventRecord[], projectId: string) {
  return records
    .filter((record) => record.data.entity_type === "project" && record.data.entity_id === projectId)
    .sort((left, right) => right.data.occurred_at.localeCompare(left.data.occurred_at) || right.created_at.localeCompare(left.created_at));
}
