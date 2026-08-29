"use client";

import { useMemo, useState, type FormEvent } from "react";

import { calendarEventsForDate, type CalendarEventType } from "../../../../src/lib/github-data/calendar-events";
import { openTasks } from "../../../../src/lib/github-data/tasks";
import type { Connection, SyncedCalendarEvent, SyncedTask } from "./page-model";

export type CalendarEventCreateFields = {
  title: string;
  eventType: CalendarEventType;
  localDate: string;
  startTime: string;
  endTime: string;
  linkedTaskId: string | null;
};

type Props = {
  connection: Connection | null;
  online: boolean | null;
  todayDate: string;
  eventFiles: SyncedCalendarEvent[];
  taskFiles: SyncedTask[];
  loading: boolean;
  saving: boolean;
  onCreate: (fields: CalendarEventCreateFields) => Promise<boolean>;
  onRefresh: () => void;
};

export function CalendarSection({ connection, online, todayDate, eventFiles, taskFiles, loading, saving, onCreate, onRefresh }: Props) {
  const [selectedDate, setSelectedDate] = useState(todayDate);
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<CalendarEventType>("time_block");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [linkedTaskId, setLinkedTaskId] = useState("");
  const events = useMemo(() => calendarEventsForDate(eventFiles.map((item) => item.record), selectedDate), [eventFiles, selectedDate]);
  const openTaskRecords = useMemo(() => openTasks(taskFiles.map((item) => item.record)).filter((record) => record.data.parent_task_id === null), [taskFiles]);
  const taskNames = useMemo(() => new Map(taskFiles.map((item) => [item.record.id, item.record.data.title])), [taskFiles]);
  const invalidRange = startTime >= endTime;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || invalidRange || saving || online === false) return;
    const saved = await onCreate({ title, eventType, localDate: selectedDate, startTime, endTime, linkedTaskId: linkedTaskId || null });
    if (saved) setTitle("");
  }

  return (
    <section className="calendar-card" aria-labelledby="calendar-title">
      <div className="card-heading calendar-heading">
        <div>
          <p className="eyebrow">Phase 2 · Internal Calendar</p>
          <h2 id="calendar-title">日程与时间块</h2>
          <p className="calendar-subtitle">时间块可以引用 Task，但不会改写 Task 的截止日期、状态或耗时事实。</p>
        </div>
        <div className="calendar-header-actions">
          <label>查看日期<input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label>
          <button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || loading || saving}>{loading ? "读取中…" : "从 GitHub 刷新"}</button>
        </div>
      </div>

      <div className="calendar-grid">
        <form className="calendar-create-form" onSubmit={submit}>
          <label className="calendar-title-field">标题<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} placeholder={connection ? "例如：项目验收" : "连接后创建日程"} disabled={!connection || saving} /></label>
          <label>类型<select value={eventType} onChange={(event) => setEventType(event.target.value as CalendarEventType)} disabled={!connection || saving}><option value="time_block">任务时间块</option><option value="event">日程</option></select></label>
          <label>开始<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} disabled={!connection || saving} /></label>
          <label>结束<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} disabled={!connection || saving} /></label>
          <label className="calendar-task-field">关联 Task（可选）
            <select value={linkedTaskId} onChange={(event) => setLinkedTaskId(event.target.value)} disabled={!connection || saving}>
              <option value="">不关联 Task</option>
              {openTaskRecords.map((task) => <option key={task.id} value={task.id}>{task.data.title}</option>)}
            </select>
          </label>
          <div className="calendar-form-actions">
            <small>{invalidRange ? "结束时间必须晚于开始时间。" : `${selectedDate} · ${connection?.timezone ?? "workspace timezone"}`}</small>
            <button className="primary-button" type="submit" disabled={!connection || !title.trim() || invalidRange || saving || online === false}>{saving ? "保存中…" : "创建时间块"}</button>
          </div>
        </form>

        <div className="calendar-day-list">
          <header><strong>{selectedDate === todayDate ? "今天" : selectedDate}</strong><span>{events.length} 项</span></header>
          {!connection ? <p className="empty-note">连接后显示 Private 仓库中的日程。</p>
            : loading && eventFiles.length === 0 ? <p className="empty-note">正在读取日程…</p>
              : events.length === 0 ? <p className="empty-note">这一天还没有日程或时间块。</p>
                : <ol>{events.map((record) => {
                  const linkedTask = record.data.linked_entity_id ? taskNames.get(record.data.linked_entity_id) : null;
                  return <li key={record.id}>
                    <time>{formatEventTime(record.data.start_at, record.data.end_at, record.data.timezone)}</time>
                    <div><strong>{record.data.title}</strong><small>{record.data.event_type === "time_block" ? "时间块" : "日程"}{linkedTask ? ` · Task：${linkedTask}` : ""}</small></div>
                    <code>v{record.version}</code>
                  </li>;
                })}</ol>}
        </div>
      </div>
      <p className="calendar-boundary"><strong>当前边界</strong>：仅支持单日、非重复、带明确起止时间的内部事件；提醒、全天事件、编辑/取消和外部同步尚未开放。</p>
    </section>
  );
}

function formatEventTime(startAt: string, endAt: string, timezone: string) {
  const formatter = new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${formatter.format(new Date(startAt))}–${formatter.format(new Date(endAt))}`;
}
