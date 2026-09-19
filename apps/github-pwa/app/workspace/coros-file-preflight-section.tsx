"use client";

import { useState, type ChangeEvent } from "react";

import { previewCorosActivityFile, type CorosFilePreflight } from "../../../../src/lib/github-data/coros-file-preflight";

export function CorosFilePreflightSection() {
  const [preview, setPreview] = useState<CorosFilePreflight | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);

  async function inspect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setChecking(true);
    setPreview(null);
    setError("");
    try {
      setPreview(await previewCorosActivityFile(file));
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setChecking(false);
    }
  }

  function reset() {
    setPreview(null);
    setError("");
    setPickerKey((value) => value + 1);
  }

  return <div className="legacy-import" aria-labelledby="coros-file-preflight-title">
    <div className="legacy-import-heading">
      <div><p className="eyebrow">Phase 4 · Local-only preflight</p><h3 id="coros-file-preflight-title">COROS 活动文件兼容性预检</h3><p>选择单个 FIT 或 TCX 文件后，只在当前浏览器计算 SHA-256、校验容器结构并生成活动摘要；不会上传文件、连接 COROS、写入 GitHub 或创建正式健康记录。</p></div>
      <span className="memory-pill">只读 · 本地</span>
    </div>
    <div className="legacy-import-picker">
      <label className="file-picker">选择 FIT / TCX 文件<input key={pickerKey} type="file" accept=".fit,.tcx,application/vnd.ant.fit,application/xml,text/xml" onChange={inspect} disabled={checking} /></label>
      <span>最大 64 MiB · 单文件 · 当前切片不提供提交能力</span>
      {preview ? <button className="secondary-button" type="button" onClick={reset}>清除预览</button> : null}
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
      <div className={`legacy-import-gate ${preview.readyForMapping ? "ready" : "blocked"}`} role="status"><strong>{preview.readyForMapping ? "结构预检通过" : "结构预检被阻断"}</strong><p>{preview.readyForMapping ? "该文件可进入后续确定性 mapping 设计；当前不会生成 staging 或 canonical 记录。" : "文件缺少建立稳定活动身份所需的结构或时间信息。"}</p></div>
      <div className="legacy-import-diagnostics"><h4>诊断</h4>{preview.diagnostics.length ? <ul>{preview.diagnostics.map((item) => <li key={item.code} data-severity={item.severity}><code>{item.code}</code><span>{item.message}</span></li>)}</ul> : <p>没有发现结构诊断。</p>}</div>
      <div className="legacy-import-boundary"><strong>当前没有写入能力</strong><p>预检结果只证明文件容器可读，不证明全部字段已映射。正式导入仍需重复检测、字段预览、批次确认和 staging 审核；原始 FIT、TCX 与 GPS 轨迹默认不会进入 Git。</p></div>
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
    COROS_IMPORT_FIT_DEFINITION_MISSING: "FIT 数据消息缺少对应定义。",
    COROS_IMPORT_TRUNCATED_FIT_DEFINITION: "FIT 定义消息不完整。",
    COROS_IMPORT_TRUNCATED_FIT_DATA: "FIT 数据消息不完整。",
    COROS_IMPORT_TCX_EXTERNAL_ENTITY_FORBIDDEN: "TCX 包含 DOCTYPE 或 ENTITY；为避免外部实体风险，预检已停止。",
    COROS_IMPORT_INVALID_TCX_ROOT: "XML 根元素不是 TrainingCenterDatabase。",
    COROS_IMPORT_INVALID_UTF8_TCX: "TCX 不是有效 UTF-8 XML。",
  };
  return messages[error.message] ?? "文件结构不受支持或不完整；没有上传或写入任何数据。";
}
