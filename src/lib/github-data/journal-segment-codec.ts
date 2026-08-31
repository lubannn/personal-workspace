const STABLE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const TIME_ONLY = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const ROOT_PREFIX = "<!-- pw-journal-segments:v1:";
const SEGMENT_PREFIX = "<!-- pw-journal-segment:v1:";
const MARKER_SUFFIX = " -->";
const END_MARKER = "<!-- pw-journal-segment:end -->";
const RESERVED_MARKER_PREFIX = "<!-- pw-journal-";
const MAX_SEGMENTS_PER_ENTRY = 10_000;
const MAX_DOCUMENT_LENGTH = 20_000_000;

export const JOURNAL_CHANGE_REASONS = [
  "initial_create",
  "manual_edit",
  "segment_restructure",
  "legacy_import",
  "legacy_import_correction",
  "sync_conflict_resolution",
  "schema_migration",
] as const;

export type JournalChangeReason = (typeof JOURNAL_CHANGE_REASONS)[number];

export type JournalSegmentSourceRef = {
  source_type: "legacy_word";
  import_batch_id: string;
  source_locator: string;
};

export type JournalSegmentSnapshot = {
  id: string;
  journal_entry_id: string;
  local_time: string | null;
  occurred_at: string | null;
  body_markdown: string;
  sort_order: number;
  source_ref: JournalSegmentSourceRef | null;
};

export function isJournalChangeReason(value: unknown): value is JournalChangeReason {
  return typeof value === "string" && (JOURNAL_CHANGE_REASONS as readonly string[]).includes(value);
}

export function createJournalSegmentSnapshot(input: {
  id: string;
  journalEntryId: string;
  localTime?: string | null;
  occurredAt?: string | null;
  bodyMarkdown: string;
  sortOrder: number;
  sourceRef?: JournalSegmentSourceRef | null;
}): JournalSegmentSnapshot {
  const snapshot: JournalSegmentSnapshot = {
    id: input.id,
    journal_entry_id: input.journalEntryId,
    local_time: input.localTime ?? null,
    occurred_at: input.occurredAt ?? null,
    body_markdown: normalizeBody(input.bodyMarkdown),
    sort_order: input.sortOrder,
    source_ref: input.sourceRef ? {
      source_type: input.sourceRef.source_type,
      import_batch_id: input.sourceRef.import_batch_id,
      source_locator: input.sourceRef.source_locator,
    } : null,
  };
  assertSegment(snapshot);
  return snapshot;
}

export function renderJournalSegmentsMarkdown(journalEntryId: string, segments: JournalSegmentSnapshot[]) {
  assertStableId(journalEntryId);
  const ordered = normalizeSegments(journalEntryId, segments);
  if (ordered.length === 0) throw new Error("JOURNAL_SEGMENTS_REQUIRED");
  const lines = [marker(ROOT_PREFIX, { journal_entry_id: journalEntryId })];
  for (const segment of ordered) {
    lines.push(
      marker(SEGMENT_PREFIX, {
        id: segment.id,
        local_time: segment.local_time,
        occurred_at: segment.occurred_at,
        sort_order: segment.sort_order,
        source_ref: segment.source_ref,
      }),
      segment.local_time ? `## ${segment.local_time}` : "## 未记录时间",
      "",
      ...segment.body_markdown.split("\n").map(escapeReservedMarkerLine),
      END_MARKER,
    );
  }
  const output = `${lines.join("\n")}\n`;
  if (output.length > MAX_DOCUMENT_LENGTH) throw new Error("JOURNAL_SEGMENT_DOCUMENT_TOO_LARGE");
  return output;
}

export function parseJournalSegmentsMarkdown(value: string) {
  if (value.length > MAX_DOCUMENT_LENGTH) throw new Error("JOURNAL_SEGMENT_DOCUMENT_TOO_LARGE");
  const normalized = value.replace(/\r\n?/g, "\n");
  const lines = normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
  const root = parseMarker(lines[0] ?? "", ROOT_PREFIX) as { journal_entry_id?: unknown };
  assertExactKeys(root, ["journal_entry_id"]);
  if (typeof root.journal_entry_id !== "string") throw new Error("INVALID_JOURNAL_SEGMENT_DOCUMENT");
  assertStableId(root.journal_entry_id);
  const segments: JournalSegmentSnapshot[] = [];
  let index = 1;
  while (index < lines.length) {
    const metadata = parseMarker(lines[index] ?? "", SEGMENT_PREFIX) as Record<string, unknown>;
    assertExactKeys(metadata, ["id", "local_time", "occurred_at", "sort_order", "source_ref"]);
    index += 1;
    const expectedHeading = metadata.local_time === null ? "## 未记录时间" : `## ${String(metadata.local_time)}`;
    if (lines[index] !== expectedHeading || lines[index + 1] !== "") throw new Error("INVALID_JOURNAL_SEGMENT_DOCUMENT");
    index += 2;
    const bodyLines: string[] = [];
    while (index < lines.length && lines[index] !== END_MARKER) {
      bodyLines.push(unescapeReservedMarkerLine(lines[index]));
      index += 1;
    }
    if (lines[index] !== END_MARKER) throw new Error("INVALID_JOURNAL_SEGMENT_DOCUMENT");
    index += 1;
    segments.push(createJournalSegmentSnapshot({
      id: String(metadata.id ?? ""),
      journalEntryId: root.journal_entry_id,
      localTime: metadata.local_time === null ? null : String(metadata.local_time ?? ""),
      occurredAt: metadata.occurred_at === null ? null : String(metadata.occurred_at ?? ""),
      bodyMarkdown: bodyLines.join("\n"),
      sortOrder: Number(metadata.sort_order),
      sourceRef: parseSourceRef(metadata.source_ref),
    }));
    if (segments.length > MAX_SEGMENTS_PER_ENTRY) throw new Error("TOO_MANY_JOURNAL_SEGMENTS");
  }
  const ordered = normalizeSegments(root.journal_entry_id, segments);
  if (ordered.some((segment, position) => segment.id !== segments[position]?.id)) throw new Error("INVALID_JOURNAL_SEGMENT_ORDER");
  return { journalEntryId: root.journal_entry_id, segments: ordered };
}

