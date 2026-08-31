"use client";

import { useMemo, useState, type FormEvent } from "react";
import { activeJournalEntries, filterJournalEntries, hasActiveDailyJournalDate, journalEntryMarkdownFileName, renderJournalEntryMarkdown, shiftJournalMonth, trashedJournalEntries } from "../../../../src/lib/github-data/journal-entries";
import type { Connection, SyncedJournalEntry } from "./page-model";

type JournalFields = { journalDate: string; title: string; bodyMarkdown: string; mood: string; weather: string };

type Props = {
  connection: Connection | null;
  online: boolean | null;
  todayDate: string;
  journalEntryFiles: SyncedJournalEntry[];
  loading: boolean;
  saving: boolean;
  savingId: string | null;
  onCreate: (fields: JournalFields) => Promise<boolean>;
  onEdit: (item: SyncedJournalEntry, fields: Omit<JournalFields, "journalDate">) => Promise<boolean>;
  onDeletionChange: (item: SyncedJournalEntry, operation: "trash" | "restore") => void;
  onRefresh: () => void;
};

export function JournalSection({ connection, online, todayDate, journalEntryFiles, loading, saving, savingId, onCreate, onEdit, onDeletionChange, onRefresh }: Props) {
  const [view, setView] = useState<"active" | "trash">("active");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [journalDate, setJournalDate] = useState("");
  const [title, setTitle] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [mood, setMood] = useState("");
  const [weather, setWeather] = useState("");
  const [month, setMonth] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const records = useMemo(() => journalEntryFiles.map((item) => item.record), [journalEntryFiles]);
  const byId = useMemo(() => new Map(journalEntryFiles.map((item) => [item.record.id, item])), [journalEntryFiles]);
  const active = useMemo(() => activeJournalEntries(records).map((record) => byId.get(record.id)!), [byId, records]);
  const trash = useMemo(() => trashedJournalEntries(records).map((record) => byId.get(record.id)!), [byId, records]);
  const source = view === "active" ? active : trash;
  const visible = useMemo(() => filterJournalEntries(records, { view, month, query: searchQuery }).map((record) => byId.get(record.id)!), [byId, month, records, searchQuery, view]);
  const busy = saving || Boolean(savingId);
  const selectedDate = journalDate || todayDate;
  const currentMonth = todayDate.slice(0, 7);
  const dateConflict = !editingId && Boolean(selectedDate) && hasActiveDailyJournalDate(records, selectedDate);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDate || !bodyMarkdown.trim()) return;
    const editing = editingId ? byId.get(editingId) : null;
    const saved = editing
      ? await onEdit(editing, { title, bodyMarkdown, mood, weather })
      : await onCreate({ journalDate: selectedDate, title, bodyMarkdown, mood, weather });
    if (saved) resetForm();
  }

  function beginEdit(item: SyncedJournalEntry) {
    setEditingId(item.record.id);
    setJournalDate(item.record.data.journal_date);
    setTitle(item.record.data.title);
    setBodyMarkdown(item.record.data.body_markdown);
    setMood(item.record.data.mood ?? "");
    setWeather(item.record.data.weather ?? "");
  }

  function resetForm() {
    setEditingId(null); setJournalDate(""); setTitle(""); setBodyMarkdown(""); setMood(""); setWeather("");
  }

  return <section className="journal-card" aria-labelledby="journal-title">
    <div className="card-heading">
      <div><p className="eyebrow">Phase 3A · Journal Core</p><h2 id="journal-title">日记</h2><p className="journal-subtitle">Private GitHub JSON 是唯一 canonical；Markdown 只在当前浏览器导出。首版不连接、不扫描也不覆盖 Obsidian Vault。</p></div>
      <div className="journal-view-actions" aria-label="日记视图与同步">
        <button className="view-button" type="button" aria-pressed={view === "active"} onClick={() => setView("active")}>日记 {active.length}</button>
        <button className="view-button" type="button" aria-pressed={view === "trash"} onClick={() => { setView("trash"); resetForm(); }}>回收站 {trash.length}</button>
        <button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || loading}>{loading ? "刷新中…" : "从 GitHub 刷新"}</button>
      </div>
    </div>
    {view === "active" ? <form className="journal-form" onSubmit={submit}>
      <div className="journal-form-meta">
        <label>日期<input type="date" value={selectedDate} onChange={(event) => setJournalDate(event.target.value)} disabled={!connection || busy || Boolean(editingId)} /></label>
        <label>标题（可选）<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} placeholder="给这一天一个标题" disabled={!connection || busy} /></label>
        <label>心情（可选）<input value={mood} onChange={(event) => setMood(event.target.value)} maxLength={100} placeholder="例如：平静" disabled={!connection || busy} /></label>
        <label>天气（可选）<input value={weather} onChange={(event) => setWeather(event.target.value)} maxLength={100} placeholder="例如：晴" disabled={!connection || busy} /></label>
      </div>
      <label className="journal-body">Markdown 正文<textarea value={bodyMarkdown} onChange={(event) => setBodyMarkdown(event.target.value)} maxLength={2_000_000} placeholder="今天发生了什么？" disabled={!connection || busy} /></label>
      <footer><span>{editingId ? "编辑会递增 record version，并使用旧 blob SHA 防止覆盖跨设备变更。" : dateConflict ? "这一天已经有一篇未删除的 daily 日记，请编辑现有记录。" : "每天一篇 daily；同一天的多个时刻可先写在同一篇 Markdown 中。"}</span><div>{editingId ? <button className="secondary-button" type="button" onClick={resetForm} disabled={busy}>取消编辑</button> : null}<button className="primary-button" type="submit" disabled={!connection || !selectedDate || !bodyMarkdown.trim() || dateConflict || busy || online === false}>{busy ? "保存中…" : editingId ? "保存修订" : "保存日记"}</button></div></footer>
    </form> : null}
    <div className="journal-browser" aria-label="日记日期浏览与搜索">
      <div className="journal-browser-date"><label><span>月份</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} disabled={!connection} /></label><button className="secondary-button" type="button" aria-label="上一个月" onClick={() => setMonth(shiftJournalMonth(month || currentMonth, -1))} disabled={!connection || !currentMonth}>←</button><button className="secondary-button" type="button" onClick={() => setMonth(currentMonth)} disabled={!connection || !currentMonth}>本月</button><button className="secondary-button" type="button" aria-label="下一个月" onClick={() => setMonth(shiftJournalMonth(month || currentMonth, 1))} disabled={!connection || !currentMonth}>→</button><button className="text-button" type="button" onClick={() => setMonth("")} disabled={!connection || !month}>全部日期</button></div>
      <label className="journal-browser-search"><span>浏览器内搜索</span><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} maxLength={200} placeholder="搜索标题、正文、心情或天气" disabled={!connection} /></label>
      <div className="journal-browser-meta" aria-live="polite"><span>{connection ? `显示 ${visible.length} / ${source.length}` : "连接后可搜索"}</span><button className="text-button" type="button" onClick={() => { setMonth(""); setSearchQuery(""); }} disabled={!connection || (!month && !searchQuery)}>清除筛选</button></div>
    </div>
    {!connection ? <p className="empty-note">连接后显示 Private 仓库中的 JournalEntry。</p> : loading && journalEntryFiles.length === 0 ? <p className="empty-note">正在读取日记…</p> : source.length === 0 ? <p className="empty-note">{view === "active" ? "还没有日记。" : "Journal 回收站是空的。"}</p> : visible.length === 0 ? <p className="empty-note">没有符合当前月份与搜索条件的日记。</p> : <ol className="journal-list">{visible.map((item) => <li key={item.record.id}>
      <div><span>{item.record.data.journal_date}</span><strong>{item.record.data.title || "未命名日记"}</strong><p>{preview(item.record.data.body_markdown)}</p><small>{[item.record.data.mood && `心情 ${item.record.data.mood}`, item.record.data.weather && `天气 ${item.record.data.weather}`, `v${item.record.version}`, item.record.data.sync_status === "not_configured" && "未连接 Obsidian"].filter(Boolean).join(" · ")}</small></div>
      <div className="journal-item-actions">{view === "active" ? <><button className="text-button" type="button" onClick={() => beginEdit(item)} disabled={Boolean(savingId) || saving}>编辑</button><button className="text-button" type="button" onClick={() => downloadMarkdown(item)}>下载 Markdown</button></> : null}<button className="text-button" type="button" onClick={() => onDeletionChange(item, view === "active" ? "trash" : "restore")} disabled={Boolean(savingId) || online === false}>{savingId === item.record.id ? "…" : view === "active" ? "移到回收站" : "恢复"}</button></div>
    </li>)}</ol>}
  </section>;
}

function preview(value: string) { const text = value.replace(/[#>*_`\[\]()\-]/g, " ").replace(/\s+/g, " ").trim(); return text.length > 180 ? `${text.slice(0, 180)}…` : text; }

function downloadMarkdown(item: SyncedJournalEntry) {
  const blob = new Blob([renderJournalEntryMarkdown(item.record)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = journalEntryMarkdownFileName(item.record); anchor.click();
  URL.revokeObjectURL(url);
}
