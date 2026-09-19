export const COROS_FILE_PREFLIGHT_VERSION = "1";
export const COROS_IMPORT_MAX_FILE_BYTES = 64 * 1024 * 1024;

export type CorosImportFile = {
  name: string;
  size: number;
  lastModified: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type CorosFileDiagnostic = {
  code: string;
  severity: "warning" | "error" | "blocking";
  message: string;
};

export type CorosFitSummary = {
  format: "fit";
  protocolVersion: string;
  profileVersion: number;
  dataBytes: number;
  definitionMessages: number;
  dataMessages: number;
  activityMessages: number;
  sessionMessages: number;
  recordMessages: number;
  headerCrc: "not-present" | "valid";
  fileCrc: "not-present" | "valid";
};

export type CorosTcxSummary = {
  format: "tcx";
  activities: number;
  laps: number;
  trackpoints: number;
  sports: string[];
  firstTimestamp: string | null;
  lastTimestamp: string | null;
};

export type CorosFilePreflight = {
  source: {
    fileName: string;
    byteSize: number;
    lastModified: string | null;
    sha256: string;
  };
  parserVersion: typeof COROS_FILE_PREFLIGHT_VERSION;
  summary: CorosFitSummary | CorosTcxSummary;
  diagnostics: CorosFileDiagnostic[];
  readyForMapping: boolean;
  localOnly: true;
  sourceModified: false;
  commitEnabled: false;
};

type FitDefinition = { globalMessageNumber: number; dataSize: number };

export async function previewCorosActivityFile(file: CorosImportFile): Promise<CorosFilePreflight> {
  const extension = file.name.toLowerCase().match(/\.(fit|tcx)$/u)?.[1] as "fit" | "tcx" | undefined;
  if (!extension) throw new Error("COROS_IMPORT_FIT_OR_TCX_REQUIRED");
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error("COROS_IMPORT_EMPTY_FILE");
  if (file.size > COROS_IMPORT_MAX_FILE_BYTES) throw new Error("COROS_IMPORT_FILE_TOO_LARGE");

  const buffer = await file.arrayBuffer();
  if (buffer.byteLength !== file.size) throw new Error("COROS_IMPORT_FILE_SIZE_MISMATCH");
  const bytes = new Uint8Array(buffer);
  const sha256 = await sha256Hex(bytes);
  const parsed = extension === "fit" ? inspectFit(bytes) : inspectTcx(bytes);

  return {
    source: {
      fileName: safeFileName(file.name),
      byteSize: file.size,
      lastModified: safeModifiedTime(file.lastModified),
      sha256,
    },
    parserVersion: COROS_FILE_PREFLIGHT_VERSION,
    summary: parsed.summary,
    diagnostics: parsed.diagnostics,
    readyForMapping: parsed.readyForMapping,
    localOnly: true,
    sourceModified: false,
    commitEnabled: false,
  };
}

function inspectFit(bytes: Uint8Array): { summary: CorosFitSummary; diagnostics: CorosFileDiagnostic[]; readyForMapping: boolean } {
  if (bytes.byteLength < 12) throw new Error("COROS_IMPORT_INVALID_FIT_HEADER");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = view.getUint8(0);
  if (headerSize !== 12 && headerSize !== 14) throw new Error("COROS_IMPORT_INVALID_FIT_HEADER");
  if (bytes.byteLength < headerSize || ascii(bytes.subarray(8, 12)) !== ".FIT") throw new Error("COROS_IMPORT_INVALID_FIT_HEADER");

  const dataSize = view.getUint32(4, true);
  const dataEnd = headerSize + dataSize;
  if (!Number.isSafeInteger(dataEnd) || dataEnd > bytes.byteLength || (bytes.byteLength !== dataEnd && bytes.byteLength !== dataEnd + 2)) {
    throw new Error("COROS_IMPORT_FIT_SIZE_MISMATCH");
  }

  let headerCrc: CorosFitSummary["headerCrc"] = "not-present";
  if (headerSize === 14) {
    const stored = view.getUint16(12, true);
    if (fitCrc(bytes.subarray(0, 12)) !== stored) throw new Error("COROS_IMPORT_FIT_HEADER_CRC_MISMATCH");
    headerCrc = "valid";
  }

  let fileCrc: CorosFitSummary["fileCrc"] = "not-present";
  if (bytes.byteLength === dataEnd + 2) {
    const stored = view.getUint16(dataEnd, true);
    if (fitCrc(bytes.subarray(0, dataEnd)) !== stored) throw new Error("COROS_IMPORT_FIT_FILE_CRC_MISMATCH");
    fileCrc = "valid";
  }

  const messages = inspectFitMessages(bytes, headerSize, dataEnd);
  const diagnostics: CorosFileDiagnostic[] = [];
  if (fileCrc === "not-present") diagnostics.push({ code: "FIT_FILE_CRC_NOT_PRESENT", severity: "warning", message: "文件没有尾部 CRC；可以继续预览，但正式映射前应保留来源哈希。" });
  if (messages.activityMessages + messages.sessionMessages === 0) diagnostics.push({ code: "FIT_ACTIVITY_MESSAGES_MISSING", severity: "blocking", message: "FIT 中没有 Activity 或 Session 消息，不能作为活动导入来源。" });
  if (messages.recordMessages === 0) diagnostics.push({ code: "FIT_RECORD_MESSAGES_MISSING", severity: "warning", message: "FIT 中没有逐点 Record 消息；摘要可能可用，但不会有轨迹或时序明细。" });

  return {
    summary: {
      format: "fit",
      protocolVersion: `${view.getUint8(1) >> 4}.${view.getUint8(1) & 0x0f}`,
      profileVersion: view.getUint16(2, true) / 100,
      dataBytes: dataSize,
      ...messages,
      headerCrc,
      fileCrc,
    },
    diagnostics,
    readyForMapping: messages.activityMessages + messages.sessionMessages > 0,
  };
}

function inspectFitMessages(bytes: Uint8Array, start: number, end: number) {
  const definitions = new Map<number, FitDefinition>();
  let offset = start;
  let definitionMessages = 0;
  let dataMessages = 0;
  let activityMessages = 0;
  let sessionMessages = 0;
  let recordMessages = 0;

  while (offset < end) {
    if (definitionMessages + dataMessages > 1_000_000) throw new Error("COROS_IMPORT_FIT_MESSAGE_LIMIT");
    const header = bytes[offset++];
    const compressedTimestamp = (header & 0x80) !== 0;
    const localMessageType = compressedTimestamp ? (header >> 5) & 0x03 : header & 0x0f;
    const definitionMessage = !compressedTimestamp && (header & 0x40) !== 0;
    const developerFields = definitionMessage && (header & 0x20) !== 0;

    if (definitionMessage) {
      if (offset + 5 > end) throw new Error("COROS_IMPORT_TRUNCATED_FIT_DEFINITION");
      offset += 1;
      const architecture = bytes[offset++];
      if (architecture !== 0 && architecture !== 1) throw new Error("COROS_IMPORT_INVALID_FIT_ARCHITECTURE");
      const littleEndian = architecture === 0;
      const globalMessageNumber = littleEndian ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1];
      offset += 2;
      const fieldCount = bytes[offset++];
      if (offset + fieldCount * 3 > end) throw new Error("COROS_IMPORT_TRUNCATED_FIT_DEFINITION");
      let dataSize = 0;
      for (let index = 0; index < fieldCount; index += 1) {
        offset += 1;
        dataSize += bytes[offset++];
        offset += 1;
      }
      if (developerFields) {
        if (offset >= end) throw new Error("COROS_IMPORT_TRUNCATED_FIT_DEFINITION");
        const developerFieldCount = bytes[offset++];
        if (offset + developerFieldCount * 3 > end) throw new Error("COROS_IMPORT_TRUNCATED_FIT_DEFINITION");
        for (let index = 0; index < developerFieldCount; index += 1) {
          offset += 1;
          dataSize += bytes[offset++];
          offset += 1;
        }
      }
      definitions.set(localMessageType, { globalMessageNumber, dataSize });
      definitionMessages += 1;
      continue;
    }

    const definition = definitions.get(localMessageType);
    if (!definition) throw new Error("COROS_IMPORT_FIT_DEFINITION_MISSING");
    if (offset + definition.dataSize > end) throw new Error("COROS_IMPORT_TRUNCATED_FIT_DATA");
    offset += definition.dataSize;
    dataMessages += 1;
    if (definition.globalMessageNumber === 34) activityMessages += 1;
    if (definition.globalMessageNumber === 18) sessionMessages += 1;
    if (definition.globalMessageNumber === 20) recordMessages += 1;
  }

  if (offset !== end) throw new Error("COROS_IMPORT_FIT_SIZE_MISMATCH");
  return { definitionMessages, dataMessages, activityMessages, sessionMessages, recordMessages };
}

