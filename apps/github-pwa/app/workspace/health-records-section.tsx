"use client";

import { useMemo } from "react";
import { Activity, Moon, RefreshCw } from "lucide-react";
import type { ConnectionMethod, SyncedHealthStagingRecord, SyncedSleepSession, SyncedWorkout } from "./page-model";
import { buildHealthRecordRows, safeHealthTimezone, summarizeHealthRecords } from "./health-records";
import { SleepCalendarSection } from "./sleep-calendar-section";
import { CorosRefreshButton } from "./coros-refresh-button";
import "./health-records.css";

import type { HealthArchiveSnapshot } from "./health-archive-reader";

type Props = {
  connected: boolean;
  connectionMethod?: ConnectionMethod | null;
  timezone: string;
  loading: boolean;
  loaded: boolean;
  error: string;
  unverifiedWorkoutCount: number;
  sleepSessions: SyncedSleepSession[];
  workouts: SyncedWorkout[];
  staging: SyncedHealthStagingRecord[];
  onRefresh: () => void;
  archive?: HealthArchiveSnapshot | null;
  onMonthChange?: (month: string) => void;
};

export function HealthRecordsSection({ connected, connectionMethod = null, timezone, loading, loaded, error, unverifiedWorkoutCount, sleepSessions, workouts, staging, onRefresh, archive, onMonthChange }: Props) {
  const displayTimezone = safeHealthTimezone(timezone);
  const { sleepRows, workoutRows } = useMemo(() => buildHealthRecordRows(sleepSessions, workouts, staging), [sleepSessions, workouts, staging]);
  const sleepSummary = useMemo(() => summarizeHealthRecords(sleepRows, displayTimezone), [sleepRows, displayTimezone]);
  const workoutSummary = useMemo(() => summarizeHealthRecords(workoutRows, displayTimezone), [workoutRows, displayTimezone]);
  const latestSleep = archive ? archive.latestReady ? archive.latestSleep ?? "暂无记录" : error ? "暂未确认" : "核对中…" : sleepSummary.latest ?? "暂无记录";
  const latestWorkout = archive ? archive.latestReady ? archive.latestWorkout ?? "暂无记录" : error ? "暂未确认" : "核对中…" : workoutSummary.latest ?? "暂无记录";
  const monthReady = !archive || archive.loadedMonths.includes(archive.month);
  const canShowRecords = connected && loaded;

  return <section className="learning-card health-records" aria-labelledby="health-records-title" aria-busy={loading}>
    <div className="card-heading health-records-heading">
      <div><h2 id="health-records-title">睡眠与运动</h2></div>
      <div className="health-records-toolbar">{canShowRecords ? <>
        <div className="health-records-latest" aria-label="最新入库记录日期">
          <div><Moon size={15} aria-hidden="true" /><span>最新睡眠</span><strong>{latestSleep}</strong></div>
          <div><Activity size={15} aria-hidden="true" /><span>最新运动</span><strong>{latestWorkout}</strong></div>
        </div>
      </> : null}<div className="health-records-actions"><button className="secondary-button health-records-refresh" type="button" onClick={onRefresh} disabled={!connected || loading}><RefreshCw size={13} aria-hidden="true" />{loading ? "读取中…" : error ? "重试读取" : "刷新已入库记录"}</button><CorosRefreshButton connectionMethod={connectionMethod} disabled={!connected || loading} /></div></div>
    </div>

    {!connected ? <p className="health-records-empty">连接私人数据仓库后，即可查看睡眠和运动月历。</p> : <>
      {error ? <p className="health-records-load-message health-records-load-error" role="alert">{loaded ? "本次刷新未完成，以下保留上次成功读取的记录；数量与日期可能不是最新。" : "健康记录读取未完成，暂时无法确认最新记录日期。"}<span>{error}</span></p> : loading ? <p className="health-records-load-message" role="status">{loaded ? "正在检查记录变化，已读取的月份会保留。" : "正在读取本月记录与最新日期…"}</p> : !loaded ? <p className="health-records-empty" role="status">健康记录尚未读取，点击「刷新记录」查看。</p> : null}
      {canShowRecords ? <>
        {unverifiedWorkoutCount > 0 ? <p className="health-records-load-message" role="status">已读取范围内有 {unverifiedWorkoutCount} 条运动记录未通过来源核验，未计入下方数量与日期。当前展示范围不代表全部历史。</p> : null}
        <SleepCalendarSection rows={sleepRows} workouts={workoutRows} healthMetrics={archive?.healthMetrics} timezone={displayTimezone} months={archive?.months} selectedMonth={archive?.month} onMonthChange={onMonthChange} monthReady={monthReady} monthError={!monthReady && Boolean(error)} />
      </> : null}
    </>}
  </section>;
}
