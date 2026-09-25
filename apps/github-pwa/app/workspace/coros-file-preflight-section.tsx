"use client";

import { useState, type ChangeEvent } from "react";

import { previewCorosActivityFile, type CorosFilePreflight } from "../../../../src/lib/github-data/coros-file-preflight";
import { commitCorosWorkoutStagingWrite, prepareCorosWorkoutStagingWrite } from "../../../../src/lib/github-data/coros-workout-staging-write";
import { GitHubConflictError, type GitHubContentsAdapter } from "../../../../src/lib/github-data/github-contents";
import type { SyncedHealthStagingRecord } from "./page-model";

export function CorosFilePreflightSection({ timezone = "Asia/Shanghai", adapter, ownerId, online, onStaged }: {
  timezone?: string;
  adapter: GitHubContentsAdapter | null;
  ownerId: string | null;
  online: boolean | null;
  onStaged: (created: SyncedHealthStagingRecord[]) => void;
}) {
  const [preview, setPreview] = useState<CorosFilePreflight | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [staging, setStaging] = useState(false);
  const [stageStatus, setStageStatus] = useState("");
  const [pickerKey, setPickerKey] = useState(0);

  async function inspect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setChecking(true);
    setPreview(null);
    setError("");
    setStageStatus("");
    try {
      const next = await previewCorosActivityFile(file, { timezone });
      setPreview(next);
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setChecking(false);
    }
  }

  function reset() {
    setPreview(null);
    setError("");
    setStageStatus("");
    setPickerKey((value) => value + 1);
  }

  async function stageWorkoutCandidates() {
    if (!adapter || !ownerId || !preview || staging || online === false) return;
    setStaging(true); setError(""); setStageStatus("");
    try {
      const prepared = await prepareCorosWorkoutStagingWrite({ adapter, ownerId, plan: preview.stagingPlan });
      if (prepared.files.length === 0) { setStageStatus(prepared.confirmationText); return; }
      if (!window.confirm(prepared.confirmationText)) { setStageStatus("已取消，没有写入暂存记录。"); return; }
      const result = await commitCorosWorkoutStagingWrite(adapter, prepared);
      onStaged(result.created);
      setStageStatus(`已写入 ${result.created.length} 条 Workout 暂存记录；跳过 ${result.alreadyPresent} 条已存在记录。正式 Workout 仍需另行审核确认。`);
    } catch (caught) {
      setError(caught instanceof GitHubConflictError ? "数据在另一台设备发生变化，或目标路径已有不同内容。请重新核对后重试；没有覆盖已有记录。" : caught instanceof Error ? `写入暂存失败：${caught.message}` : "写入暂存失败；请检查连接后重试。");
    } finally { setStaging(false); }
  }

  return <div className="legacy-import" aria-labelledby="coros-file-preflight-title">
    <div className="legacy-import-heading">
      <div><p className="eyebrow">Phase 4 · COROS file staging</p><h3 id="coros-file-preflight-title">COROS 活动文件兼容性预检</h3><p>选择单个 FIT 或 TCX 文件后，在当前浏览器计算 SHA-256、校验结构并生成活动摘要。点击写入暂存并再次确认后，才会保存摘要到 Private 仓库；原文件不会上传。</p></div>
      <span className="memory-pill">预检 · 本地</span>
    </div>
    <div className="legacy-import-picker">
      <label className="file-picker">选择 FIT / TCX 文件<input key={pickerKey} type="file" accept=".fit,.tcx,application/vnd.ant.fit,application/xml,text/xml" onChange={inspect} disabled={checking || staging} /></label>
      <span>最大 64 MiB · 单文件 · 暂存写入需要当次确认</span>
      {preview ? <button className="secondary-button" type="button" onClick={reset} disabled={staging}>清除预览</button> : null}
    </div>
    {checking ? <p className="empty-note">正在本地校验文件…</p> : null}
    {error ? <div className="legacy-import-error" role="alert"><strong>无法生成预检</strong><p>{error}</p></div> : null}
    {preview ? <>
      <div className="legacy-import-source"><div><strong>{preview.source.fileName}</strong><span>{formatBytes(preview.source.byteSize)}</span></div><code>SHA-256 {preview.source.sha256}</code><small>{preview.source.lastModified ? `源文件修改时间 ${preview.source.lastModified}` : "源文件未提供可信修改时间"}</small></div>
      <div className="legacy-import-summary">
        {preview.summary.format === "fit" ? <>
          <Summary label="格式" value="FIT" />
          <Summary label="定义消息" value={preview.summary.definitionMessages} />
          <Summary label="数据消息" value={preview.summary.dataMessages} />
          <Summary label="Session" value={preview.summary.sessionMessages} />
          <Summary label="Activity" value={preview.summary.activityMessages} />
          <Summary label="Record" value={preview.summary.recordMessages} />
        </> : <>
          <Summary label="格式" value="TCX" />
          <Summary label="活动" value={preview.summary.activities} />
          <Summary label="圈" value={preview.summary.laps} />
          <Summary label="轨迹点" value={preview.summary.trackpoints} />
          <Summary label="运动类型" value={preview.summary.sports.join(", ") || "未声明"} />
          <Summary label="首个时间" value={preview.summary.firstTimestamp ?? "缺失"} />
        </>}
      </div>
      <div className={`legacy-import-gate ${preview.readyForMapping ? "ready" : "blocked"}`} role="status"><strong>{preview.readyForMapping ? "结构与映射预检通过" : "结构预检被阻断"}</strong><p>{preview.readyForMapping ? "已生成确定性 Workout 候选。写入暂存前会检查远端记录并展示精确确认清单。" : "文件缺少建立稳定活动身份所需的结构或时间信息。"}</p></div>
      <div className="legacy-import-source"><div><strong>映射批次</strong><span>mapping v{preview.mapping.mappingVersion}</span></div><code>{preview.mapping.batchIdentity}</code><small>{preview.mapping.candidates.length} 个 Workout 候选 · 时区 {timezone} · 仍未创建 staging</small></div>
      {preview.mapping.candidates.length ? <ol className="learning-list">{preview.mapping.candidates.map((candidate) => <li key={candidate.importKey}><div><strong>{activityLabel(candidate.activity_type)}{candidate.duplicate ? " · 重复" : ""}</strong><code>{candidate.start_at} → {candidate.end_at}</code><small>{Math.round(candidate.duration_seconds / 60)} 分钟 · {candidate.distance === null ? "距离缺失" : `${candidate.distance} m`} · {candidate.metrics_json.trackpoints} 个轨迹点</small><small>import key {candidate.importKey}</small></div><span className="memory-pill">{candidate.confirmation_status}</span></li>)}</ol> : null}
      <div className="legacy-import-source"><div><strong>Workout staging envelope</strong><span>plan v{preview.stagingPlan.planVersion} · staging 协议已注册</span></div><small>{preview.stagingPlan.protocolDecision.reason}</small><small>候选 {preview.stagingPlan.items.length} 条 · 同批重复 {preview.stagingPlan.skippedDuplicateCount} 条</small></div>
      {preview.stagingPlan.items.length ? <ol className="learning-list">{preview.stagingPlan.items.map((item) => <li key={item.stagingRecordId}><div><strong>{item.writeMode === "create_only" ? "仅创建，不覆盖" : item.writeMode}</strong><code>{item.path}</code><small>payload SHA-256 {item.payloadSha256}</small></div><span className="memory-pill">pending</span></li>)}</ol> : null}
      <div className="legacy-import-boundary"><strong>最小数据策略</strong><p>保留：来源哈希、格式、解析/映射版本、批次身份、Workout 摘要和诊断。丢弃：原始文件、文件名、GPS 坐标、轨迹点序列、FIT developer fields 与 TCX extensions。</p><button className="primary-button" type="button" onClick={stageWorkoutCandidates} disabled={!adapter || !ownerId || online === false || checking || staging || !preview.stagingPlan.readyForProtocolActivation}>{staging ? "正在核对并写入…" : "检查并写入暂存区"}</button><small>点击后将读取 Private 仓库最新状态，并在写入前显示目标路径和活动摘要供你确认。</small></div>
      {stageStatus ? <p className="empty-note" role="status">{stageStatus}</p> : null}
      <div className="legacy-import-diagnostics"><h4>诊断</h4>{preview.diagnostics.length + preview.mapping.diagnostics.length ? <ul>{[...preview.diagnostics, ...preview.mapping.diagnostics].map((item, index) => <li key={`${item.code}-${index}`} data-severity={item.severity}><code>{item.code}</code><span>{item.message}</span></li>)}</ul> : <p>没有发现结构或映射诊断。</p>}</div>
      <div className="legacy-import-boundary"><strong>审核边界</strong><p>预检结果只证明文件容器可读。写入暂存后仍不能自动生成正式 Workout；原始 FIT、TCX 与 GPS 轨迹不会进入 Git。</p></div>
    </> : null}
  </div>;
}

