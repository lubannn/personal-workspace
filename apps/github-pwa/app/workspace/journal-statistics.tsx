"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GitHubContentsAdapter, GitHubDirectoryItem } from "../../../../src/lib/github-data/github-contents";
import { cachedJournalStatistics, collectJournalStatistics, journalFileStatistics, parseJournalStatisticsCache, type JournalFileStatistics } from "../../../../src/lib/github-data/journal-statistics";
import { journalStatisticsSummaryText, readSharedJournalStatistics, writeSharedJournalStatistics, type SharedJournalStatistics } from "../../../../src/lib/github-data/journal-statistics-sync";
import { journalStatisticsView } from "../../../../src/lib/github-data/journal-statistics-view";
import type { Connection, SyncedJournalEntry } from "./page-model";

type Props = { connection: Connection | null; adapter: GitHubContentsAdapter | null; catalog: GitHubDirectoryItem[]; catalogReady: boolean; loaded: SyncedJournalEntry[]; busy: boolean; children?: (controls: ReactNode, statistics: JournalFileStatistics[], complete: boolean) => ReactNode };
type SharedState = { adapter: GitHubContentsAdapter; value: SharedJournalStatistics | null; error: string };

export function JournalStatistics(props: Props) {
  const { connection } = props;
  return <JournalStatisticsSession key={connection ? `${connection.ownerId}:${connection.repository}` : "disconnected"} {...props} />;
}

