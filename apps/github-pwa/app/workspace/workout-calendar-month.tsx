"use client";

import { useState } from "react";
import { Activity } from "lucide-react";
import { formatHealthDistance, formatHealthDuration, healthLocalParts } from "./health-records";
import { sleepMonthCells } from "./sleep-calendar";
import { formatWorkoutCalendarTime, type WorkoutCalendarDay } from "./workout-calendar";

function describe(day: WorkoutCalendarDay, timezone: string) {
  return `${day.date}，${day.workouts.length}次运动，合计${formatHealthDuration(day.totalSeconds)}：${day.workouts.map(row => `${row.activity}，${healthLocalParts(row.startAt, timezone).time}开始，${formatHealthDuration(row.durationSeconds)}`).join("；")}`;
}

export function WorkoutCalendarMonth({ month, days, today, timezone }: { month: string; days: WorkoutCalendarDay[]; today: string; timezone: string }) {
  const [selectedDate, setSelectedDate] = useState("");
  const byDate = new Map(days.map(day => [day.date, day]));
  const selected = selectedDate.startsWith(`${month}-`) ? byDate.get(selectedDate) : undefined;
  const count = days.reduce((total, day) => total + day.workouts.length, 0);
  const totalSeconds = days.reduce((total, day) => total + day.totalSeconds, 0);
  const activities = [...new Set(days.flatMap(day => day.workouts.map(row => row.activity)))];
  return <article className="sleep-calendar-month workout-calendar-month" aria-label={`${Number(month.slice(0, 4))}年${Number(month.slice(5))}月运动月历`}>
    <header><h4><Activity size={17} aria-hidden="true" />运动月历</h4><span>{count} 次 · {formatWorkoutCalendarTime(totalSeconds)}</span></header>
    <p className="sleep-calendar-month-counts">{days.length} 天有运动</p>
    <div className="sleep-calendar-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map(day => <span key={day}>{day}</span>)}</div>
    <div className="sleep-calendar-grid">{sleepMonthCells(month).map((date, index) => {
      if (!date) return <span className="sleep-calendar-spacer" key={`empty-${index}`} aria-hidden="true" />;
      const day = byDate.get(date);
      if (!day) return <div key={date} className={`sleep-calendar-day sleep-grade-empty${date > today ? " sleep-calendar-future" : ""}`} aria-label={`${date}，${date > today ? "尚未到来" : "无运动记录"}`}><time dateTime={date}>{Number(date.slice(8))}</time><span>{date > today ? "" : "无记录"}</span></div>;
      return <button type="button" key={date} className={`sleep-calendar-day workout-calendar-day workout-tone-${day.tone}${date === today ? " sleep-calendar-today" : ""}`} aria-label={describe(day, timezone)} title={describe(day, timezone)} aria-pressed={selectedDate === date} onClick={() => setSelectedDate(selectedDate === date ? "" : date)}>
        <time dateTime={date}>{Number(date.slice(8))}</time>
        {day.workouts.slice(0, 2).map(row => <span className="workout-calendar-entry" key={row.id}><strong>{row.activity}</strong><small>{formatWorkoutCalendarTime(row.durationSeconds)}</small></span>)}
        {day.workouts.length > 2 ? <span className="workout-calendar-more">+{day.workouts.length - 2}次</span> : null}
        {day.workouts.length > 1 ? <span className="sleep-calendar-duration">共{formatWorkoutCalendarTime(day.totalSeconds)}</span> : null}
      </button>;
    })}</div>
    {!days.length ? <p className="sleep-calendar-note">本月暂无已入库的运动记录。</p> : <p className="sleep-calendar-note">本月项目：{activities.join("、")}。颜色区分运动类型，紫色表示当天包含多种运动。点击日期查看开始时间。</p>}
    {selected ? <div className="sleep-calendar-day-summary workout-calendar-selection" role="status"><strong>{selected.date} · {selected.workouts.length} 次 · 合计 {formatHealthDuration(selected.totalSeconds)}</strong>
      {selected.workouts.map(row => <span key={row.id} className="workout-calendar-detail"><b>{row.activity}</b><span>{healthLocalParts(row.startAt, timezone).time}开始 · {formatHealthDuration(row.durationSeconds)}{row.distanceMetres !== null ? ` · ${formatHealthDistance(row.distanceMetres)}` : ""}</span></span>)}
    </div> : null}
  </article>;
}
