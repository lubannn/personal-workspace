import { parseJournalSegmentsMarkdown } from "./journal-segment-codec";

export type JournalDisplaySegment = { time: string | null; body: string };

export function journalDisplaySegments(markdown: string): JournalDisplaySegment[] {
  if (!markdown.startsWith("<!-- pw-journal-segments:v1:")) return [{ time: null, body: markdown }];
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
