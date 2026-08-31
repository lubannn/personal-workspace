export const LEGACY_JOURNAL_PARSER_VERSION = "legacy-journal-preview-v1";
export const LEGACY_JOURNAL_MAPPING_VERSION = "zh-daily-headings-v1";

export type LegacyImportConfidence = "high" | "medium" | "low";
export type LegacyImportSeverity = "info" | "warning" | "error" | "blocking";
export type LegacyParagraphTokenKind = "YEAR_HEADING" | "MONTH_HEADING" | "DATE_HEADING" | "TIME_HEADING" | "BODY" | "EMPTY" | "UNSUPPORTED_OBJECT" | "AMBIGUOUS";

export type LegacyWordParagraph = {
  sourceLocator: string;
  text: string;
  styleName?: string | null;
  outlineLevel?: number | null;
  bold?: boolean;
  fontSizePt?: number | null;
  unsupportedObjects?: string[];
};

export type LegacyImportDiagnostic = {
  code: string;
  severity: LegacyImportSeverity;
  message: string;
  sourceLocator?: string;
};

export type LegacyParagraphToken = {
  kind: LegacyParagraphTokenKind;
  sourceLocator: string;
  originalText: string;
  normalizedText: string;
  confidence: LegacyImportConfidence;
  evidence: string[];
  parsed?: { year?: number; month?: number; day?: number; time?: string };
};

export type LegacyJournalSegmentPreview = {
  time: string | null;
  bodyMarkdown: string;
  sourceLocators: string[];
  confidence: LegacyImportConfidence;
};

export type LegacyJournalEntryPreview = {
  date: string;
  timezone: string;
  outputPath: string;
  markdown: string;
  segments: LegacyJournalSegmentPreview[];
  sourceLocators: string[];
  inheritedContext: string[];
  confidence: LegacyImportConfidence;
  diagnostics: LegacyImportDiagnostic[];
};

export type LegacyOrphanBlock = {
  sourceLocators: string[];
  text: string;
};

export type LegacyUnsupportedBlock = {
  sourceLocator: string;
  text: string;
  objectTypes: string[];
};

export type LegacyImportCorrectionAction = "set-date-heading" | "set-time-heading" | "set-body" | "assign-body" | "skip";

export type LegacyImportCorrection = {
  id: string;
  sourceLocator: string;
  action: LegacyImportCorrectionAction;
  date?: string;
  time?: string | null;
  reason: string;
  recordedAt: string;
  supersedesId?: string | null;
};

export type LegacySkippedBlock = {
  sourceLocator: string;
  text: string;
  reason: string;
  correctionId: string;
};

export type LegacyPreviewComparison = {
  addedDates: string[];
  removedDates: string[];
  changedDates: string[];
  unchangedDates: number;
  diagnosticsAdded: number;
  diagnosticsRemoved: number;
  orphanBlocksBefore: number;
  orphanBlocksAfter: number;
  correctionsBefore: number;
  correctionsAfter: number;
};

export type LegacyJournalParsePreview = {
  parserVersion: string;
  mappingVersion: string;
  timezone: string;
  entries: LegacyJournalEntryPreview[];
  tokens: LegacyParagraphToken[];
  orphanBlocks: LegacyOrphanBlock[];
  unsupportedBlocks: LegacyUnsupportedBlock[];
  skippedBlocks: LegacySkippedBlock[];
  corrections: LegacyImportCorrection[];
  diagnostics: LegacyImportDiagnostic[];
  summary: {
    sourceParagraphs: number;
    nonEmptyParagraphs: number;
    accountedNonEmptyParagraphs: number;
    coveragePercent: number;
    dateCount: number;
    segmentCount: number;
    bodyCharacters: number;
    yearRange: [number, number] | null;
    info: number;
    warnings: number;
    errors: number;
    blocking: number;
    duplicateDates: number;
    orphanBlocks: number;
    unsupportedObjects: number;
    manualCorrections: number;
    skippedParagraphs: number;
  };
  dryRunReady: boolean;
  commitEnabled: false;
};

export type LegacyJournalParseOptions = {
  timezone: string;
  sourceSha256?: string;
  minimumYear?: number;
  maximumYear?: number;
  corrections?: LegacyImportCorrection[];
};

type ClassifiedParagraph = {
  token: LegacyParagraphToken;
  invalidCandidate?: string;
};

