"use client";

import { formatCaptureTime, type Connection, type SyncedCapture } from "./page-model";

type Props = {
  connection: Connection | null;
  online: boolean | null;
  captureView: "inbox" | "trash";
  inboxCaptures: SyncedCapture[];
  trashedCaptures: SyncedCapture[];
  visibleCaptures: SyncedCapture[];
  loadingCaptures: boolean;
  savingCaptureId: string | null;
  onViewChange: (view: "inbox" | "trash") => void;
  onRefresh: () => void;
  onLifecycleChange: (item: SyncedCapture, operation: "trash" | "restore") => void;
};

export function CaptureInboxSection(props: Props) {
  const { connection, online, captureView, inboxCaptures, trashedCaptures, visibleCaptures, loadingCaptures, savingCaptureId, onViewChange, onRefresh, onLifecycleChange } = props;
  return (
    <section className="recent-card" aria-labelledby="recent-title">
      <div className="card-heading">
        <div><p className="eyebrow">Cross-device inbox</p><h2 id="recent-title">Capture Inbox</h2></div>
        <div className="recent-actions" aria-label="Capture 视图与同步">
          <button className={`view-button ${captureView === "inbox" ? "active" : ""}`} type="button" aria-pressed={captureView === "inbox"} onClick={() => onViewChange("inbox")}>Inbox {inboxCaptures.length}</button>
          <button className={`view-button ${captureView === "trash" ? "active" : ""}`} type="button" aria-pressed={captureView === "trash"} onClick={() => onViewChange("trash")}>回收站 {trashedCaptures.length}</button>
          <button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || loadingCaptures}>{loadingCaptures ? "刷新中…" : "从 GitHub 刷新"}</button>
        </div>
      </div>
      {!connection ? <p className="empty-note">连接后显示 Private 仓库中的最近记录。</p>
        : visibleCaptures.length === 0 ? <p className="empty-note">{captureView === "trash" ? "回收站是空的。" : "Inbox 还是空的，可以保存第一条记录。"}</p>
          : <ul className="recent-list">{visibleCaptures.map((item) => (
            <li key={item.record.id}>
              <time dateTime={item.record.deleted_at ?? item.record.created_at}>{formatCaptureTime(item.record.deleted_at ?? item.record.created_at)}</time>
              <p>{item.record.data.raw_text}</p>
              <div className="capture-row-actions">
                <span>{captureView === "trash" ? "trash" : item.record.data.status}</span>
                <button className={captureView === "trash" ? "restore-button" : "trash-button"} type="button" onClick={() => onLifecycleChange(item, captureView === "trash" ? "restore" : "trash")} disabled={Boolean(savingCaptureId) || online === false}>
                  {savingCaptureId === item.record.id ? "保存中…" : captureView === "trash" ? "恢复" : "移到回收站"}
                </button>
              </div>
            </li>
          ))}</ul>}
    </section>
  );
}
