import { unzip, type UnzipFileInfo, type Unzipped } from "fflate";

import { LEGACY_JOURNAL_MAPPING_VERSION, LEGACY_JOURNAL_PARSER_VERSION, parseLegacyJournalParagraphs, type LegacyImportCorrection, type LegacyImportDiagnostic, type LegacyJournalParsePreview, type LegacyWordParagraph } from "./legacy-journal-import";

export const LEGACY_DOCX_MAX_FILE_BYTES = 256 * 1024 * 1024;
export const LEGACY_DOCX_MAX_DOCUMENT_XML_BYTES = 64 * 1024 * 1024;
export const LEGACY_DOCX_MAX_ARCHIVE_ENTRIES = 20_000;

export type LegacyDocxFile = {
  name: string;
  size: number;
  lastModified: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type LegacyDocxPreview = {
  source: {
    fileName: string;
    byteSize: number;
    lastModified: string | null;
    sha256: string;
  };
  batchIdentity: string;
  parserVersion: string;
  mappingVersion: string;
  archiveEntryCount: number;
  archiveDiagnostics: LegacyImportDiagnostic[];
  parse: LegacyJournalParsePreview;
  localOnly: true;
  sourceModified: false;
  commitEnabled: false;
};

export async function previewLegacyJournalDocx(file: LegacyDocxFile, options: { timezone: string; minimumYear?: number; maximumYear?: number; corrections?: LegacyImportCorrection[] }): Promise<LegacyDocxPreview> {
  if (!/\.docx$/iu.test(file.name)) throw new Error("LEGACY_IMPORT_DOCX_REQUIRED");
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error("LEGACY_IMPORT_EMPTY_FILE");
  if (file.size > LEGACY_DOCX_MAX_FILE_BYTES) throw new Error("LEGACY_IMPORT_FILE_TOO_LARGE");
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength !== file.size) throw new Error("LEGACY_IMPORT_FILE_SIZE_MISMATCH");
  const bytes = new Uint8Array(buffer);
  const sha256 = await sha256Hex(bytes);
  const { files, entries, documentTooLarge } = await unzipDocumentXml(bytes);
  if (entries.length > LEGACY_DOCX_MAX_ARCHIVE_ENTRIES) throw new Error("LEGACY_IMPORT_ARCHIVE_ENTRY_LIMIT");
  if (entries.some((entry) => unsafeArchivePath(entry.name))) throw new Error("LEGACY_IMPORT_UNSAFE_ARCHIVE_PATH");
  if (documentTooLarge) throw new Error("LEGACY_IMPORT_DOCUMENT_XML_TOO_LARGE");
  const documentXmlBytes = files["word/document.xml"];
  if (!documentXmlBytes) throw new Error(entries.some((entry) => /EncryptedPackage|EncryptionInfo/iu.test(entry.name)) ? "LEGACY_IMPORT_ENCRYPTED_DOCX" : "LEGACY_IMPORT_DOCUMENT_XML_MISSING");

  const xml = decodeUtf8(documentXmlBytes);
  const paragraphs = extractLegacyWordParagraphs(xml);
  if (paragraphs.length === 0) throw new Error("LEGACY_IMPORT_NO_PARAGRAPHS");
  const archiveDiagnostics = archiveDiagnosticsFor(entries);
  const parse = parseLegacyJournalParagraphs(paragraphs, { timezone: options.timezone, sourceSha256: sha256, minimumYear: options.minimumYear, maximumYear: options.maximumYear, corrections: options.corrections });
  const batchIdentity = `${sha256}:${LEGACY_JOURNAL_PARSER_VERSION}:${LEGACY_JOURNAL_MAPPING_VERSION}`;
  return {
    source: {
      fileName: safeFileName(file.name),
      byteSize: file.size,
      lastModified: safeModifiedTime(file.lastModified),
      sha256,
    },
    batchIdentity,
    parserVersion: LEGACY_JOURNAL_PARSER_VERSION,
    mappingVersion: LEGACY_JOURNAL_MAPPING_VERSION,
    archiveEntryCount: entries.length,
    archiveDiagnostics,
    parse,
    localOnly: true,
    sourceModified: false,
    commitEnabled: false,
  };
}

export function extractLegacyWordParagraphs(documentXml: string): LegacyWordParagraph[] {
  const paragraphs: LegacyWordParagraph[] = [];
  const tokenPattern = /<w:tbl\b[^>]*>|<\/w:tbl\s*>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p\s*>/giu;
  let tableDepth = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(documentXml))) {
    const block = match[0];
    if (/^<w:tbl\b/iu.test(block)) { tableDepth += 1; continue; }
    if (/^<\/w:tbl/iu.test(block)) { tableDepth = Math.max(0, tableDepth - 1); continue; }
    const unsupportedObjects = detectUnsupportedObjects(block, tableDepth > 0);
    const styleName = attributeValue(block.match(/<w:pStyle\b[^>]*>/iu)?.[0], "w:val");
    const outlineText = attributeValue(block.match(/<w:outlineLvl\b[^>]*>/iu)?.[0], "w:val");
    const fontSizeText = attributeValue(block.match(/<w:sz\b[^>]*>/iu)?.[0], "w:val");
    const boldTag = block.match(/<w:b\b[^>]*\/?\s*>/iu)?.[0];
    const boldValue = attributeValue(boldTag, "w:val");
    paragraphs.push({
      sourceLocator: `word/document.xml#p${paragraphs.length + 1}`,
      text: paragraphText(block),
      styleName,
      outlineLevel: outlineText !== null && /^\d+$/u.test(outlineText) ? Number(outlineText) : null,
      bold: Boolean(boldTag) && boldValue !== "0" && boldValue !== "false" && boldValue !== "off",
      fontSizePt: fontSizeText !== null && /^\d+$/u.test(fontSizeText) ? Number(fontSizeText) / 2 : null,
      unsupportedObjects,
    });
  }
  return paragraphs;
}

