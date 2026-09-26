"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { GitHubContentsAdapter } from "../../../../src/lib/github-data/github-contents";
import { activeJournalEntries, filterJournalEntries, journalEntryMarkdownFileName, journalEntrySubmittedTime, renderJournalEntryMarkdown, shiftJournalMonth, trashedJournalEntries } from "../../../../src/lib/github-data/journal-entries";
import { LegacyJournalImportSection } from "./legacy-journal-import-section";
import { LegacyJournalCheckpointHistory } from "./legacy-journal-checkpoint-history";
import { ObsidianVaultPreflight } from "./obsidian-vault-preflight";
import { ObsidianJournalExport } from "./obsidian-journal-export";
import type { Connection, SyncedJournalEntry, SyncedJournalImportCheckpoint, SyncedJournalRevision, SyncedObsidianDocument } from "./page-model";

type JournalFields = { journalDate: string; bodyMarkdown: string };

type Props = {
  connection: Connection | null;
  adapter: GitHubContentsAdapter | null;
  online: boolean | null;
  todayDate: string;
  journalEntryFiles: SyncedJournalEntry[];
  journalRevisionFiles: SyncedJournalRevision[];
  journalImportCheckpointFiles: SyncedJournalImportCheckpoint[];
  obsidianDocumentFiles: SyncedObsidianDocument[];
  loading: boolean;
  loadingLegacyHistory: boolean;
  saving: boolean;
  savingId: string | null;
  onCreate: (fields: JournalFields) => Promise<boolean>;
  onEdit: (item: SyncedJournalEntry, fields: Omit<JournalFields, "journalDate">) => Promise<boolean>;
  onDeletionChange: (item: SyncedJournalEntry, operation: "trash" | "restore") => void;
  onRefresh: () => void;
  onRefreshLegacyHistory: () => Promise<void>;
  onLegacyImportCommitted: () => Promise<void>;
  onObsidianCanonicalChanged: () => Promise<void>;
};