function normalizeSegments(journalEntryId: string, segments: JournalSegmentSnapshot[]) {
  if (segments.length > MAX_SEGMENTS_PER_ENTRY) throw new Error("TOO_MANY_JOURNAL_SEGMENTS");
  const normalized = segments.map((segment) => createJournalSegmentSnapshot({
    id: segment.id,
    journalEntryId: segment.journal_entry_id,
    localTime: segment.local_time,
    occurredAt: segment.occurred_at,
    bodyMarkdown: segment.body_markdown,
    sortOrder: segment.sort_order,
    sourceRef: segment.source_ref,
  })).sort((left, right) => left.sort_order - right.sort_order);
  if (normalized.some((segment) => segment.journal_entry_id !== journalEntryId)) throw new Error("JOURNAL_SEGMENT_ENTRY_MISMATCH");
  if (new Set(normalized.map((segment) => segment.id)).size !== normalized.length) throw new Error("DUPLICATE_JOURNAL_SEGMENT_ID");
  if (new Set(normalized.map((segment) => segment.sort_order)).size !== normalized.length) throw new Error("DUPLICATE_JOURNAL_SEGMENT_ORDER");
  return normalized;
}

function assertSegment(value: JournalSegmentSnapshot) {
  assertStableId(value.id);
  assertStableId(value.journal_entry_id);
  if (value.local_time === null ? value.occurred_at !== null : !TIME_ONLY.test(value.local_time) || !isInstant(value.occurred_at)) throw new Error("INVALID_JOURNAL_SEGMENT_TIME");
  if (!value.body_markdown || value.body_markdown.length > 2_000_000) throw new Error("INVALID_JOURNAL_SEGMENT_BODY");
  if (!Number.isInteger(value.sort_order) || value.sort_order < 0 || value.sort_order > 1_000_000) throw new Error("INVALID_JOURNAL_SEGMENT_ORDER");
  if (value.source_ref !== null) {
    if (value.source_ref.source_type !== "legacy_word" || !STABLE_ID.test(value.source_ref.import_batch_id) || !value.source_ref.source_locator || value.source_ref.source_locator.length > 500) throw new Error("INVALID_JOURNAL_SEGMENT_SOURCE");
  }
}

function parseSourceRef(value: unknown): JournalSegmentSourceRef | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_JOURNAL_SEGMENT_SOURCE");
  const candidate = value as Record<string, unknown>;
  assertExactKeys(candidate, ["source_type", "import_batch_id", "source_locator"]);
  return {
    source_type: String(candidate.source_type ?? "") as "legacy_word",
    import_batch_id: String(candidate.import_batch_id ?? ""),
    source_locator: String(candidate.source_locator ?? ""),
  };
}

function marker(prefix: string, payload: Record<string, unknown>) {
  return `${prefix}${encodeBase64Url(JSON.stringify(payload))}${MARKER_SUFFIX}`;
}

function parseMarker(line: string, prefix: string) {
  if (!line.startsWith(prefix) || !line.endsWith(MARKER_SUFFIX)) throw new Error("INVALID_JOURNAL_SEGMENT_DOCUMENT");
  const encoded = line.slice(prefix.length, -MARKER_SUFFIX.length);
  try {
    const parsed = JSON.parse(decodeBase64Url(encoded));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("INVALID_JOURNAL_SEGMENT_DOCUMENT");
  }
}

function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("INVALID_BASE64URL");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function escapeReservedMarkerLine(line: string) {
  let prefixLength = 0;
  while (line[prefixLength] === "\\") prefixLength += 1;
  return line.startsWith(RESERVED_MARKER_PREFIX, prefixLength) ? `\\${line}` : line;
}

function unescapeReservedMarkerLine(line: string) {
  let prefixLength = 0;
  while (line[prefixLength] === "\\") prefixLength += 1;
  return prefixLength > 0 && line.startsWith(RESERVED_MARKER_PREFIX, prefixLength) ? line.slice(1) : line;
}

function normalizeBody(value: string) {
  return value.replace(/\r\n?/g, "\n").trim();
}

function assertStableId(value: string) {
  if (!STABLE_ID.test(value)) throw new Error("INVALID_RECORD_ID");
}

function isInstant(value: string | null) {
  return typeof value === "string" && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value));
}

function assertExactKeys(value: object, expected: string[]) {
  const actual = Object.keys(value).sort();
  const canonicalExpected = [...expected].sort();
  if (actual.length !== canonicalExpected.length || actual.some((key, index) => key !== canonicalExpected[index])) {
    throw new Error("INVALID_JOURNAL_SEGMENT_DOCUMENT");
  }
}
