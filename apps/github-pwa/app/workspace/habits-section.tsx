"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Check, MoreHorizontal, Plus } from "lucide-react";

import { activeHabits, archivedHabits, trashedHabits, type HabitAutomationMode, type HabitFields, type HabitStatus, type HabitTrackingType } from "../../../../src/lib/github-data/habits";
import { checkInsForMonth, type HabitCheckInStatus } from "../../../../src/lib/github-data/habit-check-ins";
import { activeHabitRule } from "../../../../src/lib/github-data/habit-rules";
import { evaluateSleepHabitRule, type SleepHabitRuleFields, type SleepHabitRuleType } from "../../../../src/lib/github-data/sleep-habit-rules";
import type { Connection, SyncedHabit, SyncedHabitCheckIn, SyncedHabitRule, SyncedSleepSession } from "./page-model";

type Props = {
  connection: Connection | null;
  online: boolean | null;
  todayDate: string;
  habits: SyncedHabit[];
  checkIns: SyncedHabitCheckIn[];
  rules: SyncedHabitRule[];
  sleepSessions: SyncedSleepSession[];
  loading: boolean;
  saving: boolean;
  savingId: string | null;
  onCreate: (fields: HabitFields, sleepRule?: SleepHabitRuleFields) => Promise<boolean>;
  onMove: (item: SyncedHabit, direction: "up" | "down") => Promise<void>;
  onStatusChange: (item: SyncedHabit, status: HabitStatus) => void;
  onDeletionChange: (item: SyncedHabit, operation: "trash" | "restore") => void;
  onCheckIn: (item: SyncedHabit, date: string, status: HabitCheckInStatus) => Promise<boolean>;
  onConfirmSleepSuggestion: (item: SyncedHabit, rule: SyncedHabitRule, session: SyncedSleepSession) => Promise<boolean>;
  onRefresh: () => void;
};

const STATUS_LABELS = { completed: "已完成", missed: "未完成", skipped: "已跳过", unknown: "未打卡", none: "未打卡" };

