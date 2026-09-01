"use client";

import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { previewLegacyJournalDocx, type LegacyDocxPreview } from "../../../../src/lib/github-data/legacy-docx-preview";
import { buildLegacyJournalDryRun } from "../../../../src/lib/github-data/legacy-journal-dry-run";
import { buildLegacyJournalCommitPlan, LEGACY_JOURNAL_IMPORT_COMMIT_ENABLED, MAX_LEGACY_JOURNAL_DATES_PER_COMMIT, type LegacyJournalCommitPlan } from "../../../../src/lib/github-data/legacy-journal-commit-plan";
import { buildLegacyJournalCommitActionConfirmation, legacyJournalCommitStatusFromReconciliation, runLegacyJournalCommitAttempt, type LegacyJournalCommitActionStatus } from "../../../../src/lib/github-data/legacy-journal-commit-action";
import { prepareLegacyJournalAtomicPayload, readLegacyJournalPlanningSnapshot, reconcileLegacyJournalBatch, writeLegacyJournalBatchAtomically, type LegacyJournalAtomicPayloadPreview, type LegacyJournalAtomicWriteResult, type LegacyJournalReconciliation } from "../../../../src/lib/github-data/legacy-journal-atomic-writer";
import type { GitHubContentsAdapter } from "../../../../src/lib/github-data/github-contents";
import {
  compareLegacyJournalPreviews,
  type LegacyImportCorrection,
  type LegacyImportCorrectionAction,
  type LegacyImportDiagnostic,
  type LegacyPreviewComparison,
} from "../../../../src/lib/github-data/legacy-journal-import";
import type { Connection } from "./page-model";

type PreviewFilter = "all" | "issues" | "low-confidence";

