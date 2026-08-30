export const GITHUB_DATA_SCHEMA_VERSION = 1 as const;

export type EntityType =
  | "capture"
  | "task"
  | "project"
  | "project_phase"
  | "milestone"
  | "project_note"
  | "project_file_reference"
  | "activity_event"
  | "calendar_event"
  | "journal"
  | "learning"
  | "habit"
  | "health";

export type WorkspaceRecord<TData extends Record<string, unknown> = Record<string, unknown>> = {
  schema_version: typeof GITHUB_DATA_SCHEMA_VERSION;
  entity_type: EntityType;
  id: string;
  owner_id: string;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  data: TData;
};

const ENTITY_DIRECTORIES: Record<Exclude<EntityType, "journal">, string> = {
  capture: "captures",
  task: "tasks",
  project: "projects",
  project_phase: "project-phases",
  milestone: "milestones",
  project_note: "project-notes",
  project_file_reference: "project-file-references",
  activity_event: "activity-events",
  calendar_event: "calendar-events",
  learning: "learning",
  habit: "habits",
  health: "health",
};

function assertStableId(value: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) throw new Error("INVALID_RECORD_ID");
}

export function recordPath(entityType: EntityType, id: string, localDate?: string) {
  assertStableId(id);
  if (entityType === "journal") {
    if (!localDate || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new Error("INVALID_JOURNAL_DATE");
    return `journal/${localDate.slice(0, 4)}/${id}.md`;
  }
  return `data/${ENTITY_DIRECTORIES[entityType]}/${id}.json`;
}

export function createWorkspaceRecord<TData extends Record<string, unknown>>(input: {
  entityType: EntityType;
  id: string;
  ownerId: string;
  data: TData;
  timestamp?: string;
}): WorkspaceRecord<TData> {
  assertStableId(input.id);
  assertStableId(input.ownerId);
  const timestamp = input.timestamp ?? new Date().toISOString();
  return {
    schema_version: GITHUB_DATA_SCHEMA_VERSION,
    entity_type: input.entityType,
    id: input.id,
    owner_id: input.ownerId,
    version: 1,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
    data: input.data,
  };
}

export function updateWorkspaceRecord<TData extends Record<string, unknown>>(
  current: WorkspaceRecord<TData>,
  data: TData,
  timestamp = new Date().toISOString(),
): WorkspaceRecord<TData> {
  return { ...current, version: current.version + 1, updated_at: timestamp, data };
}

export function setWorkspaceRecordDeleted<TData extends Record<string, unknown>>(
  current: WorkspaceRecord<TData>,
  deletedAt: string | null,
  timestamp = new Date().toISOString(),
): WorkspaceRecord<TData> {
  if (deletedAt !== null && Number.isNaN(Date.parse(deletedAt))) throw new Error("INVALID_DELETED_AT");
  if (Number.isNaN(Date.parse(timestamp))) throw new Error("INVALID_UPDATED_AT");
  return {
    ...current,
    version: current.version + 1,
    updated_at: timestamp,
    deleted_at: deletedAt,
  };
}

export function serializeRecord(record: WorkspaceRecord) {
  if (record.schema_version !== GITHUB_DATA_SCHEMA_VERSION || record.version < 1) throw new Error("INVALID_RECORD");
  return `${JSON.stringify(record, null, 2)}\n`;
}

export function parseRecord(value: string): WorkspaceRecord {
  const parsed = JSON.parse(value) as Partial<WorkspaceRecord>;
  if (
    parsed.schema_version !== GITHUB_DATA_SCHEMA_VERSION
    || typeof parsed.entity_type !== "string"
    || typeof parsed.id !== "string"
    || typeof parsed.owner_id !== "string"
    || typeof parsed.version !== "number"
    || parsed.version < 1
    || !parsed.data
    || typeof parsed.data !== "object"
  ) throw new Error("UNSUPPORTED_OR_INVALID_RECORD");
  return parsed as WorkspaceRecord;
}
