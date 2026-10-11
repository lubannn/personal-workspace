"use client";

import { useState } from "react";
import { buildHabitHeatmap } from "./habit-heatmap";
import type { SyncedHabit, SyncedHabitCheckIn } from "./page-model";
import "./habit-heatmap.css";

const STATUS_LABELS = { completed: "已完成", missed: "未完成", skipped: "已跳过", unknown: "未打卡", none: "未打卡" };
type Props = { connected: boolean; today: string; habits: SyncedHabit[]; checkIns: SyncedHabitCheckIn[]; loading: boolean; error: string; onRefresh: () => void; onOpenHabits: () => void };

export function HabitHeatmapWidget({ connected, today, habits, checkIns, loading, error, onRefresh, onOpenHabits }: Props) {
  const [selectedDate, setSelectedDate] = useState("");
  const heatmap = buildHabitHeatmap(habits.map((item) => item.record), checkIns.map((item) => item.record), today);
  const selected = heatmap?.days.find((day) => day.date === selectedDate) ?? heatmap?.days.find((day) => day.date === today);
  if (!connected) return <p className="widget-empty">连接 Private 数据仓库后显示习惯打卡。</p>;
  if (loading && habits.length === 0) return <p className="widget-empty" role="status">正在读取习惯打卡…</p>;
  if (error) return <div className="habit-heatmap-error" role="alert"><p>习惯打卡未能更新，请重试。</p><button type="button" className="text-button" onClick={onRefresh} disabled={loading}>{loading ? "读取中…" : "重试读取"}</button></div>;
  if (!heatmap) return <p className="widget-empty">正在确认今天的日期…</p>;
  if (heatmap.habits.length === 0) return <div className="habit-heatmap-empty"><p className="widget-empty">还没有进行中的习惯，添加后会显示当月打卡热力图。</p><button type="button" className="text-button" onClick={onOpenHabits}>去添加习惯</button></div>;
  return <div className="habit-heatmap-widget" aria-busy={loading}>
    <div className="habit-heatmap-summary"><time dateTime={heatmap.month}>{Number(heatmap.month.slice(0, 4))}年{Number(heatmap.month.slice(5))}月</time><span>本月完成 <strong>{heatmap.completed}</strong> 次</span></div>
    <div className="habit-heatmap-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="habit-heatmap-days" role="group" aria-label="当月习惯打卡热力图">
      {Array.from({ length: heatmap.offset }, (_, index) => <span aria-hidden="true" key={`blank-${index}`} />)}
      {heatmap.days.map((day) => {
        const label = `${day.date} · ${day.future ? "尚未到来" : day.entries.length ? `${day.completed}/${day.entries.length} 项完成` : "无习惯安排"}`;
        return <button key={day.date} type="button" className="habit-heatmap-day" data-level={day.level} data-today={day.date === today} data-future={day.future} aria-label={label} aria-pressed={day.date === selected?.date} title={label} onClick={() => setSelectedDate(day.date)}>{Number(day.date.slice(-2))}</button>;
      })}
    </div>
    <div className="habit-heatmap-legend"><span>完成比例</span><span>低</span>{[0, 1, 2, 3, 4].map((level) => <i key={level} data-level={level} aria-hidden="true" />)}<span>高</span><span className="habit-heatmap-today">描边为今天</span></div>
    {selected ? <div className="habit-heatmap-detail" aria-live="polite"><strong>{Number(selected.date.slice(5, 7))}月{Number(selected.date.slice(-2))}日{selected.date === today ? " · 今天" : ""}</strong>
      {selected.future ? <p>尚未到来</p> : selected.entries.length ? <ul>{selected.entries.map((entry) => <li key={entry.id}><span>{entry.name}</span><small data-status={entry.status}>{STATUS_LABELS[entry.status]}</small></li>)}</ul> : <p>这天没有习惯安排或打卡记录。</p>}
    </div> : null}
    <div className="habit-heatmap-actions"><button type="button" className="text-button" onClick={onRefresh} disabled={loading}>{loading ? "更新中…" : "刷新打卡"}</button><button type="button" className="text-button" onClick={onOpenHabits}>查看习惯 →</button></div>
  </div>;
}
