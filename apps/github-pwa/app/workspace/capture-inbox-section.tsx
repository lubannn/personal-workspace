"use client";

import { useMemo, useState } from "react";
import { CAPTURE_KINDS, captureMatches, suggestCapture, type CaptureFields } from "../../../../src/lib/github-data/capture-details";
import { CAPTURE_DESTINATIONS } from "../../../../src/lib/github-data/capture-routing";
import type { WorkspaceTabId } from "./workspace-tab-navigation";
import { formatCaptureTime, type Connection, type SyncedCapture } from "./page-model";

export type CaptureView = "inbox" | "archived" | "trash";
export type CaptureOperation = "trash" | "restore" | "archive" | "unarchive";
type Props = {
  module?: "overview" | "ideas"; onOpenDestination: (tab: WorkspaceTabId) => void;
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
  const [manualDestination, setManualDestination] = useState(false);
  function recognize(text: string) { return suggestCapture(text, /^(?:日记|journal)\s*[:：]/i.test(text.trim()) ? new Date() : new Date(snapshot.record.created_at), timezone); }
  const [fields, setFields] = useState<CaptureFields>(() => {
    const suggestion = recognize(item.record.data.raw_text);
    const kind = item.record.data.kind ?? suggestion.kind;
    return { rawText: item.record.data.raw_text, kind, date: item.record.data.noted_date ?? suggestion.date, time: kind === "journal" ? null : item.record.data.noted_time ?? suggestion.time, endTime: suggestion.endTime, timezone: item.record.data.timezone ?? timezone };
  });
  const target = CAPTURE_DESTINATIONS[fields.kind];
  const transfers = ["todo", "deadline", "schedule", "journal"].includes(fields.kind);
  return <form className="capture-edit-form" onSubmit={async (event) => { event.preventDefault(); if (await onSave(snapshot, fields)) onCancel(); }}>
    <label>内容<textarea value={fields.rawText} maxLength={10_000} disabled={saving} onChange={(event) => { const rawText = event.target.value; const suggestion = recognize(rawText); setFields(manualDestination ? { ...fields, rawText } : { ...fields, rawText, kind: suggestion.kind, date: suggestion.date, time: suggestion.time, endTime: suggestion.endTime }); }} /></label>
    <div className="capture-datetime">
      <label>保存位置<select value={fields.kind} disabled={saving} onChange={(event) => { setManualDestination(true); setFields({ ...fields, kind: event.target.value as CaptureFields["kind"], ...(event.target.value === "journal" ? { date: suggestCapture("日记：", new Date(), timezone).date, time: null, endTime: null } : {}) }); }}>{CAPTURE_KINDS.map((kind) => <option key={kind} value={kind}>{kind === "deadline" ? "待办（有截止日期）" : CAPTURE_DESTINATIONS[kind]}</option>)}</select></label>
      <label>日期<input type="date" value={fields.date ?? ""} disabled={saving} onChange={(event) => setFields({ ...fields, date: event.target.value || null })} /></label>
      {fields.kind !== "journal" ? <label>时间<input type="time" value={fields.time ?? ""} disabled={saving} onChange={(event) => setFields({ ...fields, time: event.target.value || null })} /></label> : null}
      {fields.kind === "schedule" && fields.time ? <label>结束<input type="time" value={fields.endTime ?? ""} disabled={saving} onChange={(event) => setFields({ ...fields, endTime: event.target.value || null })} /></label> : null}
    </div>
    <div className="capture-edit-actions">
      <button className="view-button" type="button" disabled={saving} onClick={() => { setManualDestination(false); const suggestion = recognize(fields.rawText); setFields({ ...fields, kind: suggestion.kind, date: suggestion.date, time: suggestion.time, endTime: suggestion.endTime }); }}>自动识别保存位置</button>
      <button className="view-button" type="button" disabled={saving} onClick={onCancel}>取消</button>
      <button className="primary-button" type="submit" disabled={saving || online === false || !fields.rawText.trim() || Boolean(fields.time && !fields.date) || (["schedule", "deadline"].includes(fields.kind) && !fields.date) || Boolean(fields.kind === "schedule" && fields.time && fields.endTime === fields.time)}>{saving ? "保存中…" : `保存到${target}`}</button>
    </div>
    <p className="capture-hint">{transfers ? `将创建正式${target}记录，原随手记会自动归档。` : fields.kind === "idea" ? "保存后出现在顶部“想法”模块。" : "留在概览待整理。"}</p>
    {fields.time && !fields.date ? <p className="capture-hint">请选择日期，或清除时间。</p> : null}
  </form>;
}

