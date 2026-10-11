"use client";

import { useState } from "react";
import { buildHabitHeatmap } from "./habit-heatmap";
import type { SyncedHabit, SyncedHabitCheckIn } from "./page-model";
import "./habit-heatmap.css";

const STATUS_LABELS = { completed: "已完成", missed: "未完成", skipped: "已跳过", unknown: "未打卡", none: "未打卡", not_scheduled: "无安排", future: "尚未到来" };
type Props = { connected: boolean; today: string; habits: SyncedHabit[]; checkIns: SyncedHabitCheckIn[]; loading: boolean; error: string; onRefresh: () => void; onOpenHabits: () => void };

function shiftMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export function HabitHeatmapWidget({ connected, today, habits, checkIns, loading, error, onRefresh, onOpenHabits }: Props) {
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selection, setSelection] = useState<{ habitId: string; date: string } | null>(null);
  const heatmap = buildHabitHeatmap(habits.map((item) => item.record), checkIns.map((item) => item.record), today, selectedMonth || today.slice(0, 7));
  const selectedRow = heatmap?.rows.find((row) => row.habit.id === selection?.habitId);
  const selected = selectedRow?.cells.find((cell) => cell.date === selection?.date);
  function browseMonth(month: string) { setSelectedMonth(month); setSelection(null); }
  if (!connected) return <p className="widget-empty">连接 Private 数据仓库后显示习惯打卡。</p>;
  if (loading && habits.length === 0) return <p className="widget-empty" role="status">正在读取习惯打卡…</p>;
  if (error) return <div className="habit-heatmap-error" role="alert"><p>习惯打卡未能更新，请重试。</p><button type="button" className="text-button" onClick={onRefresh} disabled={loading}>{loading ? "读取中…" : "重试读取"}</button></div>;
  if (!heatmap) return <p className="widget-empty">正在确认今天的日期…</p>;
  if (heatmap.habits.length === 0) return <div className="habit-heatmap-empty"><p className="widget-empty">还没有进行中的习惯，添加后会显示当月打卡热力图。</p><button type="button" className="text-button" onClick={onOpenHabits}>去添加习惯</button></div>;
  return <div className="habit-heatmap-widget" aria-busy={loading}>
    <div className="habit-heatmap-summary">
      <div className="habit-matrix-month-nav"><button type="button" aria-label="上个月习惯打卡" onClick={() => browseMonth(shiftMonth(heatmap.month, -1))}>‹</button>
        <time dateTime={heatmap.month}>{Number(heatmap.month.slice(0, 4))}年{Number(heatmap.month.slice(5))}月</time>
        <button type="button" aria-label="下个月习惯打卡" disabled={heatmap.month >= today.slice(0, 7)} onClick={() => browseMonth(shiftMonth(heatmap.month, 1))}>›</button>
        {heatmap.month !== today.slice(0, 7) ? <button type="button" className="habit-matrix-current" onClick={() => browseMonth(today.slice(0, 7))}>本月</button> : null}
      </div><span>完成 <strong>{heatmap.completed}</strong> 次</span>
    </div>
    <div className="habit-matrix-scroll" role="region" aria-label="每行一个习惯，每列一天的月度打卡记录，可左右滚动" tabIndex={0}>
      <table className="habit-matrix-table" style={{ minWidth: 88 + heatmap.days.length * 20 }}>
        <caption className="habit-matrix-sr-only">{heatmap.month}习惯打卡，点击圆点查看状态</caption>
        <thead><tr><th scope="col" className="habit-matrix-name">习惯</th>{heatmap.days.map((day) => <th scope="col" key={day.date} data-today={day.date === today}><time dateTime={day.date} title={day.date}>{Number(day.date.slice(-2))}</time></th>)}</tr></thead>
        <tbody>{heatmap.rows.map((row) => <tr key={row.habit.id}>
          <th scope="row" className="habit-matrix-name"><span title={row.habit.data.name}>{row.habit.data.name}</span><small>{row.completed}次{row.habit.data.status === "paused" ? " · 暂停" : ""}</small></th>
          {row.cells.map((cell) => {
            const label = `${row.habit.data.name} · ${cell.date} · ${STATUS_LABELS[cell.status]}`;
            return <td key={cell.date} data-today={cell.date === today}><button type="button" className="habit-matrix-cell" aria-label={label} aria-pressed={selection?.habitId === row.habit.id && selection.date === cell.date} title={label} onClick={() => setSelection({ habitId: row.habit.id, date: cell.date })}>
              <span className="habit-matrix-dot" data-status={cell.status} aria-hidden="true">{cell.status === "missed" ? "×" : cell.status === "skipped" ? "−" : ""}</span>
            </button></td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    <div className="habit-heatmap-legend">{(["completed", "none", "missed", "skipped"] as const).map((status) => <span key={status}><i className="habit-matrix-dot" data-status={status} aria-hidden="true">{status === "missed" ? "×" : status === "skipped" ? "−" : ""}</i>{STATUS_LABELS[status]}</span>)}<span className="habit-matrix-scroll-hint">左右滑动查看整月</span></div>
    <p className="habit-matrix-selection" aria-live="polite">{selected && selectedRow ? `${selectedRow.habit.data.name} · ${selected.date} · ${STATUS_LABELS[selected.status]}` : "点击圆点查看状态，今日列已标记。"}</p>
    <div className="habit-heatmap-actions"><button type="button" className="text-button" onClick={onRefresh} disabled={loading}>{loading ? "更新中…" : "刷新打卡"}</button><button type="button" className="text-button" onClick={onOpenHabits}>查看习惯 →</button></div>
  </div>;
}
