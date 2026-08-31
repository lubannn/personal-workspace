"use client";

import { useMemo, useState, type ChangeEvent } from "react";

import { previewLegacyJournalDocx, type LegacyDocxPreview } from "../../../../src/lib/github-data/legacy-docx-preview";
import type { LegacyImportDiagnostic } from "../../../../src/lib/github-data/legacy-journal-import";

type PreviewFilter = "all" | "issues" | "low-confidence";

export function LegacyJournalImportSection({ timezone }: { timezone: string }) {
  const [preview, setPreview] = useState<LegacyDocxPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<PreviewFilter>("all");
  const [pickerKey, setPickerKey] = useState(0);
  const diagnostics = useMemo(() => preview ? [...preview.archiveDiagnostics, ...preview.parse.diagnostics] : [], [preview]);
  const visibleEntries = useMemo(() => {
    if (!preview) return [];
    if (filter === "issues") return preview.parse.entries.filter((entry) => entry.diagnostics.length > 0);
    if (filter === "low-confidence") return preview.parse.entries.filter((entry) => entry.confidence === "low" || entry.segments.some((segment) => segment.confidence === "low"));
    return preview.parse.entries;
  }, [filter, preview]);
  const blocking = diagnostics.some((issue) => issue.severity === "blocking" || issue.severity === "error");

  async function inspectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setChecking(true);
    setPreview(null);
    setError(null);
    setFilter("all");
    try {
      setPreview(await previewLegacyJournalDocx(file, { timezone }));
    } catch (caught) {
      setError(friendlyLegacyImportError(caught));
    } finally {
      setChecking(false);
    }
  }

  function discardPreview() {
    setPreview(null);
    setError(null);
    setFilter("all");
    setPickerKey((value) => value + 1);
  }

  return <section className="legacy-import" aria-labelledby="legacy-import-title">
    <div className="legacy-import-heading">
      <div><p className="eyebrow">Phase 3 · Local-only preview</p><h3 id="legacy-import-title">Legacy Word 导入预览</h3><p>选择只读 `.docx` 工作副本后，文件只在当前浏览器内解压、计算 SHA-256 和生成诊断；不会上传、修改源文件、写入 Journal 或连接 Obsidian。</p></div>
      {preview || error ? <button className="text-button" type="button" onClick={discardPreview} disabled={checking}>丢弃本地预览</button> : null}
    </div>
    <div className="legacy-import-picker">
      <label className={`file-picker ${checking ? "disabled" : ""}`}>{checking ? "正在只读解析…" : "选择脱敏 .docx 副本"}<input key={pickerKey} type="file" accept="application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" onChange={inspectFile} disabled={checking} /></label>
      <span>最大 256 MiB · 默认时区 {timezone} · 不支持旧 `.doc`、加密文档或宏提交</span>
    </div>
    {error ? <div className="legacy-import-error" role="alert"><strong>无法生成预览</strong><p>{error}</p></div> : null}
    {preview ? <>
      <div className="legacy-import-source">
        <div><strong>{preview.source.fileName}</strong><span>{formatBytes(preview.source.byteSize)} · {preview.archiveEntryCount} 个 ZIP 条目 · 原文件未修改</span></div>
        <code>SHA-256 {preview.source.sha256}</code>
        <small>Parser {preview.parserVersion} · Mapping {preview.mappingVersion}</small>
      </div>
      <div className="legacy-import-summary" aria-label="导入预览摘要">
        <SummaryMetric label="内容覆盖" value={`${preview.parse.summary.coveragePercent}%`} />
        <SummaryMetric label="日期" value={String(preview.parse.summary.dateCount)} />
        <SummaryMetric label="Segments" value={String(preview.parse.summary.segmentCount)} />
        <SummaryMetric label="正文字符" value={String(preview.parse.summary.bodyCharacters)} />
        <SummaryMetric label="Warnings" value={String(preview.parse.summary.warnings + preview.archiveDiagnostics.filter((issue) => issue.severity === "warning").length)} />
        <SummaryMetric label="Errors" value={String(preview.parse.summary.errors + preview.parse.summary.blocking + preview.archiveDiagnostics.filter((issue) => issue.severity === "error" || issue.severity === "blocking").length)} />
      </div>
      <div className={`legacy-import-gate ${blocking || !preview.parse.dryRunReady ? "blocked" : "ready"}`} role="status">
        <strong>{blocking || !preview.parse.dryRunReady ? "预览需要人工处理" : "结构预览通过"}</strong>
        <p>{blocking || !preview.parse.dryRunReady ? "异常内容已保留在下方，当前没有提交能力，也不会丢弃或猜测归属。" : "所有非空段落都有明确去向；当前切片仍只读，Commit 按钮固定关闭。"}</p>
      </div>
      {diagnostics.length ? <DiagnosticList diagnostics={diagnostics} /> : null}
      {preview.parse.orphanBlocks.length ? <div className="legacy-import-exceptions"><h4>孤立正文 {preview.parse.orphanBlocks.length}</h4>{preview.parse.orphanBlocks.slice(0, 20).map((block) => <article key={block.sourceLocators.join("-")}><code>{block.sourceLocators.join(" · ")}</code><pre>{block.text}</pre></article>)}</div> : null}
      {preview.parse.unsupportedBlocks.length ? <div className="legacy-import-exceptions"><h4>不支持对象 {preview.parse.unsupportedBlocks.length}</h4>{preview.parse.unsupportedBlocks.slice(0, 20).map((block) => <article key={block.sourceLocator}><code>{block.sourceLocator} · {block.objectTypes.join(" / ")}</code><pre>{block.text || "（对象没有可提取纯文本）"}</pre></article>)}</div> : null}
      <div className="legacy-import-preview-heading">
        <div><h4>按日 Markdown 预览</h4><span>显示 {Math.min(visibleEntries.length, 100)} / {visibleEntries.length}；源顺序保持不变</span></div>
        <div aria-label="预览筛选"><button className="view-button" type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>全部</button><button className="view-button" type="button" aria-pressed={filter === "issues"} onClick={() => setFilter("issues")}>仅异常</button><button className="view-button" type="button" aria-pressed={filter === "low-confidence"} onClick={() => setFilter("low-confidence")}>低置信度</button></div>
      </div>
      {visibleEntries.length === 0 ? <p className="empty-note">当前筛选没有条目。</p> : <ol className="legacy-import-entries">{visibleEntries.slice(0, 100).map((entry) => <li key={entry.date}>
        <div><strong>{entry.date}</strong><span>{entry.segments.length} segments · {entry.confidence} confidence</span><code>{entry.outputPath}</code></div>
        {entry.inheritedContext.length ? <p>{entry.inheritedContext.join("；")}</p> : null}
        <pre>{entry.markdown}</pre>
      </li>)}</ol>}
      {visibleEntries.length > 100 ? <p className="empty-note">为避免巨大文档阻塞界面，本页只渲染前 100 条；统计与诊断仍覆盖整份文档。</p> : null}
      <div className="legacy-import-boundary"><strong>写入边界</strong><p>此预览没有 Commit、自动合并、Journal 写入或 Vault 输出能力。正式导入仍需规则修正、dry run、幂等 Import Log 和逐批明确确认。</p></div>
    </> : null}
  </section>;
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function DiagnosticList({ diagnostics }: { diagnostics: LegacyImportDiagnostic[] }) {
  return <div className="legacy-import-diagnostics"><h4>Diagnostics {diagnostics.length}</h4><ul>{diagnostics.slice(0, 100).map((issue, index) => <li key={`${issue.code}-${issue.sourceLocator ?? index}`} data-severity={issue.severity}><strong>{issue.severity} · {issue.code}</strong><span>{issue.sourceLocator ? `${issue.sourceLocator}：` : ""}{issue.message}</span></li>)}</ul>{diagnostics.length > 100 ? <p>仅显示前 100 条；摘要计数覆盖全部诊断。</p> : null}</div>;
}

