import { parseRecord, type WorkspaceRecord } from "./protocol";

export type JournalEntryData = {
  journal_date: string;
  timezone: string;
  title: string;
  body_markdown: string;
  mood: string | null;
  weather: string | null;
  entry_kind: "daily";
  first_entry_at: string;
  last_entry_at: string;
  sensitivity: "restricted";
  current_revision_id: string | null;
  obsidian_document_id: null;
  sync_status: "not_configured";
};

export type JournalEntryRecord = WorkspaceRecord<JournalEntryData>;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_ONLY = /^\d{4}-\d{2}$/;

export function createJournalEntryData(input: {
  journalDate: string;
  timezone: string;
  title?: string;
  bodyMarkdown: string;
  mood?: string;
  weather?: string;
  timestamp?: string;
  currentRevisionId?: string | null;
}): JournalEntryData {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const data: JournalEntryData = {
    journal_date: input.journalDate,
    timezone: input.timezone,
    title: input.title?.trim() ?? "",
    body_markdown: input.bodyMarkdown.trim(),
    mood: nullableText(input.mood),
    weather: nullableText(input.weather),
    entry_kind: "daily",
    first_entry_at: timestamp,
    last_entry_at: timestamp,
    sensitivity: "restricted",
    current_revision_id: input.currentRevisionId ?? null,
    obsidian_document_id: null,
    sync_status: "not_configured",
  };
  if (!isValidData(data)) throw new Error("INVALID_JOURNAL_ENTRY_DETAILS");
  return data;
}

export function updateJournalEntryData(current: JournalEntryRecord, input: {
  title?: string;
  bodyMarkdown: string;
  mood?: string;
  weather?: string;
  timestamp?: string;
  currentRevisionId?: string | null;
}): JournalEntryData {
  const data: JournalEntryData = {
    ...current.data,
    title: input.title?.trim() ?? "",
    body_markdown: input.bodyMarkdown.trim(),
    mood: nullableText(input.mood),
    weather: nullableText(input.weather),
    last_entry_at: input.timestamp ?? new Date().toISOString(),
    current_revision_id: input.currentRevisionId === undefined ? current.data.current_revision_id : input.currentRevisionId,
  };
  if (!isValidData(data)) throw new Error("INVALID_JOURNAL_ENTRY_DETAILS");
  return data;
}

export function parseJournalEntryRecord(value: string): JournalEntryRecord {
  const record = parseRecord(value);
  if (record.entity_type !== "journal_entry" || !isValidData(record.data)) throw new Error("INVALID_JOURNAL_ENTRY_RECORD");
  return record as JournalEntryRecord;
}

export function activeJournalEntries(records: JournalEntryRecord[]) {
  return [...records].filter((record) => record.deleted_at === null).sort(compareNewest);
}

export function trashedJournalEntries(records: JournalEntryRecord[]) {
  return [...records].filter((record) => record.deleted_at !== null)
    .sort((left, right) => String(right.deleted_at).localeCompare(String(left.deleted_at)) || compareNewest(left, right));
}

export function recentJournalEntries(records: JournalEntryRecord[], limit = 3) {
  if (!Number.isInteger(limit) || limit < 0) throw new Error("INVALID_JOURNAL_LIMIT");
  return activeJournalEntries(records).slice(0, limit);
}

export function filterJournalEntries(records: JournalEntryRecord[], input: {
  view: "active" | "trash";
  month?: string;
  query?: string;
}) {
  const month = input.month?.trim() ?? "";
  if (month && !isMonthOnly(month)) throw new Error("INVALID_JOURNAL_MONTH");
  const tokens = normalizeSearchText(input.query ?? "").split(" ").filter(Boolean);
  const source = input.view === "active" ? activeJournalEntries(records) : trashedJournalEntries(records);
  return source.filter((record) => {
    if (month && !record.data.journal_date.startsWith(`${month}-`)) return false;
    if (tokens.length === 0) return true;
    const searchable = normalizeSearchText([
      record.data.journal_date,
      record.data.title,
      record.data.body_markdown,
      record.data.mood ?? "",
      record.data.weather ?? "",
    ].join("\n"));
    return tokens.every((token) => searchable.includes(token));
  });
}

