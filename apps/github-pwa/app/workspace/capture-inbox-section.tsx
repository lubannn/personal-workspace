"use client";

import { useState } from "react";
import { CAPTURE_KINDS, CAPTURE_KIND_LABELS, captureMatches, suggestCapture, type CaptureFields, type CaptureKind } from "../../../../src/lib/github-data/capture-details";
import { formatCaptureTime, type Connection, type SyncedCapture } from "./page-model";

export type CaptureView = "inbox" | "archived" | "trash";
export type CaptureOperation = "trash" | "restore" | "archive" | "unarchive";
type Props = {
  connection: Connection | null; online: boolean | null; captureView: CaptureView;
  inboxCaptures: SyncedCapture[]; archivedCaptures: SyncedCapture[]; trashedCaptures: SyncedCapture[]; visibleCaptures: SyncedCapture[];
  loadingCaptures: boolean; savingCaptureId: string | null;
  onViewChange: (view: CaptureView) => void; onRefresh: () => void;
  onLifecycleChange: (item: SyncedCapture, operation: CaptureOperation) => void;
  onEdit: (item: SyncedCapture, fields: CaptureFields) => Promise<boolean>;
};

function CaptureEditor({ item, timezone, saving, online, onSave, onCancel }: {
  item: SyncedCapture; timezone: string; saving: boolean; online: boolean | null;
  onSave: Props["onEdit"]; onCancel: () => void;
}) {
  // Keep the SHA from when editing began, even if another device's version is refreshed underneath.
  const [snapshot] = useState(item);
  const [fields, setFields] = useState<CaptureFields>({ rawText: item.record.data.raw_text, kind: item.record.data.kind ?? "note", date: item.record.data.noted_date ?? null, time: item.record.data.noted_time ?? null, timezone: item.record.data.timezone ?? timezone });
  return <form className="capture-edit-form" onSubmit={async (event) => { event.preventDefault(); if (await onSave(snapshot, fields)) onCancel(); }}>
    <label>内容<textarea value={fields.rawText} maxLength={10_000} disabled={saving} onChange={(event) => setFields({ ...fields, rawText: event.target.value })} /></label>
    <div className="capture-datetime">
      <label>分类<select value={fields.kind} disabled={saving} onChange={(event) => setFields({ ...fields, kind: event.target.value as CaptureKind })}>{CAPTURE_KINDS.map((kind) => <option key={kind} value={kind}>{CAPTURE_KIND_LABELS[kind]}</option>)}</select></label>
      <label>日期<input type="date" value={fields.date ?? ""} disabled={saving} onChange={(event) => setFields({ ...fields, date: event.target.value || null })} /></label>
      <label>时间<input type="time" value={fields.time ?? ""} disabled={saving} onChange={(event) => setFields({ ...fields, time: event.target.value || null })} /></label>
    </div>
    <div className="capture-edit-actions">
      <button className="view-button" type="button" disabled={saving} onClick={() => { const suggestion = suggestCapture(fields.rawText, new Date(snapshot.record.created_at), fields.timezone); setFields({ ...fields, kind: suggestion.kind, date: suggestion.date, time: suggestion.time }); }}>按原记录日期重新识别</button>
      <button className="view-button" type="button" disabled={saving} onClick={onCancel}>取消</button>
      <button className="primary-button" type="submit" disabled={saving || online === false || !fields.rawText.trim() || Boolean(fields.time && !fields.date)}>{saving ? "保存中…" : "保存修改"}</button>
    </div>
    {fields.time && !fields.date ? <p className="capture-hint">请选择日期，或清除时间。</p> : null}
  </form>;
}