function friendlyLegacyImportError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    LEGACY_IMPORT_DOCX_REQUIRED: "请选择 `.docx` 工作副本；旧 `.doc` 必须先在不覆盖原件的前提下转换为 `.docx`。",
    LEGACY_IMPORT_EMPTY_FILE: "文件为空，未执行解析。",
    LEGACY_IMPORT_FILE_TOO_LARGE: "文件超过 256 MiB 安全上限，未执行解析。",
    LEGACY_IMPORT_FILE_SIZE_MISMATCH: "浏览器读取的字节数与文件元数据不一致，预览已阻断。",
    LEGACY_IMPORT_ARCHIVE_ENTRY_LIMIT: "DOCX ZIP 条目过多，可能是异常归档，预览已阻断。",
    LEGACY_IMPORT_UNSAFE_ARCHIVE_PATH: "DOCX 包含不安全的相对路径，预览已阻断。",
    LEGACY_IMPORT_DOCUMENT_XML_TOO_LARGE: "Word 主文档 XML 超过 64 MiB 安全上限，预览已阻断。",
    LEGACY_IMPORT_ENCRYPTED_DOCX: "该 Word 文档已加密，无法进行只读结构预览。",
    LEGACY_IMPORT_DOCUMENT_XML_MISSING: "DOCX 缺少 word/document.xml，可能已损坏或不是标准 OOXML 文档。",
    LEGACY_IMPORT_INVALID_ZIP: "DOCX ZIP 容器损坏或使用了不支持的压缩方式。",
    LEGACY_IMPORT_INVALID_UTF8_XML: "Word 主文档 XML 不是有效 UTF-8，预览已阻断。",
    LEGACY_IMPORT_NO_PARAGRAPHS: "Word 主文档中没有可提取段落。",
  };
  return messages[code] ?? "只读解析失败，源文件未被修改，也没有写入任何数据。";
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}