export function LegacyJournalImportSection({ connection, adapter, online, onCommitted }: { connection: Connection | null; adapter: GitHubContentsAdapter | null; online: boolean | null; onCommitted: () => Promise<void> }) {
  const timezone = connection?.timezone ?? "Asia/Shanghai";
  const [preview, setPreview] = useState<LegacyDocxPreview | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [checking, setChecking] = useState(false);
  const [applyingCorrection, setApplyingCorrection] = useState(false);
  const [buildingDryRun, setBuildingDryRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<PreviewFilter>("all");
  const [pickerKey, setPickerKey] = useState(0);
  const [correctionLocator, setCorrectionLocator] = useState("");
  const [correctionAction, setCorrectionAction] = useState<LegacyImportCorrectionAction>("assign-body");
  const [correctionDate, setCorrectionDate] = useState("");
  const [correctionTime, setCorrectionTime] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [comparison, setComparison] = useState<LegacyPreviewComparison | null>(null);
  const [dryRunResult, setDryRunResult] = useState<{ fileName: string; sha256: string; journalFiles: number } | null>(null);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<LegacyJournalCommitPlan | null>(null);
  const [payload, setPayload] = useState<LegacyJournalAtomicPayloadPreview | null>(null);
  const [repositoryConfirmation, setRepositoryConfirmation] = useState("");
  const [dateRangeConfirmation, setDateRangeConfirmation] = useState("");
  const [reconciliation, setReconciliation] = useState<LegacyJournalReconciliation | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [commitStatus, setCommitStatus] = useState<LegacyJournalCommitActionStatus>("idle");
  const [commitResult, setCommitResult] = useState<LegacyJournalAtomicWriteResult | null>(null);
  const [commitNotice, setCommitNotice] = useState<string | null>(null);
  const commitStartedRef = useRef(false);
  const diagnostics = useMemo(() => preview ? [...preview.archiveDiagnostics, ...preview.parse.diagnostics] : [], [preview]);
  const correctionCandidates = useMemo(() => {
    if (!preview) return [];
    const issueLocators = new Set([
      ...preview.parse.diagnostics.flatMap((issue) => issue.sourceLocator ? [issue.sourceLocator] : []),
      ...preview.parse.orphanBlocks.flatMap((block) => block.sourceLocators),
      ...preview.parse.unsupportedBlocks.map((block) => block.sourceLocator),
      ...preview.parse.corrections.map((correction) => correction.sourceLocator),
    ]);
    return preview.parse.tokens.filter((token) => issueLocators.has(token.sourceLocator) || token.kind === "AMBIGUOUS" || token.confidence === "low");
  }, [preview]);
  const selectedCandidate = correctionCandidates.find((candidate) => candidate.sourceLocator === correctionLocator);
  const visibleEntries = useMemo(() => {
    if (!preview) return [];
    if (filter === "issues") return preview.parse.entries.filter((entry) => entry.diagnostics.length > 0);
    if (filter === "low-confidence") return preview.parse.entries.filter((entry) => entry.confidence === "low" || entry.segments.some((segment) => segment.confidence === "low"));
    return preview.parse.entries;
  }, [filter, preview]);
  const blocking = diagnostics.some((issue) => issue.severity === "blocking" || issue.severity === "error");
  const targetRepository = connection ? `${connection.ownerLogin}/${connection.repository}` : "";
  const exactDateRange = plan?.selectedDates.length ? `${plan.selectedDates[0]}..${plan.selectedDates.at(-1)}` : "";
  const confirmationMatches = Boolean(plan && repositoryConfirmation === targetRepository && dateRangeConfirmation === exactDateRange);
  const payloadWithinLimits = Boolean(payload && payload.limitBlockers.length === 0);
  const commitReady = Boolean(LEGACY_JOURNAL_IMPORT_COMMIT_ENABLED && plan?.commitReady && payloadWithinLimits && confirmationMatches && online !== false && commitStatus === "idle");

  async function inspectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setChecking(true);
    setPreview(null);
    setSourceFile(file);
    setError(null);
    setFilter("all");
    setComparison(null);
    setDryRunResult(null);
    try {
      const nextPreview = await previewLegacyJournalDocx(file, { timezone });
      const firstLocator = firstCorrectionLocator(nextPreview);
      setPreview(nextPreview);
      setSelectedDates(nextPreview.parse.entries.length <= MAX_LEGACY_JOURNAL_DATES_PER_COMMIT ? nextPreview.parse.entries.map((entry) => entry.date) : []);
      resetCommitPlan();
      setCorrectionLocator(firstLocator);
      setCorrectionAction(nextPreview.parse.tokens.find((token) => token.sourceLocator === firstLocator)?.kind === "UNSUPPORTED_OBJECT" ? "skip" : "assign-body");
    } catch (caught) {
      setError(friendlyLegacyImportError(caught));
    } finally {
      setChecking(false);
    }
  }

  function discardPreview() {
    setPreview(null);
    setSourceFile(null);
    setError(null);
    setFilter("all");
    setCorrectionLocator("");
    setCorrectionAction("assign-body");
    setCorrectionDate("");
    setCorrectionTime("");
    setCorrectionReason("");
    setComparison(null);
    setDryRunResult(null);
    setSelectedDates([]);
    resetCommitPlan();
    setPickerKey((value) => value + 1);
  }

  function chooseCorrectionLocator(locator: string) {
    setCorrectionLocator(locator);
    const candidate = correctionCandidates.find((item) => item.sourceLocator === locator);
    if (candidate?.kind === "UNSUPPORTED_OBJECT") setCorrectionAction("skip");
  }

  async function applyCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || !sourceFile || !correctionLocator) return;
    setApplyingCorrection(true);
    setError(null);
    try {
      const previous = preview.parse.corrections.filter((item) => item.sourceLocator === correctionLocator).at(-1);
      const correction: LegacyImportCorrection = {
        id: `manual-${globalThis.crypto.randomUUID()}`,
        sourceLocator: correctionLocator,
        action: correctionAction,
        reason: correctionReason,
        recordedAt: new Date().toISOString(),
        supersedesId: previous?.id ?? null,
        ...((correctionAction === "set-date-heading" || correctionAction === "assign-body") ? { date: correctionDate } : {}),
        ...(correctionAction === "set-time-heading" ? { time: correctionTime } : {}),
        ...(correctionAction === "assign-body" ? { time: correctionTime || null } : {}),
      };
      const reparsed = await previewLegacyJournalDocx(sourceFile, { timezone, corrections: [...preview.parse.corrections, correction] });
      setComparison(compareLegacyJournalPreviews(preview.parse, reparsed.parse));
      setPreview(reparsed);
      setDryRunResult(null);
      setSelectedDates(reparsed.parse.entries.length <= MAX_LEGACY_JOURNAL_DATES_PER_COMMIT ? reparsed.parse.entries.map((entry) => entry.date) : []);
      resetCommitPlan();
      setCorrectionReason("");
    } catch (caught) {
      setError(friendlyLegacyImportError(caught));
    } finally {
      setApplyingCorrection(false);
    }
  }

  function resetCommitPlan() {
    setPlan(null);
    setPayload(null);
    setRepositoryConfirmation("");
    setDateRangeConfirmation("");
    setReconciliation(null);
    setCommitStatus("idle");
    setCommitResult(null);
    setCommitNotice(null);
    commitStartedRef.current = false;
  }

  function toggleDate(date: string) {
    resetCommitPlan();
    setSelectedDates((current) => current.includes(date) ? current.filter((item) => item !== date) : [...current, date].sort());
  }

  async function buildCommitPlan() {
    if (!preview || !connection || !adapter || selectedDates.length === 0) return;
    setPlanning(true);
    setError(null);
    resetCommitPlan();
    try {
      const snapshot = await readLegacyJournalPlanningSnapshot(adapter);
      const nextPlan = await buildLegacyJournalCommitPlan({
        preview,
        ownerId: connection.ownerId,
        expectedHeadCommitSha: snapshot.headCommitSha,
        selectedDates,
        existing: snapshot,
        plannedAt: new Date().toISOString(),
      });
      const nextPayload = nextPlan.commitReady ? await prepareLegacyJournalAtomicPayload(nextPlan) : null;
      setPlan(nextPlan);
      setPayload(nextPayload);
    } catch (caught) {
      setError(friendlyLegacyImportError(caught));
    } finally {
      setPlanning(false);
    }
  }

  async function runReconciliation() {
    if (!adapter || !plan) return;
    setReconciling(true);
    setError(null);
    try {
      const result = await reconcileLegacyJournalBatch(adapter, plan);
      setReconciliation(result);
      if (commitStatus !== "idle") {
        setCommitStatus(legacyJournalCommitStatusFromReconciliation(result));
        setCommitNotice(reconciliationNotice(result.status));
        if (result.status === "committed") await onCommitted();
      }
    } catch (caught) {
      if (commitStatus === "idle") setError(friendlyLegacyImportError(caught));
      else {
        setCommitStatus("unknown");
        setCommitNotice("仍无法确认本批结果。禁止再次提交；请恢复网络后只读核对当前计划，或重新加载数据并人工处理。");
      }
    } finally {
      setReconciling(false);
    }
  }

  async function commitBatch() {
    if (!adapter || !plan || !payload || !commitReady || commitStartedRef.current) return;
    const confirmed = globalThis.confirm(buildLegacyJournalCommitActionConfirmation({
      repository: targetRepository,
      dateRange: exactDateRange,
      expectedHeadCommitSha: plan.expectedHeadCommitSha,
      planSha256: payload.planSha256,
      fileCount: payload.fileCount,
      byteCount: payload.byteCount,
    }));
    if (!confirmed) return;

    commitStartedRef.current = true;
    setCommitStatus("writing");
    setCommitResult(null);
    setCommitNotice("正在执行单次原子 Commit；不会自动重试。");
    setReconciliation(null);
    setError(null);
    const outcome = await runLegacyJournalCommitAttempt({
      write: () => writeLegacyJournalBatchAtomically(adapter, { plan, committedAt: new Date().toISOString() }),
      reconcile: () => reconcileLegacyJournalBatch(adapter, plan),
      onWriteUncertain: () => setCommitNotice("写入请求没有返回可确认结果，正在执行只读 reconciliation；不会盲目重试。"),
    });
    if (outcome.writeResult) {
      const result = outcome.writeResult;
      setCommitResult(result);
      setCommitStatus("committed");
      setCommitNotice("本批已通过一个 Git commit 原子写入；Journal collections 已重新加载。");
      setReconciliation({ status: "committed", observedHeadCommitSha: result.commitSha, checkpointPath: result.checkpointFile.path, commitSha: result.commitSha, blockers: [] });
      await onCommitted();
      return;
    }
    if (outcome.reconciliation) {
      setReconciliation(outcome.reconciliation);
      setCommitStatus(legacyJournalCommitStatusFromReconciliation(outcome.reconciliation));
      setCommitNotice(reconciliationNotice(outcome.reconciliation.status));
      if (outcome.reconciliation.status === "committed") await onCommitted();
      return;
    }
    setCommitStatus("unknown");
    setCommitNotice("网络结果仍未知。此计划已锁定且禁止再次提交；恢复网络后只能先执行只读核对。");
  }

  async function downloadDryRun() {
    if (!preview) return;
    setBuildingDryRun(true);
    setError(null);
    try {
      const dryRun = await buildLegacyJournalDryRun(preview);
      const bytes = new Uint8Array(dryRun.bytes.length);
      bytes.set(dryRun.bytes);
      const url = URL.createObjectURL(new Blob([bytes.buffer], { type: "application/zip" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = dryRun.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setDryRunResult({ fileName: dryRun.fileName, sha256: dryRun.sha256, journalFiles: dryRun.manifest.counts.journal_files });
    } catch (caught) {
      setError(friendlyLegacyImportError(caught));
    } finally {
      setBuildingDryRun(false);
    }
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
    {error ? <div className="legacy-import-error" role="alert"><strong>本地处理未完成</strong><p>{error}</p></div> : null}
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
        <p>{blocking || !preview.parse.dryRunReady ? "异常内容已保留在下方，当前没有提交能力，也不会丢弃或猜测归属。" : "所有非空段落都有明确去向；仍需生成精确计划、完成 typed confirmation，并在动作发生时再次确认。"}</p>
      </div>
      {diagnostics.length ? <DiagnosticList diagnostics={diagnostics} /> : null}
      {preview.parse.orphanBlocks.length ? <div className="legacy-import-exceptions"><h4>孤立正文 {preview.parse.orphanBlocks.length}</h4>{preview.parse.orphanBlocks.slice(0, 20).map((block) => <article key={block.sourceLocators.join("-")}><code>{block.sourceLocators.join(" · ")}</code><pre>{block.text}</pre></article>)}</div> : null}
      {preview.parse.unsupportedBlocks.length ? <div className="legacy-import-exceptions"><h4>不支持对象 {preview.parse.unsupportedBlocks.length}</h4>{preview.parse.unsupportedBlocks.slice(0, 20).map((block) => <article key={block.sourceLocator}><code>{block.sourceLocator} · {block.objectTypes.join(" / ")}</code><pre>{block.text || "（对象没有可提取纯文本）"}</pre></article>)}</div> : null}
      <div className="legacy-correction-panel">
        <div><h4>本地人工修正</h4><p>修正只追加到当前浏览器内的审计链，并用同一源文件重新解析。每次覆盖都会通过 <code>supersedesId</code> 指向上一条记录。</p></div>
        {correctionCandidates.length ? <form className="legacy-correction-form" onSubmit={applyCorrection}>
          <label>源段落<select value={correctionLocator} onChange={(event) => chooseCorrectionLocator(event.target.value)} required><option value="">选择需要修正的段落</option>{correctionCandidates.map((candidate) => <option key={candidate.sourceLocator} value={candidate.sourceLocator}>{candidate.sourceLocator} · {candidate.kind} · {candidate.originalText.slice(0, 48) || "（空内容）"}</option>)}</select></label>
          <label>修正动作<select value={correctionAction} onChange={(event) => setCorrectionAction(event.target.value as LegacyImportCorrectionAction)} disabled={selectedCandidate?.kind === "UNSUPPORTED_OBJECT"}>
            {selectedCandidate?.kind === "UNSUPPORTED_OBJECT" ? <option value="skip">确认跳过不支持对象</option> : <><option value="assign-body">把正文指派到日期</option><option value="set-date-heading">按完整日期标题解释</option><option value="set-time-heading">按时间标题解释</option><option value="set-body">按当前上下文正文解释</option><option value="skip">明确跳过</option></>}
          </select></label>
          {correctionAction === "assign-body" || correctionAction === "set-date-heading" ? <label>目标日期<input type="date" value={correctionDate} onChange={(event) => setCorrectionDate(event.target.value)} required /></label> : null}
          {correctionAction === "assign-body" || correctionAction === "set-time-heading" ? <label>目标时间{correctionAction === "assign-body" ? "（可选）" : ""}<input type="time" value={correctionTime} onChange={(event) => setCorrectionTime(event.target.value)} required={correctionAction === "set-time-heading"} /></label> : null}
          <label className="legacy-correction-reason">修正理由<textarea value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} maxLength={1000} required placeholder="记录为什么这样解释或跳过；该理由会进入 manifest 与 Import Log。" /></label>
          <button className="secondary-button" type="submit" disabled={applyingCorrection || !sourceFile}>{applyingCorrection ? "正在重解析…" : "追加修正并重解析"}</button>
        </form> : <p className="empty-note">当前没有异常或低置信度段落需要修正。</p>}
        {selectedCandidate ? <div className="legacy-correction-source"><code>{selectedCandidate.sourceLocator}</code><strong>{selectedCandidate.kind} · {selectedCandidate.confidence} confidence</strong><pre>{selectedCandidate.originalText || "（空内容）"}</pre></div> : null}
        {comparison ? <ReparseComparison comparison={comparison} /> : null}
        {preview.parse.corrections.length ? <ol className="legacy-correction-history">{preview.parse.corrections.map((correction) => <li key={correction.id}><div><code>{correction.sourceLocator}</code><strong>{correction.action}</strong><span>{correction.recordedAt}</span></div><p>{correction.reason}</p>{correction.supersedesId ? <small>取代 {correction.supersedesId}</small> : null}</li>)}</ol> : null}
      </div>
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
      <div className={`legacy-dry-run ${preview.parse.dryRunReady && !blocking ? "ready" : "blocked"}`}>
        <div><strong>Dry Run staging 包</strong><p>生成确定性 ZIP：按日 Markdown 放在 <code>staging/Journal/</code>，并附带 <code>manifest.json</code> 与不复制正文的 <code>import-log.md</code>。下载仍只发生在本地浏览器。</p></div>
        <button className="primary-button" type="button" onClick={downloadDryRun} disabled={buildingDryRun || blocking || !preview.parse.dryRunReady}>{buildingDryRun ? "正在生成…" : "下载 Dry Run ZIP"}</button>
        {dryRunResult ? <div className="legacy-dry-run-result" role="status"><strong>{dryRunResult.fileName}</strong><span>{dryRunResult.journalFiles} 个待处理 Journal 文件 · Commit false</span><code>ZIP SHA-256 {dryRunResult.sha256}</code></div> : null}
      </div>
      <div className="legacy-commit-panel" aria-labelledby="legacy-commit-title">
        <div className="legacy-commit-heading"><div><p className="eyebrow">Fail-closed commit review</p><h4 id="legacy-commit-title">Legacy Journal 精确提交计划</h4><p>计划读取同一 branch snapshot 并固定 HEAD、目标日期、canonical 文件与 hash。生成计划和 reconciliation 都是只读操作。</p></div><span className="legacy-production-gate" data-open={LEGACY_JOURNAL_IMPORT_COMMIT_ENABLED}>Production gate · {LEGACY_JOURNAL_IMPORT_COMMIT_ENABLED ? "OPEN" : "CLOSED"}</span></div>
        <fieldset className="legacy-date-selection" disabled={!connection || planning || blocking || !preview.parse.dryRunReady}>
          <legend>选择本批日期（最多 {MAX_LEGACY_JOURNAL_DATES_PER_COMMIT} 天）</legend>
          <div>{preview.parse.entries.map((entry) => <label key={entry.date}><input type="checkbox" checked={selectedDates.includes(entry.date)} onChange={() => toggleDate(entry.date)} disabled={!selectedDates.includes(entry.date) && selectedDates.length >= MAX_LEGACY_JOURNAL_DATES_PER_COMMIT} /><span>{entry.date}</span><small>{entry.segments.length} segments</small></label>)}</div>
        </fieldset>
        <button className="secondary-button" type="button" onClick={buildCommitPlan} disabled={!connection || !adapter || online === false || planning || blocking || !preview.parse.dryRunReady || selectedDates.length === 0}>{planning ? "正在读取精确 HEAD…" : "生成只读 Commit Plan"}</button>
        {!connection ? <p className="empty-note">连接目标 Private 数据仓库后才能生成计划；DOCX 正文仍只在当前浏览器内处理。</p> : null}
        {plan ? <>
          <div className="legacy-commit-target"><div><span>目标 Private 仓库</span><strong>{targetRepository}</strong></div><div><span>精确日期范围</span><strong>{exactDateRange}</strong></div><div><span>Expected HEAD</span><code>{plan.expectedHeadCommitSha}</code></div><div><span>Dry Run ID</span><code>{plan.dryRunId}</code></div><div><span>Plan SHA-256</span><code>{payload?.planSha256 ?? "因冲突未生成"}</code></div><div><span>Correction SHA-256</span><code>{plan.correctionSetSha256}</code></div></div>
          <div className="legacy-commit-summary" aria-label="Commit Plan 摘要"><SummaryMetric label="Pending" value={String(plan.summary.pending)} /><SummaryMetric label="Already imported" value={String(plan.summary.alreadyImported)} /><SummaryMetric label="Conflicts" value={String(plan.summary.conflicts)} /><SummaryMetric label="原子文件" value={payload ? String(payload.fileCount) : "—"} /><SummaryMetric label={payload?.byteCountExact === false ? "业务 UTF-8 bytes" : "UTF-8 bytes"} value={payload ? payload.byteCount.toLocaleString("en-US") : "—"} /></div>
          <ol className="legacy-plan-items">{plan.items.map((item) => <li key={item.date} data-status={item.status}><strong>{item.date}</strong><span>{item.status}</span>{item.conflicts.length ? <code>{item.conflicts.join(" · ")}</code> : <small>{item.artifacts ? `${item.artifacts.files.length} 个业务文件` : "未生成 artifacts"}</small>}</li>)}</ol>
          <div className="legacy-confirmation-grid"><label>输入完整目标仓库名<code>{targetRepository}</code><input value={repositoryConfirmation} onChange={(event) => setRepositoryConfirmation(event.target.value)} autoComplete="off" spellCheck={false} /></label><label>输入精确日期范围<code>{exactDateRange}</code><input value={dateRangeConfirmation} onChange={(event) => setDateRangeConfirmation(event.target.value)} autoComplete="off" spellCheck={false} /></label></div>
          <div className={`legacy-import-gate ${plan.commitReady && payloadWithinLimits && confirmationMatches ? "ready" : "blocked"}`} role="status"><strong>{plan.commitReady && payloadWithinLimits && confirmationMatches ? "产品内确认已匹配" : "提交仍被阻断"}</strong><p>{plan.summary.conflicts ? "计划包含冲突，不能提交。" : !payloadWithinLimits ? `原子 payload 超出安全上限：${payload?.limitBlockers.join(" · ")}` : !confirmationMatches ? "必须逐字输入完整仓库名与精确日期范围。" : "确认仅满足产品内安全门；正式写入仍需动作发生时对该批次单独授权。"}</p></div>
          <button className="primary-button" type="button" onClick={commitBatch} disabled={!commitReady}>{commitButtonLabel(commitStatus)}</button>
          {commitNotice ? <div className={`legacy-commit-result ${commitStatus}`} role="status" aria-live="polite"><strong>{commitStatusLabel(commitStatus)}</strong><p>{commitNotice}</p>{commitResult ? <><span>Commit {commitResult.commitSha}</span><code>{commitResult.checkpointFile.path}</code></> : null}</div> : null}
          <div className="legacy-reconciliation"><div><strong>未知网络结果 reconciliation</strong><p>只读重载 checkpoint、Entry、Revision 与 Segment，结果仅为“已提交 / 未提交 / 冲突”；不会盲目重试。</p></div><button className="secondary-button" type="button" onClick={runReconciliation} disabled={reconciling || online === false}>{reconciling ? "正在只读核对…" : "只读核对当前计划"}</button>{reconciliation ? <div className={`legacy-reconciliation-result ${reconciliation.status}`} role="status"><strong>{reconciliationLabel(reconciliation.status)}</strong><span>Observed HEAD {reconciliation.observedHeadCommitSha}</span><code>{reconciliation.checkpointPath}</code>{reconciliation.blockers.length ? <p>{reconciliation.blockers.join(" · ")}</p> : null}</div> : <p className="empty-note">尚未执行 reconciliation；此状态不会自动触发重试。</p>}</div>
        </> : null}
      </div>
      <div className="legacy-import-boundary"><strong>Git 历史与写入边界</strong><p>软删除或未来 rollback 只能让当前 Entry 失效，不能从 Git 历史物理擦除 Revision、Segment、Checkpoint 或旧正文。生产 Commit 只在精确计划、双重 typed confirmation 与动作时确认后尝试一次；本页不会自动重试、自动回滚或输出到 Vault。</p></div>
    </> : null}
  </section>;
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function DiagnosticList({ diagnostics }: { diagnostics: LegacyImportDiagnostic[] }) {
  return <div className="legacy-import-diagnostics"><h4>Diagnostics {diagnostics.length}</h4><ul>{diagnostics.slice(0, 100).map((issue, index) => <li key={`${issue.code}-${issue.sourceLocator ?? index}`} data-severity={issue.severity}><strong>{issue.severity} · {issue.code}</strong><span>{issue.sourceLocator ? `${issue.sourceLocator}：` : ""}{issue.message}</span></li>)}</ul>{diagnostics.length > 100 ? <p>仅显示前 100 条；摘要计数覆盖全部诊断。</p> : null}</div>;
}

function ReparseComparison({ comparison }: { comparison: LegacyPreviewComparison }) {
  return <div className="legacy-reparse-diff" role="status"><strong>重解析差异</strong><div><span>新增日期 {comparison.addedDates.length}</span><span>删除日期 {comparison.removedDates.length}</span><span>变化日期 {comparison.changedDates.length}</span><span>诊断 −{comparison.diagnosticsRemoved} / +{comparison.diagnosticsAdded}</span><span>孤立块 {comparison.orphanBlocksBefore} → {comparison.orphanBlocksAfter}</span></div>{comparison.addedDates.length || comparison.removedDates.length || comparison.changedDates.length ? <code>{[...comparison.addedDates.map((date) => `+${date}`), ...comparison.removedDates.map((date) => `−${date}`), ...comparison.changedDates.map((date) => `~${date}`)].join(" · ")}</code> : null}</div>;
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
    LEGACY_IMPORT_DRY_RUN_NOT_READY: "仍有未处理的错误、孤立内容或不支持对象，Dry Run ZIP 尚不可生成。",
    INVALID_LEGACY_CORRECTION_ID: "修正记录 ID 无效或重复，未改变当前预览。",
    LEGACY_CORRECTION_LOCATOR_NOT_FOUND: "修正指向的源段落不存在，未改变当前预览。",
    INVALID_LEGACY_CORRECTION_CHAIN: "修正链不连续，未改变当前预览。",
    LEGACY_CORRECTION_UNSUPPORTED_OBJECT: "不支持的 Word 对象只能明确跳过，不能猜测为正文或标题。",
    INVALID_LEGACY_CORRECTION_REASON: "请填写不超过 1000 字的修正理由。",
    INVALID_LEGACY_CORRECTION_DATE: "请选择合法的完整目标日期。",
    INVALID_LEGACY_CORRECTION_TIME: "请选择合法的目标时间。",
    INVALID_LEGACY_IMPORT_DATE_SELECTION: `请选择 1–${MAX_LEGACY_JOURNAL_DATES_PER_COMMIT} 个不重复日期。`,
    LEGACY_IMPORT_PLAN_NOT_READY: "Preview 仍有阻断项，未生成 Commit Plan。",
    LEGACY_IMPORT_ATOMIC_FILE_LIMIT_EXCEEDED: "计划超过 250 个原子文件（含 checkpoint），已阻断。",
    LEGACY_IMPORT_ATOMIC_BYTE_LIMIT_EXCEEDED: "计划超过 10 MiB UTF-8 payload 上限，已阻断。",
  };
  return messages[code] ?? "只读解析失败，源文件未被修改，也没有写入任何数据。";
}

function reconciliationLabel(status: LegacyJournalReconciliation["status"]) {
  if (status === "committed") return "已提交：checkpoint 与全部 planned files 一致";
  if (status === "not_committed") return "未提交：未发现 checkpoint、部分 planned 文件或同日占用";
  return "冲突：禁止盲目重试，需重新加载并人工处理";
}

function reconciliationNotice(status: LegacyJournalReconciliation["status"]) {
  if (status === "committed") return "只读核对确认 checkpoint 与全部 planned files 一致；不会再次提交。";
  if (status === "not_committed") return "只读核对未发现本批写入。当前计划仍已锁定；必须重新生成计划后才能再次尝试。";
  return "只读核对发现部分记录、日期占用或 checkpoint 不一致。当前计划已锁定，禁止再次提交。";
}

function commitButtonLabel(status: LegacyJournalCommitActionStatus) {
  if (!LEGACY_JOURNAL_IMPORT_COMMIT_ENABLED) return "生产 Commit gate 已关闭";
  if (status === "writing") return "正在执行单次原子 Commit…";
  if (status === "idle") return "动作时确认并执行一次 Commit";
  return "本计划已锁定 · 重新生成后方可提交";
}

function commitStatusLabel(status: LegacyJournalCommitActionStatus) {
  if (status === "writing") return "原子提交进行中";
  if (status === "committed") return "已确认提交";
  if (status === "not_committed") return "已确认未提交";
  if (status === "conflict") return "对账冲突";
  if (status === "unknown") return "提交结果未知";
  return "等待动作时确认";
}

function firstCorrectionLocator(preview: LegacyDocxPreview) {
  return preview.parse.orphanBlocks.at(0)?.sourceLocators.at(0)
    ?? preview.parse.unsupportedBlocks.at(0)?.sourceLocator
    ?? preview.parse.diagnostics.find((issue) => issue.sourceLocator)?.sourceLocator
    ?? preview.parse.tokens.find((token) => token.kind === "AMBIGUOUS" || token.confidence === "low")?.sourceLocator
    ?? "";
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}
