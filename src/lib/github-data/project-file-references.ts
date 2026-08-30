import { parseRecord, updateWorkspaceRecord, type WorkspaceRecord } from "./protocol";

export type ProjectFileReferenceData = {
  project_id: string;
  title: string;
  source_url: string;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  purpose: string;
  sort_order: number;
};

export type ProjectFileReferenceRecord = WorkspaceRecord<ProjectFileReferenceData>;

export type ProjectFileReferenceFields = Omit<ProjectFileReferenceData, "project_id">;

const STABLE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function normalizedUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("INVALID_PROJECT_FILE_REFERENCE_DETAILS");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.href.length > 2_000) {
    throw new Error("INVALID_PROJECT_FILE_REFERENCE_DETAILS");
  }
  return parsed.href;
}

function validateFields(fields: ProjectFileReferenceFields) {
  const title = fields.title.trim();
  const purpose = fields.purpose.trim();
  const originalFilename = fields.original_filename?.trim() || null;
  const mimeType = fields.mime_type?.trim().toLowerCase() || null;
  if (
    !title || title.length > 300
    || purpose.length > 500
    || (originalFilename !== null && originalFilename.length > 255)
    || (mimeType !== null && (mimeType.length > 255 || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mimeType)))
    || !(fields.size_bytes === null || (Number.isInteger(fields.size_bytes) && fields.size_bytes >= 0 && fields.size_bytes <= 5_000_000_000))
    || !(fields.sha256 === null || SHA256.test(fields.sha256))
    || !Number.isInteger(fields.sort_order) || fields.sort_order < 0
  ) throw new Error("INVALID_PROJECT_FILE_REFERENCE_DETAILS");
  return {
    title,
    source_url: normalizedUrl(fields.source_url),
    original_filename: originalFilename,
    mime_type: mimeType,
    size_bytes: fields.size_bytes,
    sha256: fields.sha256,
    purpose,
    sort_order: fields.sort_order,
  };
}

export function parseProjectFileReferenceRecord(value: string): ProjectFileReferenceRecord {
  const record = parseRecord(value);
  const data = record.data as Partial<ProjectFileReferenceData>;
  if (record.entity_type !== "project_file_reference" || typeof data.project_id !== "string" || !STABLE_ID.test(data.project_id)) {
    throw new Error("INVALID_PROJECT_FILE_REFERENCE_RECORD");
  }
  try {
    validateFields({
      title: data.title as string,
      source_url: data.source_url as string,
      original_filename: data.original_filename as string | null,
      mime_type: data.mime_type as string | null,
      size_bytes: data.size_bytes as number | null,
      sha256: data.sha256 as string | null,
      purpose: data.purpose as string,
      sort_order: data.sort_order as number,
    });
  } catch {
    throw new Error("INVALID_PROJECT_FILE_REFERENCE_RECORD");
  }
  return record as ProjectFileReferenceRecord;
}

export function createProjectFileReferenceData(projectId: string, fields: ProjectFileReferenceFields): ProjectFileReferenceData {
  if (!STABLE_ID.test(projectId)) throw new Error("INVALID_PROJECT_FILE_REFERENCE_DETAILS");
  return { project_id: projectId, ...validateFields(fields) };
}

export function updateProjectFileReference(
  current: ProjectFileReferenceRecord,
  fields: ProjectFileReferenceFields,
  timestamp = new Date().toISOString(),
) {
  if (Number.isNaN(Date.parse(timestamp))) throw new Error("INVALID_PROJECT_FILE_REFERENCE_DETAILS");
  return updateWorkspaceRecord(current, { project_id: current.data.project_id, ...validateFields(fields) }, timestamp);
}

export function projectFileReferences(projectId: string, records: ProjectFileReferenceRecord[]) {
  return records
    .filter((record) => record.deleted_at === null && record.data.project_id === projectId)
    .sort((left, right) => left.data.sort_order - right.data.sort_order || left.data.title.localeCompare(right.data.title) || left.id.localeCompare(right.id));
}
