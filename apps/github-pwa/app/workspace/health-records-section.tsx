"use client";

import { useMemo } from "react";
import { Activity, Moon, RefreshCw } from "lucide-react";
import type { ConnectionMethod, SyncedHealthStagingRecord, SyncedSleepSession, SyncedWorkout } from "./page-model";
import { buildHealthRecordRows, safeHealthTimezone, summarizeHealthRecords } from "./health-records";
import { SleepCalendarSection } from "./sleep-calendar-section";
import { CorosRefreshButton } from "./coros-refresh-button";
import "./health-records.css";

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
};

export function HealthRecordsSection({ connected, connectionMethod = null, timezone, loading, loaded, error, unverifiedWorkoutCount, sleepSessions, workouts, staging, onRefresh }: Props) {
  const displayTimezone = safeHealthTimezone(timezone);
  const { sleepRows, workoutRows } = useMemo(() => buildHealthRecordRows(sleepSessions, workouts, staging), [sleepSessions, workouts, staging]);
  const sleepSummary = useMemo(() => summarizeHealthRecords(sleepRows, displayTimezone), [sleepRows, displayTimezone]);
  const workoutSummary = useMemo(() => summarizeHealthRecords(workoutRows, displayTimezone), [workoutRows, displayTimezone]);
  const canShowRecords = connected && loaded;

  return <section className="learning-card health-records" aria-labelledby="health-records-title" aria-busy={loading}>
    <div className="card-heading health-records-heading">
      <div><h2 id="health-records-title">睡眠与运动</h2></div>
      <div className="health-records-toolbar">{canShowRecords ? <>
        <div className="health-records-latest" aria-label="最新入库记录日期">
          <div><Moon size={15} aria-hidden="true" /><span>最新睡眠</span><strong>{sleepSummary.latest ? <time dateTime={sleepSummary.latest}>{sleepSummary.latest}</time> : "暂无记录"}</strong></div>
          <div><Activity size={15} aria-hidden="true" /><span>最新运动</span><strong>{workoutSummary.latest ? <time dateTime={workoutSummary.latest}>{workoutSummary.latest}</time> : "暂无记录"}</strong></div>
        </div>
      </> : null}<div className="health-records-actions"><button className="secondary-button health-records-refresh" type="button" onClick={onRefresh} disabled={!connected || loading}><RefreshCw size={13} aria-hidden="true" />{loading ? "读取中…" : error ? "重试读取" : "刷新已入库记录"}</button><CorosRefreshButton connectionMethod={connectionMethod} disabled={!connected || loading} /></div></div>
    </div>

    {!connected ? <p className="health-records-empty">连接私人数据仓库后，即可查看睡眠和运动月历。</p> : <>
      {error ? <p className="health-records-load-message health-records-load-error" role="alert">{loaded ? "本次刷新未完成，以下保留上次成功读取的记录；数量与日期可能不是最新。" : "健康记录读取未完成，暂时无法确认最新记录日期。"}<span>{error}</span></p> : loading ? <p className="health-records-load-message" role="status">{loaded ? "正在刷新，以下为上次成功读取的记录。" : "正在读取全部健康记录，完成后显示最新记录日期…"}</p> : !loaded ? <p className="health-records-empty" role="status">健康记录尚未读取，点击「刷新记录」查看。</p> : null}
      {canShowRecords ? <>
        {unverifiedWorkoutCount > 0 ? <p className="health-records-load-message" role="status">另有 {unverifiedWorkoutCount} 条运动记录未通过来源核验，未计入下方数量与日期。当前展示范围不代表全部历史。</p> : null}
        <SleepCalendarSection rows={sleepRows} workouts={workoutRows} timezone={displayTimezone} />
      </> : null}
    </>}
  </section>;
}
