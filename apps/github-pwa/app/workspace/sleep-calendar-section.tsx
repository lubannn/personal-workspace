"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Moon } from "lucide-react";
import { healthLocalParts, type WorkoutRecordRow, type SleepRecordRow } from "./health-records";
import { buildSleepCalendarDays, formatMainSleepStart, formatSleepCalendarDuration, formatSleepTime, sleepMonthCells, summarizeSleepDays, type SleepCalendarDay } from "./sleep-calendar";
import type { SyncedHealthMetric } from "./page-model";
import { buildHealthBaseline, buildHealthStatusDays, classifyHealthDay, healthBaselineRange, HEALTH_STATUSES, type HealthDayRating, type HealthStatus } from "./health-status";
import { buildWorkoutCalendarDays, healthCalendarMonths } from "./workout-calendar";
import { WorkoutCalendarMonth } from "./workout-calendar-month";
import "./sleep-calendar.css";

function monthLabel(month: string) { return `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月`; }
function dayDescription(date: string, rating: HealthDayRating, day?: SleepCalendarDay) {
  const duration = !day ? "总睡眠时长缺失" : day.hasConflictingDailyTotals ? "每日总睡眠冲突，无法确认总时长" : day.asleepSeconds === null && day.hasOverlappingEpisodes ? "睡眠分段重叠，无法确认总时长" : day.asleepSeconds === null ? `记录时段${formatSleepTime(day.recordedPeriodSeconds)}（含清醒）` : `总睡眠${formatSleepTime(day.asleepSeconds, day.hasIncompleteDuration)}`;
  return `${date}，${HEALTH_STATUSES[rating.status].label}，${duration}，${formatMainSleepStart(day)}${day?.score === null || day?.score === undefined ? "" : `，COROS 睡眠${day.score}分`}${day?.napCount ? `，包含${day.napCount}次小睡` : ""}${day?.hasIncompleteDuration ? "，部分分段实睡时长缺失" : ""}${day?.hasDateCorrection ? "，小睡日期已修正" : ""}；${rating.reasons.join("；")}${rating.missing.length ? `；缺少${rating.missing.join("、")}` : ""}${rating.recoveryObservedAt ? `；恢复观测于 ${rating.recoveryObservedAt}，不是全天汇总` : ""}${rating.partial ? "；今天尚未结束或部分指标不完整" : ""}`;
}