function unzipDocumentXml(bytes: Uint8Array): Promise<{ files: Unzipped; entries: UnzipFileInfo[]; documentTooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const entries: UnzipFileInfo[] = [];
    let documentTooLarge = false;
    unzip(bytes, {
      filter(info) {
        entries.push({ ...info });
        if (info.name === "word/document.xml" && info.originalSize > LEGACY_DOCX_MAX_DOCUMENT_XML_BYTES) {
          documentTooLarge = true;
          return false;
        }
        return info.name === "word/document.xml";
      },
    }, (error, files) => {
      if (error) reject(new Error("LEGACY_IMPORT_INVALID_ZIP", { cause: error }));
      else resolve({ files, entries, documentTooLarge });
    });
  });
}

function paragraphText(block: string) {
  const parts: string[] = [];
  const contentPattern = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t\s*>|<w:(tab|br|cr)\b[^>]*\/?\s*>/giu;
  let match: RegExpExecArray | null;
  while ((match = contentPattern.exec(block))) {
    if (match[1] !== undefined) parts.push(decodeXmlEntities(match[1]));
    else if (match[2] === "tab") parts.push("\t");
    else parts.push("\n");
  }
  return parts.join("");
}

function detectUnsupportedObjects(block: string, insideTable: boolean) {
  const objects = new Set<string>();
  if (insideTable) objects.add("table");
  const patterns: Array<[RegExp, string]> = [
    [/<w:drawing\b/iu, "drawing"],
    [/<w:pict\b/iu, "picture"],
    [/<w:object\b/iu, "embedded-object"],
    [/<w:txbxContent\b/iu, "text-box"],
    [/<w:footnoteReference\b/iu, "footnote-reference"],
    [/<w:endnoteReference\b/iu, "endnote-reference"],
    [/<w:commentReference\b/iu, "comment-reference"],
    [/<w:fldChar\b|<w:instrText\b/iu, "field"],
  ];
  for (const [pattern, name] of patterns) if (pattern.test(block)) objects.add(name);
  return [...objects];
}

function archiveDiagnosticsFor(entries: UnzipFileInfo[]) {
  const diagnostics: LegacyImportDiagnostic[] = [];
  const names = entries.map((entry) => entry.name);
  const categories: Array<[RegExp, string, string, LegacyImportDiagnostic["severity"]]> = [
    [/^word\/media\//iu, "DOCX_MEDIA_PRESENT", "文档包含图片或媒体；首版不会静默导入。", "error"],
    [/^word\/(?:footnotes|endnotes)\.xml$/iu, "DOCX_NOTES_PRESENT", "文档包含脚注或尾注；首版只报告，不导入正文。", "error"],
    [/^word\/comments\.xml$/iu, "DOCX_COMMENTS_PRESENT", "文档包含批注；首版只报告，不导入正文。", "error"],
    [/^word\/embeddings\//iu, "DOCX_EMBEDDING_PRESENT", "文档包含嵌入对象；首版不会静默导入。", "error"],
    [/^word\/(?:header|footer)\d+\.xml$/iu, "DOCX_HEADER_FOOTER_PRESENT", "文档包含页眉或页脚；首版不把它们当作日记正文。", "warning"],
    [/^word\/vbaProject\.bin$/iu, "DOCX_MACRO_PRESENT", "文档包含宏项目；预览不会执行宏，且该批次被阻断。", "blocking"],
  ];
  for (const [pattern, code, message, severity] of categories) {
    const matches = names.filter((name) => pattern.test(name));
    if (matches.length) diagnostics.push({ code, severity, message: `${message}（${matches.length} 项）` });
  }
  return diagnostics;
}

function decodeXmlEntities(value: string) {
  return value.replace(/&(?:#(x[0-9a-f]+|\d+)|amp|lt|gt|quot|apos);/giu, (entity, numeric: string | undefined) => {
    if (numeric) {
      const point = numeric[0].toLowerCase() === "x" ? Number.parseInt(numeric.slice(1), 16) : Number.parseInt(numeric, 10);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    return ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'" } as Record<string, string>)[entity.toLowerCase()] ?? entity;
  });
}

function attributeValue(tag: string | undefined, name: string) {
  if (!tag) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = tag.match(new RegExp(`${escaped}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')`, "iu"));
  return match ? decodeXmlEntities(match[1] ?? match[2] ?? "") : null;
}

function decodeUtf8(bytes: Uint8Array) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (error) { throw new Error("LEGACY_IMPORT_INVALID_UTF8_XML", { cause: error }); }
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function unsafeArchivePath(path: string) {
  return path.startsWith("/") || path.startsWith("\\") || path.split(/[\\/]/u).includes("..");
}

function safeFileName(value: string) {
  return value.split(/[\\/]/u).at(-1) || "journal.docx";
}

function safeModifiedTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}
