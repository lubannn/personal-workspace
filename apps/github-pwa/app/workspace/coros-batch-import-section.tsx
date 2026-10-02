"use client";

import { useMemo, useState, type ChangeEvent } from "react";

import { confirmCorosBatch, COROS_BATCH_MAX_FILES, previewCorosBatch, selectCorosBatchItems, stageCorosBatch, type CorosBatchPreviewRow } from "../../../../src/lib/github-data/coros-batch-import";
import type { GitHubContentsAdapter } from "../../../../src/lib/github-data/github-contents";
import type { SyncedHealthStagingRecord, SyncedWorkout } from "./page-model";

export function CorosBatchImportSection({ timezone, adapter, ownerId, online, stagingRecords, onStaged, onConfirmed, onRefresh }: {
  timezone: string;
  adapter: GitHubContentsAdapter | null;
  ownerId: string | null;
  online: boolean | null;
  stagingRecords: SyncedHealthStagingRecord[];
  onStaged: (created: SyncedHealthStagingRecord[]) => void;
  onConfirmed: (staging: SyncedHealthStagingRecord[], workouts: SyncedWorkout[]) => void;
  onRefresh: () => void;
}) {
  const [rows, setRows] = useState<CorosBatchPreviewRow[]>([]);
  const [busy, setBusy] = useState<"preview" | "stage" | "confirm" | null>(null);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pickerKey, setPickerKey] = useState(0);
  const selection = useMemo(() => selectCorosBatchItems(rows), [rows]);
  const selectedIds = useMemo(() => new Set(selection.items.map((item) => item.stagingRecordId)), [selection]);
  const selectedRecords = stagingRecords.filter((item) => selectedIds.has(item.record.id));
  const pending = selectedRecords.filter((item) => item.record.deleted_at === null && item.record.data.health_type === "workout" && item.record.data.status === "pending");
  const missingRecords = selection.items.length - selectedRecords.length;

  async function inspect(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    setRows([]); setError(""); setMessage(""); setProgress("");
    if (files.length === 0) return;
    if (files.length > COROS_BATCH_MAX_FILES) {
      setError(`一次最多选择 ${COROS_BATCH_MAX_FILES} 个文件；这批共有 ${files.length} 个，请分成两批。`);
      return;
    }
    setBusy("preview");
    try {
      const inspected = await previewCorosBatch(files, timezone, (done, total) => setProgress(`本地预检 ${done} / ${total}`));
      setRows(inspected);
      setMessage("预检已完成；尚未写入 Private 仓库。请检查统计与明细后，再决定是否批量写入。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "批量预检失败；没有写入数据。");
    } finally { setBusy(null); }
  }

  async function stage() {
    if (!adapter || !ownerId || busy || !selection.items.length || online === false) return;
    const accepted = window.confirm(`将分批写入 ${selection.items.length} 条 Workout 暂存记录，来自 ${selection.acceptedFiles} 个文件。\n${selection.blockedFiles} 个无法预检的文件、${selection.repeatedFiles} 个相同文件和 ${selection.suspectedDuplicateActivities} 条疑似重复活动将跳过。\n只保存运动摘要和来源哈希，不上传原始 FIT/TCX 或 GPS 轨迹。每批独立提交；中途失败时，已成功的批次会保留。确认开始吗？`);
    if (!accepted) return;
    setBusy("stage"); setError(""); setMessage("");
    try {
      const result = await stageCorosBatch({
        adapter, ownerId, items: selection.items,
        onCommitted(created, done, total) {
          if (created.length) onStaged(created);
          setProgress(`写入暂存 ${done} / ${total}`);
        },
      });
      setMessage(`暂存完成：新增 ${result.created} 条，已存在 ${result.alreadyPresent} 条。下一步可一次性确认这些 Workout 为正式记录。`);
      onRefresh();
    } catch (caught) {
      setError(`批量暂存已停止：${caught instanceof Error ? caught.message : "未知错误"}。此前成功的批次不会回滚；请刷新数据后重新选择同批文件，已存在记录会跳过。`);
      onRefresh();
    } finally { setBusy(null); }
  }

  async function confirm() {
    if (!adapter || !ownerId || busy || online === false || pending.length === 0) return;
    if (missingRecords > 0) { setError(`还有 ${missingRecords} 条选中记录不在当前列表中。请先刷新健康数据，确认暂存全部成功后重试。`); onRefresh(); return; }
    if (!window.confirm(`将把这批文件中 ${pending.length} 条待确认运动分批写成正式 Workout。每条都会再次核对远端暂存与目标路径；每批的暂存状态和正式 Workout 在同一个 Git 提交中更新。中途失败时，已成功的批次会保留。确认执行吗？`)) return;
    setBusy("confirm"); setError(""); setMessage("");
    try {
      const result = await confirmCorosBatch({
        adapter, ownerId, staging: pending,
        onCommitted(updated, workouts, done, total) {
          onConfirmed(updated, workouts);
          setProgress(`确认正式 Workout ${done} / ${total}`);
        },
      });
      setMessage(`已将 ${result.confirmed} 条活动确认成正式 Workout。`);
      onRefresh();
    } catch (caught) {
      setError(`批量确认已停止：${caught instanceof Error ? caught.message : "未知错误"}。此前成功的批次不会回滚；请刷新数据后重试剩余待确认记录。`);
      onRefresh();
    } finally { setBusy(null); }
  }

  return <div className="legacy-import" aria-labelledby="coros-batch-import-title">
    <div className="legacy-import-heading"><div><p className="eyebrow">COROS · Batch import</p><h3 id="coros-batch-import-title">批量导入历史 FIT / TCX</h3><p>一次选中多个活动文件，在浏览器内逐个解析；确认后分批写入暂存，再一次性审核为正式 Workout。</p></div><span className="memory-pill">最多 {COROS_BATCH_MAX_FILES} 个文件</span></div>
    <div className="legacy-import-picker"><label className="file-picker">选择多个 FIT / TCX 文件<input key={pickerKey} type="file" multiple accept=".fit,.tcx,application/vnd.ant.fit,application/xml,text/xml" onChange={inspect} disabled={busy !== null} /></label><span>Windows 文件选择窗口可用 Ctrl+A 全选同一目录；每个文件最多 64 MiB。</span>{rows.length ? <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => { setRows([]); setMessage(""); setError(""); setProgress(""); setPickerKey((value) => value + 1); }}>清除本批</button> : null}</div>
    {progress ? <p role="status" className="empty-note">{progress}</p> : null}
    {error ? <p role="alert" className="error-message">{error}</p> : null}
    {message ? <p role="status" className="empty-note">{message}</p> : null}
    {rows.length ? <>
      <div className="legacy-import-summary">
        <Summary label="选中文件" value={rows.length} />
        <Summary label="可导入 Workout" value={selection.items.length} />
        <Summary label="无法预检" value={selection.blockedFiles} />
        <Summary label="相同文件" value={selection.repeatedFiles} />
        <Summary label="疑似重复活动" value={selection.suspectedDuplicateActivities} />
      </div>
      <details><summary>查看每个文件的预检结果与候选活动</summary><ol className="learning-list">{rows.map((row, index) => <li key={`${row.name}-${index}`}><div><strong>{row.name}</strong><small>{selection.rowStatuses[index]}</small>{row.error ? <small>未通过：{friendlyError(row.error)}</small> : row.preview ? <><small>{row.preview.mapping.candidates.length} 条候选 · SHA-256 {row.preview.source.sha256.slice(0, 12)}…</small>{row.preview.mapping.candidates.map((candidate) => <small key={candidate.importKey}>{candidate.start_at} · {candidate.activity_type} · {Math.round(candidate.duration_seconds / 60)} 分钟 · {candidate.distance === null ? "距离缺失" : `${candidate.distance} m`}</small>)}</> : null}</div></li>)}</ol></details>
      <div className="learning-view-actions"><button className="primary-button" type="button" disabled={!adapter || !ownerId || online === false || busy !== null || selection.items.length === 0} onClick={() => void stage()}>{busy === "stage" ? "正在批量暂存…" : "批量写入暂存区"}</button><button className="secondary-button" type="button" disabled={!adapter || !ownerId || online === false || busy !== null || pending.length === 0} onClick={() => void confirm()}>{busy === "confirm" ? "正在批量确认…" : `批量确认正式 Workout（${pending.length}）`}</button></div>
      <p className="empty-note">已暂存 {selectedRecords.length} / {selection.items.length} 条；正式确认只处理其中仍为 pending 的记录。预检失败和疑似重复不会写入，原始文件不会上传。</p>
    </> : null}
  </div>;
}

function Summary({ label, value }: { label: string; value: number }) { return <div><span>{label}</span><strong>{value}</strong></div>; }

function friendlyError(code: string) {
  return ({ COROS_IMPORT_FIT_OR_TCX_REQUIRED: "仅支持 FIT 或 TCX 文件", COROS_IMPORT_EMPTY_FILE: "文件为空", COROS_IMPORT_FILE_TOO_LARGE: "超过 64 MiB", COROS_IMPORT_INVALID_FIT_HEADER: "FIT 头部无效", COROS_IMPORT_FIT_SIZE_MISMATCH: "FIT 长度不匹配", COROS_IMPORT_FIT_FILE_CRC_MISMATCH: "FIT 校验失败", COROS_IMPORT_FIT_SEMANTIC_DECODE_FAILED: "FIT 活动字段无法解码" } as Record<string, string>)[code] ?? code;
}
