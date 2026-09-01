"use client";

import { useMemo, useState } from "react";

import type { GitHubContentsAdapter } from "../../../../src/lib/github-data/github-contents";
import { newestLegacyJournalCheckpoints, readLegacyJournalCheckpointRollbackPreview, type LegacyJournalCheckpointRollbackPreview } from "../../../../src/lib/github-data/legacy-journal-checkpoint-history";
import type { Connection, SyncedJournalImportCheckpoint } from "./page-model";

type Props = {
  connection: Connection | null;
  adapter: GitHubContentsAdapter | null;
  checkpoints: SyncedJournalImportCheckpoint[];
  loading: boolean;
  online: boolean | null;
  onRefresh: () => Promise<void>;
};

export function LegacyJournalCheckpointHistory({ connection, adapter, checkpoints, loading, online, onRefresh }: Props) {
  const ordered = useMemo(() => newestLegacyJournalCheckpoints(checkpoints.map((item) => item.record)), [checkpoints]);
  const [preview, setPreview] = useState<LegacyJournalCheckpointRollbackPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectingId, setInspectingId] = useState<string | null>(null);

  async function inspect(checkpointId: string) {
    setInspecting(true);
    setInspectingId(checkpointId);
    setPreview(null);
    setPreviewError(null);
    try {
      const checkpoint = checkpoints.find((item) => item.record.id === checkpointId);
      if (!adapter || !checkpoint) throw new Error("CHECKPOINT_UNAVAILABLE");
      const result = await readLegacyJournalCheckpointRollbackPreview(adapter, checkpoint.path);
      setPreview(result);
      await onRefresh();
    } catch {
      setPreviewError("无法从同一个最新 GitHub HEAD 完成只读核对；未使用旧数据生成预览，回滚保持阻断。");
    } finally {
      setInspecting(false);
      setInspectingId(null);
    }
  }

  return <section className="legacy-checkpoint-history" aria-labelledby="legacy-checkpoint-history-title">
    <div className="legacy-checkpoint-history-heading">
      <div><p className="eyebrow">Import safety · read only</p><h3 id="legacy-checkpoint-history-title">Legacy 导入 Checkpoint 历史</h3><p>Checkpoint 是与导入实体同批创建的不可变记录。预览会先刷新 GitHub，再核对当前 Entry、Revision、Segment 与原计划 hash；不会写入或自动回滚。</p></div>
      <button className="secondary-button" type="button" onClick={() => void onRefresh()} disabled={!connection || loading || online === false}>{loading ? "刷新中…" : "刷新历史"}</button>
    </div>
    {!connection ? <p className="empty-note">连接后显示 Private 仓库中的导入 Checkpoint。</p> : loading && checkpoints.length === 0 ? <p className="empty-note">正在读取 Checkpoint…</p> : ordered.length === 0 ? <p className="empty-note">尚无 Legacy Journal 导入 Checkpoint。</p> : <ol className="legacy-checkpoint-list">{ordered.map((checkpoint) => {
      const firstDate = checkpoint.data.items[0]?.date ?? "—";
      const lastDate = checkpoint.data.items.at(-1)?.date ?? firstDate;
      const selected = preview?.checkpointId === checkpoint.id || inspectingId === checkpoint.id;
      return <li key={checkpoint.id} data-selected={selected}>
        <div className="legacy-checkpoint-summary"><span>{checkpoint.data.committed_at}</span><strong>{firstDate === lastDate ? firstDate : `${firstDate}..${lastDate}`}</strong><small>{checkpoint.data.items.length} 天 · {checkpoint.data.planned_files.length} 个业务文件</small><code>{checkpoint.data.import_batch_id}</code></div>
        <div className="legacy-checkpoint-facts"><span>Plan SHA-256</span><code>{checkpoint.data.plan_sha256}</code><span>Expected parent HEAD</span><code>{checkpoint.data.expected_parent_commit_sha}</code></div>
        <button className="secondary-button" type="button" onClick={() => void inspect(checkpoint.id)} disabled={inspecting || loading || online === false}>{inspectingId === checkpoint.id ? "核对中…" : "刷新并生成只读预览"}</button>
      </li>;
    })}</ol>}
    {previewError ? <div className="legacy-rollback-preview blocked" role="status"><strong>预览被阻断</strong><p>{previewError}</p></div> : null}
    {preview ? <div className={`legacy-rollback-preview ${preview.rollbackReady ? "ready" : preview.summary.blocked ? "blocked" : "inactive"}`} role="status" aria-live="polite">
      <div><p className="eyebrow">Rollback preview · no write</p><strong>{preview.rollbackReady ? "满足只读预览条件" : preview.summary.blocked ? "当前状态不允许回滚" : "本批 Entry 已处于软删除状态"}</strong><p>可软删除 {preview.summary.ready} · 已失效 {preview.summary.alreadyInactive} · 阻断 {preview.summary.blocked}。Revision、Segment、Checkpoint 与 Git 历史始终保留。</p></div>
      <ol>{preview.items.map((item) => <li key={item.entryId} data-status={item.status}><span>{item.date}</span><strong>{rollbackStatusLabel(item.status)}</strong><code>{item.entryId}</code>{item.blockers.length ? <small>{item.blockers.map(rollbackBlockerLabel).join(" · ")}</small> : <small>当前记录与 checkpoint 的原子计划一致。</small>}</li>)}</ol>
      <p className="legacy-rollback-boundary">这里没有执行入口。未来实际软删除仍需独立动作确认，并在写入前重新检查 HEAD 与每个 Entry blob SHA；Git 历史无法物理擦除。</p>
    </div> : null}
  </section>;
}

function rollbackStatusLabel(status: LegacyJournalCheckpointRollbackPreview["items"][number]["status"]) {
  if (status === "ready") return "可计划软删除";
  if (status === "already_inactive") return "已软删除";
  return "阻断";
}

function rollbackBlockerLabel(code: string) {
  const labels: Record<string, string> = {
    LEGACY_ROLLBACK_ENTRY_MISSING: "Entry 缺失",
    LEGACY_ROLLBACK_REVISION_MISSING: "Revision 缺失",
    LEGACY_ROLLBACK_SEGMENT_MISSING: "Segment 缺失",
    LEGACY_ROLLBACK_OWNER_MISMATCH: "owner 不一致",
    LEGACY_ROLLBACK_DATE_CHANGED: "日期已变化",
    LEGACY_ROLLBACK_CURRENT_REVISION_CHANGED: "current Revision 已变化",
    LEGACY_ROLLBACK_CONTENT_CHANGED: "正文已变化",
    LEGACY_ROLLBACK_NEWER_REVISION_EXISTS: "存在后续 Revision",
    LEGACY_ROLLBACK_SEGMENT_SET_CHANGED: "Segment 集合已变化",
    LEGACY_ROLLBACK_SOURCE_MISMATCH: "导入来源不一致",
    LEGACY_ROLLBACK_ENTRY_EDITED: "Entry 已编辑",
    LEGACY_ROLLBACK_ENTRY_LIFECYCLE_CHANGED: "Entry 生命周期已多次变化",
    LEGACY_ROLLBACK_ENTRY_BLOB_INVALID: "Entry blob SHA 无效",
    LEGACY_ROLLBACK_PLANNED_FILE_MISSING: "原计划缺少文件 hash",
    LEGACY_ROLLBACK_PLANNED_FILE_CHANGED: "文件已偏离原计划 hash",
  };
  return labels[code] ?? code;
}
