"use client";

import type { DashboardLayout, DashboardWidgetConfig, DashboardWidgetSize } from "../../../../src/lib/github-data/dashboard-layout";
import { isTodayDashboardWidget } from "./dashboard-presentation";
import { calendarEventsForDate } from "../../../../src/lib/github-data/calendar-events";
import { formatTaskDue, type Connection, type SyncedCalendarEvent, type SyncedTask } from "./page-model";


type WidgetDefinition = { eyebrow: string; title: string; empty: string };

const WIDGETS: Record<string, WidgetDefinition> = {
  today_schedule: { eyebrow: "Calendar", title: "今日日程", empty: "Calendar 模块接入后，这里显示今天的时间块。" },
  today_tasks: { eyebrow: "Tasks", title: "今日待办", empty: "Tasks 模块接入后，这里显示今天最重要的行动。" },
  learning_today: { eyebrow: "Learning", title: "今日学习", empty: "Learning 模块接入后，这里显示语言、乐器和运动学习任务。" },
  exercise_today: { eyebrow: "Health", title: "今日运动", empty: "Health 数据经确认后，这里生成当天运动建议。" },
  habit_heatmap: { eyebrow: "Habits", title: "习惯月度打卡", empty: "Habit 模块接入后，这里显示当月 Heatmap。" },
};

const SIZE_LABELS: Record<DashboardWidgetSize, string> = { compact: "紧凑", standard: "标准", wide: "宽卡片" };

type Props = {
  connection: Connection | null;
  online: boolean | null;
  dashboardLayout: DashboardLayout | null;
  dashboardBlobSha: string | null;
  dashboardDirty: boolean;
  editingDashboard: boolean;
  loadingDashboard: boolean;
  savingDashboard: boolean;
  visibleWidgets: DashboardWidgetConfig[];
  hiddenWidgets: DashboardWidgetConfig[];
  todayTasks: SyncedTask[];
  calendarEvents: SyncedCalendarEvent[];
  loadingTasks: boolean;
  loadingCalendarEvents: boolean;
  savingTaskId: string | null;
  currentTaskDate: string;
  onToggleEditing: () => void;
  onRefresh: () => void;
  onSaveLayout: () => void;
  onWidgetChange: (widget: DashboardWidgetConfig, operation: "up" | "down" | "hide" | "show") => void;
  onWidgetResize: (widget: DashboardWidgetConfig, size: DashboardWidgetSize) => void;
  onReset: () => void;
  onCompleteTask: (item: SyncedTask) => void;
};