function inspectTcx(bytes: Uint8Array): { summary: CorosTcxSummary; diagnostics: CorosFileDiagnostic[]; readyForMapping: boolean } {
  const xml = decodeUtf8(bytes).replace(/^\uFEFF/u, "");
  if (/<!DOCTYPE\b|<!ENTITY\b/iu.test(xml)) throw new Error("COROS_IMPORT_TCX_EXTERNAL_ENTITY_FORBIDDEN");
  const root = xml.match(/^(?:\s|<\?xml\b[^?]*\?>|<!--[\s\S]*?-->)*<(?:(?:[A-Za-z_][\w.-]*):)?([A-Za-z_][\w.-]*)\b/iu)?.[1];
  if (root !== "TrainingCenterDatabase") throw new Error("COROS_IMPORT_INVALID_TCX_ROOT");

  const activities = countOpeningTags(xml, "Activity");
  const laps = countOpeningTags(xml, "Lap");
  const trackpoints = countOpeningTags(xml, "Trackpoint");
  const sports = unique([...xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?Activity\b[^>]*\bSport\s*=\s*(?:"([^"]*)"|'([^']*)')/giu)].map((match) => decodeXmlEntities(match[1] ?? match[2] ?? "")).filter(Boolean));
  const timestamps = [...xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?(?:Id|Time)\b[^>]*>\s*([^<]{1,64})\s*<\/(?:[A-Za-z_][\w.-]*:)?(?:Id|Time)\s*>/giu)]
    .map((match) => match[1].trim())
    .filter((value) => !Number.isNaN(Date.parse(value)))
    .map((value) => new Date(value).toISOString())
    .sort();

  const diagnostics: CorosFileDiagnostic[] = [];
  if (activities === 0) diagnostics.push({ code: "TCX_ACTIVITY_MISSING", severity: "blocking", message: "TCX 中没有 Activity，不能生成活动映射计划。" });
  if (laps === 0) diagnostics.push({ code: "TCX_LAP_MISSING", severity: "warning", message: "TCX 中没有 Lap；只能保留有限的活动摘要。" });
  if (trackpoints === 0) diagnostics.push({ code: "TCX_TRACKPOINT_MISSING", severity: "warning", message: "TCX 中没有 Trackpoint；不会生成轨迹或时序明细。" });
  if (timestamps.length === 0) diagnostics.push({ code: "TCX_TIMESTAMP_MISSING", severity: "blocking", message: "TCX 中没有可识别的 ISO 时间，不能建立稳定的活动身份。" });

  return {
    summary: {
      format: "tcx",
      activities,
      laps,
      trackpoints,
      sports,
      firstTimestamp: timestamps[0] ?? null,
      lastTimestamp: timestamps.at(-1) ?? null,
    },
    diagnostics,
    readyForMapping: activities > 0 && timestamps.length > 0,
  };
}