type DraftSegment = {
  time: string | null;
  lines: string[];
  sourceLocators: string[];
  confidence: LegacyImportConfidence;
  headingLocator?: string;
};

type DraftEntry = {
  date: string;
  segments: DraftSegment[];
  sourceLocators: string[];
  inheritedContext: string[];
  confidence: LegacyImportConfidence;
  diagnostics: LegacyImportDiagnostic[];
};

const CHINESE_DIGITS: Record<string, number> = { "〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
const CONFIDENCE_RANK: Record<LegacyImportConfidence, number> = { low: 0, medium: 1, high: 2 };

export function parseLegacyJournalParagraphs(paragraphs: LegacyWordParagraph[], options: LegacyJournalParseOptions): LegacyJournalParsePreview {
  const minimumYear = options.minimumYear ?? 1900;
  const maximumYear = options.maximumYear ?? 2100;
  if (!isIanaTimezone(options.timezone)) throw new Error("INVALID_LEGACY_IMPORT_TIMEZONE");
  if (!Number.isInteger(minimumYear) || !Number.isInteger(maximumYear) || minimumYear > maximumYear) throw new Error("INVALID_LEGACY_IMPORT_YEAR_RANGE");

  const tokens: LegacyParagraphToken[] = [];
  const diagnostics: LegacyImportDiagnostic[] = [];
  const orphanBlocks: LegacyOrphanBlock[] = [];
  const unsupportedBlocks: LegacyUnsupportedBlock[] = [];
  const skippedBlocks: LegacySkippedBlock[] = [];
  const corrections = validateCorrections(paragraphs, options.corrections ?? [], minimumYear, maximumYear);
  const activeCorrections = new Map<string, LegacyImportCorrection>();
  for (const correction of corrections) activeCorrections.set(correction.sourceLocator, correction);
  const entriesByDate = new Map<string, DraftEntry>();
  const entryOrder: DraftEntry[] = [];
  let currentYear: number | null = null;
  let currentMonth: number | null = null;
  let currentDate: string | null = null;
  let currentSegment: DraftSegment | null = null;
  let lastDate: string | null = null;
  let duplicateDates = 0;
  const headingUse = new Map<string, number>();

  function addDiagnostic(issue: LegacyImportDiagnostic, entry?: DraftEntry) {
    diagnostics.push(issue);
    if (entry) entry.diagnostics.push(issue);
  }

  function closeEmptySegment() {
    if (!currentSegment || currentSegment.lines.some((line) => line.trim())) return;
    const entry = currentDate ? entriesByDate.get(currentDate) : undefined;
    addDiagnostic({ code: "EMPTY_TIME_SEGMENT", severity: "warning", message: "时间标题后没有正文。", sourceLocator: currentSegment.headingLocator }, entry);
  }

  for (const paragraph of paragraphs) {
    const correction = activeCorrections.get(paragraph.sourceLocator);
    const classified: ClassifiedParagraph = correction ? classifyCorrection(paragraph, correction) : classifyParagraph(paragraph, { currentYear, currentMonth, minimumYear, maximumYear });
    const token: LegacyParagraphToken = classified.token;
    tokens.push(token);

    if (correction?.action === "skip") {
      skippedBlocks.push({ sourceLocator: paragraph.sourceLocator, text: paragraph.text, reason: correction.reason, correctionId: correction.id });
      addDiagnostic({ code: "MANUAL_SKIP_APPLIED", severity: "info", message: `已按手工修正跳过该段落：${correction.reason}`, sourceLocator: paragraph.sourceLocator });
      continue;
    }
    if (correction?.action === "assign-body") {
      const date = correction.date!;
      let entry = entriesByDate.get(date);
      if (!entry) {
        entry = { date, segments: [], sourceLocators: [], inheritedContext: ["日期来自手工修正"], confidence: "high", diagnostics: [] };
        entriesByDate.set(date, entry);
        entryOrder.push(entry);
      }
      const assignedTime = correction.time ?? null;
      let segment = entry.segments.at(-1);
      if (!segment || segment.time !== assignedTime || segment.headingLocator) {
        segment = { time: assignedTime, lines: [], sourceLocators: [], confidence: "high" };
        entry.segments.push(segment);
      }
      segment.lines.push(paragraph.text);
      segment.sourceLocators.push(paragraph.sourceLocator);
      entry.sourceLocators.push(paragraph.sourceLocator);
      addDiagnostic({ code: "MANUAL_BODY_ASSIGNMENT_APPLIED", severity: "info", message: `正文已按手工修正归入 ${date}${assignedTime ? ` ${assignedTime}` : ""}：${correction.reason}`, sourceLocator: paragraph.sourceLocator }, entry);
      continue;
    }

    if (token.kind === "UNSUPPORTED_OBJECT") {
      unsupportedBlocks.push({ sourceLocator: paragraph.sourceLocator, text: paragraph.text, objectTypes: paragraph.unsupportedObjects ?? [] });
      addDiagnostic({ code: "UNSUPPORTED_WORD_OBJECT", severity: "error", message: `发现不支持的 Word 容器：${(paragraph.unsupportedObjects ?? []).join("、") || "unknown"}。内容已保留在异常预览中。`, sourceLocator: paragraph.sourceLocator });
      continue;
    }
    if (token.kind === "AMBIGUOUS") {
      closeEmptySegment();
      addDiagnostic({ code: "AMBIGUOUS_STRUCTURE", severity: "error", message: classified.invalidCandidate ?? "段落疑似结构标题，但无法安全解析。", sourceLocator: paragraph.sourceLocator });
      appendOrphan(orphanBlocks, paragraph);
      currentDate = null;
      currentSegment = null;
      continue;
    }
    if (token.kind === "YEAR_HEADING") {
      closeEmptySegment();
      currentYear = token.parsed!.year!;
      currentMonth = null;
      currentDate = null;
      currentSegment = null;
      headingUse.set(paragraph.sourceLocator, 0);
      continue;
    }
    if (token.kind === "MONTH_HEADING") {
      closeEmptySegment();
      if (currentYear === null) {
        addDiagnostic({ code: "MONTH_WITHOUT_YEAR", severity: "error", message: "月份标题前没有可确定年份。", sourceLocator: paragraph.sourceLocator });
        continue;
      }
      currentMonth = token.parsed!.month!;
      currentDate = null;
      currentSegment = null;
      headingUse.set(paragraph.sourceLocator, 0);
      continue;
    }
    if (token.kind === "DATE_HEADING") {
      closeEmptySegment();
      const parsed = token.parsed!;
      const inherited: string[] = [];
      const year: number | null | undefined = parsed.year ?? currentYear;
      const month: number | null | undefined = parsed.month ?? currentMonth;
      if (year === null || year === undefined || month === null || month === undefined || parsed.day === undefined) {
        addDiagnostic({ code: "DATE_WITHOUT_CONTEXT", severity: "error", message: "日期标题缺少唯一可继承的年份或月份。", sourceLocator: paragraph.sourceLocator });
        currentDate = null;
        currentSegment = null;
        continue;
      }
      if (parsed.year === undefined) inherited.push(`年份 ${year} 来自上文标题`);
      if (parsed.month === undefined) inherited.push(`月份 ${month} 来自上文标题`);
      currentYear = year;
      currentMonth = month;
      const date = formatDate(year, month, parsed.day);
      if (!isValidDate(year, month, parsed.day) || year < minimumYear || year > maximumYear) {
        addDiagnostic({ code: "INVALID_JOURNAL_DATE", severity: "error", message: `日期 ${date} 不存在或超出允许年代。`, sourceLocator: paragraph.sourceLocator });
        currentDate = null;
        currentSegment = null;
        continue;
      }
      if (lastDate && date < lastDate) addDiagnostic({ code: "DATE_ORDER_RETREAT", severity: "warning", message: `日期从 ${lastDate} 回退到 ${date}；保留源顺序。`, sourceLocator: paragraph.sourceLocator });
      lastDate = date;
      let entry = entriesByDate.get(date);
      if (!entry) {
        entry = { date, segments: [], sourceLocators: [], inheritedContext: inherited, confidence: token.confidence, diagnostics: [] };
        entriesByDate.set(date, entry);
        entryOrder.push(entry);
      } else {
        duplicateDates += 1;
        addDiagnostic({ code: "DUPLICATE_DATE_HEADING", severity: "warning", message: `日期 ${date} 再次出现；预览合并为同一天并保留源顺序。`, sourceLocator: paragraph.sourceLocator }, entry);
        entry.inheritedContext.push(...inherited);
        entry.confidence = lowerConfidence(entry.confidence, token.confidence);
      }
      entry.sourceLocators.push(paragraph.sourceLocator);
      currentDate = date;
      currentSegment = null;
      for (const [locator, used] of headingUse) headingUse.set(locator, used + 1);
      continue;
    }
    if (token.kind === "TIME_HEADING") {
      closeEmptySegment();
      if (!currentDate) {
        addDiagnostic({ code: "TIME_WITHOUT_DATE", severity: "error", message: "时间标题前没有可确定日期。", sourceLocator: paragraph.sourceLocator });
        appendOrphan(orphanBlocks, paragraph);
        currentSegment = null;
        continue;
      }
      const entry = entriesByDate.get(currentDate)!;
      currentSegment = { time: token.parsed!.time!, lines: [], sourceLocators: [paragraph.sourceLocator], confidence: token.confidence, headingLocator: paragraph.sourceLocator };
      entry.segments.push(currentSegment);
      entry.sourceLocators.push(paragraph.sourceLocator);
      entry.confidence = lowerConfidence(entry.confidence, token.confidence);
      continue;
    }
    if (token.kind === "EMPTY") {
      if (currentSegment && currentSegment.lines.length > 0 && currentSegment.lines.at(-1) !== "") currentSegment.lines.push("");
      continue;
    }
    if (token.kind === "BODY") {
      if (!currentDate) {
        appendOrphan(orphanBlocks, paragraph);
        addDiagnostic({ code: "ORPHAN_BODY", severity: "error", message: "正文没有可确定的日期归属。", sourceLocator: paragraph.sourceLocator });
        continue;
      }
      const entry = entriesByDate.get(currentDate)!;
      if (!currentSegment) {
        currentSegment = { time: null, lines: [], sourceLocators: [], confidence: token.confidence };
        entry.segments.push(currentSegment);
      }
      currentSegment.lines.push(paragraph.text);
      currentSegment.sourceLocators.push(paragraph.sourceLocator);
      currentSegment.confidence = lowerConfidence(currentSegment.confidence, token.confidence);
      entry.sourceLocators.push(paragraph.sourceLocator);
    }
  }
  closeEmptySegment();

  for (const [locator, used] of headingUse) {
    if (used === 0) addDiagnostic({ code: "UNUSED_CONTEXT_HEADING", severity: "warning", message: "年或月标题后没有形成日记条目。", sourceLocator: locator });
  }

  const sourceSha256 = options.sourceSha256 ?? "fixture";
  const batchIdentity = `${sourceSha256}:${LEGACY_JOURNAL_PARSER_VERSION}:${LEGACY_JOURNAL_MAPPING_VERSION}`;
  const entries = entryOrder.map((draft): LegacyJournalEntryPreview => {
    const segments = draft.segments.map((segment) => ({
      time: segment.time,
      bodyMarkdown: trimBlankEdges(segment.lines).join("\n"),
      sourceLocators: unique(segment.sourceLocators),
      confidence: segment.confidence,
    }));
    return {
      date: draft.date,
      timezone: options.timezone,
      outputPath: `Journal/${draft.date.slice(0, 4)}/${draft.date}.md`,
      markdown: renderLegacyJournalMarkdown(draft.date, options.timezone, batchIdentity, segments),
      segments,
      sourceLocators: unique(draft.sourceLocators),
      inheritedContext: unique(draft.inheritedContext),
      confidence: draft.confidence,
      diagnostics: draft.diagnostics,
    };
  });

  const nonEmptyParagraphs = paragraphs.filter((paragraph) => paragraph.text.trim() || (paragraph.unsupportedObjects?.length ?? 0) > 0).length;
  const accountedNonEmptyParagraphs = tokens.filter((token) => token.originalText.trim() || token.kind === "UNSUPPORTED_OBJECT").length;
  const counts = countDiagnostics(diagnostics);
  const years = entries.map((entry) => Number(entry.date.slice(0, 4)));
  return {
    parserVersion: LEGACY_JOURNAL_PARSER_VERSION,
    mappingVersion: LEGACY_JOURNAL_MAPPING_VERSION,
    timezone: options.timezone,
    entries,
    tokens,
    orphanBlocks,
    unsupportedBlocks,
    skippedBlocks,
    corrections,
    diagnostics,
    summary: {
      sourceParagraphs: paragraphs.length,
      nonEmptyParagraphs,
      accountedNonEmptyParagraphs,
      coveragePercent: nonEmptyParagraphs === 0 ? 100 : Math.round((accountedNonEmptyParagraphs / nonEmptyParagraphs) * 10_000) / 100,
      dateCount: entries.length,
      segmentCount: entries.reduce((total, entry) => total + entry.segments.length, 0),
      bodyCharacters: entries.reduce((total, entry) => total + entry.segments.reduce((sum, segment) => sum + segment.bodyMarkdown.length, 0), 0),
      yearRange: years.length ? [Math.min(...years), Math.max(...years)] : null,
      info: counts.info,
      warnings: counts.warning,
      errors: counts.error,
      blocking: counts.blocking,
      duplicateDates,
      orphanBlocks: orphanBlocks.length,
      unsupportedObjects: unsupportedBlocks.length,
      manualCorrections: corrections.length,
      skippedParagraphs: skippedBlocks.length,
    },
    dryRunReady: entries.length > 0 && counts.error === 0 && counts.blocking === 0 && accountedNonEmptyParagraphs === nonEmptyParagraphs,
    commitEnabled: false,
  };
}

export function compareLegacyJournalPreviews(before: LegacyJournalParsePreview, after: LegacyJournalParsePreview): LegacyPreviewComparison {
  const beforeEntries = new Map(before.entries.map((entry) => [entry.date, entry]));
  const afterEntries = new Map(after.entries.map((entry) => [entry.date, entry]));
  const addedDates = [...afterEntries.keys()].filter((date) => !beforeEntries.has(date)).sort();
  const removedDates = [...beforeEntries.keys()].filter((date) => !afterEntries.has(date)).sort();
  const sharedDates = [...afterEntries.keys()].filter((date) => beforeEntries.has(date));
  const changedDates = sharedDates.filter((date) => beforeEntries.get(date)!.markdown !== afterEntries.get(date)!.markdown).sort();
  const beforeDiagnostics = multiset(before.diagnostics.map(diagnosticFingerprint));
  const afterDiagnostics = multiset(after.diagnostics.map(diagnosticFingerprint));
  return {
    addedDates,
    removedDates,
    changedDates,
    unchangedDates: sharedDates.length - changedDates.length,
    diagnosticsAdded: multisetDifferenceCount(afterDiagnostics, beforeDiagnostics),
    diagnosticsRemoved: multisetDifferenceCount(beforeDiagnostics, afterDiagnostics),
    orphanBlocksBefore: before.orphanBlocks.length,
    orphanBlocksAfter: after.orphanBlocks.length,
    correctionsBefore: before.corrections.length,
    correctionsAfter: after.corrections.length,
  };
}

export function classifyLegacyWordParagraph(paragraph: LegacyWordParagraph, context: { currentYear: number | null; currentMonth: number | null; minimumYear?: number; maximumYear?: number }) {
  return classifyParagraph(paragraph, { minimumYear: context.minimumYear ?? 1900, maximumYear: context.maximumYear ?? 2100, currentYear: context.currentYear, currentMonth: context.currentMonth }).token;
}

function classifyCorrection(paragraph: LegacyWordParagraph, correction: LegacyImportCorrection): ClassifiedParagraph {
  const normalizedText = normalizeForMatch(paragraph.text);
  const base = { sourceLocator: paragraph.sourceLocator, originalText: paragraph.text, normalizedText, confidence: "high" as const, evidence: [`手工修正 ${correction.id}：${correction.reason}`] };
  if (correction.action === "set-date-heading") {
    const [year, month, day] = correction.date!.split("-").map(Number);
    return { token: { ...base, kind: "DATE_HEADING", parsed: { year, month, day } } };
  }
  if (correction.action === "set-time-heading") return { token: { ...base, kind: "TIME_HEADING", parsed: { time: correction.time! } } };
  return { token: { ...base, kind: "BODY" } };
}

function classifyParagraph(paragraph: LegacyWordParagraph, context: { currentYear: number | null; currentMonth: number | null; minimumYear: number; maximumYear: number }): ClassifiedParagraph {
  const normalizedText = normalizeForMatch(paragraph.text);
  const styleEvidence = headingStyleEvidence(paragraph);
  const base = { sourceLocator: paragraph.sourceLocator, originalText: paragraph.text, normalizedText };
  if ((paragraph.unsupportedObjects?.length ?? 0) > 0) return { token: { ...base, kind: "UNSUPPORTED_OBJECT", confidence: "high", evidence: [`Word 容器：${paragraph.unsupportedObjects!.join("、")}`] } };
  if (!normalizedText) return { token: { ...base, kind: "EMPTY", confidence: "high", evidence: ["空段落"] } };

  const yearMatch = normalizedText.match(/^(\d{4}|[〇零一二三四五六七八九]{4})年?$/u);
  if (yearMatch) {
    const year = parseYear(yearMatch[1]);
    if (year < context.minimumYear || year > context.maximumYear) return ambiguous(base, `疑似年份 ${year} 超出允许范围 ${context.minimumYear}–${context.maximumYear}。`);
    return { token: { ...base, kind: "YEAR_HEADING", confidence: styleEvidence.length ? "high" : "medium", evidence: ["完整年份模式", ...styleEvidence], parsed: { year } } };
  }

  const monthMatch = normalizedText.match(/^([0-9]{1,2}|[一二三四五六七八九十]{1,3})月$/u);
  if (monthMatch) {
    const month = parseChineseNumber(monthMatch[1]);
    if (month < 1 || month > 12) return ambiguous(base, `疑似月份 ${month} 不合法。`);
    return { token: { ...base, kind: "MONTH_HEADING", confidence: styleEvidence.length ? "high" : "medium", evidence: ["月份标题模式", ...styleEvidence], parsed: { month } } };
  }

  const time = parseTime(normalizedText);
  if (time.kind === "valid") return { token: { ...base, kind: "TIME_HEADING", confidence: styleEvidence.length ? "high" : "medium", evidence: ["合法时间模式", ...styleEvidence], parsed: { time: time.value } } };
  if (time.kind === "invalid") return ambiguous(base, time.message);

  const date = parseDateHeading(normalizedText);
  if (date.kind === "valid") {
    const year = date.year ?? context.currentYear;
    const month = date.month ?? context.currentMonth;
    if (year !== null && year !== undefined && month !== null && month !== undefined && !isValidDate(year, month, date.day)) return ambiguous(base, `疑似日期 ${formatDate(year, month, date.day)} 不存在。`);
    const inherited = [date.year === undefined && "继承年份", date.month === undefined && "继承月份"].filter(Boolean) as string[];
    const confidence: LegacyImportConfidence = inherited.length === 0 || styleEvidence.length ? "high" : "medium";
    return { token: { ...base, kind: "DATE_HEADING", confidence, evidence: ["日期标题模式", ...inherited, ...styleEvidence], parsed: { year: date.year, month: date.month, day: date.day } } };
  }
  if (date.kind === "invalid") return ambiguous(base, date.message);

  if (/^(?:\d{1,2}|[一二三四五六七八九十]{1,3})$/u.test(normalizedText) && styleEvidence.length && context.currentYear !== null) {
    const month = parseChineseNumber(normalizedText);
    if (month >= 1 && month <= 12) return { token: { ...base, kind: "MONTH_HEADING", confidence: "low", evidence: ["纯数字标题样式，按月份候选解释", ...styleEvidence], parsed: { month } } };
  }

  return { token: { ...base, kind: "BODY", confidence: "high", evidence: ["未匹配结构标题，保留为正文"] } };
}

function parseDateHeading(value: string): { kind: "valid"; year?: number; month?: number; day: number } | { kind: "invalid"; message: string } | { kind: "none" } {
  const weekday = "(?:\\s*(?:星期|周)[一二三四五六日天])?";
  let match = value.match(new RegExp(`^(\\d{4}|[〇零一二三四五六七八九]{4})年([0-9]{1,2}|[一二三四五六七八九十]{1,3})月([0-9]{1,2}|[一二三四五六七八九十]{1,3})[日号]${weekday}$`, "u"));
  if (match) return { kind: "valid", year: parseYear(match[1]), month: parseChineseNumber(match[2]), day: parseChineseNumber(match[3]) };
  match = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/u);
  if (match) return { kind: "valid", year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  match = value.match(new RegExp(`^([0-9]{1,2}|[一二三四五六七八九十]{1,3})月([0-9]{1,2}|[一二三四五六七八九十]{1,3})[日号]${weekday}$`, "u"));
  if (match) return { kind: "valid", month: parseChineseNumber(match[1]), day: parseChineseNumber(match[2]) };
  match = value.match(/^(\d{1,2})[-/](\d{1,2})$/u);
  if (match) return { kind: "valid", month: Number(match[1]), day: Number(match[2]) };
  match = value.match(new RegExp(`^([0-9]{1,2}|[一二三四五六七八九十]{1,3})[日号]${weekday}$`, "u"));
  if (match) return { kind: "valid", day: parseChineseNumber(match[1]) };
  if (/^(?=[\s\S]*(?:[年月日号]|\d[-/.]\d))[0-9〇零一二三四五六七八九十年月日号星期周天\s./-]+$/u.test(value)) {
    return { kind: "invalid", message: "段落疑似日期标题，但格式或数值无法安全解析。" };
  }
  return { kind: "none" };
}

function parseTime(value: string): { kind: "valid"; value: string } | { kind: "invalid"; message: string } | { kind: "none" } {
  const match = value.match(/^(?:(上午|下午|晚上|凌晨)\s*)?(\d{1,2})[:：](\d{2})$/u);
  if (!match) return /\d{1,2}[:：]\d{1,2}/u.test(value) ? { kind: "invalid", message: "段落疑似时间标题，但格式无法安全解析。" } : { kind: "none" };
  const period = match[1];
  let hour = Number(match[2]);
  const minute = Number(match[3]);
  if (minute > 59 || (!period && hour > 23) || (period && (hour < 1 || hour > 12))) return { kind: "invalid", message: `疑似时间 ${value} 不合法；24:00 不会自动跨日。` };
  if (period === "下午" || period === "晚上") hour = hour === 12 ? 12 : hour + 12;
  if (period === "上午" || period === "凌晨") hour = hour === 12 ? 0 : hour;
  return { kind: "valid", value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}

function parseYear(value: string) {
  if (/^\d{4}$/u.test(value)) return Number(value);
  return [...value].reduce((year, digit) => year * 10 + (CHINESE_DIGITS[digit] ?? 0), 0);
}

function parseChineseNumber(value: string) {
  if (/^\d+$/u.test(value)) return Number(value);
  if (!value.includes("十")) return CHINESE_DIGITS[value] ?? Number.NaN;
  const [tens, ones] = value.split("十");
  return (tens ? CHINESE_DIGITS[tens] : 1) * 10 + (ones ? CHINESE_DIGITS[ones] : 0);
}

function headingStyleEvidence(paragraph: LegacyWordParagraph) {
  const evidence: string[] = [];
  if (paragraph.styleName && /heading|title|标题|题目|year|month|date|time/i.test(paragraph.styleName)) evidence.push(`Word 样式 ${paragraph.styleName}`);
  if (paragraph.outlineLevel !== null && paragraph.outlineLevel !== undefined && paragraph.outlineLevel <= 3) evidence.push(`大纲级别 ${paragraph.outlineLevel}`);
  if (paragraph.bold) evidence.push("加粗提示");
  return evidence;
}

function ambiguous(base: Pick<LegacyParagraphToken, "sourceLocator" | "originalText" | "normalizedText">, message: string): ClassifiedParagraph {
  return { token: { ...base, kind: "AMBIGUOUS", confidence: "low", evidence: [message] }, invalidCandidate: message };
}

function normalizeForMatch(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function formatDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isValidDate(year: number, month: number, day: number) {
  if (![year, month, day].every(Number.isInteger) || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isIanaTimezone(value: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return true; } catch { return false; }
}

function lowerConfidence(left: LegacyImportConfidence, right: LegacyImportConfidence): LegacyImportConfidence {
  return CONFIDENCE_RANK[left] <= CONFIDENCE_RANK[right] ? left : right;
}

function appendOrphan(blocks: LegacyOrphanBlock[], paragraph: LegacyWordParagraph) {
  const previous = blocks.at(-1);
  const locatorNumber = Number(paragraph.sourceLocator.match(/(\d+)$/u)?.[1]);
  const previousNumber = Number(previous?.sourceLocators.at(-1)?.match(/(\d+)$/u)?.[1]);
  if (previous && Number.isFinite(locatorNumber) && locatorNumber === previousNumber + 1) {
    previous.sourceLocators.push(paragraph.sourceLocator);
    previous.text += `\n${paragraph.text}`;
  } else blocks.push({ sourceLocators: [paragraph.sourceLocator], text: paragraph.text });
}

function trimBlankEdges(lines: string[]) {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

function renderLegacyJournalMarkdown(date: string, timezone: string, batchIdentity: string, segments: LegacyJournalSegmentPreview[]) {
  const sections = segments.map((segment) => `${segment.time ? `## ${segment.time}` : "## 未记录时间"}\n\n${segment.bodyMarkdown}`.trimEnd()).join("\n\n");
  return `---\ntype: journal\ndate: ${date}\ntimezone: ${timezone}\nsource: legacy-word-import\nimport_batch_identity: ${JSON.stringify(batchIdentity)}\nschema_version: 1\n---\n\n${sections}\n`;
}

function countDiagnostics(diagnostics: LegacyImportDiagnostic[]) {
  const counts: Record<LegacyImportSeverity, number> = { info: 0, warning: 0, error: 0, blocking: 0 };
  for (const issue of diagnostics) counts[issue.severity] += 1;
  return counts;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function validateCorrections(paragraphs: LegacyWordParagraph[], corrections: LegacyImportCorrection[], minimumYear: number, maximumYear: number) {
  const paragraphsByLocator = new Map(paragraphs.map((paragraph) => [paragraph.sourceLocator, paragraph]));
  const ids = new Set<string>();
  const previousByLocator = new Map<string, LegacyImportCorrection>();
  return corrections.map((correction) => {
    if (!correction.id.trim() || correction.id.length > 200 || ids.has(correction.id)) throw new Error("INVALID_LEGACY_CORRECTION_ID");
    ids.add(correction.id);
    const paragraph = paragraphsByLocator.get(correction.sourceLocator);
    if (!paragraph) throw new Error("LEGACY_CORRECTION_LOCATOR_NOT_FOUND");
    const previous = previousByLocator.get(correction.sourceLocator);
    if (previous ? correction.supersedesId !== previous.id : correction.supersedesId) throw new Error("INVALID_LEGACY_CORRECTION_CHAIN");
    if ((paragraph.unsupportedObjects?.length ?? 0) > 0 && correction.action !== "skip") throw new Error("LEGACY_CORRECTION_UNSUPPORTED_OBJECT");
    const reason = correction.reason.trim();
    if (!reason || reason.length > 1_000) throw new Error("INVALID_LEGACY_CORRECTION_REASON");
    const recordedAt = new Date(correction.recordedAt);
    if (Number.isNaN(recordedAt.valueOf()) || recordedAt.toISOString() !== correction.recordedAt) throw new Error("INVALID_LEGACY_CORRECTION_TIMESTAMP");
    if (!(["set-date-heading", "set-time-heading", "set-body", "assign-body", "skip"] as string[]).includes(correction.action)) throw new Error("INVALID_LEGACY_CORRECTION_ACTION");
    if (correction.action === "set-date-heading" || correction.action === "assign-body") {
      if (!correction.date || !isValidIsoDate(correction.date, minimumYear, maximumYear)) throw new Error("INVALID_LEGACY_CORRECTION_DATE");
    } else if (correction.date !== undefined) throw new Error("UNEXPECTED_LEGACY_CORRECTION_DATE");
    if (correction.action === "set-time-heading") {
      if (!correction.time || !isValidIsoTime(correction.time)) throw new Error("INVALID_LEGACY_CORRECTION_TIME");
    } else if (correction.action === "assign-body") {
      if (correction.time !== undefined && correction.time !== null && !isValidIsoTime(correction.time)) throw new Error("INVALID_LEGACY_CORRECTION_TIME");
    } else if (correction.time !== undefined) throw new Error("UNEXPECTED_LEGACY_CORRECTION_TIME");
    const normalized = { ...correction, reason, recordedAt: recordedAt.toISOString(), supersedesId: correction.supersedesId ?? null };
    previousByLocator.set(correction.sourceLocator, normalized);
    return normalized;
  });
}

function isValidIsoDate(value: string, minimumYear: number, maximumYear: number) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return false;
  const year = Number(match[1]);
  return year >= minimumYear && year <= maximumYear && isValidDate(year, Number(match[2]), Number(match[3]));
}

function isValidIsoTime(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/u);
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
}

function diagnosticFingerprint(issue: LegacyImportDiagnostic) {
  return `${issue.severity}\u0000${issue.code}\u0000${issue.sourceLocator ?? ""}\u0000${issue.message}`;
}

function multiset(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function multisetDifferenceCount(left: Map<string, number>, right: Map<string, number>) {
  let count = 0;
  for (const [value, occurrences] of left) count += Math.max(0, occurrences - (right.get(value) ?? 0));
  return count;
}