function JournalStatisticsSession({ connection, adapter, catalog, catalogReady, loaded, busy, children }: Props) {
  const [cache, setCache] = useState<Record<string, JournalFileStatistics>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const [sharedState, setSharedState] = useState<SharedState | null>(null);
  const shared = sharedState?.adapter === adapter ? sharedState.value : null;
  const shareError = sharedState?.adapter === adapter ? sharedState.error : "";
  const [sharingAdapter, setSharingAdapter] = useState<GitHubContentsAdapter | null>(null);
  const sharing = Boolean(adapter && sharingAdapter === adapter);
  const [sharedRetry, setSharedRetry] = useState(0);
  const sharingRef = useRef<GitHubContentsAdapter | null>(null);
  // v1 excluded punctuation and cannot be reused under the new counting rule.
  const storageKey = connection ? `nexus-journal-counts-v2:${connection.ownerId}:${connection.repository}` : null;
  const loadedStatistics = useMemo(() => Object.fromEntries((connection ? loaded : []).flatMap((item) => {
    try { return [[item.path, cachedJournalStatistics(cache, item.path, item.blobSha) ?? cachedJournalStatistics(shared?.files ?? {}, item.path, item.blobSha) ?? journalFileStatistics(item.record, item.blobSha)] as const]; }
    catch { return []; } // An unreadable legacy body must not crash the journal view or produce a guessed total.
  })), [connection, loaded, cache, shared]);
  const loadedStatisticsText = JSON.stringify(loadedStatistics);
  const { files, missing, phase, statistics, totals } = useMemo(() => journalStatisticsView({ catalog, catalogReady: Boolean(connection) && catalogReady, loaded: loadedStatistics, cache, shared: shared?.files ?? null }), [catalog, catalogReady, connection, loadedStatistics, cache, shared]);
  const complete = phase === "complete";
  const summaryText = useMemo(() => journalStatisticsSummaryText(Object.fromEntries(files.flatMap((item) => item.statistics ? [[item.path, item.statistics]] : []))), [files]);
  const sharedText = useMemo(() => shared ? journalStatisticsSummaryText(shared.files) : null, [shared]);
  const sharedMatches = useMemo(() => catalogReady && Boolean(shared) && files.every((item) => !item.statistics || JSON.stringify(item.statistics) === JSON.stringify(shared?.files[item.path])), [catalogReady, files, shared]);

  useEffect(() => {
    if (!adapter) return;
    let mounted = true;
    void readSharedJournalStatistics(adapter, { refresh: sharedRetry > 0 }).then((value) => {
      if (mounted) setSharedState({ adapter, value, error: "" });
    }).catch(() => {
      if (mounted) setSharedState((current) => ({ adapter, value: current?.adapter === adapter ? current.value : null, error: "共享统计读取失败；重试仅读取摘要，不会重算历史日记。" }));
    });
    return () => { mounted = false; };
  }, [adapter, sharedRetry]);

  useEffect(() => {
    if (!adapter || !catalogReady || !shared || shareError || running || busy || sharingRef.current === adapter || files.length === 0 || summaryText === journalStatisticsSummaryText({}) || summaryText === sharedText) return;
    const summary = JSON.parse(summaryText);
    const next = { ...shared.files, ...parseJournalStatisticsCache(JSON.stringify(summary.files)) };
    if (journalStatisticsSummaryText(next) === sharedText) return;
    const timer = setTimeout(() => {
      sharingRef.current = adapter; setSharingAdapter(adapter);
      // Retain cached records unknown to this browser's catalog. Version checks
      // still decide whether each record is reusable on another device.
      void writeSharedJournalStatistics(adapter, next, shared.blobSha)
        .then((value) => setSharedState((current) => current?.adapter === adapter ? { adapter, value, error: "" } : current))
        .catch(() => setSharedState((current) => current?.adapter === adapter ? { ...current, error: "统计已保留在此浏览器，尚未同步到 GitHub。点“重试同步”会先核对仓库摘要。" } : current))
        .finally(() => {
          if (sharingRef.current === adapter) sharingRef.current = null;
          setSharingAdapter((current) => current === adapter ? null : current);
        });
    }, 1000);
    return () => clearTimeout(timer);
  }, [adapter, catalogReady, shared, sharedText, shareError, running, busy, files.length, summaryText]);

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
    if (!storageKey || !complete) return;
    // Save counts, never private bodies. The next visit can display the full
    // last-known summary before requests finish instead of just three entries.
    try { localStorage.setItem(storageKey, JSON.stringify(JSON.parse(summaryText).files)); } catch { /* Optional display cache. */ }
  }, [storageKey, complete, summaryText]);

  useEffect(() => {
    if (busy || !catalogReady) { generation.current += 1; queueMicrotask(() => setRunning(false)); }
  }, [busy, catalogReady]);

  async function calculate() {
    if (!adapter || !storageKey || !catalogReady || running || busy) return;
    const token = ++generation.current;
    setRunning(true); setError("");
    try {
      const result = await collectJournalStatistics({
        files: missing, cache: { ...shared?.files, ...cache, ...loadedStatistics },
        read: (path, blobSha) => adapter.readBlobText(path, blobSha),
        cancelled: () => generation.current !== token,
        checkpoint: (next) => {
          let merged = next;
          try {
            const stored = parseJournalStatisticsCache(localStorage.getItem(storageKey) ?? "{}");
            merged = { ...stored, ...next };
            // Do not overwrite a newer save if it interrupted this scan.
            if (generation.current !== token) {
              for (const [path, value] of Object.entries(stored)) if (next[path]?.blobSha !== value.blobSha) merged[path] = value;
            }
            localStorage.setItem(storageKey, JSON.stringify(merged));
          } catch { /* Counts remain usable in memory when storage is unavailable. */ }
          setCache(merged);
        },
      });
      if (generation.current === token && result.failures) setError("部分记录读取失败，已完成进度已保留。点“继续统计”只补算剩余记录。");
    } catch {
      if (generation.current === token) setError("统计未完成，请刷新后继续；已统计的结果会保留。");
    } finally {
      if (generation.current === token) setRunning(false);
    }
  }

  const controls = <div className="journal-statistics">
    <div className="journal-statistics-counts" aria-label="全部日记统计" aria-live="polite">
      <span className="view-button">日记天数 {totals ? totals.days.toLocaleString() : "—"}{totals && !complete ? "（已统计）" : ""}</span>
      <span className="view-button">日记数量 {totals ? totals.entries.toLocaleString() : "—"}{totals && !complete ? "（已统计）" : ""}</span>
      <span className="view-button" title="中文逐字、英文逐词，标点逐个计数；不含空格、换行与 Markdown 格式标记">日记字数 {totals ? totals.words.toLocaleString() : "—"}{totals && !complete ? "（已统计）" : ""}</span>
    </div>
    {catalogReady && missing.length > 0 ? <div className="journal-statistics-progress"><button className="text-button" type="button" disabled={!adapter || busy || (!shared && !shareError)} onClick={() => { if (running) { generation.current += 1; setRunning(false); } else void calculate(); }}>{running ? `暂停统计（${files.length - missing.length}/${files.length}）` : !shared && !shareError ? "读取共享统计…" : "继续统计"}</button><small>剩余 {missing.length} 个文件；只补算未完成记录，完成或暂停后同步统计摘要。</small></div> : null}
    <small>{!connection ? "连接后显示日记统计。" : phase === "snapshot" ? "上次已统计，正在核对目录。" : !catalogReady ? shareError ? "等待日记目录；可重试读取统计摘要。" : "正在读取统计摘要与日记目录…" : sharing ? "正在同步统计摘要…" : sharedMatches ? "已统计部分已同步到 GitHub，可跨浏览器复用。" : shared ? "等待同步统计摘要…" : "正在读取 GitHub 统计摘要…"}</small>
    {shareError ? <div className="journal-statistics-progress"><small role="alert">{shareError}</small><button className="text-button" type="button" disabled={sharing || !adapter} onClick={() => setSharedRetry((value) => value + 1)}>重试同步</button></div> : null}
    {error ? <small role="alert">{error}</small> : null}
  </div>;
  return children ? children(controls, statistics, complete) : controls;
}