export function JournalSection({ connection, adapter, online, todayDate, journalEntryFiles, journalRevisionFiles, journalImportCheckpointFiles, obsidianDocumentFiles, loading, loadingLegacyHistory, saving, savingId, onCreate, onEdit, onDeletionChange, onRefresh, onRefreshLegacyHistory, onLegacyImportCommitted, onObsidianCanonicalChanged }: Props) {
  const [view, setView] = useState<"active" | "trash">("active");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [journalDate, setJournalDate] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDate || !bodyMarkdown.trim()) return;
    const editing = editingId ? byId.get(editingId) : null;
    const saved = editing
      ? await onEdit(editing, { bodyMarkdown })
      : await onCreate({ journalDate: selectedDate, bodyMarkdown });
    if (saved) resetForm();
  }

  function beginEdit(item: SyncedJournalEntry) {
    setEditingId(item.record.id);
    setJournalDate(item.record.data.journal_date);
    setBodyMarkdown(item.record.data.body_markdown);
  }

  function resetForm() {
    setEditingId(null); setJournalDate(""); setBodyMarkdown("");
  }

  return <section className="journal-card" aria-labelledby="journal-title">
    <div className="card-heading">
      <div><p className="eyebrow">Phase 3A · Journal Core</p><h2 id="journal-title">日记</h2><p className="journal-subtitle">Private GitHub JSON 是唯一 canonical；Obsidian 仅支持逐篇、显式确认的单向派生导出。</p></div>
      <div className="journal-view-actions" aria-label="日记视图与同步">
        <button className="view-button" type="button" aria-pressed={view === "active"} onClick={() => setView("active")}>日记 {active.length}</button>
        <button className="view-button" type="button" aria-pressed={view === "trash"} onClick={() => { setView("trash"); resetForm(); }}>回收站 {trash.length}</button>
        <button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || loading}>{loading ? "刷新中…" : "从 GitHub 刷新"}</button>
      </div>
    </div>
    {view === "active" ? <form className="journal-form" onSubmit={submit}>
      <div className="journal-form-meta">
        <label>日期<input type="date" value={selectedDate} onChange={(event) => setJournalDate(event.target.value)} disabled={!connection || busy || Boolean(editingId)} /></label>
      </div>
      <label className="journal-body">Markdown 正文<textarea value={bodyMarkdown} onChange={(event) => setBodyMarkdown(event.target.value)} maxLength={2_000_000} placeholder="今天发生了什么？" disabled={!connection || busy} /></label>
      <footer><span>{editingId ? "正文编辑会创建不可变 Revision；首次提交时间保持不变。" : "同一天可保存多篇；提交时刻会自动记录，日记与初始 Revision 原子保存。"}</span><div>{editingId ? <button className="secondary-button" type="button" onClick={resetForm} disabled={busy}>取消编辑</button> : null}<button className="primary-button" type="submit" disabled={!connection || !selectedDate || !bodyMarkdown.trim() || busy || online === false}>{busy ? "保存中…" : editingId ? "保存修订" : "保存日记"}</button></div></footer>
    </form> : null}
    <div className="journal-browser" aria-label="日记日期浏览与搜索">
      <div className="journal-browser-date"><label><span>月份</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} disabled={!connection} /></label><button className="secondary-button" type="button" aria-label="上一个月" onClick={() => setMonth(shiftJournalMonth(month || currentMonth, -1))} disabled={!connection || !currentMonth}>←</button><button className="secondary-button" type="button" onClick={() => setMonth(currentMonth)} disabled={!connection || !currentMonth}>本月</button><button className="secondary-button" type="button" aria-label="下一个月" onClick={() => setMonth(shiftJournalMonth(month || currentMonth, 1))} disabled={!connection || !currentMonth}>→</button><button className="text-button" type="button" onClick={() => setMonth("")} disabled={!connection || !month}>全部日期</button></div>
      <label className="journal-browser-search"><span>浏览器内搜索</span><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} maxLength={200} placeholder="搜索日期或正文" disabled={!connection} /></label>
      <div className="journal-browser-meta" aria-live="polite"><span>{connection ? `显示 ${visible.length} / ${source.length}` : "连接后可搜索"}</span><button className="text-button" type="button" onClick={() => { setMonth(""); setSearchQuery(""); }} disabled={!connection || (!month && !searchQuery)}>清除筛选</button></div>
    </div>
    {!connection ? <p className="empty-note">连接后显示 Private 仓库中的 JournalEntry。</p> : loading && journalEntryFiles.length === 0 ? <p className="empty-note">正在读取日记…</p> : source.length === 0 ? <p className="empty-note">{view === "active" ? "还没有日记。" : "Journal 回收站是空的。"}</p> : visible.length === 0 ? <p className="empty-note">没有符合当前月份与搜索条件的日记。</p> : <ol className="journal-list">{visible.map((item) => <li key={item.record.id}>
      <div><span>{item.record.data.journal_date} · 提交于 {journalEntrySubmittedTime(item.record)}（{item.record.data.timezone}）</span><p>{preview(item.record.data.body_markdown)}</p><small>{[`v${item.record.version}`, obsidianDocumentFiles.some((document) => document.record.deleted_at === null && document.record.data.journal_entry_id === item.record.id) ? "已有 Obsidian 导出基线" : "尚未导出到 Obsidian"].join(" · ")}</small></div>
      <div className="journal-item-actions">{view === "active" ? <><button className="text-button" type="button" onClick={() => beginEdit(item)} disabled={Boolean(savingId) || saving}>编辑</button><button className="text-button" type="button" onClick={() => downloadMarkdown(item)}>下载 Markdown</button></> : null}<button className="text-button" type="button" onClick={() => onDeletionChange(item, view === "active" ? "trash" : "restore")} disabled={Boolean(savingId) || online === false}>{savingId === item.record.id ? "…" : view === "active" ? "移到回收站" : "恢复"}</button></div>
    </li>)}</ol>}
    <LegacyJournalCheckpointHistory connection={connection} adapter={adapter} checkpoints={journalImportCheckpointFiles} loading={loadingLegacyHistory} online={online} onRefresh={onRefreshLegacyHistory} />
    <ObsidianJournalExport connection={connection} adapter={adapter} online={online} entries={journalEntryFiles} revisions={journalRevisionFiles} documents={obsidianDocumentFiles} onCanonicalChanged={onObsidianCanonicalChanged} />
    <ObsidianVaultPreflight />
    <LegacyJournalImportSection key={connection ? `${connection.ownerLogin}/${connection.repository}/${connection.timezone}` : "disconnected"} connection={connection} adapter={adapter} online={online} onCommitted={onLegacyImportCommitted} />
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
