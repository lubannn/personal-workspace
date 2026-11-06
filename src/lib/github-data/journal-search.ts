import { gzipSync, gunzipSync, strFromU8, strToU8 } from "fflate";
import type { GitHubDirectoryItem } from "./github-contents";
import { journalEntrySubmittedTime, parseJournalEntryRecord, type JournalEntryRecord } from "./journal-entries";
import { journalDisplaySegments } from "./journal-display";
import { parseJournalSegmentsMarkdown } from "./journal-segment-codec";
import { recordPath } from "./protocol";

export const JOURNAL_SEARCH_PATH = "data/journal-search/index-v1.json";
const MAX_RAW_BYTES = 64 * 1024 * 1024;
const MAX_PACKED_BYTES = 16 * 1024 * 1024;
const entryPath = /^data\/journal-entries\/[a-zA-Z0-9_-]+\.json$/u;
const sha = /^[a-f0-9]{40}$/u;
const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/u.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export type JournalSearchFile = { blobSha: string; id: string; date: string; firstEntryAt: string; deleted: boolean; segments: { time: string | null; body: string }[] };
export type JournalSearchIndex = { version: 1; ownerId: string; files: Record<string, JournalSearchFile> };
export type JournalSearchRow = { path: string; id: string; date: string; time: string | null; body: string; normalized: string; firstEntryAt: string; segmentIndex: number };
export const emptyJournalSearchIndex = (ownerId: string): JournalSearchIndex => ({ version: 1, ownerId, files: {} });
export const normalizeJournalSearch = (text: string) => text.replace(/<!--[\s\S]*?-->/gu, "").normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();

export function journalSearchFile(record: JournalEntryRecord, blobSha: string, ownerId: string): JournalSearchFile {
  if (record.owner_id !== ownerId || !sha.test(blobSha)) throw new Error("JOURNAL_SEARCH_SOURCE_MISMATCH");
  const body = record.data.body_markdown;
  if (body.startsWith("<!-- pw-journal-segments:v1:")) parseJournalSegmentsMarkdown(body);
  return { blobSha, id: record.id, date: record.data.journal_date, firstEntryAt: record.data.first_entry_at, deleted: record.deleted_at !== null,
    segments: record.deleted_at !== null ? [] : journalDisplaySegments(body, journalEntrySubmittedTime(record).slice(0, 5)) };
}

export function journalSearchSource(text: string, path: string, blobSha: string, ownerId: string) {
  const record = parseJournalEntryRecord(text);
  if (recordPath("journal_entry", record.id) !== path) throw new Error("JOURNAL_SEARCH_SOURCE_MISMATCH");
  return journalSearchFile(record, blobSha, ownerId);
}

export function verifiedJournalSearch(index: JournalSearchIndex, catalog: readonly GitHubDirectoryItem[]) {
  const candidates = catalog.filter((file) => file.type === "file" && entryPath.test(file.path));
  const files = Object.fromEntries(candidates.flatMap((file) => index.files[file.path]?.blobSha === file.blobSha ? [[file.path, index.files[file.path]]] : []));
  return { index: { ...index, files }, missing: candidates.filter((file) => !files[file.path]), total: candidates.length };
}

const preparedFiles = new WeakMap<JournalSearchFile, JournalSearchRow[]>();
export function prepareJournalSearch(index: JournalSearchIndex): JournalSearchRow[] {
  return Object.entries(index.files).flatMap(([path, file]) => {
    if (file.deleted) return [];
    let rows = preparedFiles.get(file);
    if (!rows) {
      rows = file.segments.map((segment, segmentIndex) => ({ path, id: file.id, date: file.date, time: segment.time, body: segment.body,
        normalized: normalizeJournalSearch(segment.body), firstEntryAt: file.firstEntryAt, segmentIndex }));
      preparedFiles.set(file, rows);
    }
    return rows;
  })
    .sort((left, right) => right.date.localeCompare(left.date) || (right.time ?? "").localeCompare(left.time ?? "")
      || Date.parse(left.firstEntryAt) - Date.parse(right.firstEntryAt) || left.id.localeCompare(right.id) || left.segmentIndex - right.segmentIndex);
}

export function searchAllJournals(rows: readonly JournalSearchRow[], query: string, limit = 30) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("INVALID_JOURNAL_SEARCH_LIMIT");
  const tokens = normalizeJournalSearch(query).split(" ").filter(Boolean);
  if (!tokens.length) return { total: 0, rows: [] as JournalSearchRow[] };
  let total = 0;
  const matches: JournalSearchRow[] = [];
  for (const row of rows) if (tokens.every((token) => row.normalized.includes(token))) { total++; if (matches.length < limit) matches.push(row); }
  return { total, rows: matches };
}

function validateIndex(value: unknown, ownerId: string): JournalSearchIndex {
  const index = value as JournalSearchIndex;
  if (!index || index.version !== 1 || index.ownerId !== ownerId || !index.files || Array.isArray(index.files) || typeof index.files !== "object" || Object.keys(index.files).length > 50_000) throw new Error("INVALID_JOURNAL_SEARCH_INDEX");
  for (const [path, file] of Object.entries(index.files)) {
    if (!entryPath.test(path) || !file || !sha.test(file.blobSha) || typeof file.id !== "string" || recordPath("journal_entry", file.id) !== path || typeof file.date !== "string" || !date(file.date)
      || typeof file.firstEntryAt !== "string" || !Number.isFinite(Date.parse(file.firstEntryAt)) || typeof file.deleted !== "boolean" || !Array.isArray(file.segments) || file.segments.length > 10_000
      || file.segments.some((segment) => !segment || (segment.time !== null && !time.test(segment.time)) || typeof segment.body !== "string" || segment.body.length > 2_000_000)) throw new Error("INVALID_JOURNAL_SEARCH_INDEX");
  }
  return index;
}

export function packJournalSearch(index: JournalSearchIndex) {
  validateIndex(index, index.ownerId);
  const raw = strToU8(JSON.stringify(index));
  if (raw.length > MAX_RAW_BYTES) throw new Error("JOURNAL_SEARCH_INDEX_TOO_LARGE");
  const bytes = gzipSync(raw);
  if (bytes.length > MAX_PACKED_BYTES) throw new Error("JOURNAL_SEARCH_INDEX_TOO_LARGE");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return JSON.stringify({ format: "journal-search-gzip-v1", bytes: raw.length, payload: btoa(binary) }) + "\n";
}

export function unpackJournalSearch(text: string, ownerId: string) {
  if (text.length > MAX_PACKED_BYTES * 1.4) throw new Error("JOURNAL_SEARCH_INDEX_TOO_LARGE");
  const packed = JSON.parse(text);
  if (packed.format !== "journal-search-gzip-v1" || !Number.isSafeInteger(packed.bytes) || packed.bytes < 1 || packed.bytes > MAX_RAW_BYTES || typeof packed.payload !== "string") throw new Error("INVALID_JOURNAL_SEARCH_INDEX");
  const bytes = Uint8Array.from(atob(packed.payload), (char) => char.charCodeAt(0));
  if (bytes.length < 18 || bytes.length > MAX_PACKED_BYTES || new DataView(bytes.buffer).getUint32(bytes.length - 4, true) !== packed.bytes) throw new Error("INVALID_JOURNAL_SEARCH_INDEX");
  const raw = gunzipSync(bytes, { out: new Uint8Array(packed.bytes) });
  if (raw.length !== packed.bytes) throw new Error("INVALID_JOURNAL_SEARCH_INDEX");
  return validateIndex(JSON.parse(strFromU8(raw)), ownerId);
}