export function CaptureInboxSection(props: Props) {
  const { connection, online, captureView, inboxCaptures, archivedCaptures, trashedCaptures, visibleCaptures, loadingCaptures, savingCaptureId, onViewChange, onRefresh, onLifecycleChange, onEdit, module = "overview", onOpenDestination } = props;
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(20);
  const [editingId, setEditingId] = useState<string | null>(null);
  const matches = useMemo(() => visibleCaptures.filter((item) => captureMatches(item.record, query)), [visibleCaptures, query]);
  const titleId = module === "ideas" ? "ideas-title" : "recent-title";
  return (
    <section className="recent-card capture-inbox" aria-labelledby={titleId}>
      <div className="card-heading capture-inbox-heading">
        <h2 id={titleId}>{module === "ideas" ? "想法" : "待整理随手记"}</h2>
        <button className="secondary-button" type="button" aria-label={module === "ideas" ? "刷新想法" : "刷新随手记"} onClick={onRefresh} disabled={!connection || online === false || loadingCaptures || Boolean(savingCaptureId) || editingId !== null}>{loadingCaptures ? "刷新中…" : "刷新"}</button>
      </div>
      <div className="recent-actions capture-view-actions" aria-label={module === "ideas" ? "想法视图" : "随手记视图"}>
        {([["inbox", "待整理", inboxCaptures.length], ["archived", "已归档", archivedCaptures.length], ["trash", "回收站", trashedCaptures.length]] as const).map(([view, label, count]) => <button key={view} className={`view-button ${captureView === view ? "active" : ""}`} type="button" disabled={editingId !== null} aria-pressed={captureView === view} onClick={() => { onViewChange(view); setLimit(20); setEditingId(null); }}>{label} {count}</button>)}
      </div>
      {savingCaptureId ? <p className="capture-hint" role="status">正在同步随手记…完成后会显示保存结果。</p> : null}
      <div className="capture-search-toolbar">
        <label><span className="visually-hidden">{module === "ideas" ? "搜索想法内容或日期" : "搜索随手记内容、日期或星期"}</span><input type="search" disabled={editingId !== null} value={query} placeholder="搜索内容或日期…" onChange={(event) => { setQuery(event.target.value); setLimit(20); }} /></label>

      </div>
      {!connection ? <p className="empty-note">{module === "ideas" ? "连接后显示已同步的想法。" : "连接后显示已同步的随手记。"}</p>
        : loadingCaptures && visibleCaptures.length === 0 ? <p className="empty-note" role="status">{module === "ideas" ? "正在读取想法…" : "正在读取随手记…"}</p>
          : matches.length === 0 ? <p className="empty-note">{query ? "没有匹配的记录，试试其他关键词。" : captureView === "trash" ? "回收站是空的。" : captureView === "archived" ? "还没有归档记录。" : module === "ideas" ? "还没有想法，在随手记中写下第一个想法吧。" : "还没有待整理记录。"}</p>
            : <ul className="recent-list">{matches.slice(0, limit).map((item) => <li key={item.record.id}>
              <div className="capture-record-content">
                <div className="capture-record-meta"><time dateTime={item.record.deleted_at ?? item.record.created_at}>{formatCaptureTime(item.record.deleted_at ?? item.record.created_at)}</time><span>{item.record.data.routed_to ? `已转入${item.record.data.routed_to.label}` : module === "ideas" ? "想法" : ["todo", "deadline", "schedule", "journal"].includes(item.record.data.kind ?? "note") ? `待转入${CAPTURE_DESTINATIONS[item.record.data.kind!]}` : "待整理"}</span>{item.record.data.noted_date ? <span>{item.record.data.noted_date}{item.record.data.noted_time ? ` ${item.record.data.noted_time}` : ""}</span> : null}</div>
                {editingId === item.record.id ? <CaptureEditor item={item} timezone={connection.timezone} saving={Boolean(savingCaptureId)} online={online} onSave={onEdit} onCancel={() => setEditingId(null)} /> : <p>{item.record.data.raw_text}</p>}
              </div>
              <div className="capture-row-actions">
                {item.record.data.routed_to ? <button className="view-button" type="button" onClick={() => onOpenDestination(item.record.data.routed_to!.tab)}>打开{item.record.data.routed_to.label}</button> : captureView !== "trash" ? <>
                  <button className="view-button" type="button" disabled={Boolean(savingCaptureId) || editingId !== null} onClick={() => setEditingId(item.record.id)}>编辑</button>
                  <button className="view-button" type="button" disabled={Boolean(savingCaptureId) || loadingCaptures || online === false || editingId !== null} onClick={() => onLifecycleChange(item, captureView === "archived" ? "unarchive" : "archive")}>{captureView === "archived" ? "放回待整理" : "归档"}</button>
                </> : null}
                {!item.record.data.routed_to ? <button className={captureView === "trash" ? "restore-button" : "trash-button"} type="button" onClick={() => onLifecycleChange(item, captureView === "trash" ? "restore" : "trash")} disabled={Boolean(savingCaptureId) || loadingCaptures || online === false || editingId !== null}>{savingCaptureId === item.record.id ? "同步中…" : captureView === "trash" ? "恢复" : "移到回收站"}</button> : null}
              </div>
            </li>)}</ul>}
      {connection && matches.length > 0 ? <div className="capture-list-footer"><span role="status">显示 {Math.min(limit, matches.length)} / {matches.length} 条</span>{limit < matches.length ? <button className="view-button" type="button" onClick={() => setLimit(limit + 20)}>加载更多</button> : null}</div> : null}
    </section>
  );
}
