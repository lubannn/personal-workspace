"use client";

import styles from "../workbench.module.css";

import { useMemo, useState, type FormEvent } from "react";

import {
  calendarDateRange,
  calendarEventsForRange,
  cancelledCalendarEventsForRange,
  trashedCalendarEventsForRange,
  type CalendarRangeView,
  type CalendarEventType,
  type CalendarReminderOffset,
} from "../../../../src/lib/github-data/calendar-events";
import { shiftCalendarDate, formatCalendarTime } from "./calendar-presentation";
import { formatWorkspaceDate } from "./workspace-date";
import { openTasks } from "../../../../src/lib/github-data/tasks";
import type { Connection, SyncedCalendarEvent, SyncedTask } from "./page-model";
import { useCalendarReminders } from "./use-calendar-reminders";

export type CalendarEventFields = {
  allDay?: boolean;
  title: string;
  eventType: CalendarEventType;
  localDate: string;
  startTime: string;
  endTime: string;
  linkedTaskId: string | null;
  reminderOffsetsMinutes: CalendarReminderOffset[];
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
  const [selectedDateOverride, setSelectedDate] = useState<string | null>(null);
  const selectedDate = selectedDateOverride ?? todayDate;
  const [eventView, setEventView] = useState<"scheduled" | "cancelled" | "trash">("scheduled");
  const [periodView, setPeriodView] = useState<CalendarRangeView>("day");
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<CalendarEventType>("time_block");
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [linkedTaskId, setLinkedTaskId] = useState("");
  const [reminderOffset, setReminderOffset] = useState<"none" | `${CalendarReminderOffset}`>("none");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editEventType, setEditEventType] = useState<CalendarEventType>("time_block");
  const [editDate, setEditDate] = useState(selectedDate);
  const [editAllDay, setEditAllDay] = useState(false);
  const [editStartTime, setEditStartTime] = useState("09:00");
  const [editEndTime, setEditEndTime] = useState("10:00");
  const [editLinkedTaskId, setEditLinkedTaskId] = useState("");
  const [editReminderOffset, setEditReminderOffset] = useState<"none" | `${CalendarReminderOffset}`>("none");
  const { permission: reminderPermission, deliveryError: reminderDeliveryError, requestPermission } = useCalendarReminders(eventFiles.map((item) => item.record));
  const dateRange = useMemo(() => calendarDateRange(selectedDate || "1970-01-01", periodView), [selectedDate, periodView]);
  const events = useMemo(() => {
    if (!selectedDate) return [];
    const records = eventFiles.map((item) => item.record);
    if (eventView === "cancelled") return cancelledCalendarEventsForRange(records, dateRange.startDate, dateRange.endDate);
    if (eventView === "trash") return trashedCalendarEventsForRange(records, dateRange.startDate, dateRange.endDate);
    return calendarEventsForRange(records, dateRange.startDate, dateRange.endDate);
  }, [dateRange, eventFiles, eventView, selectedDate]);
  const eventItems = useMemo(() => new Map(eventFiles.map((item) => [item.record.id, item])), [eventFiles]);
  const openTaskRecords = useMemo(() => openTasks(taskFiles.map((item) => item.record)).filter((record) => record.data.parent_task_id === null), [taskFiles]);
  const linkableTaskRecords = useMemo(() => taskFiles.map((item) => item.record).filter((record) => record.deleted_at === null), [taskFiles]);
  const taskNames = useMemo(() => new Map(taskFiles.map((item) => [item.record.id, item.record.data.title])), [taskFiles]);
  const invalidRange = !allDay && (!startTime || !endTime || startTime === endTime);
  const invalidEditRange = !editDate || (!editAllDay && (!editStartTime || !editEndTime || editStartTime === editEndTime));
  const operationBusy = saving || savingEventId !== null;
  const calendarBusy = operationBusy || editingEventId !== null;
  const periodLabel = !selectedDate ? "正在定位日期"
    : periodView === "day"
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
    if (!selectedDate || !title.trim() || invalidRange || operationBusy || online === false) return;
    const saved = await onCreate({ allDay, title, eventType, localDate: selectedDate, startTime, endTime, linkedTaskId: linkedTaskId || null, reminderOffsetsMinutes: reminderOffset === "none" ? [] : [Number(reminderOffset) as CalendarReminderOffset] });
    if (saved) setTitle("");
  }

  function beginEdit(item: SyncedCalendarEvent) {
    if (calendarBusy || online === false) return;
    setEditingEventId(item.record.id);
    setEditTitle(item.record.data.title);
    setEditEventType(item.record.data.event_type);
    setEditDate(item.record.data.local_start_date);
    setEditAllDay(item.record.data.all_day);
    setEditStartTime(formatEventInputTime(item.record.data.start_at, item.record.data.timezone));
    setEditEndTime(formatEventInputTime(item.record.data.end_at, item.record.data.timezone));
    setEditLinkedTaskId(item.record.data.linked_entity_id ?? "");
    setEditReminderOffset(item.record.data.reminder_offsets_minutes[0] === undefined ? "none" : String(item.record.data.reminder_offsets_minutes[0]) as `${CalendarReminderOffset}`);
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>, item: SyncedCalendarEvent) {
    event.preventDefault();
    if (!editTitle.trim() || invalidEditRange || operationBusy || online === false) return;
    const saved = await onEdit(item, {
      allDay: editAllDay,
      title: editTitle,
      eventType: editEventType,
      localDate: editDate,
      startTime: editStartTime,
      endTime: editEndTime,
      linkedTaskId: editLinkedTaskId || null,
      reminderOffsetsMinutes: editReminderOffset === "none" ? [] : [Number(editReminderOffset) as CalendarReminderOffset],
    });
    if (saved) setEditingEventId(null);
  }

  return (
    <section className={`calendar-card ${styles.scope}`} aria-labelledby="calendar-title">
      <div className="card-heading calendar-heading">
        <div>
          <p className="eyebrow">CALENDAR</p>
          <h2 id="calendar-title">日程安排</h2>
          <p className="calendar-subtitle">安排时间，留出专注。关联待办不会改变它的截止日期。</p>
        </div>
        <div className="calendar-header-actions">
          <label>定位日期<input type="date" value={selectedDate} onChange={(event) => { if (event.target.value) setSelectedDate(event.target.value); setEditingEventId(null); }} onInput={(event) => { if (event.currentTarget.value) setSelectedDate(event.currentTarget.value); setEditingEventId(null); }} disabled={calendarBusy} /></label>
          <button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || loading || calendarBusy}>{loading ? "读取中…" : "刷新"}</button>
        </div>
      </div>

      <nav className="calendar-date-nav" aria-label="日程日期导航">
        <button className="secondary-button" type="button" aria-label="上一个日期范围" disabled={!selectedDate || calendarBusy} onClick={() => setSelectedDate(shiftCalendarDate(selectedDate, periodView, -1))}>←</button>
        <strong>{selectedDate ? formatWorkspaceDate(selectedDate) : "正在定位日期…"}</strong>
        <button className="secondary-button" type="button" aria-label="下一个日期范围" disabled={!selectedDate || calendarBusy} onClick={() => setSelectedDate(shiftCalendarDate(selectedDate, periodView, 1))}>→</button>
        <button className="view-button" type="button" disabled={!todayDate || calendarBusy} onClick={() => setSelectedDate(null)}>今天</button>
      </nav>
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
          <label className="calendar-all-day">时间安排<select value={allDay ? "yes" : "no"} onChange={(event) => setAllDay(event.target.value === "yes")} disabled={!connection || calendarBusy}><option value="no">定时</option><option value="yes">全天</option></select></label>
          <label>开始<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} onInput={(event) => setStartTime(event.currentTarget.value)} disabled={!connection || !selectedDate || calendarBusy || allDay} /></label>
          <label>结束<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} onInput={(event) => setEndTime(event.currentTarget.value)} disabled={!connection || !selectedDate || calendarBusy || allDay} /></label>
          <label className="calendar-task-field">关联 Task（可选）
            <select value={linkedTaskId} onChange={(event) => setLinkedTaskId(event.target.value)} disabled={!connection || calendarBusy}>
              <option value="">不关联 Task</option>
              {openTaskRecords.map((task) => <option key={task.id} value={task.id}>{task.data.title}</option>)}
            </select>
          </label>
          <label className="calendar-task-field">前台设备提醒
            <select value={reminderOffset} onChange={(event) => setReminderOffset(event.target.value as "none" | `${CalendarReminderOffset}`)} disabled={!connection || calendarBusy}>
              {reminderOptions()}
            </select>
          </label>
          <div className="calendar-form-actions">
            <small>{!selectedDate ? "正在定位工作区日期…" : invalidRange ? "请填写不同的开始、结束时间。" : allDay ? "全天安排" : endTime < startTime ? "结束时间在次日" : `${selectedDate} · ${connection?.timezone ?? "工作区时区"}`}</small>
            <button className="primary-button" type="submit" disabled={!connection || !selectedDate || !title.trim() || invalidRange || calendarBusy || online === false}>{saving ? "保存中…" : eventType === "event" ? "添加日程" : "添加时间块"}</button>
          </div>
        </form>

        <div className={`calendar-day-list ${periodView === "day" ? "" : "calendar-range-list"}`}>
          <header><strong>{viewTitle}</strong><span>{selectedDate ? formatDateRange(dateRange.startDate, dateRange.endDate) : "日期初始化中"} · {events.length} 项</span></header>
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
                        <label>日期<input type="date" value={editDate} onChange={(event) => setEditDate(event.target.value)} onInput={(event) => setEditDate(event.currentTarget.value)} disabled={operationBusy} /></label>
                        <label>全天<select value={editAllDay ? "yes" : "no"} onChange={(event) => setEditAllDay(event.target.value === "yes")} disabled={operationBusy}><option value="no">定时</option><option value="yes">全天</option></select></label>
                        <label>开始<input type="time" value={editStartTime} onChange={(event) => setEditStartTime(event.target.value)} onInput={(event) => setEditStartTime(event.currentTarget.value)} disabled={operationBusy || editAllDay} /></label>
                        <label>结束<input type="time" value={editEndTime} onChange={(event) => setEditEndTime(event.target.value)} onInput={(event) => setEditEndTime(event.currentTarget.value)} disabled={operationBusy || editAllDay} /></label>
                        <label className="calendar-edit-task">关联 Task（可选）
                          <select value={editLinkedTaskId} onChange={(event) => setEditLinkedTaskId(event.target.value)} disabled={operationBusy}>
                            <option value="">不关联 Task</option>
                            {linkableTaskRecords.map((task) => <option key={task.id} value={task.id}>{task.data.title}</option>)}
                          </select>
                        </label>
                        <label className="calendar-edit-task">前台设备提醒
                          <select value={editReminderOffset} onChange={(event) => setEditReminderOffset(event.target.value as "none" | `${CalendarReminderOffset}`)} disabled={operationBusy}>
                            {reminderOptions()}
                          </select>
                        </label>
                        <div className="calendar-edit-actions">
                          <small>{invalidEditRange ? "请填写不同的开始、结束时间。" : editAllDay ? "全天安排" : editEndTime < editStartTime ? "结束时间在次日" : "修改只应用于这条日程。"}</small>
                          <span>
                            <button className="text-button" type="button" onClick={() => setEditingEventId(null)} disabled={operationBusy}>取消编辑</button>
                            <button className="primary-button" type="submit" disabled={!editTitle.trim() || invalidEditRange || operationBusy || online === false}>{isSaving ? "保存中…" : "保存修改"}</button>
                          </span>
                        </div>
                      </form>
                    </li>
                  ) : (
                    <li key={record.id}>
                      <time>{periodView === "day" ? "" : `${record.data.local_start_date.slice(5)} · `}{record.data.all_day ? "全天" : formatCalendarTime(record.data.start_at, record.data.end_at, record.data.timezone)}</time>
                      <div className="calendar-event-copy"><strong>{record.data.title}</strong><small>{record.data.event_type === "time_block" ? "时间块" : "日程"}{linkedTask ? ` · Task：${linkedTask}` : record.data.linked_entity_id ? " · Task 引用当前不可用" : ""}{record.data.reminder_offsets_minutes[0] === undefined ? "" : ` · ${reminderLabel(record.data.reminder_offsets_minutes[0])}`}</small></div>
                      <div className="calendar-event-actions">

                        {eventView === "scheduled" ? <>
                          <button className="text-button" type="button" onClick={() => beginEdit(item)} disabled={calendarBusy || online === false}>编辑</button>
                          <details className="row-more"><summary>更多</summary><div className="row-more-actions"><button className="text-button" type="button" onClick={() => onLifecycleChange(item, "cancel")} disabled={calendarBusy || online === false}>{isSaving ? "处理中…" : "取消日程"}</button>
                          <button className="text-button calendar-destructive-button" type="button" onClick={() => onDeletionChange(item, "trash")} disabled={calendarBusy || online === false}>移到回收站</button></div></details>
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
      <div className="calendar-reminder-permission">
        <span><strong>前台设备提醒</strong><small>{reminderPermission === "granted" ? "此设备已授权；页面运行或恢复时会检查到期提醒。" : reminderPermission === "denied" ? "此设备已拒绝通知，请在系统设置中重新授权。" : reminderPermission === "unsupported" ? "当前浏览器不支持所需的通知与 Service Worker API。" : "需要你点击按钮后由浏览器请求通知权限。"}</small></span>
        {reminderPermission === "default" ? <button className="secondary-button" type="button" onClick={() => void requestPermission()}>启用此设备提醒</button> : null}
      </div>
      {reminderDeliveryError ? <p className="calendar-boundary" role="status">{reminderDeliveryError}</p> : null}
      <details className="calendar-help"><summary>关于日程提醒</summary><p className="calendar-boundary">提醒计划保存在 Private GitHub，但首版只在页面运行或从挂起恢复时尝试通知，不承诺关闭页面后的后台送达。iPhone/iPad 后台 Web Push 需要安装到主屏幕，并且还需要尚未接入的隐私安全调度端。重复事件、永久删除和外部同步仍未开放。</p></details>
    </section>
  );
}

function reminderOptions() {
  return <><option value="none">不提醒</option><option value="0">开始时</option><option value="5">提前 5 分钟</option><option value="10">提前 10 分钟</option><option value="15">提前 15 分钟</option><option value="30">提前 30 分钟</option><option value="60">提前 1 小时</option><option value="1440">提前 1 天</option></>;
}

function reminderLabel(offset: CalendarReminderOffset) {
  if (offset === 0) return "开始时提醒";
  if (offset === 60) return "提前 1 小时提醒";
  if (offset === 1440) return "提前 1 天提醒";
  return `提前 ${offset} 分钟提醒`;
}

function formatEventInputTime(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${read("hour")}:${read("minute")}`;
}

function formatDateRange(startDate: string, endDate: string) {
  return startDate === endDate ? startDate : `${startDate} — ${endDate}`;
}
