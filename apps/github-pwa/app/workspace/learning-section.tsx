"use client";

import { useMemo, useState, type FormEvent } from "react";

import {
  activeLearningAreas,
  archivedLearningAreas,
  trashedLearningAreas,
  type LearningAreaFields,
  type LearningAreaStatus,
} from "../../../../src/lib/github-data/learning-areas";
import type { Connection, SyncedLearningArea } from "./page-model";

type Props = {
  connection: Connection | null;
  online: boolean | null;
  items: SyncedLearningArea[];
  loading: boolean;
  saving: boolean;
  savingId: string | null;
  onCreate: (fields: LearningAreaFields) => Promise<boolean>;
  onEdit: (item: SyncedLearningArea, fields: LearningAreaFields) => Promise<boolean>;
  onStatusChange: (item: SyncedLearningArea, status: LearningAreaStatus) => void;
  onDeletionChange: (item: SyncedLearningArea, operation: "trash" | "restore") => void;
  onRefresh: () => void;
};

const EMPTY_FIELDS: LearningAreaFields = { name: "", description_markdown: "", area_type: "general", icon: null, color: null };

export function LearningSection({ connection, online, items, loading, saving, savingId, onCreate, onEdit, onStatusChange, onDeletionChange, onRefresh }: Props) {
  const [view, setView] = useState<"active" | "archived" | "trash">("active");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fields, setFields] = useState<LearningAreaFields>(EMPTY_FIELDS);
  const byId = useMemo(() => new Map(items.map((item) => [item.record.id, item])), [items]);
  const records = useMemo(() => items.map((item) => item.record), [items]);
  const active = useMemo(() => activeLearningAreas(records).map((record) => byId.get(record.id)!), [byId, records]);
  const archived = useMemo(() => archivedLearningAreas(records).map((record) => byId.get(record.id)!), [byId, records]);
  const trash = useMemo(() => trashedLearningAreas(records).map((record) => byId.get(record.id)!), [byId, records]);
  const visible = view === "active" ? active : view === "archived" ? archived : trash;
  const busy = saving || savingId !== null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fields.name.trim() || !fields.area_type.trim()) return;
    const editing = editingId ? byId.get(editingId) : null;
    const saved = editing ? await onEdit(editing, fields) : await onCreate(fields);
    if (saved) resetForm();
  }

  function beginEdit(item: SyncedLearningArea) {
    setEditingId(item.record.id);
    setFields({
      name: item.record.data.name,
      description_markdown: item.record.data.description_markdown,
      area_type: item.record.data.area_type,
      icon: item.record.data.icon,
      color: item.record.data.color,
    });
  }

  function resetForm() { setEditingId(null); setFields(EMPTY_FIELDS); }
  function setField<Key extends keyof LearningAreaFields>(key: Key, value: LearningAreaFields[Key]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  return <section className="learning-card" aria-labelledby="learning-title">
    <div className="card-heading">
      <div><p className="eyebrow">Phase 4 · Learning</p><h2 id="learning-title">学习领域</h2><p className="learning-subtitle">先定义长期学习边界；领域类型由你命名，不预设语言、考试或课程体系。</p></div>
      <div className="learning-view-actions">
        <button className="view-button" type="button" aria-pressed={view === "active"} onClick={() => setView("active")}>进行中 {active.length}</button>
        <button className="view-button" type="button" aria-pressed={view === "archived"} onClick={() => { setView("archived"); resetForm(); }}>已归档 {archived.length}</button>
        <button className="view-button" type="button" aria-pressed={view === "trash"} onClick={() => { setView("trash"); resetForm(); }}>回收站 {trash.length}</button>
        <button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || loading}>{loading ? "刷新中…" : "从 GitHub 刷新"}</button>
      </div>
    </div>
    {view === "active" ? <form className="learning-form" onSubmit={submit}>
      <label>名称<input value={fields.name} maxLength={200} onChange={(event) => setField("name", event.target.value)} placeholder="例如：数据分析" disabled={!connection || busy} /></label>
      <label>类型标识<input value={fields.area_type} maxLength={64} pattern="[a-z0-9][a-z0-9_-]*" onChange={(event) => setField("area_type", event.target.value)} placeholder="例如：professional" disabled={!connection || busy} /></label>
      <label>图标（可选）<input value={fields.icon ?? ""} maxLength={32} onChange={(event) => setField("icon", event.target.value || null)} placeholder="📚" disabled={!connection || busy} /></label>
      <label>颜色（可选）<input value={fields.color ?? ""} pattern="#[0-9a-fA-F]{6}" onChange={(event) => setField("color", event.target.value || null)} placeholder="#5f7459" disabled={!connection || busy} /></label>
      <label className="learning-description">说明（支持 Markdown）<textarea value={fields.description_markdown} maxLength={50_000} onChange={(event) => setField("description_markdown", event.target.value)} placeholder="这个领域为什么重要？边界是什么？" disabled={!connection || busy} /></label>
      <footer><span>每次保存都会创建 Git 版本；类型标识保存后仍可修改。</span><div>{editingId ? <button className="secondary-button" type="button" onClick={resetForm} disabled={busy}>取消编辑</button> : null}<button className="primary-button" type="submit" disabled={!connection || !fields.name.trim() || !fields.area_type.trim() || busy || online === false}>{busy ? "保存中…" : editingId ? "保存修改" : "创建领域"}</button></div></footer>
    </form> : null}
    {!connection ? <p className="empty-note">连接后显示 Private 仓库中的 LearningArea。</p> : loading && items.length === 0 ? <p className="empty-note">正在读取学习领域…</p> : visible.length === 0 ? <p className="empty-note">当前视图还没有学习领域。</p> : <ol className="learning-list">{visible.map((item) => <li key={item.record.id}>
      <div><span>{item.record.data.icon || "◌"}</span><strong>{item.record.data.name}</strong><code>{item.record.data.area_type}</code>{item.record.data.description_markdown ? <p>{item.record.data.description_markdown}</p> : null}<small>{item.record.data.status === "on_hold" ? "已暂停" : item.record.data.status === "archived" ? "已归档" : "进行中"} · v{item.record.version}</small></div>
      <div className="learning-item-actions">{view === "active" ? <><button className="text-button" type="button" onClick={() => beginEdit(item)} disabled={busy}>编辑</button><button className="text-button" type="button" onClick={() => onStatusChange(item, item.record.data.status === "on_hold" ? "active" : "on_hold")} disabled={busy || online === false}>{item.record.data.status === "on_hold" ? "继续" : "暂停"}</button><button className="text-button" type="button" onClick={() => onStatusChange(item, "archived")} disabled={busy || online === false}>归档</button></> : view === "archived" ? <button className="text-button" type="button" onClick={() => onStatusChange(item, "active")} disabled={busy || online === false}>恢复进行</button> : null}<button className="text-button" type="button" onClick={() => onDeletionChange(item, view === "trash" ? "restore" : "trash")} disabled={busy || online === false}>{savingId === item.record.id ? "…" : view === "trash" ? "恢复" : "移到回收站"}</button></div>
    </li>)}</ol>}
  </section>;
}