export function DashboardSection(props: Props) {
  const { connection, online, dashboardLayout, dashboardBlobSha, dashboardDirty, editingDashboard, loadingDashboard, savingDashboard, visibleWidgets, hiddenWidgets, todayTasks, calendarEvents, loadingTasks, loadingCalendarEvents, savingTaskId, currentTaskDate, onToggleEditing, onRefresh, onSaveLayout, onWidgetChange, onWidgetResize, onReset, onCompleteTask } = props;
  const todayCalendarEvents = currentTaskDate
    ? calendarEventsForDate(calendarEvents.map((item) => item.record), currentTaskDate)
    : [];
  const todayWidgets = visibleWidgets.filter(isTodayDashboardWidget);
  const hiddenTodayWidgets = hiddenWidgets.filter(isTodayDashboardWidget);
  return (
    <section className="dashboard-card" aria-labelledby="dashboard-title">
      <div className="card-heading dashboard-heading">
        <div>
          <p className="eyebrow">Today · Modular dashboard</p>
          <h2 id="dashboard-title">我的今天</h2>
          <p className="dashboard-subtitle">日程、待办、学习、运动与习惯。</p>
        </div>
        <div className="dashboard-actions" aria-label="Dashboard 布局操作">
          <button className="secondary-button" type="button" onClick={onToggleEditing} disabled={!dashboardLayout}>{editingDashboard ? "完成编辑" : "编辑布局"}</button>
          <button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || loadingDashboard || dashboardDirty}>{loadingDashboard ? "读取中…" : "刷新"}</button>
          {editingDashboard || dashboardDirty ? <button className="primary-button" type="button" onClick={onSaveLayout} disabled={!connection || !dashboardLayout || savingDashboard || online === false || (!dashboardDirty && dashboardBlobSha !== null)}>{savingDashboard ? "保存中…" : dashboardBlobSha ? "保存布局" : "保存默认布局"}</button> : null}
        </div>
      </div>

      {editingDashboard ? <div className="dashboard-layout-meta">
        <span>{!connection ? "连接后从 Private GitHub 读取布局" : dashboardBlobSha && dashboardLayout ? `Private layout v${dashboardLayout.version}` : "尚未保存的默认布局"}</span>
        <span>{todayWidgets.length} 个显示 · {hiddenTodayWidgets.length} 个隐藏{dashboardDirty ? " · 有未保存修改" : ""}</span>
      </div> : null}
      <div className="dashboard-widget-grid">
        {todayWidgets.map((widget, index) => {
          const definition = WIDGETS[widget.widget_type] ?? { eyebrow: "Extension", title: `未知模块 · ${widget.widget_type}`, empty: "当前版本未安装这个模块，但配置会被完整保留。" };
          return (
            <article className={`dashboard-widget widget-${widget.widget_type} size-${widget.size}`} key={widget.id}>
              <header><div><p className="eyebrow">{definition.eyebrow}</p><h3>{definition.title}</h3></div><span className="privacy-label">{widget.privacy_mode}</span></header>
              {editingDashboard ? (
                <div className="widget-controls" aria-label={`${definition.title} 布局操作`}>
                  <button type="button" onClick={() => onWidgetChange(widget, "up")} disabled={index === 0}>上移</button>
                  <button type="button" onClick={() => onWidgetChange(widget, "down")} disabled={index === todayWidgets.length - 1}>下移</button>
                  <label>尺寸
                    <select value={widget.size} onChange={(event) => onWidgetResize(widget, event.target.value as DashboardWidgetSize)}>
                      {Object.entries(SIZE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <button type="button" onClick={() => onWidgetChange(widget, "hide")}>隐藏</button>
                </div>
              ) : null}
              {widget.widget_type === "today_schedule" ? (
                <div className="today-task-widget today-schedule-widget">
                  {!connection ? <p className="widget-empty">连接 Private 数据仓库后显示今日日程。</p>
                    : loadingCalendarEvents ? <p className="widget-empty">正在读取今日日程…</p>
                      : todayCalendarEvents.length === 0 ? <p className="widget-empty">今天还没有日程或时间块。</p>
                        : <ul>{todayCalendarEvents.slice(0, 4).map((event) => <li key={event.id}><span>{event.data.title}</span><small>{(event.data.all_day ? "全天" : formatScheduleTime(event.data.start_at, event.data.end_at, event.data.timezone))}</small></li>)}</ul>}
                  {todayCalendarEvents.length > 4 ? <p className="task-overflow-note">另有 {todayCalendarEvents.length - 4} 项，请在 Calendar 查看。</p> : null}
                </div>
              ) : widget.widget_type === "today_tasks" ? (
                <div className="today-task-widget">
                  {!connection ? <p className="widget-empty">连接 Private 数据仓库后显示今日任务。</p>
                    : loadingTasks ? <p className="widget-empty">正在读取今日任务…</p>
                      : todayTasks.length === 0 ? <p className="widget-empty">今天没有到期或逾期任务。</p>
                        : <ul>{todayTasks.slice(0, 4).map((item) => <li key={item.record.id}><button type="button" aria-label={`完成任务：${item.record.data.title}`} onClick={() => onCompleteTask(item)} disabled={Boolean(savingTaskId) || online === false}>○</button><span>{item.record.data.title}</span><small>{formatTaskDue(item.record.data.due_at, currentTaskDate)}</small></li>)}</ul>}
                  {todayTasks.length > 4 ? <p className="task-overflow-note">另有 {todayTasks.length - 4} 项，请在任务清单查看。</p> : null}
                </div>
              ) : <p className="widget-empty">{definition.empty}</p>}
            </article>
          );
        })}
      </div>
      {editingDashboard ? (
        <div className="dashboard-editor-footer">
          <div><strong>已隐藏模块</strong>{hiddenTodayWidgets.length === 0 ? <span>无</span> : hiddenTodayWidgets.map((widget) => <button type="button" key={widget.id} onClick={() => onWidgetChange(widget, "show")}>+ {WIDGETS[widget.widget_type]?.title ?? widget.widget_type}</button>)}</div>
          <button className="secondary-button" type="button" onClick={onReset}>恢复默认布局</button>
        </div>
      ) : null}
    </section>
  );
}

function formatScheduleTime(startAt: string, endAt: string, timezone: string) {
  const formatter = new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${formatter.format(new Date(startAt))}–${formatter.format(new Date(endAt))}`;
}
