"use client";

import type { ChangeEvent } from "react";

import type { PortableRestorePlan } from "../../../../src/lib/github-data/portable-restore";
import type { SchemaMigrationDryRun } from "../../../../src/lib/github-data/schema-migrations";
import type { Connection, PortabilityResult } from "./page-model";

function InspectionResult({ result }: { result: PortabilityResult }) {
  return (
    <div className={`portability-result ${result.valid ? "valid" : "invalid"}`} role="status">
      <strong>{result.valid ? "预检通过" : "预检未通过"}</strong>
      <span>{result.fileName}</span>
      <p>{result.files} 个文件 · {result.captures} 条 Capture · {result.tasks} 条 Task · {result.projects} 个 Project · {result.projectPhases} 个阶段 · {result.milestones} 个里程碑 · {result.projectNotes} 条 Project Note · {result.activityEvents} 条 Activity · {result.dashboardLayouts} 个 Dashboard 布局</p>
      {result.errors.length > 0 ? <ul>{result.errors.slice(0, 5).map((issue, index) => <li key={`${issue.code}-${issue.path ?? index}`}>{issue.path ? `${issue.path}：` : ""}{issue.message}</li>)}</ul> : null}
      {result.warnings.length > 0 ? <ul>{result.warnings.slice(0, 3).map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul> : null}
    </div>
  );
}

function MigrationResult({ result }: { result: SchemaMigrationDryRun }) {
  const ready = result.valid && result.counts.blocked === 0;
  return (
    <div className={`portability-result ${ready ? "valid" : "invalid"}`} role="status">
      <strong>{ready ? "Schema dry run 通过" : "Schema dry run 阻断"}</strong>
      <span>Migration registry v{result.registryVersion}</span>
      <p>{result.counts.files} 个文件 · 当前 {result.counts.current} · 待迁移 {result.counts.migratable} · 阻断 {result.counts.blocked}</p>
      {result.errors.length > 0 ? <ul>{result.errors.slice(0, 5).map((issue, index) => <li key={`${issue.code}-${issue.path ?? index}`}>{issue.path ? `${issue.path}：` : ""}{issue.message}</li>)}</ul> : null}
    </div>
  );
}

type Props = {
  connection: Connection | null;
  online: boolean | null;
  exporting: boolean;
  exportProgress: string;
  checkingRestore: boolean;
  checkingRestoreTarget: boolean;
  restoring: boolean;
  exportResult: PortabilityResult | null;
  restoreResult: PortabilityResult | null;
  migrationDryRun: SchemaMigrationDryRun | null;
  restoreTargetOwner: string;
  restoreTargetRepository: string;
  restorePlan: PortableRestorePlan | null;
  restoreConfirmation: string;
  restoreCommitSha: string | null;
  onExport: () => void;
  onPreflight: (event: ChangeEvent<HTMLInputElement>) => void;
  onTargetOwnerChange: (value: string) => void;
  onTargetRepositoryChange: (value: string) => void;
  onResetTarget: () => void;
  onCheckTarget: () => void;
  onConfirmationChange: (value: string) => void;
  onRestore: () => void;
};

export function PortabilitySection(props: Props) {
  const { connection, online, exporting, exportProgress, checkingRestore, checkingRestoreTarget, restoring, exportResult, restoreResult, migrationDryRun, restoreTargetOwner, restoreTargetRepository, restorePlan, restoreConfirmation, restoreCommitSha, onExport, onPreflight, onTargetOwnerChange, onTargetRepositoryChange, onResetTarget, onCheckTarget, onConfirmationChange, onRestore } = props;
  return (
    <section className="portability-card" aria-labelledby="portability-title">
      <div className="card-heading">
        <div><p className="eyebrow">Phase 1C · Data portability</p><h2 id="portability-title">导出与恢复预检</h2></div>
        <span className={`memory-pill ${connection ? "live" : ""}`}>{connection ? "Private 数据已就绪" : "连接后可导出"}</span>
      </div>
      <div className="portability-grid">
        <article>
          <span className="step-number">01</span><h3>下载开放数据包</h3>
          <p>读取 workspace.json、Dashboard 布局、全部 Capture、Task、Project、阶段、里程碑、Project Note 和 Activity，生成带 SHA-256、Git blob SHA、文件数量与 schema 版本的 JSON。</p>
          <button className="primary-button" type="button" onClick={onExport} disabled={!connection || exporting || online === false}>{exporting ? exportProgress || "正在生成…" : "导出并下载 JSON"}</button>
          {exportResult ? <InspectionResult result={exportResult} /> : null}
        </article>
        <article>
          <span className="step-number">02</span><h3>只读恢复预检</h3>
          <p>在当前浏览器校验文件版本、所有者、路径、数量和哈希。本阶段不会上传，也不会写入或覆盖 GitHub。</p>
          <label className={`file-picker ${checkingRestore ? "disabled" : ""}`}>{checkingRestore ? "正在检查…" : "选择 JSON 导出文件"}<input type="file" accept="application/json,.json" onChange={onPreflight} disabled={checkingRestore} /></label>
          {restoreResult ? <InspectionResult result={restoreResult} /> : null}
          {migrationDryRun ? <MigrationResult result={migrationDryRun} /> : null}
        </article>
        <article className="restore-write-panel">
          <span className="step-number">03</span><h3>隔离仓库原子恢复</h3>
          <p>仅接受同一 owner 下、已用 README 初始化且尚无 Personal Workspace 业务数据的 Private 仓库。全部文件只通过一个 Git commit 写入。</p>
          {!restoreResult?.valid ? <p className="restore-gate">先选择并通过第 02 步恢复预检。</p>
            : !connection ? <p className="restore-gate">先连接来源 Private 仓库，复用当前页面内存中的临时授权检查目标。</p>
              : <>
                <div className="restore-target-form">
                  <label>Target owner<input value={restoreTargetOwner} onChange={(event) => { onTargetOwnerChange(event.target.value); onResetTarget(); }} autoCapitalize="none" spellCheck={false} /></label>
                  <label>Target repository<input value={restoreTargetRepository} onChange={(event) => { onTargetRepositoryChange(event.target.value); onResetTarget(); }} autoCapitalize="none" spellCheck={false} /></label>
                  <button className="secondary-button" type="button" onClick={onCheckTarget} disabled={checkingRestoreTarget || restoring || online === false || !restoreTargetOwner.trim() || !restoreTargetRepository.trim()}>{checkingRestoreTarget ? "正在检查…" : "检查恢复目标"}</button>
                </div>
                {restorePlan ? <div className={`restore-plan ${restorePlan.ready ? "valid" : "invalid"}`} role="status">
                  <strong>{restorePlan.ready ? "目标检查通过" : "禁止恢复到此目标"}</strong><span>{restorePlan.targetRepository} · {restorePlan.branch}</span>
                  <p>{restorePlan.counts.files} 个文件 · {restorePlan.counts.captures} 条 Capture · {restorePlan.counts.tasks} 条 Task · {restorePlan.counts.projects} 个 Project · {restorePlan.counts.projectPhases} 个阶段 · {restorePlan.counts.milestones} 个里程碑 · {restorePlan.counts.projectNotes} 条 Project Note · {restorePlan.counts.activityEvents} 条 Activity · 单个原子 commit</p>
                  {restorePlan.errors.length > 0 ? <ul>{restorePlan.errors.slice(0, 5).map((issue, index) => <li key={`${issue.code}-${issue.path ?? index}`}>{issue.path ? `${issue.path}：` : ""}{issue.message}</li>)}</ul> : null}
                  {restorePlan.warnings.length > 0 ? <ul>{restorePlan.warnings.slice(0, 3).map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul> : null}
                </div> : null}
                {restorePlan?.ready && !restoreCommitSha ? <div className="restore-confirmation">
                  <label>输入完整目标仓库名以确认<input value={restoreConfirmation} onChange={(event) => onConfirmationChange(event.target.value)} placeholder={restorePlan.targetRepository} autoCapitalize="none" spellCheck={false} /></label>
                  <button className="danger-button" type="button" onClick={onRestore} disabled={restoring || restoreConfirmation !== restorePlan.targetRepository || online === false}>{restoring ? "正在原子恢复…" : "确认恢复到隔离仓库"}</button>
                </div> : null}
                {restoreCommitSha ? <p className="restore-success">恢复 Commit {restoreCommitSha.slice(0, 8)}。来源仓库未被修改。</p> : null}
              </>}
        </article>
      </div>
      <div className="portability-boundary"><strong>当前安全边界</strong><p>导出包含你的私人正文，请自行安全保存。恢复禁止写回来源仓库、禁止覆盖已有业务数据，并在执行前后检查目标分支；任何并发变化都会中止。</p></div>
    </section>
  );
}