export function shiftJournalMonth(month: string, offset: number) {
  if (!isMonthOnly(month) || !Number.isInteger(offset)) throw new Error("INVALID_JOURNAL_MONTH");
  const [year, monthNumber] = month.split("-").map(Number);
  const shiftedIndex = year * 12 + monthNumber - 1 + offset;
  const shiftedYear = Math.floor(shiftedIndex / 12);
  const shiftedMonth = shiftedIndex % 12 + 1;
  if (shiftedYear < 1 || shiftedYear > 9999) throw new Error("INVALID_JOURNAL_MONTH");
  return `${String(shiftedYear).padStart(4, "0")}-${String(shiftedMonth).padStart(2, "0")}`;
}

export function hasActiveDailyJournalDate(records: JournalEntryRecord[], journalDate: string, excludingId?: string) {
  return records.some((record) => record.deleted_at === null && record.id !== excludingId && record.data.entry_kind === "daily" && record.data.journal_date === journalDate);
}

export function renderJournalEntryMarkdown(record: JournalEntryRecord) {
  const title = record.data.title || record.data.journal_date;
  return [
    "---",
    `schema_version: ${record.schema_version}`,
    `journal_id: ${JSON.stringify(record.id)}`,
    `journal_date: ${JSON.stringify(record.data.journal_date)}`,
    `timezone: ${JSON.stringify(record.data.timezone)}`,
    `entry_kind: ${JSON.stringify(record.data.entry_kind)}`,
    `sensitivity: ${JSON.stringify(record.data.sensitivity)}`,
    `record_version: ${record.version}`,
    "---",
    "",
    `# ${escapeMarkdownHeading(title)}`,
    "",
    record.data.mood ? `心情：${record.data.mood}` : "",
    record.data.weather ? `天气：${record.data.weather}` : "",
    record.data.mood || record.data.weather ? "" : "",
    record.data.body_markdown,
    "",
  ].filter((line, index, lines) => line !== "" || index === 0 || lines[index - 1] !== "").join("\n");
}

export function journalEntryMarkdownFileName(record: JournalEntryRecord) {
  return `personal-workspace-journal-${record.data.journal_date}.md`;
}

function isValidData(value: Record<string, unknown>): value is JournalEntryData {
  return typeof value.journal_date === "string" && isDateOnly(value.journal_date)
    && isTimezone(value.timezone)
    && typeof value.title === "string" && value.title.length <= 300
    && typeof value.body_markdown === "string" && value.body_markdown.length > 0 && value.body_markdown.length <= 2_000_000
    && (value.mood === null || (typeof value.mood === "string" && value.mood.length <= 100))
    && (value.weather === null || (typeof value.weather === "string" && value.weather.length <= 100))
    && value.entry_kind === "daily"
    && typeof value.first_entry_at === "string" && !Number.isNaN(Date.parse(value.first_entry_at))
    && typeof value.last_entry_at === "string" && !Number.isNaN(Date.parse(value.last_entry_at))
    && Date.parse(value.last_entry_at) >= Date.parse(value.first_entry_at)
    && value.sensitivity === "restricted"
    && (value.current_revision_id === null || isStableId(value.current_revision_id))
    && value.obsidian_document_id === null
    && value.sync_status === "not_configured";
}

function compareNewest(left: JournalEntryRecord, right: JournalEntryRecord) {
  return right.data.journal_date.localeCompare(left.data.journal_date) || right.updated_at.localeCompare(left.updated_at) || left.id.localeCompare(right.id);
}

function nullableText(value: string | undefined) {
  const text = value?.trim() ?? "";
  return text || null;
}

function isDateOnly(value: string) {
  if (!DATE_ONLY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isMonthOnly(value: string) {
  if (!MONTH_ONLY.test(value)) return false;
  const [year, month] = value.split("-").map(Number);
  return year >= 1 && month >= 1 && month <= 12;
}

function normalizeSearchText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function isTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 100) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
}

function escapeMarkdownHeading(value: string) {
  return value.replace(/\s+/g, " ").trim().replace(/([\\`*_{}\[\]()<>#+.!|\-])/g, "\\$1");
}
