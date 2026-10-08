import { parseRecord, type WorkspaceRecord } from "./protocol";

export const NOTICE_MAX_LENGTH = 4_000;
export type NoticeData = { body: string };
export type NoticeRecord = WorkspaceRecord<NoticeData>;

export function createNoticeData(body: string): NoticeData {
  if (typeof body !== "string" || !body.trim() || body.length > NOTICE_MAX_LENGTH) throw new Error("INVALID_NOTICE");
  // Keep line breaks and intentional spacing; notices are always plain text.
  return { body };
}

export function parseNoticeRecord(text: string): NoticeRecord {
  const record = parseRecord(text);
  if (record.entity_type !== "notice"
    || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(record.id)
    || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(record.owner_id)
    || !Number.isSafeInteger(record.version)
    || typeof record.created_at !== "string" || Number.isNaN(Date.parse(record.created_at))
    || typeof record.updated_at !== "string" || Number.isNaN(Date.parse(record.updated_at))
    || (record.deleted_at !== null && (typeof record.deleted_at !== "string" || Number.isNaN(Date.parse(record.deleted_at))))
  ) throw new Error("INVALID_NOTICE");
  createNoticeData(record.data.body as string);
  return record as NoticeRecord;
}
