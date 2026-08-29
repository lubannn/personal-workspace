import { parseRecord, updateWorkspaceRecord, type WorkspaceRecord } from "./protocol";

export type ProjectNoteData = {
  project_id: string;
  title: string;
  body_markdown: string;
  note_date: string;
};

export type ProjectNoteRecord = WorkspaceRecord<ProjectNoteData>;
export type ProjectNoteEditableFields = Pick<ProjectNoteData, "title" | "body_markdown" | "note_date">;

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
}

function isValidDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeDetails(details: ProjectNoteEditableFields): ProjectNoteEditableFields {
  const title = details.title.trim();
  if (
    !title
    || title.length > 300
    || typeof details.body_markdown !== "string"
    || details.body_markdown.length > 100_000
    || !isValidDateOnly(details.note_date)
  ) throw new Error("INVALID_PROJECT_NOTE_DETAILS");
  return { title, body_markdown: details.body_markdown, note_date: details.note_date };
}

export function parseProjectNoteRecord(value: string): ProjectNoteRecord {
  const record = parseRecord(value);
  const data = record.data;
  if (
    record.entity_type !== "project_note"
    || !isStableId(data.project_id)
    || typeof data.title !== "string"
    || !data.title.trim()
    || data.title.length > 300
    || typeof data.body_markdown !== "string"
    || data.body_markdown.length > 100_000
    || typeof data.note_date !== "string"
    || !isValidDateOnly(data.note_date)
  ) throw new Error("INVALID_PROJECT_NOTE_RECORD");
  return record as ProjectNoteRecord;
}

export function createProjectNoteData(input: {
  projectId: string;
  title: string;
  bodyMarkdown: string;
  noteDate: string;
}): ProjectNoteData {
  if (!isStableId(input.projectId)) throw new Error("INVALID_PROJECT_NOTE_DETAILS");
  const details = normalizeDetails({ title: input.title, body_markdown: input.bodyMarkdown, note_date: input.noteDate });
  return { project_id: input.projectId, ...details };
}

export function updateProjectNoteDetails(
  current: ProjectNoteRecord,
  details: ProjectNoteEditableFields,
  timestamp = new Date().toISOString(),
): ProjectNoteRecord {
  if (Number.isNaN(Date.parse(timestamp))) throw new Error("INVALID_PROJECT_NOTE_DETAILS");
  return updateWorkspaceRecord(current, { ...current.data, ...normalizeDetails(details) }, timestamp);
}

export function projectNotesForProject(records: ProjectNoteRecord[], projectId: string) {
  return records
    .filter((record) => record.deleted_at === null && record.data.project_id === projectId)
    .sort((left, right) => right.data.note_date.localeCompare(left.data.note_date) || right.updated_at.localeCompare(left.updated_at));
}
