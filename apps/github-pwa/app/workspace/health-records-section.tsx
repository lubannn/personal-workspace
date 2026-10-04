"use client";

import { useMemo } from "react";
import { Activity, Moon, RefreshCw } from "lucide-react";
import type { SyncedHealthStagingRecord, SyncedSleepSession, SyncedWorkout } from "./page-model";
import { buildHealthRecordRows, safeHealthTimezone, summarizeHealthRecords } from "./health-records";
import { SleepCalendarSection } from "./sleep-calendar-section";
import "./health-records.css";

type Props = {
  connected: boolean;
  timezone: string;
  loading: boolean;
  loaded: boolean;
  error: string;
  unverifiedWorkoutCount: number;
  sleepSessions: SyncedSleepSession[];
  workouts: SyncedWorkout[];
  staging: SyncedHealthStagingRecord[];
  onRefresh: () => void;
};

export function HealthRecordsSection({ connected, timezone, loading, loaded, error, unverifiedWorkoutCount, sleepSessions, workouts, staging, onRefresh }: Props) {
  const displayTimezone = safeHealthTimezone(timezone);
  const { sleepRows, workoutRows } = useMemo(() => buildHealthRecordRows(sleepSessions, workouts, staging), [sleepSessions, workouts, staging]);
  const sleepSummary = useMemo(() => summarizeHealthRecords(sleepRows, displayTimezone), [sleepRows, displayTimezone]);
  const workoutSummary = useMemo(() => summarizeHealthRecords(workoutRows, displayTimezone), [workoutRows, displayTimezone]);
  const corosSummary = useMemo(() => summarizeHealthRecords(workoutRows.filter((row) => (row.source.kind === "coros_file" || row.source.kind === "coros_mcp")), displayTimezone), [workoutRows, displayTimezone]);
  const canShowRecords = connected && loaded;

  return <section className="learning-card health-records" aria-labelledby="health-records-title" aria-busy={loading}>
    <div className="card-heading health-records-heading">
      <div><p className="eyebrow">Health · Records</p><h2 id="health-records-title">睡眠与运动</h2><p className="learning-subtitle">查看工作台已入库的记录。以下日期范围不代表 COROS 中的最新数据。</p></div>
      <button className="secondary-button health-records-refresh" type="button" onClick={onRefresh} disabled={!connected || loading}><RefreshCw size={13} aria-hidden="true" />{loading ? "读取中…" : error ? "重试读取" : "刷新已入库记录"}</button>
    </div>
    <div className="health-records-sync-note"><span className="health-records-status-dot" aria-hidden="true" /><p>此处展示 COROS 后台同步及已有的历史记录。刷新用于读取最新入库结果；COROS 同步进度和最近成功时间见下方连接状态。</p></div>
    {!connected ? <p className="health-records-empty">连接私人数据仓库后，即可查看睡眠月历、运动记录和历史范围。</p> : <>
      {error ? <p className="health-records-load-message health-records-load-error" role="alert">{loaded ? "本次刷新未完成，以下保留上次成功读取的记录；数量与日期可能不是最新。" : "健康记录读取未完成，暂时无法确认数量与最早日期。"}<span>{error}</span></p> : loading ? <p className="health-records-load-message" role="status">{loaded ? "正在刷新，以下为上次成功读取的记录。" : "正在读取全部健康记录，完成后显示数量与最早日期…"}</p> : !loaded ? <p className="health-records-empty" role="status">健康记录尚未读取，点击「刷新记录」查看。</p> : null}
      {canShowRecords ? <>
        {unverifiedWorkoutCount > 0 ? <p className="health-records-load-message" role="status">另有 {unverifiedWorkoutCount} 条运动记录未通过来源核验，未计入下方数量与日期。当前展示范围不代表全部历史。</p> : null}
        <div className="health-records-summary">
          <article><div className="health-records-summary-label"><Moon size={15} aria-hidden="true" /><span>已入库睡眠</span></div><p className="health-records-count">{sleepSummary.count}<span>段</span></p><RecordRange earliest={sleepSummary.earliest} latest={sleepSummary.latest} /><p className="health-records-summary-note">{sleepRows.some((row) => row.source.kind === "coros_mcp") ? "COROS 睡眠按醒来日期归属，包含夜间睡眠与小睡" : "暂无已入库的 COROS 自动同步睡眠"}</p></article>
          <article><div className="health-records-summary-label"><Activity size={15} aria-hidden="true" /><span>已入库运动</span></div><p className="health-records-count">{workoutSummary.count}<span>次</span></p><RecordRange earliest={workoutSummary.earliest} latest={workoutSummary.latest} /><p className="health-records-summary-note">{corosSummary.count > 0 ? <>其中 COROS 来源 {corosSummary.count} 次，最早 <time dateTime={corosSummary.earliest ?? undefined}>{corosSummary.earliest}</time></> : "暂无已核验的 COROS 运动记录"}</p></article>
        </div>
        <SleepCalendarSection rows={sleepRows} workouts={workoutRows} timezone={displayTimezone} />
      </> : null}
    </>}
  </section>;
}

function RecordRange({ earliest, latest }: { earliest: string | null; latest: string | null }) {
  return <dl className="health-records-range"><div><dt>最早记录</dt><dd>{earliest ? <time dateTime={earliest}>{earliest}</time> : "暂无记录"}</dd></div><div><dt>最近记录</dt><dd>{latest ? <time dateTime={latest}>{latest}</time> : "暂无记录"}</dd></div></dl>;
}