export function CaptureInboxSection(props: Props) {
  const { connection, online, captureView, inboxCaptures, archivedCaptures, trashedCaptures, visibleCaptures, loadingCaptures, savingCaptureId, onViewChange, onRefresh, onLifecycleChange, onEdit } = props;
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<CaptureKind | "all">("all");
  const [limit, setLimit] = useState(20);
  const [editingId, setEditingId] = useState<string | null>(null);
  const matches = visibleCaptures.filter((item) => captureMatches(item.record, query, kind));
  return (
    <section className="recent-card" aria-labelledby="recent-title">
      <div className="card-heading">
        <div><p className="eyebrow">Quick capture inbox</p><h2 id="recent-title">随手记收件箱</h2></div>
        <div className="recent-actions" aria-label="随手记视图与同步">
          {([["inbox", "待整理", inboxCaptures.length], ["archived", "已归档", archivedCaptures.length], ["trash", "回收站", trashedCaptures.length]] as const).map(([view, label, count]) => <button key={view} className={`view-button ${captureView === view ? "active" : ""}`} type="button" disabled={Boolean(savingCaptureId) || editingId !== null} aria-pressed={captureView === view} onClick={() => { onViewChange(view); setLimit(20); setEditingId(null); }}>{label} {count}</button>)}
          <button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || online === false || loadingCaptures || Boolean(savingCaptureId) || editingId !== null}>{loadingCaptures ? "刷新中…" : "刷新记录"}</button>
        </div>
      </div>
      <div className="capture-search-toolbar">
        <label><span className="visually-hidden">搜索随手记内容、日期或星期</span><input type="search" disabled={editingId !== null} value={query} placeholder="搜索内容、日期、月份或星期…" onChange={(event) => { setQuery(event.target.value); setLimit(20); }} /></label>
        <div className="capture-kind-options" aria-label="筛选随手记分类">
          {(["all", ...CAPTURE_KINDS] as const).map((value) => <button key={value} className={`view-button ${kind === value ? "active" : ""}`} type="button" disabled={editingId !== null} aria-pressed={kind === value} onClick={() => { setKind(value); setLimit(20); }}>{value === "all" ? "全部" : CAPTURE_KIND_LABELS[value]}</button>)}
        </div>
      </div>
      {!connection ? <p className="empty-note">连接后显示已同步的随手记。</p>
        : loadingCaptures && visibleCaptures.length === 0 ? <p className="empty-note" role="status">正在读取随手记…</p>
          : matches.length === 0 ? <p className="empty-note">{query || kind !== "all" ? "没有匹配的记录，试试其他关键词或分类。" : captureView === "trash" ? "回收站是空的。" : captureView === "archived" ? "还没有归档记录。" : "还没有随手记，写下第一个想法吧。"}</p>
            : <ul className="recent-list">{matches.slice(0, limit).map((item) => <li key={item.record.id}>
              <time dateTime={item.record.deleted_at ?? item.record.created_at}>{formatCaptureTime(item.record.deleted_at ?? item.record.created_at)}</time>
              <div className="capture-record-content">
                <div className="capture-record-meta"><span>{CAPTURE_KIND_LABELS[item.record.data.kind ?? "note"]}</span>{item.record.data.noted_date ? <span>{item.record.data.noted_date}{item.record.data.noted_time ? ` ${item.record.data.noted_time}` : ""}</span> : null}</div>
                {editingId === item.record.id ? <CaptureEditor item={item} timezone={connection.timezone} saving={Boolean(savingCaptureId)} online={online} onSave={onEdit} onCancel={() => setEditingId(null)} /> : <p>{item.record.data.raw_text}</p>}
              </div>
              <div className="capture-row-actions">
                {captureView !== "trash" ? <>
                  <button className="view-button" type="button" disabled={Boolean(savingCaptureId) || editingId !== null} onClick={() => setEditingId(item.record.id)}>编辑</button>
                  <button className="view-button" type="button" disabled={Boolean(savingCaptureId) || online === false || editingId !== null} onClick={() => onLifecycleChange(item, captureView === "archived" ? "unarchive" : "archive")}>{captureView === "archived" ? "放回待整理" : "归档"}</button>
                </> : null}
                <button className={captureView === "trash" ? "restore-button" : "trash-button"} type="button" onClick={() => onLifecycleChange(item, captureView === "trash" ? "restore" : "trash")} disabled={Boolean(savingCaptureId) || online === false || editingId !== null}>{savingCaptureId === item.record.id ? "保存中…" : captureView === "trash" ? "恢复" : "移到回收站"}</button>
              </div>
            </li>)}</ul>}
      {connection && matches.length > 0 ? <div className="capture-list-footer"><span role="status">显示 {Math.min(limit, matches.length)} / {matches.length} 条</span>{limit < matches.length ? <button className="view-button" type="button" onClick={() => setLimit(limit + 20)}>加载更多</button> : null}</div> : null}
    </section>
  );
}