function Summary({ label, value }: { label: string; value: string | number }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

function activityLabel(value: string) {
  return ({ run: "跑步", ride: "骑行", swim: "游泳", walk: "步行", hike: "徒步", strength: "力量训练", other: "其他活动" } as Record<string, string>)[value] ?? value;
}

function friendlyError(error: unknown) {
  if (!(error instanceof Error)) return "文件无法读取；没有上传或写入任何数据。";
  const messages: Record<string, string> = {
    COROS_IMPORT_FIT_OR_TCX_REQUIRED: "请选择扩展名为 .fit 或 .tcx 的文件。",
    COROS_IMPORT_EMPTY_FILE: "文件为空。",
    COROS_IMPORT_FILE_TOO_LARGE: "文件超过 64 MiB 安全上限。",
    COROS_IMPORT_FILE_SIZE_MISMATCH: "浏览器读取长度与文件元数据不一致；请重新选择文件。",
    COROS_IMPORT_INVALID_FIT_HEADER: "FIT 头部或 .FIT 签名无效。",
    COROS_IMPORT_FIT_SIZE_MISMATCH: "FIT 声明的数据长度与实际文件不一致。",
    COROS_IMPORT_FIT_HEADER_CRC_MISMATCH: "FIT 头部 CRC 校验失败。",
    COROS_IMPORT_FIT_FILE_CRC_MISMATCH: "FIT 文件 CRC 校验失败。",
    COROS_IMPORT_FIT_SEMANTIC_DECODE_FAILED: "FIT 结构存在，但官方 Garmin 解码器无法读取活动字段。",
    COROS_IMPORT_FIT_DEFINITION_MISSING: "FIT 数据消息缺少对应定义。",
    COROS_IMPORT_TRUNCATED_FIT_DEFINITION: "FIT 定义消息不完整。",
    COROS_IMPORT_TRUNCATED_FIT_DATA: "FIT 数据消息不完整。",
    COROS_IMPORT_TCX_EXTERNAL_ENTITY_FORBIDDEN: "TCX 包含 DOCTYPE 或 ENTITY；为避免外部实体风险，预检已停止。",
    COROS_IMPORT_INVALID_TCX_ROOT: "XML 根元素不是 TrainingCenterDatabase。",
    COROS_IMPORT_INVALID_UTF8_TCX: "TCX 不是有效 UTF-8 XML。",
  };
  return messages[error.message] ?? "文件结构不受支持或不完整；没有上传或写入任何数据。";
}
