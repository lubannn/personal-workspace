"use client";

import { useMemo } from "react";
import type { HealthArchiveSnapshot } from "./health-archive-reader";
import { buildHealthRecordRows, formatHealthDuration, formatHealthDistance } from "./health-records";
import { formatSleepTime, SLEEP_GRADES } from "./sleep-calendar";
import { buildTodayExercise } from "./today-exercise";
import "./today-exercise.css";

type Props = {
  connected: boolean; online: boolean | null; today: string; timezone: string;
  snapshot: HealthArchiveSnapshot | null; loadedDate: string; loading: boolean; error: string;
  onRefresh: () => void; onOpenHealth: () => void;
};

export function TodayExerciseWidget({ connected, online, today, timezone, snapshot, loadedDate, loading, error, onRefresh, onOpenHealth }: Props) {
  const summary = useMemo(() => {
    if (!snapshot || !today || loadedDate !== today) return null;
    const rows = buildHealthRecordRows(snapshot.sleepSessions, snapshot.workouts, snapshot.staging);
    return buildTodayExercise(today, timezone, rows.sleepRows, rows.workoutRows);
  }, [snapshot, today, loadedDate, timezone]);
  return <div className="today-exercise-widget">
    {!connected ? <p className="widget-empty">连接私人数据后显示健康记录与当天建议。</p>
      : loading ? <p className="widget-empty" role="status">正在读取近期睡眠与运动…</p>
        : error ? <p className="widget-empty" role="status">读取未完成，暂不生成建议。请重试。</p>
          : !summary ? <p className="widget-empty">{online === false ? "当前离线，请联网后读取健康数据。" : "近期健康数据尚未读取。"}</p>
            : <>
              {online === false ? <p className="exercise-context">离线：显示上次读取的记录。</p> : null}
              <p className="exercise-today-total"><strong>{summary.todayWorkouts.length ? `已记录 ${summary.todayWorkouts.length} 次 · ${formatHealthDuration(summary.todaySeconds)}` : "今天尚未记录运动"}</strong></p>
              {summary.todayWorkouts.length ? <ul className="exercise-today-records">{summary.todayWorkouts.slice(0, 2).map(row => <li key={row.id}><span>{row.activity}</span><small>{formatHealthDuration(row.durationSeconds)}{row.distanceMetres !== null ? ` · ${formatHealthDistance(row.distanceMetres)}` : ""}</small></li>)}</ul> : null}
              {summary.todayWorkouts.length > 2 ? <p className="exercise-context">另有 {summary.todayWorkouts.length - 2} 次，查看健康模块。</p> : null}
              <p className="exercise-context">近 7 天已记录 {summary.recentCount} 次 · {formatHealthDuration(summary.recentSeconds)}</p>
              <p className="exercise-context">{summary.sleep ? `当天睡眠：${summary.sleep.score !== null ? `${summary.sleep.score} 分 · ${SLEEP_GRADES[summary.sleep.grade].label}` : "未评分"}${summary.sleep.asleepSeconds !== null ? ` · ${formatSleepTime(summary.sleep.asleepSeconds, summary.sleep.hasIncompleteDuration)}` : " · 实际时长缺失"}` : "当天睡眠：尚未记录"}</p>
              <div className={`exercise-advice advice-${summary.advice.mode}`}>
                <strong>{summary.advice.title}</strong><p>{summary.advice.suggestion}</p>
                <details><summary>建议依据</summary><p>{summary.advice.reason}</p><p>仅按已记录数据生成日常活动建议；缺少记录不代表未运动，有不适时停止活动。</p><a href="https://www.cdc.gov/physical-activity-basics/adding-adults/" target="_blank" rel="noreferrer">成人活动指南参考</a></details>
              </div>
            </>}
    {connected ? <div className="exercise-widget-actions"><button type="button" onClick={onOpenHealth}>查看健康</button><button type="button" onClick={onRefresh} disabled={loading || online === false}>{loading ? "读取中…" : error ? "重试" : "刷新数据"}</button></div> : null}
  </div>;
}
