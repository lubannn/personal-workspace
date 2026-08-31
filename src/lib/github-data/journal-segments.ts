import { createJournalSegmentSnapshot, type JournalSegmentSourceRef } from "./journal-segment-codec";
import { parseRecord, type WorkspaceRecord } from "./protocol";

export type JournalSegmentData = {
  journal_entry_id: string;
  local_time: string | null;
  occurred_at: string | null;
  body_markdown: string;
  sort_order: number;
  source_ref: JournalSegmentSourceRef | null;
};

export type JournalSegmentRecord = WorkspaceRecord<JournalSegmentData>;

export function createJournalSegmentData(input: {
  id: string;
  journalEntryId: string;
  localTime?: string | null;
  occurredAt?: string | null;
  bodyMarkdown: string;
  sortOrder: number;
  sourceRef?: JournalSegmentSourceRef | null;
}): JournalSegmentData {
  const snapshot = createJournalSegmentSnapshot(input);
  return {
    journal_entry_id: snapshot.journal_entry_id,
    local_time: snapshot.local_time,
    occurred_at: snapshot.occurred_at,
    body_markdown: snapshot.body_markdown,
    sort_order: snapshot.sort_order,
    source_ref: snapshot.source_ref,
  };
}

export function parseJournalSegmentRecord(value: string): JournalSegmentRecord {
  const record = parseRecord(value);
  if (record.entity_type !== "journal_segment" || record.version !== 1 || record.deleted_at !== null || record.updated_at !== record.created_at || !isInstant(record.created_at)) {
    throw new Error("INVALID_JOURNAL_SEGMENT_RECORD");
  }
  try {
    const data = record.data as Partial<JournalSegmentData>;
    const canonical = createJournalSegmentData({
      id: record.id,
      journalEntryId: String(data.journal_entry_id ?? ""),
      localTime: data.local_time === null ? null : String(data.local_time ?? ""),
      occurredAt: data.occurred_at === null ? null : String(data.occurred_at ?? ""),
      bodyMarkdown: String(data.body_markdown ?? ""),
      sortOrder: Number(data.sort_order),
      sourceRef: parseSourceRef(data.source_ref),
    });
    if (!sameSegmentData(data, canonical)) throw new Error();
    return record as JournalSegmentRecord;
  } catch {
    throw new Error("INVALID_JOURNAL_SEGMENT_RECORD");
  }
}

function parseSourceRef(value: unknown): JournalSegmentSourceRef | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  if (keys.join(",") !== "import_batch_id,source_locator,source_type") throw new Error();
  return {
    source_type: String(source.source_type ?? "") as "legacy_word",
    import_batch_id: String(source.import_batch_id ?? ""),
    source_locator: String(source.source_locator ?? ""),
  };
}

function sameSegmentData(value: Partial<JournalSegmentData>, canonical: JournalSegmentData) {
  return value.journal_entry_id === canonical.journal_entry_id
    && value.local_time === canonical.local_time
    && value.occurred_at === canonical.occurred_at
    && value.body_markdown === canonical.body_markdown
    && value.sort_order === canonical.sort_order
    && sameSourceRef(value.source_ref, canonical.source_ref);
}

function sameSourceRef(left: JournalSegmentSourceRef | null | undefined, right: JournalSegmentSourceRef | null) {
  if (left === null || left === undefined || right === null) return left === right;
  return left.source_type === right.source_type
    && left.import_batch_id === right.import_batch_id
    && left.source_locator === right.source_locator;
}

function isInstant(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
}
