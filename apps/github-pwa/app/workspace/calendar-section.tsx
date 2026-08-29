"use client";

import { useMemo, useState, type FormEvent } from "react";

import {
  calendarDateRange,
  calendarEventsForRange,
  cancelledCalendarEventsForRange,
  trashedCalendarEventsForRange,
  type CalendarRangeView,
  type CalendarEventType,
} from "../../../../src/lib/github-data/calendar-events";
import { openTasks } from "../../../../src/lib/github-data/tasks";
import type { Connection, SyncedCalendarEvent, SyncedTask } from "./page-model";

export type CalendarEventFields = {
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
  savingEventId: string | null;
  onCreate: (fields: CalendarEventFields) => Promise<boolean>;
  onEdit: (item: SyncedCalendarEvent, fields: CalendarEventFields) => Promise<boolean>;
  onLifecycleChange: (item: SyncedCalendarEvent, operation: "cancel" | "reopen") => void;
  onDeletionChange: (item: SyncedCalendarEvent, operation: "trash" | "restore") => void;
  onRefresh: () => void;
};

export function CalendarSection({ connection, online, todayDate, eventFiles, taskFiles, loading, saving, savingEventId, onCreate, onEdit, onLifecycleChange, onDeletionChange, onRefresh }: Props) {
  const [selectedDate, setSelectedDate] = useState(todayDate);
  const [eventView, setEventView] = useState<"scheduled" | "cancelled" | "trash">("scheduled");
  const [periodView, setPeriodView] = useState<CalendarRangeView>("day");
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<CalendarEventType>("time_block");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [linkedTaskId, setLinkedTaskId] = useState("");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editEventType, setEditEventType] = useState<CalendarEventType>("time_block");
  const [editDate, setEditDate] = useState(selectedDate);
  const [editStartTime, setEditStartTime] = useState("09:00");
  const [editEndTime, setEditEndTime] = useState("10:00");
  const [editLinkedTaskId, setEditLinkedTaskId] = useState("");
  const dateRange = useMemo(() => calendarDateRange(selectedDate, periodView), [selectedDate, periodView]);
  const events = useMemo(() => {
    const records = eventFiles.map((item) => item.record);
    if (eventView === "cancelled") return cancelledCalendarEventsForRange(records, dateRange.startDate, dateRange.endDate);
    if (eventView === "trash") return trashedCalendarEventsForRange(records, dateRange.startDate, dateRange.endDate);
    return calendarEventsForRange(records, dateRange.startDate, dateRange.endDate);
  }, [dateRange, eventFiles, eventView]);
  const eventItems = useMemo(() => new Map(eventFiles.map((item) => [item.record.id, item])), [eventFiles]);
  const openTaskRecords = useMemo(() => openTasks(taskFiles.map((item) => item.record)).filter((record) => record.data.parent_task_id === null), [taskFiles]);
  const linkableTaskRecords = useMemo(() => taskFiles.map((item) => item.record).filter((record) => record.deleted_at === null), [taskFiles]);
  const taskNames = useMemo(() => new Map(taskFiles.map((item) => [item.record.id, item.record.data.title])), [taskFiles]);
  const invalidRange = startTime >= endTime;
  const invalidEditRange = editStartTime >= editEndTime;
  const operationBusy = saving || savingEventId !== null;
  const calendarBusy = operationBusy || editingEventId !== null;
  const periodLabel = periodView === "day"
    ? selectedDate === todayDate ? "今天" : selectedDate
    : periodView === "week" ? "周视图" : `${selectedDate.slice(0, 7)} 月视图`;
  const viewTitle = eventView === "cancelled" ? `已取消 · ${periodLabel}` : eventView === "trash" ? `回收站 · ${periodLabel}` : periodLabel;
  const periodNoun = periodView === "day" ? "这一天" : periodView === "week" ? "这一周" : "这个月";
  const emptyMessage = eventView === "cancelled"
    ? `${periodNoun}没有已取消的日程。`
    : eventView === "trash"
      ? `${periodNoun}的回收站是空的。`
      : `${periodNoun}还没有日程或时间块。`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || invalidRange || operationBusy || online === false) return;
    const saved = await onCreate({ title, eventType, localDate: selectedDate, startTime, endTime, linkedTaskId: linkedTaskId || null });
    if (saved) setTitle("");
  }

  function beginEdit(item: SyncedCalendarEvent) {
    if (calendarBusy || online === false) return;
    setEditingEventId(item.record.id);
    setEditTitle(item.record.data.title);
    setEditEventType(item.record.data.event_type);
    setEditDate(item.record.data.local_start_date);
    setEditStartTime(formatEventInputTime(item.record.data.start_at, item.record.data.timezone));
    setEditEndTime(formatEventInputTime(item.record.data.end_at, item.record.data.timezone));
    setEditLinkedTaskId(item.record.data.linked_entity_id ?? "");
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>, item: SyncedCalendarEvent) {
    event.preventDefault();
    if (!editTitle.trim() || invalidEditRange || operationBusy || online === false) return;
    const saved = await onEdit(item, {
      title: editTitle,
      eventType: editEventType,
      localDate: editDate,
      startTime: editStartTime,
      endTime: editEndTime,
      linkedTaskId: editLinkedTaskId || null,
    });
    if (saved) setEditingEventId(null);
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
          <label>定位日期<input type="date" value={selectedDate} onChange={(event) => { if (event.target.value) setSelectedDate(event.target.value); setEditingEventId(null); }} disabled={calendarBusy} /></label>
          <button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || loading || calendarBusy}>{loading ? "读取中…" : "从 GitHub 刷新"}</button>
        </div>
      </div>

      <div className="calendar-view-toolbar">
        <div className="calendar-view-actions" aria-label="Calendar 状态视图">
          <button className={`view-button ${eventView === "scheduled" ? "active" : ""}`} type="button" aria-pressed={eventView === "scheduled"} onClick={() => { setEventView("scheduled"); setEditingEventId(null); }} disabled={calendarBusy}>已安排</button>
          <button className={`view-button ${eventView === "cancelled" ? "active" : ""}`} type="button" aria-pressed={eventView === "cancelled"} onClick={() => { setEventView("cancelled"); setEditingEventId(null); }} disabled={calendarBusy}>已取消</button>
          <button className={`view-button ${eventView === "trash" ? "active" : ""}`} type="button" aria-pressed={eventView === "trash"} onClick={() => { setEventView("trash"); setEditingEventId(null); }} disabled={calendarBusy}>回收站</button>
        </div>
        <div className="calendar-period-actions" aria-label="Calendar 时间范围">
          <button className={`view-button ${periodView === "day" ? "active" : ""}`} type="button" aria-pressed={periodView === "day"} onClick={() => setPeriodView("day")} disabled={calendarBusy}>日</button>
          <button className={`view-button ${periodView === "week" ? "active" : ""}`} type="button" aria-pressed={periodView === "week"} onClick={() => setPeriodView("week")} disabled={calendarBusy}>周</button>
          <button className={`view-button ${periodView === "month" ? "active" : ""}`} type="button" aria-pressed={periodView === "month"} onClick={() => setPeriodView("month")} disabled={calendarBusy}>月</button>
        </div>
      </div>

      <div className="calendar-grid">
        <form className="calendar-create-form" onSubmit={submit}>
          <label className="calendar-title-field">标题<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} placeholder={connection ? "例如：项目验收" : "连接后创建日程"} disabled={!connection || calendarBusy} /></label>
          <label>类型<select value={eventType} onChange={(event) => setEventType(event.target.value as CalendarEventType)} disabled={!connection || calendarBusy}><option value="time_block">任务时间块</option><option value="event">日程</option></select></label>
          <label>开始<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} disabled={!connection || calendarBusy} /></label>
          <label>结束<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} disabled={!connection || calendarBusy} /></label>
          <label className="calendar-task-field">关联 Task（可选）
            <select value={linkedTaskId} onChange={(event) => setLinkedTaskId(event.target.value)} disabled={!connection || calendarBusy}>
              <option value="">不关联 Task</option>
              {openTaskRecords.map((task) => <option key={task.id} value={task.id}>{task.data.title}</option>)}
            </select>
          </label>
          <div className="calendar-form-actions">
            <small>{invalidRange ? "结束时间必须晚于开始时间。" : `${selectedDate} · ${connection?.timezone ?? "workspace timezone"}`}</small>
            <button className="primary-button" type="submit" disabled={!connection || !title.trim() || invalidRange || calendarBusy || online === false}>{saving ? "保存中…" : "创建时间块"}</button>
          </div>
        </form>

        <div className={`calendar-day-list ${periodView === "day" ? "" : "calendar-range-list"}`}>
          <header><strong>{viewTitle}</strong><span>{formatDateRange(dateRange.startDate, dateRange.endDate)} · {events.length} 项</span></header>
          {!connection ? <p className="empty-note">连接后显示 Private 仓库中的日程。</p>
            : loading && eventFiles.length === 0 ? <p className="empty-note">正在读取日程…</p>
              : events.length === 0 ? <p className="empty-note">{emptyMessage}</p>
                : <ol>{events.map((record) => {
                  const item = eventItems.get(record.id);
                  if (!item) return null;
                  const linkedTask = record.data.linked_entity_id ? taskNames.get(record.data.linked_entity_id) : null;
                  const isSaving = savingEventId === record.id;
                  return editingEventId === record.id ? (
                    <li className="calendar-event-editing" key={record.id}>
                      <form className="calendar-edit-form" onSubmit={(event) => submitEdit(event, item)}>
                        <label className="calendar-edit-title">标题<input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} maxLength={300} disabled={operationBusy} /></label>
                        <label>类型<select value={editEventType} onChange={(event) => setEditEventType(event.target.value as CalendarEventType)} disabled={operationBusy}><option value="time_block">任务时间块</option><option value="event">日程</option></select></label>
                        <label>日期<input type="date" value={editDate} onChange={(event) => setEditDate(event.target.value)} disabled={operationBusy} /></label>
                        <label>开始<input type="time" value={editStartTime} onChange={(event) => setEditStartTime(event.target.value)} disabled={operationBusy} /></label>
                        <label>结束<input type="time" value={editEndTime} onChange={(event) => setEditEndTime(event.target.value)} disabled={operationBusy} /></label>
                        <label className="calendar-edit-task">关联 Task（可选）
                          <select value={editLinkedTaskId} onChange={(event) => setEditLinkedTaskId(event.target.value)} disabled={operationBusy}>
                            <option value="">不关联 Task</option>
                            {linkableTaskRecords.map((task) => <option key={task.id} value={task.id}>{task.data.title}</option>)}
                          </select>
                        </label>
                        <div className="calendar-edit-actions">
                          <small>{invalidEditRange ? "结束时间必须晚于开始时间。" : `保存会生成 v${record.version + 1}，并校验旧 blob SHA。`}</small>
                          <span>
                            <button className="text-button" type="button" onClick={() => setEditingEventId(null)} disabled={operationBusy}>取消编辑</button>
                            <button className="primary-button" type="submit" disabled={!editTitle.trim() || invalidEditRange || operationBusy || online === false}>{isSaving ? "保存中…" : "保存修改"}</button>
                          </span>
                        </div>
                      </form>
                    </li>
                  ) : (
                    <li key={record.id}>
                      <time>{periodView === "day" ? "" : `${record.data.local_start_date.slice(5)} · `}{formatEventTime(record.data.start_at, record.data.end_at, record.data.timezone)}</time>
                      <div className="calendar-event-copy"><strong>{record.data.title}</strong><small>{record.data.event_type === "time_block" ? "时间块" : "日程"}{linkedTask ? ` · Task：${linkedTask}` : record.data.linked_entity_id ? " · Task 引用当前不可用" : ""}</small></div>
                      <div className="calendar-event-actions">
                        <code>v{record.version}</code>
                        {eventView === "scheduled" ? <>
                          <button className="text-button" type="button" onClick={() => beginEdit(item)} disabled={calendarBusy || online === false}>编辑</button>
                          <button className="text-button" type="button" onClick={() => onLifecycleChange(item, "cancel")} disabled={calendarBusy || online === false}>{isSaving ? "处理中…" : "取消日程"}</button>
                          <button className="text-button calendar-destructive-button" type="button" onClick={() => onDeletionChange(item, "trash")} disabled={calendarBusy || online === false}>移到回收站</button>
                        </> : eventView === "cancelled" ? <>
                          <button className="text-button" type="button" onClick={() => onLifecycleChange(item, "reopen")} disabled={calendarBusy || online === false}>{isSaving ? "处理中…" : "恢复日程"}</button>
                          <button className="text-button calendar-destructive-button" type="button" onClick={() => onDeletionChange(item, "trash")} disabled={calendarBusy || online === false}>移到回收站</button>
                        </> : <button className="text-button" type="button" onClick={() => onDeletionChange(item, "restore")} disabled={calendarBusy || online === false}>{isSaving ? "处理中…" : "从回收站恢复"}</button>}
                      </div>
                    </li>
                  );
                })}</ol>}
        </div>
      </div>
      <p className="calendar-boundary"><strong>当前边界</strong>：支持单日内部事件的版本化编辑、取消/恢复与可恢复软删除；提醒、重复、全天事件、永久删除和外部同步尚未开放。</p>
    </section>
  );
}

function formatEventTime(startAt: string, endAt: string, timezone: string) {
  const formatter = new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${formatter.format(new Date(startAt))}–${formatter.format(new Date(endAt))}`;
}

function formatEventInputTime(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${read("hour")}:${read("minute")}`;
}

function formatDateRange(startDate: string, endDate: string) {
  return startDate === endDate ? startDate : `${startDate} — ${endDate}`;
}
