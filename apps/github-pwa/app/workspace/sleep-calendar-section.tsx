"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Moon } from "lucide-react";
import { healthLocalParts, type WorkoutRecordRow, type SleepRecordRow } from "./health-records";
import { buildSleepCalendarDays, formatMainSleepStart, formatSleepCalendarDuration, formatSleepBreakdown, formatSleepTime, sleepMonthCells, summarizeSleepDays, type SleepCalendarDay } from "./sleep-calendar";
import type { SyncedHealthMetric } from "./page-model";
import { buildHealthBaseline, buildHealthStatusDays, classifyHealthDay, healthBaselineRange, HEALTH_STATUSES, type HealthDayRating, type HealthStatus } from "./health-status";
import { buildWorkoutCalendarDays, healthCalendarMonths } from "./workout-calendar";
import { WorkoutCalendarMonth } from "./workout-calendar-month";
import "./sleep-calendar.css";

function monthLabel(month: string) { return `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月`; }
function dayDescription(date: string, rating: HealthDayRating, day?: SleepCalendarDay) {
  const duration = !day ? "总睡眠时长缺失" : day.hasConflictingDailyTotals ? "每日总睡眠冲突，无法确认总时长" : day.asleepSeconds === null && day.hasOverlappingEpisodes ? "睡眠分段重叠，无法确认总时长" : day.asleepSeconds === null ? `记录时段${formatSleepTime(day.recordedPeriodSeconds)}（含清醒）` : `总睡眠${formatSleepTime(day.asleepSeconds, day.hasIncompleteDuration)}`;
  return `${date}，${HEALTH_STATUSES[rating.status].label}${rating.provisional ? "（暂定）" : ""}，${duration}，${formatMainSleepStart(day)}${day?.score === null || day?.score === undefined ? "" : `，COROS 睡眠${day.score}分`}${day?.napCount ? `，包含${day.napCount}次小睡` : ""}${day?.hasIncompleteDuration ? "，部分分段实睡时长缺失" : ""}${day?.hasDateCorrection ? "，小睡日期已修正" : ""}；${day ? `${formatSleepBreakdown(day, "main")}${day.napCount ? `；${formatSleepBreakdown(day, "nap")}` : ""}` : ""}；${rating.reasons.join("；")}${rating.missing.length ? `；未参与判断：${rating.missing.join("、")}` : ""}${rating.recoveryObservedAt ? `；恢复观测于 ${rating.recoveryObservedAt}，不是全天汇总` : ""}${rating.provisional ? "；当天数据仍会更新" : rating.partial ? "；部分来源指标不完整，已跳过" : ""}`;
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
          <header><h4><Moon size={17} aria-hidden="true" />综合健康月历</h4><span title={stats.averageSeconds !== null ? `平均总睡眠统计 ${stats.completeDays} 个时长完整的日期；缺测不按零计入` : stats.averageRecordedPeriodSeconds !== null ? `平均记录时段统计 ${stats.recordedPeriodDays} 个无重叠的日期，包含清醒，不是实睡平均值` : "没有可用于计算平均值的有效睡眠时长或记录时段"}>{stats.count} 天睡眠{stats.averageSeconds !== null ? ` · 平均 ${formatSleepTime(stats.averageSeconds)}` : stats.averageRecordedPeriodSeconds !== null ? ` · 平均时段 ${formatSleepTime(stats.averageRecordedPeriodSeconds)}†` : " · 平均—"}</span></header>
          <p className="sleep-calendar-month-counts">不错 {counts.good} · 平稳 {counts.steady} · 需休息 {counts.rest} · 活动多 {counts.active}{counts.insufficient ? ` · 待补 ${counts.insufficient}` : ""}{counts.empty ? ` · 无数据 ${counts.empty}` : ""}</p>
          {[...ratings.values()].some(rating => rating.limited) ? <p className="sleep-calendar-note">缺测项已跳过，按已有有效指标评级；点选日期查看依据。</p> : null}
          <div className="sleep-calendar-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="sleep-calendar-grid">{sleepMonthCells(value).map((date, cellIndex) => {
            if (!date) return <span className="sleep-calendar-spacer" key={`empty-${cellIndex}`} aria-hidden="true" />;
            const day = byDate.get(date);
            const rating = ratings.get(date);
            if (!rating) return <div key={date} className={`sleep-calendar-day sleep-grade-empty${date > healthToday ? " sleep-calendar-future" : ""}`} aria-label={`${date}，${date > healthToday ? "尚未到来" : "无记录"}`}><time dateTime={date}>{Number(date.slice(8))}</time><span>{date > healthToday ? "" : "无记录"}</span></div>;
            return <button type="button" key={date} className={`sleep-calendar-day health-status-${rating.status}${date === healthToday ? " sleep-calendar-today" : ""}`} aria-label={dayDescription(date, rating, day)} aria-pressed={selectedDate === date} title={dayDescription(date, rating, day)} onClick={() => setSelectedDate(selectedDate === date ? "" : date)}><time dateTime={date}>{Number(date.slice(8))}{day?.hasDateCorrection ? <sup aria-hidden="true">*</sup> : null}</time><strong>{HEALTH_STATUSES[rating.status].short}{rating.provisional ? "·暂定" : ""}</strong><span className="sleep-calendar-onset">{formatMainSleepStart(day, true)}</span><span className="sleep-calendar-duration">{formatSleepCalendarDuration(day)}</span></button>;
          })}</div>
        </article>;
      })}<WorkoutCalendarMonth month={month} days={monthWorkouts} today={today} timezone={timezone} /></div>
      <ul className="sleep-calendar-legend" aria-label="综合健康评级颜色说明">{Object.entries(HEALTH_STATUSES).map(([status, value]) => <li key={status}><i className={`health-status-${status}`} aria-hidden="true" /><span>{value.label} {counts[status as HealthStatus]} 天</span></li>)}<li><i className="sleep-grade-empty" aria-hidden="true" /><span>无记录</span></li></ul>

      {selectedRating ? <div className="sleep-calendar-day-summary" role="status"><strong>{selectedDate} · {HEALTH_STATUSES[selectedRating.status].label}{selectedRating.provisional ? "（暂定）" : ""}</strong><span>{selectedRating.reasons.join("；")}</span>{selectedRating.used.length ? <small>有效指标：{selectedRating.used.join("、")}。</small> : null}{selectedRating.missing.length ? <small>未参与判断：{selectedRating.missing.join("、")}。{selectedRating.limited ? "缺测或参照不足的项已跳过，评级仅反映已有证据。" : "未提供的数值保持缺测，不补零。"}</small> : null}{selectedRating.unavailable.length ? <small>活动支路未判项：{selectedRating.unavailable.join("、")}；不影响其他已有证据的支路。</small> : null}{selectedRating.recoveryObservedAt ? <small>恢复观测时间：{healthLocalParts(selectedRating.recoveryObservedAt, "Asia/Shanghai").date} {healthLocalParts(selectedRating.recoveryObservedAt, "Asia/Shanghai").time}（Asia/Shanghai），表示同步时点，不能代表全天。</small> : null}{selectedRating.provisional ? <small>今天按当前数据评级，后续同步到新数据会自动重算；当日数据不纳入个人基线。</small> : selectedRating.partial ? <small>来源的部分指标不完整；部分值不参与判断，其余有效指标独立使用。</small> : null}</div> : null}

      {selected ? <div className="sleep-calendar-day-summary"><span>{formatMainSleepStart(selected)}</span><strong>COROS 睡眠{selected.score !== null ? ` · ${selected.score} 分` : " · 未评分"}</strong><span>{selected.hasConflictingDailyTotals ? "每日总睡眠冲突，无法确认总时长" : selected.asleepSeconds === null && selected.hasOverlappingEpisodes ? "分段重叠，无法确认总时长" : selected.asleepSeconds === null ? `记录时段 ${formatSleepTime(selected.recordedPeriodSeconds)}（含清醒）` : `总睡眠 ${formatSleepTime(selected.asleepSeconds, selected.hasIncompleteDuration)}`}{selected.usesCorosDailyTotal ? "（COROS 每日总睡眠）" : ""} · {formatSleepBreakdown(selected, "main")}{selected.napCount ? ` · ${formatSleepBreakdown(selected, "nap")}（${selected.napCount} 次）` : ""}</span>{selected.hasConflictingDailyTotals || (selected.asleepSeconds === null && selected.hasOverlappingEpisodes) ? <small>存在冲突记录，总时长不计入实睡平均值。</small> : selected.asleepSeconds === null ? <small>旧归档仅保留起止时段，未记录实睡或每日总睡眠；时段包含清醒，不代表已确认的每日总睡眠，不计入实睡平均值。</small> : selected.hasIncompleteDuration ? <small>部分记录未提供实际睡着时长，合计仅包含已知时长。</small> : selected.usesCorosDailyTotal && (selected.mainSeconds === null || (selected.napCount > 0 && selected.napSeconds === null)) ? <small>COROS 已提供每日总时长，部分夜间或小睡分段的实际时长未单独提供。</small> : null}{((selected.mainSeconds === null && selected.mainRecordedPeriodSeconds !== null) || (selected.napCount > 0 && selected.napSeconds === null && selected.napRecordedPeriodSeconds !== null)) ? <small>† 夜间或小睡时段为记录起止时间（包含清醒），不是分段实睡时长；每日总睡眠仍使用 COROS 提供的实睡总量，不能把总清醒时间直接分配给某一段。</small> : null}{selected.hasDateCorrection ? <small>* 小睡日期已按所属睡眠日修正，原始时间及修正记录仍保留。</small> : null}</div> : null}
      <details className="sleep-calendar-explanation"><summary>评级与时长说明</summary><p className="sleep-calendar-note">综合评级按睡眠/恢复、相对活动量、HRV/静息心率的优先级判断，无加权总分。总睡眠低于 3 小时且主睡眠入睡时间缺失，或睡眠评分/恢复低于 70，优先显示需要休息。总睡眠完整数值取不到时，按用户规则以 0 小时参与此项判断；原记录仍保持缺测，详情注明缺测触发，不将评级用的 0 当作实测值。已有入睡时间或已确认总睡眠至少 3 小时时不触发此项；完整日活动高于个人中位数且达到 p90，或至少两项高于中位数且达到 p80，显示活动较多；随后检查 HRV 偏低与静息心率偏高。历史日期跳过缺测、部分值及参照不足的项，按其余有效指标判定。状态不错需至少一项可判定的睡眠或生理证据，且所有参与的生理项符合条件：睡眠或恢复至少 90，HRV 达到基线，静息心率不高于中位数 +2。缺少恢复观测时标明「未纳入恢复数据」，不补算恢复值。个人基线各指标独立统计至少 21 个已结束日期的有效值；来源明确标记的部分值及今天不纳入。缺测不当作正常；只有活动指标时，未触发高活动条件显示平稳，并说明不能代表睡眠或生理状态。取不到总睡眠且缺入睡时间时，即使当天尚未结束也按上述用户规则显示需休息；其余没有任何有效指标显示无数据。今天按当前有效数据先给暂定评级，包括已观测的活动累计值；数据更新后自动重算，今天不进入个人基线；活动指标独立判断，不要求五项齐全，已知需要休息或高活动证据仍按上述优先级展示。仅供健康自我观察，不作医学诊断。</p><p className="sleep-calendar-note">基线范围：{baselineRange.start} 至 {baselineRange.end}（90 个本地日期）（HRV {baseline.hrvMs.count} 天、静息心率 {baseline.restingBpm.count} 天）。跨月共享此范围；历史月份截止该月末，不采用其后的数据。</p><p className="sleep-calendar-note">日格依次显示综合评级、主睡眠入睡时间、总睡眠；日格只显示入睡时刻，详情和无障碍说明保留实际日期与原始时区。主睡眠以评分对应的主睡眠记录为准，多条主睡眠时优先 COROS 并取最新结束的一条。恢复百分比可能为同步时观测的时点值，不代表全天；历史没有观测记录时不补算。总睡眠优先使用 COROS 每日总睡眠（含小睡），否则汇总实睡分段。「≥」表示部分实睡时长；旧归档缺少实睡时长时，显示「时段…†」，表示已记录起止时段合计（含清醒），不代表已确认的每日总睡眠，不计入实睡平均值；分段重叠或每日总量冲突时总计显示「—」。实睡平均值仅统计总时长完整的日期；当月没有完整实睡总量时，显示已有无重叠记录时段的平均值「平均时段…†」，包含清醒，不与实睡平均值混算；* 表示含日期修正。</p></details>
    </> : <p className="health-records-empty">尚无已入库的睡眠或运动记录，COROS 同步完成后会显示月历。</p>}
  </section>;
}