const NO_HEALTH_METRICS: SyncedHealthMetric[] = [];
export function SleepCalendarSection({ rows, workouts = [], healthMetrics = NO_HEALTH_METRICS, timezone, months: archiveMonths, selectedMonth, onMonthChange, monthReady = true, monthError = false }: { rows: SleepRecordRow[]; workouts?: WorkoutRecordRow[]; healthMetrics?: SyncedHealthMetric[]; timezone: string; months?: string[]; selectedMonth?: string; onMonthChange?: (month: string) => void; monthReady?: boolean; monthError?: boolean }) {
  const days = useMemo(() => buildSleepCalendarDays(rows), [rows]);
  const today = healthLocalParts(new Date().toISOString(), timezone).date;
  const healthToday = healthLocalParts(new Date().toISOString(), "Asia/Shanghai").date;
  const healthDays = useMemo(() => buildHealthStatusDays(days, healthMetrics, healthToday), [days, healthMetrics, healthToday]);
  const workoutDays = useMemo(() => buildWorkoutCalendarDays(workouts, timezone), [workouts, timezone]);
  const rowMonths = useMemo(() => healthCalendarMonths(healthDays, workoutDays), [healthDays, workoutDays]);
  const months = archiveMonths ?? rowMonths;
  const [requestedMonth, setRequestedMonth] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const month = selectedMonth ?? (months.includes(requestedMonth) ? requestedMonth : months.at(-1) ?? "");
  const baselineRange = useMemo(() => healthBaselineRange(month, healthToday), [month, healthToday]);
  const baseline = useMemo(() => buildHealthBaseline(healthDays, baselineRange), [healthDays, baselineRange]);
  const ratings = useMemo(() => new Map(healthDays.filter(day => day.date.startsWith(`${month}-`))
    .map(day => [day.date, classifyHealthDay(day, baseline, healthToday)])), [healthDays, baseline, month, healthToday]);
  const selectMonth = (value: string) => { if (onMonthChange) onMonthChange(value); else setRequestedMonth(value); };
  const index = months.indexOf(month);
  const visibleMonths = month ? [month] : [];
  const monthWorkouts = workoutDays.filter(day => day.date.startsWith(`${month}-`));
  const byDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const counts = Object.fromEntries(Object.keys(HEALTH_STATUSES).map(status => [status, healthDays.filter(day => day.date.startsWith(`${month}-`) && ratings.get(day.date)?.status === status).length])) as Record<HealthStatus, number>;
  const selected = selectedDate.slice(0, 7) && visibleMonths.includes(selectedDate.slice(0, 7)) ? byDate.get(selectedDate) : undefined;
  const selectedRating = selectedDate.startsWith(`${month}-`) ? ratings.get(selectedDate) : undefined;

  return <section className="sleep-calendar" aria-labelledby="sleep-calendar-title">
    <div className="sleep-calendar-heading">
      <h3 id="sleep-calendar-title" className="sr-only">综合健康与运动月历</h3>
      {months.length ? <div className="sleep-calendar-controls"><button className="secondary-button" type="button" aria-label="查看上一个月份" disabled={index < 1} onClick={() => selectMonth(months[Math.max(0, index - 1)])}><ChevronLeft size={16} aria-hidden="true" /></button><label><select aria-label="查看月份" value={month} onChange={(event) => selectMonth(event.target.value)}>{[...months].reverse().map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}</select></label><button className="secondary-button" type="button" aria-label="查看下一个月份" disabled={index === months.length - 1} onClick={() => selectMonth(months[Math.min(months.length - 1, index + 1)])}><ChevronRight size={16} aria-hidden="true" /></button></div> : null}
    </div>
    {months.length && !monthReady ? <p className="health-records-load-message" role="status">{monthLabel(month)}{monthError ? "读取未完成，请重试。" : "记录读取中…"}</p> : months.length ? <>
      <div className="sleep-calendar-months">{visibleMonths.map((value) => {
        const monthDays = days.filter((day) => day.date.startsWith(value));
        const stats = summarizeSleepDays(monthDays);
        return <article className="sleep-calendar-month" key={value} aria-label={`${monthLabel(value)}综合健康月历`}>
          <header><h4><Moon size={17} aria-hidden="true" />综合健康月历</h4><span title={`平均总睡眠统计 ${stats.completeDays} 个时长完整的日期`}>{stats.count} 天睡眠{stats.averageSeconds !== null ? ` · 平均 ${formatSleepTime(stats.averageSeconds)}` : ""}</span></header>
          <p className="sleep-calendar-month-counts">不错 {counts.good} · 平稳 {counts.steady} · 需休息 {counts.rest} · 活动多 {counts.active}{counts.insufficient ? ` · 待补 ${counts.insufficient}` : ""}</p>
          {[...ratings.values()].some(rating => rating.recoveryNotIncluded) ? <p className="sleep-calendar-note">本月 {[...ratings.values()].filter(rating => rating.recoveryNotIncluded).length} 天未纳入恢复数据；各日期详情标明参与判断及仍缺少的指标。</p> : null}
          <div className="sleep-calendar-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="sleep-calendar-grid">{sleepMonthCells(value).map((date, cellIndex) => {
            if (!date) return <span className="sleep-calendar-spacer" key={`empty-${cellIndex}`} aria-hidden="true" />;
            const day = byDate.get(date);
            const rating = ratings.get(date);
            if (!rating) return <div key={date} className={`sleep-calendar-day sleep-grade-empty${date > healthToday ? " sleep-calendar-future" : ""}`} aria-label={`${date}，${date > healthToday ? "尚未到来" : "无记录"}`}><time dateTime={date}>{Number(date.slice(8))}</time><span>{date > healthToday ? "" : "无记录"}</span></div>;
            return <button type="button" key={date} className={`sleep-calendar-day health-status-${rating.status}${date === healthToday ? " sleep-calendar-today" : ""}`} aria-label={dayDescription(date, rating, day)} aria-pressed={selectedDate === date} title={dayDescription(date, rating, day)} onClick={() => setSelectedDate(selectedDate === date ? "" : date)}><time dateTime={date}>{Number(date.slice(8))}{day?.hasDateCorrection ? <sup aria-hidden="true">*</sup> : null}</time><strong>{HEALTH_STATUSES[rating.status].short}</strong><span className="sleep-calendar-onset">{formatMainSleepStart(day, true)}</span><span className="sleep-calendar-duration">{formatSleepCalendarDuration(day)}</span></button>;
          })}</div>
        </article>;
      })}<WorkoutCalendarMonth month={month} days={monthWorkouts} today={today} timezone={timezone} /></div>
      <ul className="sleep-calendar-legend" aria-label="综合健康评级颜色说明">{Object.entries(HEALTH_STATUSES).map(([status, value]) => <li key={status}><i className={`health-status-${status}`} aria-hidden="true" /><span>{value.label} {counts[status as HealthStatus]} 天</span></li>)}<li><i className="sleep-grade-empty" aria-hidden="true" /><span>无记录</span></li></ul>

      {selectedRating ? <div className="sleep-calendar-day-summary" role="status"><strong>{selectedDate} · {HEALTH_STATUSES[selectedRating.status].label}</strong><span>{selectedRating.reasons.join("；")}</span>{selectedRating.missing.length ? <small>未参与判断：{selectedRating.missing.join("、")}。需要正常同步后查看可读取的指标；来源不提供的字段保持缺测。</small> : null}{selectedRating.unavailable.length ? <small>活动支路未判项：{selectedRating.unavailable.join("、")}；不影响其他已有证据的支路。</small> : null}{selectedRating.recoveryObservedAt ? <small>恢复观测时间：{healthLocalParts(selectedRating.recoveryObservedAt, "Asia/Shanghai").date} {healthLocalParts(selectedRating.recoveryObservedAt, "Asia/Shanghai").time}（Asia/Shanghai），表示同步时点，不能代表全天。</small> : null}{selectedRating.partial ? <small>今天尚未结束或部分指标不完整；对应活动量不用于强评级，部分值不计入该指标基线。</small> : null}</div> : null}

      {selected ? <div className="sleep-calendar-day-summary"><span>{formatMainSleepStart(selected)}</span><strong>COROS 睡眠{selected.score !== null ? ` · ${selected.score} 分` : " · 未评分"}</strong><span>{selected.hasConflictingDailyTotals ? "每日总睡眠冲突，无法确认总时长" : selected.asleepSeconds === null && selected.hasOverlappingEpisodes ? "分段重叠，无法确认总时长" : selected.asleepSeconds === null ? `记录时段 ${formatSleepTime(selected.recordedPeriodSeconds)}（含清醒）` : `总睡眠 ${formatSleepTime(selected.asleepSeconds, selected.hasIncompleteDuration)}`}{selected.usesCorosDailyTotal ? "（COROS 每日总睡眠）" : ""} · 夜间 {formatSleepTime(selected.mainSeconds)}{selected.napCount ? ` · 小睡 ${formatSleepTime(selected.napSeconds)}（${selected.napCount} 次）` : ""}</span>{selected.hasConflictingDailyTotals || (selected.asleepSeconds === null && selected.hasOverlappingEpisodes) ? <small>存在冲突记录，总时长不计入实睡平均值。</small> : selected.asleepSeconds === null ? <small>旧归档仅保留起止时段，未记录实睡或每日总睡眠；时段包含清醒，不代表已确认的每日总睡眠，不计入实睡平均值。</small> : selected.hasIncompleteDuration ? <small>部分记录未提供实际睡着时长，合计仅包含已知时长。</small> : selected.usesCorosDailyTotal && (selected.mainSeconds === null || (selected.napCount > 0 && selected.napSeconds === null)) ? <small>COROS 已提供每日总时长，部分夜间或小睡分段的实际时长未单独提供。</small> : null}{selected.hasDateCorrection ? <small>* 小睡日期已按所属睡眠日修正，原始时间及修正记录仍保留。</small> : null}</div> : null}
      <details className="sleep-calendar-explanation"><summary>评级与时长说明</summary><p className="sleep-calendar-note">综合评级按睡眠/恢复、相对活动量、HRV/静息心率的优先级判断，无加权总分。睡眠或恢复低于 70 优先显示需要休息；完整日活动高于个人中位数且达到 p90，或至少两项高于中位数且达到 p80，显示活动较多；随后检查 HRV 偏低与静息心率偏高。状态不错需睡眠至少 90，且 HRV、静息心率符合个人基线；有恢复数据时仍要求恢复至少 90。已结束日期缺少恢复观测时，按其余指标判断，并标明「未纳入恢复数据」，不补算恢复值；其他生理指标与参照门槛不变。个人基线各指标独立统计至少 21 个已结束日期的有效值；来源明确标记的部分值及今天不纳入。缺测不当作正常；生理指标缺测、必要参照样本不足或今天尚未结束时显示待补指标；活动指标独立判断，不要求五项齐全，已知需要休息或高活动证据仍按上述优先级展示。仅供健康自我观察，不作医学诊断。</p><p className="sleep-calendar-note">基线范围：{baselineRange.start} 至 {baselineRange.end}（90 个本地日期）（HRV {baseline.hrvMs.count} 天、静息心率 {baseline.restingBpm.count} 天）。跨月共享此范围；历史月份截止该月末，不采用其后的数据。</p><p className="sleep-calendar-note">日格依次显示综合评级、主睡眠入睡时间、总睡眠；日格只显示入睡时刻，详情和无障碍说明保留实际日期与原始时区。主睡眠以评分对应的主睡眠记录为准，多条主睡眠时优先 COROS 并取最新结束的一条。恢复百分比可能为同步时观测的时点值，不代表全天；历史没有观测记录时不补算。总睡眠优先使用 COROS 每日总睡眠（含小睡），否则汇总实睡分段。「≥」表示部分实睡时长；旧归档缺少实睡时长时，显示「时段…†」，表示已记录起止时段合计（含清醒），不代表已确认的每日总睡眠，不计入平均值；分段重叠或每日总量冲突时总计显示「—」。平均值仅统计总时长完整的日期；* 表示含日期修正。</p></details>
    </> : <p className="health-records-empty">尚无已入库的睡眠或运动记录，COROS 同步完成后会显示月历。</p>}
  </section>;
}
