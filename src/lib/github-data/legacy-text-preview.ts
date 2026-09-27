import type { LegacyDocxFile, LegacyJournalPreview } from "./legacy-docx-preview";
import { parseLegacyJournalParagraphs, type LegacyImportCorrection, type LegacyImportDiagnostic, type LegacyWordParagraph } from "./legacy-journal-import";

export const LEGACY_TEXT_MAX_FILE_BYTES = 32 * 1024 * 1024;
export const LEGACY_TEXT_PARSER_VERSION = "legacy-journal-text-preview-v1";
export const LEGACY_TEXT_MAPPING_VERSION = "zh-monthly-diary-export-v1";

const MONTH_NAMES = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"] as const;
const MONTH_HEADER = /^(\d{4})年(\d{2})月的日记$/u;
const MONTH_FOOTER = /^<\s*(\d{2})月\s*><<\s*(\d{4})\s*>>$/u;
const TIME_HEADING = /^(?:[01]?\d|2[0-3]):[0-5]\d$/u;
const EMPTY_MONTH_MESSAGE = "这个月没有日记呀～";

type TextSection = { year: number; month: number; headerLine: number; endLine: number };

export async function previewLegacyJournalText(
  file: LegacyDocxFile,
  options: { timezone: string; minimumYear?: number; maximumYear?: number; corrections?: LegacyImportCorrection[] },
): Promise<LegacyJournalPreview> {
  if (!/\.txt$/iu.test(file.name)) throw new Error("LEGACY_IMPORT_TXT_REQUIRED");
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error("LEGACY_IMPORT_EMPTY_FILE");
  if (file.size > LEGACY_TEXT_MAX_FILE_BYTES) throw new Error("LEGACY_IMPORT_TEXT_FILE_TOO_LARGE");
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength !== file.size) throw new Error("LEGACY_IMPORT_FILE_SIZE_MISMATCH");
  const bytes = new Uint8Array(buffer);
  const sha256 = await sha256Hex(bytes);
  const text = decodeUtf8(bytes).replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  const lines = text.split("\n");
  const sections = findSections(lines);
  if (sections.length === 0) throw new Error("LEGACY_IMPORT_TEXT_MONTHS_MISSING");
  if (sections.some((section) => section.month < 1 || section.month > 12)) throw new Error("LEGACY_IMPORT_TEXT_INVALID_MONTH");

  const structuralDiagnostics: LegacyImportDiagnostic[] = [];
  const paragraphs: LegacyWordParagraph[] = [];
  let ignoredPreambleLines = 0;
  for (let index = 0; index < sections[0]!.headerLine; index += 1) if (lines[index]!.trim()) ignoredPreambleLines += 1;
  if (ignoredPreambleLines) structuralDiagnostics.push({ code: "TEXT_PREAMBLE_IGNORED", severity: "info", message: `已忽略日记导出标题区 ${ignoredPreambleLines} 行。` });

  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index]!;
    const previous = sections[index - 1];
    if (previous && monthIndex(section) !== monthIndex(previous) + 1) {
      structuralDiagnostics.push({ code: monthIndex(section) <= monthIndex(previous) ? "TEXT_MONTH_DUPLICATE_OR_RETREAT" : "TEXT_MONTH_SEQUENCE_GAP", severity: "error", message: `月份顺序在 ${formatMonth(previous)} 与 ${formatMonth(section)} 之间不连续。`, sourceLocator: locator(section.headerLine) });
    }
    paragraphs.push(paragraph(section.headerLine, `${section.year}年`), paragraph(section.headerLine, `${section.month}月`));
    const expectedMarker = MONTH_NAMES[section.month];
    let footerLine = -1;
    let currentDay = 0;
    let insideDay = false;
    for (let lineIndex = section.headerLine + 1; lineIndex < section.endLine; lineIndex += 1) {
      const value = lines[lineIndex]!.trim();
      const footer = value.match(MONTH_FOOTER);
      if (footer) {
        footerLine = lineIndex;
        if (Number(footer[1]) !== section.month || Number(footer[2]) !== section.year) structuralDiagnostics.push({ code: "TEXT_MONTH_FOOTER_MISMATCH", severity: "error", message: `${formatMonth(section)} 的月历页脚与月份标题不一致。`, sourceLocator: locator(lineIndex) });
        break;
      }
      if (value === expectedMarker && /^\d{1,2}$/u.test(lines[lineIndex + 1]?.trim() ?? "") && TIME_HEADING.test(lines[lineIndex + 2]?.trim() ?? "")) {
        const dayLine = lineIndex + 1;
        const day = Number(lines[dayLine]!.trim());
        const maximumDay = new Date(Date.UTC(section.year, section.month, 0)).getUTCDate();
        if (day < 1 || day > maximumDay) structuralDiagnostics.push({ code: "TEXT_INVALID_DAY", severity: "error", message: `${formatMonth(section)} 中出现无效日期 ${day}。`, sourceLocator: locator(dayLine) });
        else if (day <= currentDay) structuralDiagnostics.push({ code: "TEXT_DAY_ORDER_OR_DUPLICATE", severity: "error", message: `${formatMonth(section)} 的日期 ${day} 重复或倒序。`, sourceLocator: locator(dayLine) });
        currentDay = day;
        insideDay = true;
        paragraphs.push(paragraph(dayLine, `${day}日`));
        lineIndex = dayLine;
        continue;
      }
      if (insideDay && TIME_HEADING.test(value)) paragraphs.push(paragraph(lineIndex, lines[lineIndex]!));
      else if (insideDay) paragraphs.push(bodyParagraph(lineIndex, lines[lineIndex]!));
      else if (value && value !== EMPTY_MONTH_MESSAGE) structuralDiagnostics.push({ code: "TEXT_CONTENT_OUTSIDE_DAY", severity: "error", message: `${formatMonth(section)} 在首个日期前包含无法归属的内容。`, sourceLocator: locator(lineIndex) });
    }
    if (footerLine < 0) structuralDiagnostics.push({ code: "TEXT_MONTH_FOOTER_MISSING", severity: "error", message: `${formatMonth(section)} 缺少月历页脚，无法安全确定正文边界。`, sourceLocator: locator(section.headerLine) });
  }

  const parse = parseLegacyJournalParagraphs(paragraphs, {
    timezone: options.timezone,
    sourceSha256: sha256,
    parserVersion: LEGACY_TEXT_PARSER_VERSION,
    mappingVersion: LEGACY_TEXT_MAPPING_VERSION,
    minimumYear: options.minimumYear,
    maximumYear: options.maximumYear,
    corrections: options.corrections,
  });
  const duplicateDiagnostics = exactDuplicateDiagnostics(parse.entries);
  const extraDiagnostics = [...structuralDiagnostics, ...duplicateDiagnostics];
  parse.diagnostics.push(...extraDiagnostics);
  parse.summary.info += extraDiagnostics.filter((issue) => issue.severity === "info").length;
  parse.summary.warnings += extraDiagnostics.filter((issue) => issue.severity === "warning").length;
  parse.summary.errors += extraDiagnostics.filter((issue) => issue.severity === "error").length;
  parse.summary.blocking += extraDiagnostics.filter((issue) => issue.severity === "blocking").length;
  if (extraDiagnostics.some((issue) => issue.severity === "error" || issue.severity === "blocking")) parse.dryRunReady = false;
  return {
    source: { fileName: safeFileName(file.name), byteSize: file.size, lastModified: safeModifiedTime(file.lastModified), sha256, format: "txt" },
    batchIdentity: `${sha256}:${LEGACY_TEXT_PARSER_VERSION}:${LEGACY_TEXT_MAPPING_VERSION}`,
    parserVersion: LEGACY_TEXT_PARSER_VERSION,
    mappingVersion: LEGACY_TEXT_MAPPING_VERSION,
    archiveEntryCount: 0,
    archiveDiagnostics: [],
    parse,
    localOnly: true,
    sourceModified: false,
    commitEnabled: false,
  };
}

