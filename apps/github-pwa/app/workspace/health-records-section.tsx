"use client";

import { useMemo, useState } from "react";
import { Activity, Moon, RefreshCw } from "lucide-react";
import type { SyncedHealthStagingRecord, SyncedSleepSession, SyncedWorkout } from "./page-model";
import { buildHealthRecordRows, filterHealthRecords, formatHealthDistance, formatHealthDuration, healthLocalParts, healthRangeError, paginateHealthRecords, safeHealthTimezone, summarizeHealthRecords } from "./health-records";
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
  const [range, setRange] = useState({ from: "", to: "" });
  const [sleepPage, setSleepPage] = useState(1);
  const [workoutPage, setWorkoutPage] = useState(1);
  const displayTimezone = safeHealthTimezone(timezone);
  const { sleepRows, workoutRows } = useMemo(() => buildHealthRecordRows(sleepSessions, workouts, staging), [sleepSessions, workouts, staging]);
  const sleepSummary = useMemo(() => summarizeHealthRecords(sleepRows, displayTimezone), [sleepRows, displayTimezone]);
  const workoutSummary = useMemo(() => summarizeHealthRecords(workoutRows, displayTimezone), [workoutRows, displayTimezone]);
  const corosSummary = useMemo(() => summarizeHealthRecords(workoutRows.filter((row) => row.source.kind === "coros_file"), displayTimezone), [workoutRows, displayTimezone]);
  const filteredSleep = useMemo(() => filterHealthRecords(sleepRows, range, displayTimezone), [sleepRows, range, displayTimezone]);
  const filteredWorkouts = useMemo(() => filterHealthRecords(workoutRows, range, displayTimezone), [workoutRows, range, displayTimezone]);
  const sleep = paginateHealthRecords(filteredSleep, sleepPage);
  const workout = paginateHealthRecords(filteredWorkouts, workoutPage);
  const rangeError = healthRangeError(range);
  const hasRange = Boolean(range.from || range.to);
  const canShowRecords = connected && loaded;

  function changeRange(next: typeof range) {
    setRange(next); setSleepPage(1); setWorkoutPage(1);
  }

  return <section className="learning-card health-records" aria-labelledby="health-records-title" aria-busy={loading}>
    <div className="card-heading health-records-heading">
      <div><p className="eyebrow">Health · Records</p><h2 id="health-records-title">睡眠与运动</h2><p className="learning-subtitle">查看工作台已入库的记录。以下日期范围不代表 COROS 中的最新数据。</p></div>
      <button className="secondary-button health-records-refresh" type="button" onClick={onRefresh} disabled={!connected || loading}><RefreshCw size={13} aria-hidden="true" />{loading ? "读取中…" : error ? "重试读取" : "刷新已入库记录"}</button>
    </div>
    <div className="health-records-sync-note"><span className="health-records-status-dot" aria-hidden="true" /><p>刷新只读取 GitHub 仓库中已保存的数据，不会拉取 COROS 新记录。当前版本尚未实现 COROS 自动同步；FIT / TCX 文件导入只包含运动，睡眠需单独录入。</p></div>
    {!connected ? <p className="health-records-empty">连接私人数据仓库后，即可查看记录数量、最早日期和完整列表。</p> : <>
      {error ? <p className="health-records-load-message health-records-load-error" role="alert">{loaded ? "本次刷新未完成，以下保留上次成功读取的记录；数量与日期可能不是最新。" : "健康记录读取未完成，暂时无法确认数量与最早日期。"}<span>{error}</span></p> : loading ? <p className="health-records-load-message" role="status">{loaded ? "正在刷新，以下为上次成功读取的记录。" : "正在读取全部健康记录，完成后显示数量与最早日期…"}</p> : !loaded ? <p className="health-records-empty" role="status">健康记录尚未读取，点击「刷新记录」查看。</p> : null}
      {canShowRecords ? <>
        {unverifiedWorkoutCount > 0 ? <p className="health-records-load-message" role="status">另有 {unverifiedWorkoutCount} 条运动记录未通过来源核验，未计入下方数量与日期。当前展示范围不代表全部历史。</p> : null}
        <div className="health-records-summary">
          <article><div className="health-records-summary-label"><Moon size={15} aria-hidden="true" /><span>已确认睡眠</span></div><p className="health-records-count">{sleepSummary.count}<span>段</span></p><RecordRange earliest={sleepSummary.earliest} latest={sleepSummary.latest} /><p className="health-records-summary-note">COROS 睡眠历史尚未同步</p></article>
          <article><div className="health-records-summary-label"><Activity size={15} aria-hidden="true" /><span>已确认运动</span></div><p className="health-records-count">{workoutSummary.count}<span>次</span></p><RecordRange earliest={workoutSummary.earliest} latest={workoutSummary.latest} /><p className="health-records-summary-note">{corosSummary.count > 0 ? <>其中 COROS 文件导入 {corosSummary.count} 次，最早 <time dateTime={corosSummary.earliest ?? undefined}>{corosSummary.earliest}</time></> : "暂无已核验的 COROS 文件运动记录"}</p></article>
        </div>
        <div className="health-records-filter">
          <div><strong>按日期回看</strong><p>按开始日期筛选，包含首尾两日 · {displayTimezone}</p></div>
          <div className="health-records-date-inputs"><label>开始日期<input type="date" value={range.from} onChange={(event) => changeRange({ ...range, from: event.target.value })} aria-invalid={Boolean(rangeError)} aria-describedby={rangeError ? "health-records-range-error" : undefined} /></label><span aria-hidden="true">—</span><label>结束日期<input type="date" value={range.to} onChange={(event) => changeRange({ ...range, to: event.target.value })} aria-invalid={Boolean(rangeError)} aria-describedby={rangeError ? "health-records-range-error" : undefined} /></label><button type="button" className="text-button" onClick={() => changeRange({ from: "", to: "" })} disabled={!hasRange}>全部日期</button></div>
        </div>
        {rangeError ? <p id="health-records-range-error" className="health-records-load-message health-records-load-error" role="alert">{rangeError}</p> : <>
          <p className="health-records-date-note">上方数量与最早 / 最近日期始终统计全部已读取的确认记录（{displayTimezone}）。下方按开始时间从新到旧排列，时间使用每条记录的时区。</p>
          <div className="health-records-panels">
            <section className="health-records-panel health-records-sleep" aria-labelledby="health-records-sleep-title">
              <header><h3 id="health-records-sleep-title"><Moon size={16} aria-hidden="true" />睡眠记录</h3><span>{hasRange ? "筛选结果" : "全部"} {sleep.count} 段</span></header>
              {sleep.count === 0 ? <div className="health-records-panel-empty"><Moon size={24} aria-hidden="true" /><strong>{hasRange ? "这段时间暂无睡眠记录" : "尚无已确认的睡眠记录"}</strong><p>{hasRange ? "调整日期范围，或查看全部日期。" : "COROS 睡眠历史尚未同步。你可以在下方录入睡眠时间，确认后会显示在这里。"}</p></div> : <ol className="health-records-sleep-list">{sleep.rows.map((row) => {
                const start = healthLocalParts(row.startAt, row.timezone); const end = healthLocalParts(row.endAt, row.timezone);
                return <li key={row.id}><div className="health-records-sleep-top"><strong>{row.category}</strong><span>{formatHealthDuration(row.durationSeconds)}</span></div><dl><div><dt>开始</dt><dd><time dateTime={row.startAt}>{start.date} {start.time}</time></dd></div><div><dt>结束</dt><dd><time dateTime={row.endAt}>{end.date} {end.time}</time></dd></div></dl><small>{safeHealthTimezone(row.timezone)} · {row.source.label}</small></li>;
              })}</ol>}
              <RecordPagination label="睡眠记录" page={sleep.page} pages={sleep.pages} count={sleep.count} onChange={setSleepPage} />
            </section>
            <section className="health-records-panel health-records-workouts" aria-labelledby="health-records-workouts-title">
              <header><h3 id="health-records-workouts-title"><Activity size={16} aria-hidden="true" />运动记录</h3><span>{hasRange ? "筛选结果" : "全部"} {workout.count} 次</span></header>
              {workout.count === 0 ? <div className="health-records-panel-empty"><Activity size={24} aria-hidden="true" /><strong>{hasRange ? "这段时间暂无运动记录" : "尚无已确认的运动记录"}</strong><p>{hasRange ? "调整日期范围，或查看全部日期。" : "导入 COROS FIT / TCX 文件并确认后，运动记录会显示在这里。"}</p></div> : <div className="health-records-table-scroll" role="region" aria-label="运动记录明细，可横向滚动" tabIndex={0}><table><thead><tr><th scope="col">开始时间 / 时区</th><th scope="col">运动</th><th scope="col">时长</th><th scope="col">距离</th><th scope="col">来源</th></tr></thead><tbody>{workout.rows.map((row) => {
                const start = healthLocalParts(row.startAt, row.timezone);
                return <tr key={row.id}><td><time dateTime={row.startAt}>{start.date}<span>{start.time} · {safeHealthTimezone(row.timezone)}</span></time></td><td>{row.activity}</td><td>{formatHealthDuration(row.durationSeconds)}</td><td className={row.distanceMetres === null ? "health-records-missing" : undefined}>{formatHealthDistance(row.distanceMetres)}</td><td><span className="health-records-source">{row.source.label}</span></td></tr>;
              })}</tbody></table></div>}
              <RecordPagination label="运动记录" page={workout.page} pages={workout.pages} count={workout.count} onChange={setWorkoutPage} />
            </section>
          </div>
        </>}
      </> : null}
    </>}
  </section>;
}

function RecordRange({ earliest, latest }: { earliest: string | null; latest: string | null }) {
  return <dl className="health-records-range"><div><dt>最早记录</dt><dd>{earliest ? <time dateTime={earliest}>{earliest}</time> : "暂无记录"}</dd></div><div><dt>最近记录</dt><dd>{latest ? <time dateTime={latest}>{latest}</time> : "暂无记录"}</dd></div></dl>;
}

function RecordPagination({ label, page, pages, count, onChange }: { label: string; page: number; pages: number; count: number; onChange: (page: number) => void }) {
  if (count === 0) return null;
  return <nav className="health-records-pagination" aria-label={`${label}分页`}><span>第 {page} / {pages} 页 · 共 {count} 条</span>{pages > 1 ? <div><button className="secondary-button" type="button" disabled={page === 1} onClick={() => onChange(page - 1)} aria-label={`${label}上一页`}>上一页</button><button className="secondary-button" type="button" disabled={page === pages} onClick={() => onChange(page + 1)} aria-label={`${label}下一页`}>下一页</button></div> : null}</nav>;
}
