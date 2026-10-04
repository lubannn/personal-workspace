"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import type { GitHubContentsAdapter } from "../../../../src/lib/github-data/github-contents";
import type { GitHubDirectoryItem } from "../../../../src/lib/github-data/github-contents";
import { journalCatalogDates } from "../../../../src/lib/github-data/journal-archive-catalog";
import { searchJournalDisplaySegments } from "../../../../src/lib/github-data/journal-display";
import { activeJournalEntries, canWriteJournalDate, filterJournalEntries, journalEntrySubmittedTime, journalMonthDays, previousJournalDate, shiftJournalMonth, trashedJournalEntries } from "../../../../src/lib/github-data/journal-entries";
import { JournalStatistics } from "./journal-statistics";
import { JournalAchievements } from "./journal-achievements";
import type { Connection, SyncedJournalEntry } from "./page-model";

type JournalFields = { journalDate: string; bodyMarkdown: string };

type Props = {
  connection: Connection | null;
  adapter: GitHubContentsAdapter | null;
  online: boolean | null;
  todayDate: string;
  journalEntryFiles: SyncedJournalEntry[];
  journalEntryCatalog: GitHubDirectoryItem[];
  catalogReady: boolean;
  loadedMonths: string[];
  loadError: string;
  loading: boolean;
  saving: boolean;
  savingId: string | null;
  onCreate: (fields: JournalFields) => Promise<boolean>;
  onEdit: (item: SyncedJournalEntry, fields: Omit<JournalFields, "journalDate">) => Promise<boolean>;
  onRefresh: (month?: string) => void;
  onBrowseMonth: (month: string) => void;
  onBrowseRecent: () => void;
};