function findSections(lines: string[]) {
  const starts: Array<Omit<TextSection, "endLine">> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]!.trim().match(MONTH_HEADER);
    if (match) starts.push({ year: Number(match[1]), month: Number(match[2]), headerLine: index });
  }
  return starts.map((section, index): TextSection => ({ ...section, endLine: starts[index + 1]?.headerLine ?? lines.length }));
}

function exactDuplicateDiagnostics(entries: LegacyJournalPreview["parse"]["entries"]) {
  const diagnostics: LegacyImportDiagnostic[] = [];
  for (const entry of entries) {
    const seen = new Map<string, number>();
    for (const segment of entry.segments) {
      const key = `${segment.time ?? ""}\n${segment.bodyMarkdown}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const groups = [...seen.values()].filter((count) => count > 1);
    if (groups.length) diagnostics.push({ code: "TEXT_EXACT_DUPLICATE_ENTRIES_PRESERVED", severity: "warning", message: `${entry.date} 有 ${groups.length} 组日期、时间和正文完全相同的记录；为避免误删，预览会原样保留。` });
  }
  return diagnostics;
}

function paragraph(lineIndex: number, text: string): LegacyWordParagraph {
  return { sourceLocator: locator(lineIndex), text };
}
function bodyParagraph(lineIndex: number, text: string): LegacyWordParagraph {
  return { sourceLocator: locator(lineIndex), text, classificationHint: "body" };
}

function locator(lineIndex: number) { return `text#line${lineIndex + 1}`; }
function monthIndex(section: Pick<TextSection, "year" | "month">) { return section.year * 12 + section.month - 1; }
function formatMonth(section: Pick<TextSection, "year" | "month">) { return `${section.year}-${String(section.month).padStart(2, "0")}`; }
function safeFileName(value: string) { return value.split(/[\\/]/u).at(-1) || "journal.txt"; }
function safeModifiedTime(value: number) { if (!Number.isFinite(value) || value <= 0) return null; const date = new Date(value); return Number.isNaN(date.valueOf()) ? null : date.toISOString(); }
function decodeUtf8(bytes: Uint8Array) { try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (error) { throw new Error("LEGACY_IMPORT_INVALID_UTF8_TEXT", { cause: error }); } }
async function sha256Hex(bytes: Uint8Array) { const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
