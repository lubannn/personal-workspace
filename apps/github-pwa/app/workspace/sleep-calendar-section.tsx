"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Moon } from "lucide-react";
import { healthLocalParts, type SleepRecordRow } from "./health-records";
import { buildSleepCalendarDays, formatSleepTime, sleepCalendarMonths, sleepMonthCells, SLEEP_GRADES, summarizeSleepDays, type SleepCalendarDay } from "./sleep-calendar";
import "./sleep-calendar.css";

function monthLabel(month: string) { return `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月`; }
function dayDescription(day: SleepCalendarDay) {
  return `${day.date}，${SLEEP_GRADES[day.grade].label}${day.score === null ? "" : `，${day.score}分`}，实际睡眠${formatSleepTime(day.asleepSeconds, day.hasIncompleteDuration)}${day.napCount ? `，包含${day.napCount}次小睡` : ""}${day.hasIncompleteDuration ? "，部分时长缺失" : ""}${day.hasDateCorrection ? "，小睡日期已修正" : ""}`;
}

export function SleepCalendarSection({ rows, timezone }: { rows: SleepRecordRow[]; timezone: string }) {
  const days = useMemo(() => buildSleepCalendarDays(rows), [rows]);
  const months = useMemo(() => sleepCalendarMonths(days), [days]);
  const [requestedMonth, setRequestedMonth] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const month = months.includes(requestedMonth) ? requestedMonth : months.at(-1) ?? "";
  const index = months.indexOf(month);
  const visibleMonths = months.slice(Math.max(0, index - 1), index + 1);
  const byDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const summary = useMemo(() => summarizeSleepDays(days), [days]);
  const selected = selectedDate.slice(0, 7) && visibleMonths.includes(selectedDate.slice(0, 7)) ? byDate.get(selectedDate) : undefined;
  const today = healthLocalParts(new Date().toISOString(), timezone).date;

  return <section className="sleep-calendar" aria-labelledby="sleep-calendar-title">
    <div className="sleep-calendar-heading">
      <div><p className="eyebrow">Sleep · Calendar</p><h3 id="sleep-calendar-title"><Moon size={19} aria-hidden="true" />睡眠质量月历</h3><p>按醒来日期汇总夜间睡眠与小睡，每格显示实际睡眠时长（小时:分钟）。</p></div>
      {months.length ? <div className="sleep-calendar-controls"><button className="secondary-button" type="button" aria-label="查看更早的睡眠月份" disabled={index < 1} onClick={() => setRequestedMonth(months[Math.max(0, index - 2)])}><ChevronLeft size={16} aria-hidden="true" /></button><label><span>查看月份</span><select value={month} onChange={(event) => setRequestedMonth(event.target.value)}>{[...months].reverse().map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}</select></label><button className="secondary-button" type="button" aria-label="查看更晚的睡眠月份" disabled={index === months.length - 1} onClick={() => setRequestedMonth(months[Math.min(months.length - 1, index + 2)])}><ChevronRight size={16} aria-hidden="true" /></button></div> : null}
    </div>
    {days.length ? <>
      <p className="sleep-calendar-summary">共 {summary.count} 天 · {days[0].date} 至 {days.at(-1)!.date}{summary.averageSeconds !== null ? <> · 平均睡眠 <strong>{formatSleepTime(summary.averageSeconds)}</strong><span>（{summary.completeDays} 天时长完整）</span></> : null}</p>
      <ul className="sleep-calendar-legend" aria-label="睡眠评分颜色说明">{Object.entries(SLEEP_GRADES).map(([grade, value]) => <li key={grade}><i className={`sleep-grade-${grade}`} aria-hidden="true" /><span>{value.label} {summary.grades[grade as keyof typeof SLEEP_GRADES]} 天{value.range ? <small>{value.range} 分</small> : null}</span></li>)}<li><i className="sleep-grade-empty" aria-hidden="true" /><span>无记录</span></li></ul>
      <div className="sleep-calendar-months">{visibleMonths.map((value) => {
        const monthDays = days.filter((day) => day.date.startsWith(value));
        const stats = summarizeSleepDays(monthDays);
        return <article className="sleep-calendar-month" key={value} aria-label={monthLabel(value)}>
          <header><h4>{monthLabel(value)}</h4><span>{stats.count} 天有记录{stats.averageSeconds !== null ? ` · 平均 ${formatSleepTime(stats.averageSeconds)}` : ""}</span></header>
          <p className="sleep-calendar-month-counts">优秀 {stats.grades.excellent} · 良好 {stats.grades.good} · 欠佳 {stats.grades.poor}{stats.grades.unscored ? ` · 未评分 ${stats.grades.unscored}` : ""}</p>
          <div className="sleep-calendar-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="sleep-calendar-grid">{sleepMonthCells(value).map((date, cellIndex) => {
            if (!date) return <span className="sleep-calendar-spacer" key={`empty-${cellIndex}`} aria-hidden="true" />;
            const day = byDate.get(date);
            if (!day) return <div key={date} className={`sleep-calendar-day sleep-grade-empty${date > today ? " sleep-calendar-future" : ""}`} aria-label={`${date}，${date > today ? "尚未到来" : "无记录"}`}><time dateTime={date}>{Number(date.slice(8))}</time><span>{date > today ? "" : "无记录"}</span></div>;
            return <button type="button" key={date} className={`sleep-calendar-day sleep-grade-${day.grade}${date === today ? " sleep-calendar-today" : ""}`} aria-label={dayDescription(day)} aria-pressed={selectedDate === date} title={dayDescription(day)} onClick={() => setSelectedDate(selectedDate === date ? "" : date)}><time dateTime={date}>{Number(date.slice(8))}{day.hasDateCorrection ? <sup aria-hidden="true">*</sup> : null}</time><strong>{SLEEP_GRADES[day.grade].label}</strong><span className="sleep-calendar-duration">{formatSleepTime(day.asleepSeconds, day.hasIncompleteDuration, true)}</span></button>;
          })}</div>
        </article>;
      })}</div>
      {selected ? <div className="sleep-calendar-day-summary" role="status"><strong>{selected.date} · {SLEEP_GRADES[selected.grade].label}{selected.score !== null ? ` · ${selected.score} 分` : ""}</strong><span>合计 {formatSleepTime(selected.asleepSeconds, selected.hasIncompleteDuration)} · 夜间 {formatSleepTime(selected.mainSeconds)}{selected.napCount ? ` · 小睡 ${formatSleepTime(selected.napSeconds)}（${selected.napCount} 次）` : ""}</span>{selected.hasIncompleteDuration ? <small>部分记录未提供实际睡着时长，合计仅包含已知时长。</small> : null}{selected.hasDateCorrection ? <small>* 小睡日期已按所属睡眠日修正，原始时间及修正记录仍保留。</small> : null}</div> : null}
      <p className="sleep-calendar-note">颜色按 <a href="https://support.coros.com/hc/en-us/articles/51716381180948-Understand-Your-COROS-Sleep-Score" target="_blank" rel="noreferrer">COROS 睡眠评分</a>分档，使用最新已入库评分。时长含小睡，不含清醒时间；「≥」表示部分时长缺失，平均值仅统计时长完整的日期。点击日期可查看简要汇总，* 表示含日期修正。</p>
    </> : <p className="health-records-empty">尚无已入库的睡眠记录，COROS 同步完成后会显示月历。</p>}
  </section>;
}