function countOpeningTags(xml: string, localName: string) {
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return [...xml.matchAll(new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${escaped}\\b`, "giu"))].length;
}

function fitCrc(bytes: Uint8Array) {
  const table = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
  let crc = 0;
  for (const byte of bytes) {
    let temporary = table[crc & 0x0f];
    crc = (crc >> 4) & 0x0fff;
    crc ^= temporary ^ table[byte & 0x0f];
    temporary = table[crc & 0x0f];
    crc = (crc >> 4) & 0x0fff;
    crc ^= temporary ^ table[(byte >> 4) & 0x0f];
  }
  return crc;
}

function ascii(bytes: Uint8Array) { return String.fromCharCode(...bytes); }
function unique(values: string[]) { return [...new Set(values)]; }
function decodeUtf8(bytes: Uint8Array) { try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (error) { throw new Error("COROS_IMPORT_INVALID_UTF8_TCX", { cause: error }); } }
function decodeXmlEntities(value: string) { return value.replace(/&(?:amp|lt|gt|quot|apos);/giu, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'" } as Record<string, string>)[entity.toLowerCase()] ?? entity); }
async function sha256Hex(bytes: Uint8Array) { const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function safeFileName(value: string) { return value.split(/[\\/]/u).at(-1) || "coros-activity"; }
function safeModifiedTime(value: number) { if (!Number.isFinite(value) || value <= 0) return null; const date = new Date(value); return Number.isNaN(date.valueOf()) ? null : date.toISOString(); }
