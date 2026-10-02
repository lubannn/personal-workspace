"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GitHubContentsAdapter, GitHubDirectoryItem } from "../../../../src/lib/github-data/github-contents";
import { parseJournalEntryRecord } from "../../../../src/lib/github-data/journal-entries";
import { cachedJournalStatistics, journalFileStatistics, parseJournalStatisticsCache, sumJournalStatistics, type JournalFileStatistics } from "../../../../src/lib/github-data/journal-statistics";
import type { Connection, SyncedJournalEntry } from "./page-model";

export function JournalStatistics({ connection, adapter, catalog, loaded, busy }: { connection: Connection | null; adapter: GitHubContentsAdapter | null; catalog: GitHubDirectoryItem[]; loaded: SyncedJournalEntry[]; busy: boolean }) {
  const [cache, setCache] = useState<Record<string, JournalFileStatistics>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  // v1 excluded punctuation and cannot be reused under the new counting rule.
  const storageKey = connection ? `nexus-journal-counts-v2:${connection.ownerId}:${connection.repository}` : null;
  const loadedStatistics = useMemo(() => Object.fromEntries(loaded.flatMap((item) => {
    try { return [[item.path, cachedJournalStatistics(cache, item.path, item.blobSha) ?? journalFileStatistics(item.record, item.blobSha)] as const]; }
    catch { return []; } // An unreadable legacy body must not crash the journal view or produce a guessed total.
  })), [loaded, cache]);
  const loadedStatisticsText = JSON.stringify(loadedStatistics);
  const files = useMemo(() => {
    const expected = new Map(catalog.filter((item) => item.type === "file" && item.name.endsWith(".json")).map((item) => [item.path, item.blobSha]));
    for (const item of loaded) expected.set(item.path, item.blobSha);
    return [...expected].map(([path, blobSha]) => ({ path, blobSha, statistics: loadedStatistics[path] ?? cachedJournalStatistics(cache, path, blobSha) }));
  }, [catalog, loaded, loadedStatistics, cache]);
  const missing = files.filter((item) => !item.statistics);
  const totals = sumJournalStatistics(files.flatMap((item) => item.statistics ? [item.statistics] : []));
  const complete = Boolean(connection) && !busy && missing.length === 0;

  useEffect(() => {
    generation.current += 1;
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted || !storageKey) return;
      try { setCache(parseJournalStatisticsCache(localStorage.getItem(storageKey) ?? "{}")); } catch { /* A missing or corrupt cache is recalculated, never treated as a total. */ }
    });
    return () => { mounted = false; generation.current += 1; };
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || loadedStatisticsText === "{}") return;
    try {
      const stored = parseJournalStatisticsCache(localStorage.getItem(storageKey) ?? "{}");
      localStorage.setItem(storageKey, JSON.stringify({ ...stored, ...parseJournalStatisticsCache(loadedStatisticsText) }));
    } catch { /* Storage is optional; saving diaries never depends on it. */ }
  }, [storageKey, loadedStatisticsText]);

  useEffect(() => {
    if (busy) { generation.current += 1; queueMicrotask(() => setRunning(false)); }
  }, [busy]);

  async function calculate() {
    if (!adapter || !storageKey || running || busy) return;
    const token = ++generation.current;
    setRunning(true); setError("");
    try {
      // Explicit, resumable statistics only. Never part of journal load or save.
      let processed = 0;
      const workingCache = { ...cache, ...loadedStatistics };
      for (const item of missing) {
        if (generation.current !== token) return;
        const stored = await adapter.readText(item.path);
        if (generation.current !== token) return;
        if (stored.blobSha !== item.blobSha) throw new Error("历史日记已变动，请先从 GitHub 刷新后再统计。");
        const statistics = journalFileStatistics(parseJournalEntryRecord(stored.text), stored.blobSha);
        processed += 1;
        const persist = processed % 25 === 0 || processed === missing.length;
        workingCache[item.path] = statistics;
        setCache({ ...workingCache });
        if (persist) { try { localStorage.setItem(storageKey, JSON.stringify(workingCache)); } catch { /* Cache stores counts only, never prose or access tokens. */ } }
      }
    } catch {
      if (generation.current === token) setError("统计未完成，请刷新后继续；已统计的结果会保留。");
    } finally {
      if (generation.current === token) setRunning(false);
    }
  }

  return <div className="journal-statistics">
    <div className="journal-statistics-counts" aria-label="全部日记统计" aria-live="polite">
      <span className="view-button">日记天数 {complete ? totals.days.toLocaleString() : "待统计"}</span>
      <span className="view-button">日记数量 {complete ? totals.entries.toLocaleString() : "待统计"}</span>
      <span className="view-button" title="中文逐字、英文逐词，标点逐个计数；不含空格、换行与 Markdown 格式标记">日记字数 {complete ? totals.words.toLocaleString() : "待统计"}</span>
    </div>
    {missing.length > 0 ? <div className="journal-statistics-progress"><button className="text-button" type="button" disabled={!adapter || busy} onClick={() => { if (running) { generation.current += 1; setRunning(false); if (storageKey) { try { localStorage.setItem(storageKey, JSON.stringify(cache)); } catch { /* Optional count cache. */ } } } else void calculate(); }}>{running ? `暂停统计（${files.length - missing.length}/${files.length}）` : "统计增量"}</button><small>当前有 {missing.length} 个文件待统计；仅读取新增或变动记录。首次使用此规则需统计一次历史正文。</small></div> : null}
    {error ? <small role="alert">{error}</small> : null}
  </div>;
}
