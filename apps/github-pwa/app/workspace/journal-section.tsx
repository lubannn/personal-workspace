"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { GitHubContentsAdapter } from "../../../../src/lib/github-data/github-contents";
import type { GitHubDirectoryItem } from "../../../../src/lib/github-data/github-contents";
import { journalCatalogDates } from "../../../../src/lib/github-data/journal-archive-catalog";
import { journalDisplaySegments } from "../../../../src/lib/github-data/journal-display";
import { activeJournalEntries, canWriteJournalDate, filterJournalEntries, journalEntryMarkdownFileName, journalEntrySubmittedTime, journalMonthDays, previousJournalDate, renderJournalEntryMarkdown, shiftJournalMonth, trashedJournalEntries } from "../../../../src/lib/github-data/journal-entries";
import { LegacyJournalImportSection } from "./legacy-journal-import-section";
import { LegacyJournalCheckpointHistory } from "./legacy-journal-checkpoint-history";
import type { Connection, SyncedJournalEntry, SyncedJournalImportCheckpoint } from "./page-model";

type JournalFields = { journalDate: string; bodyMarkdown: string };

type Props = {
  connection: Connection | null;
  adapter: GitHubContentsAdapter | null;
  online: boolean | null;
  todayDate: string;
  journalEntryFiles: SyncedJournalEntry[];
  journalEntryCatalog: GitHubDirectoryItem[];
  loadedMonths: string[];
  loadError: string;
  journalImportCheckpointFiles: SyncedJournalImportCheckpoint[];
  loading: boolean;
  loadingLegacyHistory: boolean;
  saving: boolean;
  savingId: string | null;
  onCreate: (fields: JournalFields) => Promise<boolean>;
  onEdit: (item: SyncedJournalEntry, fields: Omit<JournalFields, "journalDate">) => Promise<boolean>;
  onDeletionChange: (item: SyncedJournalEntry, operation: "trash" | "restore") => void;
  onRefresh: (month?: string) => void;
  onBrowseMonth: (month: string) => void;
  onRefreshLegacyHistory: () => Promise<void>;
  onLegacyImportCommitted: (month: string) => Promise<void>;
};

