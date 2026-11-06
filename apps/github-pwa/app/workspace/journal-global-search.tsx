"use client";

import { useDeferredValue, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { GitHubContentsAdapter, GitHubDirectoryItem } from "../../../../src/lib/github-data/github-contents";
import { journalSearchSession } from "../../../../src/lib/github-data/journal-search-session";
import { prepareJournalSearch, searchAllJournals, verifiedJournalSearch } from "../../../../src/lib/github-data/journal-search";
import type { SyncedJournalEntry } from "./page-model";

export function JournalGlobalSearch({ adapter, ownerId, catalog, loaded, query, busy, onDay }: {
  adapter: GitHubContentsAdapter; ownerId: string; catalog: GitHubDirectoryItem[]; loaded: SyncedJournalEntry[]; query: string; busy: boolean; onDay: (date: string) => void;
}) {
  const session = useMemo(() => journalSearchSession(adapter, ownerId), [adapter, ownerId]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const [page, setPage] = useState({ query: "", limit: 30 });
  const deferredQuery = useDeferredValue(query);
  const limit = page.query === deferredQuery ? page.limit : 30;
  useEffect(() => { session.setSources(catalog, loaded); }, [session, catalog, loaded]);
  useEffect(() => { void session.load(); }, [session]);
  useEffect(() => { session.setBusy(busy); }, [session, busy]);
  const coverage = useMemo(() => verifiedJournalSearch(state.index, catalog), [state.index, catalog]);
  const rows = useMemo(() => prepareJournalSearch(coverage.index), [coverage.index]);
  const matches = useMemo(() => searchAllJournals(rows, deferredQuery, limit), [rows, deferredQuery, limit]);
  const complete = state.ready && coverage.missing.length === 0;
  return <section className="journal-global-results" aria-label="全部日记搜索结果" aria-busy={query !== deferredQuery || state.reading}>
    <div className="journal-search-index-status" aria-live="polite"><strong>{state.reading ? "正在读取搜索索引…" : complete ? "全库索引已就绪" : `已索引 ${coverage.total - coverage.missing.length} / ${coverage.total} 个日记文件`}</strong>
      <span>{state.syncing ? "正在同步私有索引…" : "按原始分段搜索；仅显示包含关键词的那条日记。"}</span></div>
    {!complete && state.ready ? <div className="journal-search-build"><p>首次建立需读取历史日记；此后只补读新增或修改的内容。压缩索引保存在你的私有 GitHub 仓库，其他设备可复用。</p><button type="button" className="secondary-button" disabled={busy || state.reading || state.syncing} onClick={() => state.running ? session.pause() : void session.build()}>{state.running ? "暂停建立索引" : coverage.total === coverage.missing.length ? "建立全库搜索索引" : "继续补全索引"}</button></div> : null}
    {state.error ? <p className="empty-note" role="alert">{state.error}</p> : null}
    {state.syncError ? <p className="empty-note" role="alert">{state.syncError}</p> : null}
    <div className="journal-search-summary"><span>{matches.total} 条匹配{complete ? "" : "（当前已索引范围，尚非完整结果）"}</span><button type="button" className="text-button" disabled={state.reading || state.running || state.syncing || busy} onClick={() => void session.load(true)}>重新核对索引</button></div>
    {!query.trim() ? <p className="empty-note">输入关键词，搜索所有年份的日记。</p> : matches.total === 0 ? <p className="empty-note">{complete ? "全部日记中没有匹配记录。" : "当前已索引记录中没有匹配；补全索引后再查看完整结果。"}</p> : <ol className="journal-global-match-list">{matches.rows.map((row) => {
      const token = deferredQuery.trim().split(/\s+/u)[0]?.toLowerCase() ?? "";
      const start = Math.max(0, row.body.toLowerCase().indexOf(token) - 55);
      const excerpt = `${start > 0 ? "…" : ""}${row.body.slice(start, start + 230)}${row.body.length > start + 230 ? "…" : ""}`;
      return <li key={`${row.path}:${row.segmentIndex}`}><header><span>{row.date}{row.time ? ` · ${row.time}` : ""}</span><button type="button" className="text-button" onClick={() => onDay(row.date)}>查看当天</button></header><p>{excerpt}</p></li>;
    })}</ol>}
    {matches.total > matches.rows.length && limit < 1000 ? <button type="button" className="secondary-button" onClick={() => setPage({ query: deferredQuery, limit: Math.min(limit + 30, 1000) })}>显示更多（已显示 {matches.rows.length} / {matches.total}）</button> : null}
  </section>;
}
