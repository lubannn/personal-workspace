"use client";

import { useRef, useState, type FormEvent } from "react";
import { createNoticeData, NOTICE_MAX_LENGTH } from "../../../../src/lib/github-data/notices";
import type { SyncedNotice } from "../../../../src/lib/github-data/notice-sync";
import type { Connection } from "./page-model";
import "./notices.css";

type Props = {
  connection: Connection | null; online: boolean | null; files: SyncedNotice[];
  loading: boolean; ready: boolean; saving: boolean; error: string;
  onRefresh: () => void; onSave: (body: string, current?: SyncedNotice) => Promise<boolean>;
  onDelete: (current: SyncedNotice) => Promise<boolean>; onRestore: (current: SyncedNotice) => Promise<boolean>;
};

export function NoticesSection({ connection, online, files, loading, ready, saving, error, onRefresh, onSave, onDelete, onRestore }: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<SyncedNotice>();
  const [formError, setFormError] = useState("");
  const submitRef = useRef(false);
  const disabled = !connection || online === false || loading || saving || !ready;
  const visible = connection && ready ? files : [];
  const active = visible.filter(file => file.record.deleted_at === null).sort((a, b) => b.record.created_at.localeCompare(a.record.created_at) || a.record.id.localeCompare(b.record.id));
  const trash = visible.filter(file => file.record.deleted_at !== null).sort((a, b) => String(b.record.deleted_at).localeCompare(String(a.record.deleted_at)));
  function cancel() { setFormOpen(false); setEditing(undefined); setBody(""); setFormError(""); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || submitRef.current) return;
    try { createNoticeData(body); }
    catch { setFormError(`请填写通告内容，最多 ${NOTICE_MAX_LENGTH.toLocaleString("zh-CN")} 个字符。`); return; }
    submitRef.current = true; setFormError("");
    try { if (await onSave(body, editing)) cancel(); }
    finally { submitRef.current = false; }
  }
  return <section className="notices-section" aria-labelledby="notices-title">
    <div className="notices-heading">
      <div><p className="eyebrow">NOTICE BOARD</p><h2 id="notices-title">通告</h2></div>
      <div className="notices-actions"><button type="button" disabled={!connection || online === false || loading || saving} onClick={onRefresh}>{loading ? "读取中…" : "刷新通告"}</button>
        {!formOpen && <button className="primary-button" type="button" disabled={disabled} onClick={() => { setBody(""); setEditing(undefined); setFormError(""); setFormOpen(true); }}>新增通告</button>}</div>
    </div>
    {!connection && <p className="muted">连接私人数据仓库后，可保存和同步通告。</p>}
    {online === false && <p role="status">当前离线，连接网络后可保存。</p>}
    {error && <p className="notices-error" role="alert">{error}</p>}
    {formOpen && <form className="notices-form" onSubmit={submit}>
      <h3>{editing ? "编辑通告" : "新增通告"}</h3>
      <fieldset disabled={disabled}>
        <label htmlFor="notice-body">通告内容</label>
        <textarea id="notice-body" autoFocus required rows={5} maxLength={NOTICE_MAX_LENGTH} value={body} aria-describedby="notice-input-hint" aria-invalid={formError ? true : undefined} onChange={event => { setBody(event.target.value); setFormError(""); }} placeholder="写下需要常常看见的一句话，或几行提醒。" />
        <p className="muted" id="notice-input-hint">保留换行 · 纯文本 · {body.length} / {NOTICE_MAX_LENGTH}</p>
        {formError && <p role="alert">{formError}</p>}
        <div className="notices-actions"><button className="primary-button" type="submit">{saving ? "保存中…" : "保存通告"}</button></div>
      </fieldset>
      <button type="button" disabled={saving} onClick={cancel}>取消</button>
    </form>}
    {loading && <p role="status">正在核对通告…</p>}
    {connection && ready && !active.length && <p className="notices-empty">这里还没有通告。写下近期需要提醒自己的事。</p>}
    <ol className="notices-list" aria-label="当前通告">
      {active.map((item, index) => <li className="notice-card" key={item.record.id}>
        <div className="notice-card-heading"><span className="notice-number">通告 {String(index + 1).padStart(2, "0")}</span><div className="notices-actions">
          <button type="button" aria-label={`编辑通告 ${index + 1}`} disabled={disabled} onClick={() => { setEditing(item); setBody(item.record.data.body); setFormError(""); setFormOpen(true); }}>编辑</button>
          <button type="button" aria-label={`删除通告 ${index + 1}`} disabled={disabled || editing?.record.id === item.record.id} onClick={() => void onDelete(item)}>删除</button>
        </div></div>
        <p className="notice-body">{item.record.data.body}</p>
      </li>)}
    </ol>
    {trash.length > 0 && <details className="notices-trash"><summary>回收站（{trash.length}）</summary><p className="muted">删除的通告可以恢复。</p><ul>
      {trash.map((item, index) => <li key={item.record.id}><p>{item.record.data.body}</p><button type="button" disabled={disabled} aria-label={`恢复通告 ${index + 1}`} onClick={() => void onRestore(item)}>恢复</button></li>)}
    </ul></details>}
  </section>;
}
