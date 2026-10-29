import { parseJournalSegmentsMarkdown } from "./journal-segment-codec";
import type { JournalEntryRecord } from "./journal-entries";

export type JournalDisplaySegment = { time: string | null; body: string };

// Reading order is distinct from save/load order. Flatten imported days so a
// later backfill can sit between their time segments, without rewriting records.
export function journalDisplayTimeline<T extends { record: JournalEntryRecord; segments: JournalDisplaySegment[] }>(entries: readonly T[]) {
  return entries.flatMap((entry) => entry.segments.map((segment, segmentIndex) => ({ entry, segment, segmentIndex })))
    .sort((left, right) => right.entry.record.data.journal_date.localeCompare(left.entry.record.data.journal_date)
      || (right.segment.time ?? "").localeCompare(left.segment.time ?? "")
      || Date.parse(left.entry.record.data.first_entry_at) - Date.parse(right.entry.record.data.first_entry_at)
      || left.entry.record.id.localeCompare(right.entry.record.id)
      || left.segmentIndex - right.segmentIndex);
}

export function journalDisplaySegments(markdown: string, submittedTime: string | null = null): JournalDisplaySegment[] {
  if (!markdown.startsWith("<!-- pw-journal-segments:v1:")) return [{ time: submittedTime, body: markdown }];
  try {
    return parseJournalSegmentsMarkdown(markdown).segments.map((segment) => ({ time: segment.local_time, body: segment.body_markdown }));
  } catch {
    // Never show encoded source metadata as diary prose when the structured body is damaged.
    return [{ time: null, body: "这篇历史日记的显示格式无法解析。原始 Markdown 仍可下载核对。" }];
  }
}

export function journalDisplayPreview(markdown: string, limit = 90) {
  const text = journalDisplaySegments(markdown).map((segment) => segment.body).join(" ")
    .replace(/[#>*_`\[\]()\-]/g, " ").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function searchJournalDisplaySegments(markdown: string, query: string, submittedTime: string | null = null) {
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
  const tokens = normalize(query).split(" ").filter(Boolean);
  return journalDisplaySegments(markdown, submittedTime).filter((segment) => {
    const body = normalize(segment.body);
    return tokens.every((token) => body.includes(token));
  });
}
