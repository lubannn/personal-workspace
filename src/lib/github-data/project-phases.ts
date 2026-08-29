import { parseRecord, type WorkspaceRecord } from "./protocol";

export type ProjectPhaseData = {
  project_id: string;
  name: string;
  description: string;
  sort_order: number;
  started_at: string | null;
  completed_at: string | null;
  status: string;
};

export type ProjectPhaseRecord = WorkspaceRecord<ProjectPhaseData>;

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
}

function hasValidTimestamp(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
}

export function parseProjectPhaseRecord(value: string): ProjectPhaseRecord {
  const record = parseRecord(value);
  const data = record.data;
  if (
    record.entity_type !== "project_phase"
    || !isStableId(data.project_id)
    || typeof data.name !== "string"
    || !data.name.trim()
    || data.name.length > 300
    || typeof data.description !== "string"
    || data.description.length > 50_000
    || !Number.isInteger(data.sort_order)
    || Number(data.sort_order) < 0
    || !hasValidTimestamp(data.started_at)
    || !hasValidTimestamp(data.completed_at)
    || typeof data.status !== "string"
    || !data.status.trim()
  ) throw new Error("INVALID_PROJECT_PHASE_RECORD");
  return record as ProjectPhaseRecord;
}

export function createProjectPhaseData(input: {
  projectId: string;
  name: string;
  sortOrder: number;
  timestamp?: string;
}): ProjectPhaseData {
  const name = input.name.trim();
  const timestamp = input.timestamp ?? new Date().toISOString();
  if (
    !isStableId(input.projectId)
    || !name
    || name.length > 300
    || !Number.isInteger(input.sortOrder)
    || input.sortOrder < 0
    || Number.isNaN(Date.parse(timestamp))
  ) throw new Error("INVALID_PROJECT_PHASE_DETAILS");
  return {
    project_id: input.projectId,
    name,
    description: "",
    sort_order: input.sortOrder,
    started_at: timestamp,
    completed_at: null,
    status: "active",
  };
}

export function phasesForProject(records: ProjectPhaseRecord[], projectId: string) {
  return records
    .filter((record) => record.deleted_at === null && record.data.project_id === projectId)
    .sort((left, right) => left.data.sort_order - right.data.sort_order || left.created_at.localeCompare(right.created_at));
}