export function JournalSection({ connection, adapter, online, todayDate, journalEntryFiles, journalEntryCatalog, loadedMonths, loadError, journalImportCheckpointFiles, loading, loadingLegacyHistory, saving, savingId, onCreate, onEdit, onDeletionChange, onRefresh, onBrowseMonth, onRefreshLegacyHistory, onLegacyImportCommitted }: Props) {
  const [view, setView] = useState<"active" | "trash">("active");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [journalDate, setJournalDate] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [month, setMonth] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const records = useMemo(() => journalEntryFiles.map((item) => item.record), [journalEntryFiles]);
  const byId = useMemo(() => new Map(journalEntryFiles.map((item) => [item.record.id, item])), [journalEntryFiles]);
  const active = useMemo(() => activeJournalEntries(records).map((record) => byId.get(record.id)!), [byId, records]);
  const trash = useMemo(() => trashedJournalEntries(records).map((record) => byId.get(record.id)!), [byId, records]);
  const source = view === "active" ? active : trash;
  const currentMonth = todayDate.slice(0, 7);
  const displayedMonth = month || currentMonth;
  const recentView = !month && !selectedDay;
  const monthLoaded = loadedMonths.includes(displayedMonth);
  const resultsLoaded = recentView ? source.length > 0 || (!loading && !loadError) : monthLoaded;
  const totalPaths = useMemo(() => new Set([...journalEntryCatalog.map((item) => item.path), ...journalEntryFiles.map((item) => item.path)]), [journalEntryCatalog, journalEntryFiles]);
  const visible = useMemo(() => {
    const filtered = filterJournalEntries(records, { view, month: recentView ? undefined : displayedMonth, query: searchQuery }).filter((record) => !selectedDay || record.data.journal_date === selectedDay);
    return (recentView ? filtered.slice(0, 3) : filtered).map((record) => byId.get(record.id)!);
  }, [byId, displayedMonth, recentView, records, searchQuery, selectedDay, view]);
  const busy = saving || Boolean(savingId);
  const selectedDate = journalDate || todayDate;
  const writable = canWriteJournalDate(selectedDate, todayDate);
  const catalogDates = useMemo(() => journalCatalogDates(journalEntryCatalog), [journalEntryCatalog]);
  const daysWithEntries = useMemo(() => monthLoaded || view === "trash" ? new Set(source.map((item) => item.record.data.journal_date)) : new Set([...catalogDates, ...source.map((item) => item.record.data.journal_date)]), [catalogDates, monthLoaded, source, view]);
  const monthDays = useMemo(() => displayedMonth ? journalMonthDays(displayedMonth) : [], [displayedMonth]);

  function browseMonth(next: string) { setMonth(next); setSelectedDay(null); if (next) onBrowseMonth(next); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!writable || !bodyMarkdown.trim()) return;
    const editing = editingId ? byId.get(editingId) : null;
    const saved = editing
      ? await onEdit(editing, { bodyMarkdown })
      : await onCreate({ journalDate: selectedDate, bodyMarkdown });
    if (saved) resetForm();
  }

  function beginEdit(item: SyncedJournalEntry) {
    if (!canWriteJournalDate(item.record.data.journal_date, todayDate)) return;
    setEditingId(item.record.id);
    setJournalDate(item.record.data.journal_date);
    setBodyMarkdown(item.record.data.body_markdown);
    browseMonth(item.record.data.journal_date.slice(0, 7));
    setSelectedDay(item.record.data.journal_date);
  }

  function resetForm() {
    setEditingId(null); setJournalDate(""); setBodyMarkdown("");
  }

  return <section className="journal-card" aria-labelledby="journal-title">
    <div className="card-heading">
      <div><p className="eyebrow">Nexus · Journal</p><h2 id="journal-title">日记</h2><p className="journal-subtitle">随时回看；仅今天和昨天可以写入或修改。日期按工作台时区计算。</p></div>
      <div className="journal-view-actions" aria-label="日记视图与同步">
        <button className="view-button" type="button" aria-pressed={view === "active"} onClick={() => setView("active")}>日记 {Math.max(0, totalPaths.size - trash.length)}</button>
        <button className="view-button" type="button" aria-pressed={view === "trash"} onClick={() => { setView("trash"); resetForm(); }}>回收站 {trash.length}</button>
        <button className="secondary-button" type="button" onClick={() => onRefresh(recentView ? undefined : displayedMonth)} disabled={!connection || loading}>{loading ? "刷新中…" : "从 GitHub 刷新"}</button>
      </div>
    </div>
    {view === "active" ? <form className="journal-form" onSubmit={submit}>
      <div className="journal-form-meta">
        <label>写入日期<select value={selectedDate} onChange={(event) => setJournalDate(event.target.value)} disabled={!connection || busy || Boolean(editingId) || !todayDate}><option value={todayDate}>今天 · {todayDate}</option>{todayDate ? <option value={previousJournalDate(todayDate)}>昨天 · {previousJournalDate(todayDate)}</option> : null}</select></label>
      </div>
      <label className="journal-body">Markdown 正文<textarea value={bodyMarkdown} onChange={(event) => setBodyMarkdown(event.target.value)} maxLength={2_000_000} placeholder="今天发生了什么？" disabled={!connection || busy} /></label>
      <footer><span>{editingId ? "修订会保留首次提交时间。" : "同一天可以写多篇；每篇自动记录提交时间。"}{!writable && selectedDate ? " 该日期已不能修改，请取消编辑。" : ""}</span><div>{editingId ? <button className="secondary-button" type="button" onClick={resetForm} disabled={busy}>取消编辑</button> : null}<button className="primary-button" type="submit" disabled={!connection || !writable || !bodyMarkdown.trim() || busy || online === false}>{busy ? "保存中…" : editingId ? "保存修订" : "保存日记"}</button></div></footer>
    </form> : null}
    <div className="journal-explorer">
      <div className="journal-results">
        <div className="journal-results-header"><div><p className="eyebrow">Journal archive</p><h3>{recentView ? "最近日记" : selectedDay ? `${selectedDay} 的日记` : `${displayedMonth.replace("-", "年")}月的日记`}</h3></div><span aria-live="polite">{visible.length} 篇</span></div>
        <label className="journal-browser-search"><span>{recentView ? "搜索已加载日记" : "搜索本月日记"}</span><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} maxLength={200} placeholder="搜索正文" disabled={!connection} /></label>
        {loadError && resultsLoaded ? <p className="empty-note" role="alert">刷新失败，已保留上次读取的日记：{loadError}</p> : null}
        {!connection ? <p className="empty-note">连接后显示 Private 仓库中的日记。</p> : loadError && !resultsLoaded ? <p className="empty-note" role="alert">日记读取失败：{loadError}。请重试，不需要重新导入。</p> : !resultsLoaded ? <p className="empty-note">{recentView ? "正在读取最近日记…" : loading ? "正在读取该月日记…" : "正在准备该月日记…"}</p> : source.length === 0 ? <p className="empty-note">{view === "active" ? "还没有日记。" : "日记回收站是空的。"}</p> : visible.length === 0 ? <p className="empty-note">这段时间没有符合条件的日记。</p> : <ol className="journal-list">{visible.map((item) => {
      const canManage = canWriteJournalDate(item.record.data.journal_date, todayDate);
      return <li key={item.record.id}>
        <div><span>{item.record.data.journal_date}{canManage ? ` · ${journalEntrySubmittedTime(item.record)}` : ""}</span><div className="journal-readable-segments">{journalDisplaySegments(item.record.data.body_markdown).map((segment, index) => <div className={`journal-readable-segment${segment.time ? "" : " untimed"}`} key={`${item.record.id}-${index}`}>{segment.time ? <time>{segment.time}</time> : null}<p>{segment.body}</p></div>)}</div></div>
        {canManage ? <div className="journal-item-actions">{view === "active" ? <><button className="text-button" type="button" onClick={() => beginEdit(item)} disabled={busy}>编辑</button><button className="text-button" type="button" onClick={() => downloadMarkdown(item)}>下载 Markdown</button></> : null}<button className="text-button" type="button" onClick={() => onDeletionChange(item, view === "active" ? "trash" : "restore")} disabled={busy || online === false}>{savingId === item.record.id ? "…" : view === "active" ? "移到回收站" : "恢复"}</button></div> : null}
      </li>;
    })}</ol>}
      </div>
      <aside className="journal-calendar" aria-label="日记月历">
        <div className="journal-calendar-heading"><button type="button" aria-label="上一个月" onClick={() => browseMonth(shiftJournalMonth(displayedMonth, -1))} disabled={!connection || loading || !displayedMonth}>‹</button><button type="button" className="journal-calendar-month" onClick={() => browseMonth(displayedMonth)} aria-label={`显示 ${displayedMonth} 全部日记`} aria-pressed={!recentView && !selectedDay} disabled={!connection || loading}>{displayedMonth.replace("-", "年")}月</button><button type="button" aria-label="下一个月" onClick={() => browseMonth(shiftJournalMonth(displayedMonth, 1))} disabled={!connection || loading || !displayedMonth}>›</button></div>
        <div className="journal-calendar-jump"><input type="month" aria-label="选择月份" value={displayedMonth} onChange={(event) => browseMonth(event.target.value)} disabled={!connection || loading} /><button type="button" className="text-button" onClick={() => browseMonth(currentMonth)} disabled={!connection || loading || !currentMonth}>回到本月</button></div>
        <button type="button" className="text-button" onClick={() => { setMonth(""); setSelectedDay(null); setSearchQuery(""); onRefresh(); }} disabled={!connection || loading}>最近日记</button>
        <div className="journal-calendar-grid" role="group" aria-label={`${displayedMonth} 日期`}>{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span className="journal-calendar-weekday" key={day}>{day}</span>)}{monthDays.map((date, index) => date ? <button key={date} type="button" className={["journal-calendar-day", daysWithEntries.has(date) ? "has-entry" : "", date === selectedDay ? "selected" : "", date === todayDate ? "today" : ""].filter(Boolean).join(" ")} aria-label={`${date}${daysWithEntries.has(date) ? "，有日记" : "，无日记"}`} aria-pressed={date === selectedDay} onClick={() => { browseMonth(displayedMonth); setSelectedDay(date); }} disabled={!connection || loading}>{Number(date.slice(-2))}</button> : <span key={`blank-${index}`} aria-hidden="true" />)}</div>
        <p>圈出的日期有日记。点日期看当天，点月份看整月。</p>
      </aside>
    </div>
    <LegacyJournalCheckpointHistory connection={connection} adapter={adapter} checkpoints={journalImportCheckpointFiles} loading={loadingLegacyHistory} online={online} onRefresh={onRefreshLegacyHistory} />
    <LegacyJournalImportSection key={connection ? `${connection.ownerLogin}/${connection.repository}/${connection.timezone}` : "disconnected"} connection={connection} adapter={adapter} online={online} onCommitted={() => onLegacyImportCommitted(displayedMonth)} />
  </section>;
}

function downloadMarkdown(item: SyncedJournalEntry) {
  const blob = new Blob([renderJournalEntryMarkdown(item.record)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = journalEntryMarkdownFileName(item.record); anchor.click();
  URL.revokeObjectURL(url);
}
