"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Moon } from "lucide-react";
import { healthLocalParts, type WorkoutRecordRow, type SleepRecordRow } from "./health-records";
import { buildSleepCalendarDays, formatSleepTime, sleepMonthCells, SLEEP_GRADES, summarizeSleepDays, type SleepCalendarDay } from "./sleep-calendar";
import { buildWorkoutCalendarDays, healthCalendarMonths } from "./workout-calendar";
import { WorkoutCalendarMonth } from "./workout-calendar-month";
import "./sleep-calendar.css";

function monthLabel(month: string) { return `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月`; }
function dayDescription(day: SleepCalendarDay) {
  const duration = day.asleepSeconds === null ? `记录时段${formatSleepTime(day.recordedPeriodSeconds)}（含清醒）` : `实际睡眠${formatSleepTime(day.asleepSeconds, day.hasIncompleteDuration)}`;
  return `${day.date}，${SLEEP_GRADES[day.grade].label}${day.score === null ? "" : `，${day.score}分`}，${duration}${day.napCount ? `，包含${day.napCount}次小睡` : ""}${day.hasIncompleteDuration ? "，部分分段实睡时长缺失" : ""}${day.hasDateCorrection ? "，小睡日期已修正" : ""}`;
}

export function SleepCalendarSection({ rows, workouts = [], timezone }: { rows: SleepRecordRow[]; workouts?: WorkoutRecordRow[]; timezone: string }) {
  const days = useMemo(() => buildSleepCalendarDays(rows), [rows]);
  const workoutDays = useMemo(() => buildWorkoutCalendarDays(workouts, timezone), [workouts, timezone]);
  const months = useMemo(() => healthCalendarMonths(days, workoutDays), [days, workoutDays]);
  const [requestedMonth, setRequestedMonth] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const month = months.includes(requestedMonth) ? requestedMonth : months.at(-1) ?? "";
  const index = months.indexOf(month);
  const visibleMonths = month ? [month] : [];
  const monthDays = days.filter(day => day.date.startsWith(`${month}-`));
  const monthWorkouts = workoutDays.filter(day => day.date.startsWith(`${month}-`));
  const byDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const summary = summarizeSleepDays(monthDays);
  const selected = selectedDate.slice(0, 7) && visibleMonths.includes(selectedDate.slice(0, 7)) ? byDate.get(selectedDate) : undefined;
  const today = healthLocalParts(new Date().toISOString(), timezone).date;

  return <section className="sleep-calendar" aria-labelledby="sleep-calendar-title">
    <div className="sleep-calendar-heading">
      <h3 id="sleep-calendar-title" className="sr-only">睡眠与运动月历</h3>
      {months.length ? <div className="sleep-calendar-controls"><button className="secondary-button" type="button" aria-label="查看上一个月份" disabled={index < 1} onClick={() => setRequestedMonth(months[Math.max(0, index - 1)])}><ChevronLeft size={16} aria-hidden="true" /></button><label><select aria-label="查看月份" value={month} onChange={(event) => setRequestedMonth(event.target.value)}>{[...months].reverse().map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}</select></label><button className="secondary-button" type="button" aria-label="查看下一个月份" disabled={index === months.length - 1} onClick={() => setRequestedMonth(months[Math.min(months.length - 1, index + 1)])}><ChevronRight size={16} aria-hidden="true" /></button></div> : null}
    </div>
    {months.length ? <>
      <div className="sleep-calendar-months">{visibleMonths.map((value) => {
        const monthDays = days.filter((day) => day.date.startsWith(value));
        const stats = summarizeSleepDays(monthDays);
        return <article className="sleep-calendar-month" key={value} aria-label={`${monthLabel(value)}睡眠月历`}>
          <header><h4><Moon size={17} aria-hidden="true" />睡眠质量月历</h4><span title={`平均值统计 ${stats.completeDays} 个时长完整的日期`}>{stats.count} 天{stats.averageSeconds !== null ? ` · 平均 ${formatSleepTime(stats.averageSeconds)}` : ""}</span></header>
          <p className="sleep-calendar-month-counts">优秀 {stats.grades.excellent} · 良好 {stats.grades.good} · 一般 {stats.grades.fair} · 欠佳 {stats.grades.poor}{stats.grades.unscored ? ` · 未评分 ${stats.grades.unscored}` : ""}</p>
          <div className="sleep-calendar-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="sleep-calendar-grid">{sleepMonthCells(value).map((date, cellIndex) => {
            if (!date) return <span className="sleep-calendar-spacer" key={`empty-${cellIndex}`} aria-hidden="true" />;
            const day = byDate.get(date);
            if (!day) return <div key={date} className={`sleep-calendar-day sleep-grade-empty${date > today ? " sleep-calendar-future" : ""}`} aria-label={`${date}，${date > today ? "尚未到来" : "无记录"}`}><time dateTime={date}>{Number(date.slice(8))}</time><span>{date > today ? "" : "无记录"}</span></div>;
            return <button type="button" key={date} className={`sleep-calendar-day sleep-grade-${day.grade}${date === today ? " sleep-calendar-today" : ""}`} aria-label={dayDescription(day)} aria-pressed={selectedDate === date} title={dayDescription(day)} onClick={() => setSelectedDate(selectedDate === date ? "" : date)}><time dateTime={date}>{Number(date.slice(8))}{day.hasDateCorrection ? <sup aria-hidden="true">*</sup> : null}</time><strong>{SLEEP_GRADES[day.grade].label}</strong><span className="sleep-calendar-duration">{day.asleepSeconds === null ? `${formatSleepTime(day.recordedPeriodSeconds, false, true)}†` : formatSleepTime(day.asleepSeconds, day.hasIncompleteDuration, true)}</span></button>;
          })}</div>
        </article>;
      })}<WorkoutCalendarMonth month={month} days={monthWorkouts} today={today} timezone={timezone} /></div>
      <ul className="sleep-calendar-legend" aria-label="睡眠评分颜色说明">{Object.entries(SLEEP_GRADES).map(([grade, value]) => <li key={grade}><i className={`sleep-grade-${grade}`} aria-hidden="true" /><span>{value.label} {summary.grades[grade as keyof typeof SLEEP_GRADES]} 天{value.range ? <small>{value.range} 分</small> : null}</span></li>)}<li><i className="sleep-grade-empty" aria-hidden="true" /><span>无记录</span></li></ul>

      {selected ? <div className="sleep-calendar-day-summary" role="status"><strong>{selected.date} · {SLEEP_GRADES[selected.grade].label}{selected.score !== null ? ` · ${selected.score} 分` : ""}</strong><span>{selected.asleepSeconds === null ? `记录时段 ${formatSleepTime(selected.recordedPeriodSeconds)}（含清醒）` : `合计 ${formatSleepTime(selected.asleepSeconds, selected.hasIncompleteDuration)}`}{selected.usesCorosDailyTotal ? "（COROS 每日总睡眠）" : ""} · 夜间 {formatSleepTime(selected.mainSeconds)}{selected.napCount ? ` · 小睡 ${formatSleepTime(selected.napSeconds)}（${selected.napCount} 次）` : ""}</span>{selected.asleepSeconds === null ? <small>† COROS 仅提供起止时段，实际睡着时长未提供；此时段不计入实睡平均值。</small> : selected.hasIncompleteDuration ? <small>部分记录未提供实际睡着时长，合计仅包含已知时长。</small> : selected.usesCorosDailyTotal && (selected.mainSeconds === null || (selected.napCount > 0 && selected.napSeconds === null)) ? <small>COROS 已提供每日总时长，部分夜间或小睡分段的实际时长未单独提供。</small> : null}{selected.hasDateCorrection ? <small>* 小睡日期已按所属睡眠日修正，原始时间及修正记录仍保留。</small> : null}</div> : null}
      <details className="sleep-calendar-explanation"><summary>评分与时长说明</summary><p className="sleep-calendar-note">评分按你设置的四档显示：优秀 86–100、良好 75–85、一般 60–74、欠佳 0–59，使用最新已入库评分。时长优先使用 COROS 每日总睡眠（含小睡），否则汇总实睡分段。「≥」表示部分实睡时长；「†」为含清醒的起止时段，不计入平均值。平均值仅统计总时长完整的日期；* 表示含日期修正。</p></details>
    </> : <p className="health-records-empty">尚无已入库的睡眠或运动记录，COROS 同步完成后会显示月历。</p>}
  </section>;
}