export function HabitsSection({ connection, online, todayDate, habits, checkIns, rules, sleepSessions, loading, saving, savingId, onCreate, onMove, onStatusChange, onDeletionChange, onCheckIn, onConfirmSleepSuggestion, onRefresh }: Props) {
  const [view, setView] = useState<"active" | "archived" | "trash">("active");
  const [creating, setCreating] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [trackingType, setTrackingType] = useState<HabitTrackingType>("boolean");
  const [targetValue, setTargetValue] = useState("1");
  const [targetUnit, setTargetUnit] = useState("");
  const [automationMode, setAutomationMode] = useState<HabitAutomationMode>("manual");
  const [sleepRuleType, setSleepRuleType] = useState<SleepHabitRuleType>("sleep_start_before");
  const [thresholdTime, setThresholdTime] = useState("23:30");
  const records = useMemo(() => habits.map((item) => item.record), [habits]);
  const byId = useMemo(() => new Map(habits.map((item) => [item.record.id, item])), [habits]);
  const active = useMemo(() => activeHabits(records).map((record) => byId.get(record.id)!), [byId, records]);
  const archived = useMemo(() => archivedHabits(records).map((record) => byId.get(record.id)!), [byId, records]);
  const trash = useMemo(() => trashedHabits(records).map((record) => byId.get(record.id)!), [byId, records]);
  const visible = view === "active" ? active : view === "archived" ? archived : trash;
  const month = todayDate.slice(0, 7);
  const days = month ? Array.from({ length: new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate() }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`) : [];
  const monthly = new Map(visible.map((item) => [item.record.id,
    new Map((month ? checkInsForMonth(checkIns.map((entry) => entry.record), item.record.id, month) : []).map((record) => [record.data.local_date, record.data.status])),
  ]));
  const busy = saving || savingId !== null;
  const disabled = !connection || busy || loading || online === false;
  const sleepSuggestions = useMemo(() => {
    const candidates: Array<{ habit: SyncedHabit; rule: SyncedHabitRule; session: SyncedSleepSession; explanation: string; localDate: string; status: "completed" | "missed" }> = [];
    for (const habit of active) {
      if (habit.record.data.status !== "active" || habit.record.data.automation_mode !== "rule_assisted") continue;
      const habitRules = rules.filter((rule) => rule.record.data.habit_id === habit.record.id);
      for (const session of sleepSessions) {
        for (const rule of habitRules) {
          try {
            const evaluation = evaluateSleepHabitRule(rule.record, session.record);
            const hasCheckIn = checkIns.some((item) => item.record.deleted_at === null && item.record.data.habit_id === habit.record.id && item.record.data.local_date === evaluation.local_date);
            const selectedRule = activeHabitRule(habitRules.map((item) => item.record), habit.record.id, evaluation.local_date);
            if (!hasCheckIn && selectedRule?.id === rule.record.id) candidates.push({ habit, rule, session, explanation: evaluation.explanation, localDate: evaluation.local_date, status: evaluation.status });
          } catch { /* Ineligible sessions and inactive rules do not create suggestions. */ }
        }
      }
    }
    const seenHabitDates = new Set<string>();
    return candidates
      .sort((left, right) => right.localDate.localeCompare(left.localDate)
        || right.session.record.updated_at.localeCompare(left.session.record.updated_at)
        || right.session.record.id.localeCompare(left.session.record.id))
      .filter((candidate) => {
        const key = `${candidate.habit.record.id}:${candidate.localDate}`;
        if (seenHabitDates.has(key)) return false;
        seenHabitDates.add(key);
        return true;
      })
      .slice(0, 8);
  }, [active, checkIns, rules, sleepSessions]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = trackingType === "boolean" ? 1 : Number(targetValue);
    if (disabled || !todayDate || !name.trim() || !Number.isFinite(value) || value <= 0 || (trackingType !== "boolean" && !targetUnit.trim())) return;
    if (automationMode === "rule_assisted" && (!thresholdTime || trackingType !== "boolean")) return;
    const saved = await onCreate({
      name,
      description_markdown: "",
      schedule_json: { frequency: "daily", weekdays: [] },
      timezone: connection?.timezone ?? "Asia/Shanghai",
      tracking_type: trackingType,
      target_json: { value, unit: trackingType === "boolean" ? null : targetUnit },
      automation_mode: automationMode,
      start_date: todayDate,
      end_date: null,
    }, automationMode === "rule_assisted" ? { rule_type: sleepRuleType, threshold_local_time: thresholdTime } : undefined);
    if (saved) { setName(""); setTrackingType("boolean"); setTargetValue("1"); setTargetUnit(""); setCreating(false); setAutomationMode("manual"); }
  }

  function switchView(next: typeof view) {
    setView(next); setCreating(false); setSorting(false); setMenuId(null);
  }

  return <section className="habit-card" aria-labelledby="habits-title">
    <div className="card-heading">
      <div><h2 id="habits-title">习惯</h2><p className="habit-subtitle">{month ? `${month.slice(0, 4)} 年 ${Number(month.slice(5, 7))} 月` : "每日打卡"} · 点击今天的格子打卡</p></div>
      <div className="habit-header-actions">
        <button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || loading || busy}>{loading ? "刷新中…" : "刷新"}</button>
        {view === "active" ? <button className="primary-button" type="button" onClick={() => { setCreating(!creating); setMenuId(null); }} disabled={disabled}><Plus size={14} aria-hidden="true" />{creating ? "收起" : "新增习惯"}</button> : null}
      </div>
    </div>
    <div className="habit-toolbar">
      <div className="habit-view-actions" aria-label="习惯视图">
        <button className={`view-button ${view === "active" ? "active" : ""}`} type="button" aria-pressed={view === "active"} onClick={() => switchView("active")} disabled={busy}>进行中 {active.length}</button>
        <button className={`view-button ${view === "archived" ? "active" : ""}`} type="button" aria-pressed={view === "archived"} onClick={() => switchView("archived")} disabled={busy}>已归档 {archived.length}</button>
        <button className={`view-button ${view === "trash" ? "active" : ""}`} type="button" aria-pressed={view === "trash"} onClick={() => switchView("trash")} disabled={busy}>回收站 {trash.length}</button>
      </div>
      {view === "active" ? <button className="text-button" type="button" aria-pressed={sorting} onClick={() => { setSorting(!sorting); setMenuId(null); }} disabled={disabled || active.length < 2}>{sorting ? "完成排序" : "调整顺序"}</button> : null}
    </div>
    {view === "active" && creating ? <form className="habit-create-form" onSubmit={submit}>
      <label>事项名称<input autoFocus value={name} maxLength={200} onChange={(event) => setName(event.target.value)} placeholder="例如：阅读、运动、早睡" disabled={disabled} /></label>
      <label>打卡方式<select value={trackingType} onChange={(event) => setTrackingType(event.target.value as HabitTrackingType)} disabled={disabled}><option value="boolean">完成 / 未完成</option><option value="count">次数</option><option value="duration">时长</option><option value="threshold">阈值</option></select></label>
      {trackingType !== "boolean" ? <><label>目标值<input type="number" min="0.01" step="0.01" value={targetValue} onChange={(event) => setTargetValue(event.target.value)} disabled={disabled} /></label><label>单位<input value={targetUnit} maxLength={64} onChange={(event) => setTargetUnit(event.target.value)} placeholder="分钟 / 页 / 次" disabled={disabled} /></label></> : null}
      <label>记录方式<select value={automationMode} onChange={(event) => setAutomationMode(event.target.value as HabitAutomationMode)} disabled={!connection || busy}><option value="manual">仅手工打卡</option><option value="rule_assisted">已确认睡眠辅助</option></select></label>
      {automationMode === "rule_assisted" ? <><label>睡眠规则<select value={sleepRuleType} onChange={(event) => { const next = event.target.value as SleepHabitRuleType; setSleepRuleType(next); setThresholdTime(next === "sleep_start_before" ? "23:30" : "07:00"); }} disabled={!connection || busy}><option value="sleep_start_before">不晚于此时间入睡</option><option value="wake_before">不晚于此时间起床</option></select></label><label>时间阈值<input type="time" value={thresholdTime} onChange={(event) => setThresholdTime(event.target.value)} disabled={!connection || busy} /></label></> : null}
      {automationMode === "rule_assisted" ? <p className="habit-form-note">只读取已确认的夜间睡眠，确认判定后才打卡。此方式仅支持完成 / 未完成。</p> : null}
      <button className="primary-button" type="submit" disabled={disabled || !todayDate || !name.trim() || (trackingType !== "boolean" && (!targetUnit.trim() || !Number.isFinite(Number(targetValue)) || Number(targetValue) <= 0)) || (automationMode === "rule_assisted" && (!thresholdTime || trackingType !== "boolean"))}>{saving ? "保存中…" : "添加"}</button>
    </form> : null}
    {!connection ? <p className="empty-note">连接后显示你的习惯。</p> : loading && habits.length === 0 ? <p className="empty-note">正在读取习惯…</p> : visible.length === 0 ? <p className="empty-note">{view === "active" ? "添加一个习惯，开始每日打卡。" : view === "archived" ? "还没有已归档的习惯。" : "回收站是空的。"}</p> : <>
      <div className="habit-table-scroll" role="region" aria-label="习惯与当月每日打卡，窄屏可左右滚动" tabIndex={0}>
        <table className="habit-table">
          <thead><tr><th scope="col" className="habit-name-cell">事项名称</th>{days.map((date) => <th key={date} scope="col" className="habit-date-cell" data-today={date === todayDate}><span aria-label={date}>{Number(date.slice(-2))}</span></th>)}<th scope="col" className="habit-actions-cell"><span className="habit-sr-only">操作</span></th></tr></thead>
          <tbody>{visible.map((item, index) => <tr key={item.record.id}>
            <th scope="row" className="habit-name-cell"><div className="habit-name-content">
              {sorting ? <div className="habit-sort-actions"><button type="button" className="habit-icon-button" aria-label={`上移${item.record.data.name}`} title="上移" disabled={disabled || index === 0} onClick={() => void onMove(item, "up")}><ArrowUp size={14} aria-hidden="true" /></button><button type="button" className="habit-icon-button" aria-label={`下移${item.record.data.name}`} title="下移" disabled={disabled || index === visible.length - 1} onClick={() => void onMove(item, "down")}><ArrowDown size={14} aria-hidden="true" /></button></div> : null}
              <strong title={item.record.data.name}>{item.record.data.name}</strong>{item.record.data.status === "paused" && view === "active" ? <small>暂停</small> : null}
            </div></th>
            {days.map((date) => {
              const status = monthly.get(item.record.id)?.get(date) ?? "none";
              const label = `${item.record.data.name} · ${date} · ${STATUS_LABELS[status]}`;
              const isToday = date === todayDate;
              const content = status === "completed" ? <Check size={12} aria-hidden="true" /> : status === "skipped" ? "−" : status === "missed" ? "×" : null;
              return <td key={date} className="habit-date-cell" data-today={isToday}>{isToday && view === "active" ? <button type="button" className="habit-day" data-status={status} aria-label={`${label}，${status === "completed" ? "撤销打卡" : "打卡"}`} aria-pressed={status === "completed"} title={label} disabled={disabled || date < item.record.data.start_date || (item.record.data.end_date !== null && date > item.record.data.end_date) || item.record.data.status === "paused"} onClick={() => void onCheckIn(item, date, status === "completed" ? "unknown" : "completed")}>{content}</button> : <span className="habit-day" data-status={status} data-future={date > todayDate} role="img" aria-label={label} title={label}>{content}</span>}</td>;
            })}
            <td className="habit-actions-cell"><button type="button" className="habit-icon-button" aria-label={`管理${item.record.data.name}`} aria-expanded={menuId === item.record.id} aria-controls={`habit-menu-${item.record.id}`} title="管理习惯" disabled={disabled} onClick={() => setMenuId(menuId === item.record.id ? null : item.record.id)}><MoreHorizontal size={16} aria-hidden="true" /></button></td>
          </tr>)}</tbody>
        </table>
      </div>
      {visible.filter((item) => item.record.id === menuId).map((item) => <div key={item.record.id} id={`habit-menu-${item.record.id}`} className="habit-manage-bar" aria-label={`管理${item.record.data.name}`}><span>{item.record.data.name}</span><div>
        {view === "active" ? <><button className="text-button" type="button" disabled={disabled} onClick={() => { onStatusChange(item, item.record.data.status === "paused" ? "active" : "paused"); setMenuId(null); }}>{item.record.data.status === "paused" ? "继续" : "暂停"}</button><button className="text-button" type="button" disabled={disabled} onClick={() => { onStatusChange(item, "archived"); setMenuId(null); }}>归档</button></> : view === "archived" ? <button className="text-button" type="button" disabled={disabled} onClick={() => { onStatusChange(item, "active"); setMenuId(null); }}>恢复进行</button> : null}
        <button className="text-button" type="button" disabled={disabled} onClick={() => { onDeletionChange(item, view === "trash" ? "restore" : "trash"); setMenuId(null); }}>{view === "trash" ? "恢复" : "移到回收站"}</button><button className="text-button" type="button" onClick={() => setMenuId(null)}>收起</button>
      </div></div>)}
      <div className="habit-legend"><span><i data-status="completed" />已完成</span><span><i />未打卡</span><span className="habit-mobile-hint">左右滑动查看日期</span><span className="habit-sort-note" role="status">{savingId ? "正在保存…" : sorting ? "用上移、下移调整顺序，自动保存" : "今天的打卡可再次点击撤销"}</span></div>
    </>}
    {view === "active" && sleepSuggestions.length > 0 ? <details className="habit-sleep-suggestions"><summary>待确认的睡眠判定 · {sleepSuggestions.length} 条</summary><ol className="learning-list">{sleepSuggestions.map((suggestion) => <li key={`${suggestion.habit.record.id}:${suggestion.rule.record.id}:${suggestion.session.record.id}`}><div><strong>{suggestion.habit.record.data.name} · {suggestion.localDate}</strong><code>{suggestion.status === "completed" ? "建议：完成" : "建议：未完成"}</code><small>{suggestion.explanation} · 规则 v{suggestion.rule.record.data.rule_version}</small></div><button className="primary-button" type="button" onClick={() => void onConfirmSleepSuggestion(suggestion.habit, suggestion.rule, suggestion.session)} disabled={busy || online === false}>{savingId === suggestion.habit.record.id ? "写入中…" : "确认判定并打卡"}</button></li>)}</ol></details> : null}
  </section>;
}
