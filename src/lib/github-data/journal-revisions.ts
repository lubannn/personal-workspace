import { isJournalChangeReason, type JournalChangeReason } from "./journal-segment-codec";
import { parseRecord, type WorkspaceRecord } from "./protocol";

export const JOURNAL_REVISION_CREATORS = ["owner", "legacy_importer", "sync_resolution", "migration"] as const;

export type JournalRevisionCreator = (typeof JOURNAL_REVISION_CREATORS)[number];
export type JournalRevisionContentMode = "body" | "segments";

export type JournalRevisionData = {
  journal_entry_id: string;
  revision_number: number;
  content_mode: JournalRevisionContentMode;
  body_markdown: string;
  segment_ids: string[];
  content_sha256: string;
  created_at: string;
  created_by: JournalRevisionCreator;
  change_reason: JournalChangeReason;
};

export type JournalRevisionRecord = WorkspaceRecord<JournalRevisionData>;

export function createJournalRevisionData(input: {
  journalEntryId: string;
  revisionNumber: number;
  contentMode: JournalRevisionContentMode;
  bodyMarkdown: string;
  segmentIds?: string[];
  contentSha256: string;
  createdAt?: string;
  createdBy: JournalRevisionCreator;
  changeReason: JournalChangeReason;
}): JournalRevisionData {
  const data: JournalRevisionData = {
    journal_entry_id: input.journalEntryId,
    revision_number: input.revisionNumber,
    content_mode: input.contentMode,
    body_markdown: input.bodyMarkdown.trim(),
    segment_ids: [...(input.segmentIds ?? [])],
    content_sha256: input.contentSha256,
    created_at: input.createdAt ?? new Date().toISOString(),
    created_by: input.createdBy,
    change_reason: input.changeReason,
  };
  if (!isValidJournalRevisionData(data)) throw new Error("INVALID_JOURNAL_REVISION_DETAILS");
  return data;
}

export function parseJournalRevisionRecord(value: string): JournalRevisionRecord {
  const record = parseRecord(value);
  if (
    record.entity_type !== "journal_revision"
    || record.version !== 1
    || record.deleted_at !== null
    || record.updated_at !== record.created_at
    || !isInstant(record.created_at)
    || !isValidJournalRevisionData(record.data)
    || record.data.created_at !== record.created_at
  ) throw new Error("INVALID_JOURNAL_REVISION_RECORD");
  return record as JournalRevisionRecord;
}

export async function sha256JournalRevisionBody(bodyMarkdown: string) {
  const normalized = bodyMarkdown.trim();
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isValidJournalRevisionData(value: Record<string, unknown>): value is JournalRevisionData {
  if (
    !isStableId(value.journal_entry_id)
    || !Number.isInteger(value.revision_number)
    || Number(value.revision_number) < 1
    || Number(value.revision_number) > 1_000_000
    || (value.content_mode !== "body" && value.content_mode !== "segments")
    || typeof value.body_markdown !== "string"
    || value.body_markdown !== value.body_markdown.trim()
    || value.body_markdown.length === 0
    || value.body_markdown.length > 20_000_000
    || !Array.isArray(value.segment_ids)
    || value.segment_ids.length > 10_000
    || value.segment_ids.some((id) => !isStableId(id))
    || new Set(value.segment_ids).size !== value.segment_ids.length
    || typeof value.content_sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(value.content_sha256)
    || !isInstant(value.created_at)
    || !JOURNAL_REVISION_CREATORS.includes(value.created_by as JournalRevisionCreator)
    || !isJournalChangeReason(value.change_reason)
  ) return false;
  return value.content_mode === "body" ? value.segment_ids.length === 0 : value.segment_ids.length > 0;
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
}

function isInstant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
}