export function JournalSection({ connection, adapter, online, todayDate, journalEntryFiles, journalEntryCatalog, catalogReady, loadedMonths, loadError, loading, saving, savingId, onCreate, onEdit, onRefresh, onBrowseMonth, onBrowseRecent }: Props) {
  const [view] = useState<"active" | "trash">("active");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [journalDate, setJournalDate] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [month, setMonth] = useState("");
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const monthButtonRef = useRef<HTMLButtonElement>(null);
  const [pickerYear, setPickerYear] = useState("");
  const [pickerMonth, setPickerMonth] = useState("");
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
  const hasVisibleMonthEntries = source.some((item) => item.record.data.journal_date.startsWith(`${displayedMonth}-`) && (!selectedDay || item.record.data.journal_date === selectedDay));
  const resultsLoaded = recentView ? source.length > 0 || (!loading && !loadError) : monthLoaded || hasVisibleMonthEntries;
  const visible = useMemo(() => {
    const filtered = filterJournalEntries(records, { view, month: recentView ? undefined : displayedMonth }).filter((record) => !selectedDay || record.data.journal_date === selectedDay);
    const matches = filtered.map((record) => ({ ...byId.get(record.id)!, segments: searchJournalDisplaySegments(record.data.body_markdown, searchQuery, journalEntrySubmittedTime(record).slice(0, 5)) })).filter((item) => item.segments.length > 0);
    return recentView && !searchQuery.trim() ? matches.slice(0, 3) : matches;
  }, [byId, displayedMonth, recentView, records, searchQuery, selectedDay, view]);
  const busy = saving || Boolean(savingId);
  const selectedDate = journalDate || todayDate;
  const writable = canWriteJournalDate(selectedDate, todayDate);
  const catalogDates = useMemo(() => journalCatalogDates(journalEntryCatalog), [journalEntryCatalog]);
  const daysWithEntries = useMemo(() => monthLoaded || view === "trash" ? new Set(source.map((item) => item.record.data.journal_date)) : new Set([...catalogDates, ...source.map((item) => item.record.data.journal_date)]), [catalogDates, monthLoaded, source, view]);
  const monthDays = useMemo(() => displayedMonth ? journalMonthDays(displayedMonth) : [], [displayedMonth]);
  const displayedYear = Number(displayedMonth.slice(0, 4));
  const yearOptions = useMemo(() => {
    if (!displayedYear) return [];
    const catalogYears = [...catalogDates].map((date) => Number(date.slice(0, 4))).filter((year) => Number.isInteger(year) && year > 0);
    const first = Math.max(1, Math.min(displayedYear - 20, ...catalogYears));
    const last = Math.min(9999, Math.max(displayedYear + 1, Number(currentMonth.slice(0, 4)) + 1, ...catalogYears));
    return Array.from({ length: last - first + 1 }, (_, index) => String(last - index).padStart(4, "0"));
  }, [catalogDates, currentMonth, displayedYear]);

  function browseMonth(next: string) {
    setMonth(next);
    setSelectedDay(null);
    setMonthPickerOpen(false);
    if (next) onBrowseMonth(next);
  }

  function toggleMonthPicker() {
    if (!monthPickerOpen) {
      setPickerYear(displayedMonth.slice(0, 4));
      setPickerMonth(displayedMonth.slice(5, 7));
    }
    setMonthPickerOpen(!monthPickerOpen);
  }

  function applyMonthSelection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{4}$/.test(pickerYear) || !/^(0[1-9]|1[0-2])$/.test(pickerMonth)) return;
    browseMonth(`${pickerYear}-${pickerMonth}`);
  }

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

  return <JournalStatistics key={connection ? `${connection.ownerId}:${connection.repository}` : "disconnected"} connection={connection} adapter={adapter} catalog={journalEntryCatalog} catalogReady={catalogReady} loaded={journalEntryFiles} busy={loading || busy}>{(statisticsControls, statistics, complete) => <section className="journal-card" aria-labelledby="journal-title">
    <div className="card-heading">
      <div><p className="eyebrow">Nexus · Journal</p><h2 id="journal-title">日记</h2></div>
      <div className="journal-view-actions" aria-label="日记视图与同步">
        {statisticsControls}
        <button className="secondary-button" type="button" onClick={() => onRefresh(recentView ? undefined : displayedMonth)} disabled={!connection || loading}>{loading ? "刷新中…" : "从 GitHub 刷新"}</button>
      </div>
    </div>
    {view === "active" ? <form className="journal-form" onSubmit={submit}>
      <div className="journal-form-meta">
        <label>写入日期<select value={selectedDate} onChange={(event) => setJournalDate(event.target.value)} disabled={!connection || busy || Boolean(editingId) || !todayDate}><option value={todayDate}>今天 · {todayDate}</option>{todayDate ? <option value={previousJournalDate(todayDate)}>昨天 · {previousJournalDate(todayDate)}</option> : null}</select></label>
        <div className="journal-form-actions">{editingId ? <button className="secondary-button" type="button" onClick={resetForm} disabled={busy}>取消编辑</button> : null}<button className="primary-button" type="submit" disabled={!connection || !writable || !bodyMarkdown.trim() || busy || online === false}>{busy ? "保存中…" : editingId ? "保存修订" : "保存日记"}</button></div>
      </div>
      <label className="journal-body">Markdown 正文<textarea value={bodyMarkdown} onChange={(event) => setBodyMarkdown(event.target.value)} maxLength={2_000_000} placeholder="今天发生了什么？" disabled={!connection || busy} /></label>
      {!writable && selectedDate ? <p className="journal-form-warning" role="alert">该日期已不能修改，请取消编辑。</p> : null}
    </form> : null}
    <div className="journal-explorer">
      <div className="journal-results">
        <div className="journal-results-header"><div><p className="eyebrow">Journal archive</p><h3>{recentView ? "最近日记" : selectedDay ? `${selectedDay} 的日记` : `${displayedMonth.replace("-", "年")}月的日记`}</h3></div><div className="journal-results-tools"><span className="journal-result-count" aria-live="polite">{visible.length} 篇</span><label className="journal-browser-search"><input type="search" aria-label={recentView ? "搜索已加载日记" : selectedDay ? "搜索当天日记" : "搜索本月日记"} aria-describedby="journal-search-scope" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} maxLength={200} placeholder="搜索内容" disabled={!connection} /><span id="journal-search-scope">{recentView ? "搜索已加载日记" : selectedDay ? "搜索当天日记" : "搜索本月日记"}</span></label></div></div>
        {loadError && resultsLoaded ? <p className="empty-note" role="alert">读取未完成，已保留读取到的日记：{loadError}</p> : null}
        {!recentView && !monthLoaded && resultsLoaded && !loadError ? <p className="journal-load-progress" role="status">已显示读取到的日记，正在补全该月…</p> : null}
        {!connection ? <p className="empty-note">连接后显示 Private 仓库中的日记。</p> : loadError && !resultsLoaded ? <p className="empty-note" role="alert">日记读取失败：{loadError}。请重试。</p> : !resultsLoaded ? <p className="empty-note">{recentView ? "正在读取最近日记…" : loading ? "正在读取该月日记…" : "正在准备该月日记…"}</p> : source.length === 0 ? <p className="empty-note">{view === "active" ? "还没有日记。" : "日记回收站是空的。"}</p> : visible.length === 0 ? <p className="empty-note">{!recentView && !monthLoaded && !loadError ? "暂未找到匹配日记，正在继续读取该月…" : "这段时间没有符合条件的日记。"}</p> : <ol className="journal-list">{visible.map((item, itemIndex) => {
      const canManage = canWriteJournalDate(item.record.data.journal_date, todayDate);
      const startsDay = itemIndex === 0 || visible[itemIndex - 1].record.data.journal_date !== item.record.data.journal_date;
      return <li key={item.record.id} className={startsDay ? "journal-day-start" : undefined}>
        {startsDay ? <span className="journal-day-heading">{item.record.data.journal_date}</span> : null}
        <div className="journal-entry-content"><div className="journal-readable-segments">{item.segments.map((segment, index) => <div className={`journal-readable-segment${segment.time ? "" : " untimed"}`} key={`${item.record.id}-${index}`}>{segment.time ? <time>{segment.time}</time> : null}<p>{segment.body}</p></div>)}</div></div>
        {canManage && view === "active" ? <div className="journal-item-actions"><button className="text-button" type="button" onClick={() => beginEdit(item)} disabled={busy}>编辑</button></div> : null}
      </li>;
    })}</ol>}
      </div>
      <aside className="journal-calendar" aria-label="日记月历">
        <div className="journal-calendar-heading"><button type="button" aria-label="上一个月" onClick={() => browseMonth(shiftJournalMonth(displayedMonth, -1))} disabled={!connection || !displayedMonth}>‹</button><button ref={monthButtonRef} type="button" className="journal-calendar-month" onClick={toggleMonthPicker} aria-label={`选择年份和月份，查看 ${displayedMonth} 全部日记`} aria-expanded={monthPickerOpen} aria-controls="journal-month-picker" disabled={!connection || !displayedMonth}>{displayedMonth.replace("-", "年")}月 <span aria-hidden="true">⌄</span></button><button type="button" aria-label="下一个月" onClick={() => browseMonth(shiftJournalMonth(displayedMonth, 1))} disabled={!connection || !displayedMonth}>›</button></div>
        {monthPickerOpen ? <form className="journal-calendar-picker" id="journal-month-picker" onSubmit={applyMonthSelection} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setMonthPickerOpen(false); monthButtonRef.current?.focus(); } }} aria-label="跳转到年份和月份"><label>年份<select aria-label="选择年份" value={pickerYear} onChange={(event) => setPickerYear(event.target.value)}>{yearOptions.map((year) => <option key={year} value={year}>{year} 年</option>)}</select></label><label>月份<select aria-label="选择月份" value={pickerMonth} onChange={(event) => setPickerMonth(event.target.value)}>{Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0")).map((value) => <option key={value} value={value}>{Number(value)} 月</option>)}</select></label><button className="secondary-button" type="submit">查看整月</button></form> : null}
        <div className="journal-calendar-shortcuts"><button type="button" className="text-button" onClick={() => browseMonth(currentMonth)} disabled={!connection || !currentMonth || (displayedMonth === currentMonth && !selectedDay)}>本月</button><button type="button" className="text-button" onClick={() => { setMonth(""); setSelectedDay(null); setSearchQuery(""); setMonthPickerOpen(false); onBrowseRecent(); }} disabled={!connection}>最近日记</button></div>
        <div className="journal-calendar-grid" role="group" aria-label={`${displayedMonth} 日期`}>{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span className="journal-calendar-weekday" key={day}>{day}</span>)}{monthDays.map((date, index) => date ? <button key={date} type="button" className={["journal-calendar-day", daysWithEntries.has(date) ? "has-entry" : "", date === selectedDay ? "selected" : "", date === todayDate ? "today" : ""].filter(Boolean).join(" ")} aria-label={`${date}${daysWithEntries.has(date) ? "，有日记" : "，无日记"}`} aria-pressed={date === selectedDay} onClick={() => { browseMonth(displayedMonth); setSelectedDay(date); }} disabled={!connection}>{Number(date.slice(-2))}</button> : <span key={`blank-${index}`} aria-hidden="true" />)}</div>
      </aside>
    </div>
    <JournalAchievements statistics={statistics} complete={complete} todayDate={todayDate} connected={Boolean(connection)} />
  </section>}</JournalStatistics>;
}
