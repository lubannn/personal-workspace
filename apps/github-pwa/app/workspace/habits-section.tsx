"use client";

import { useMemo, useState, type FormEvent } from "react";

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
  rules: SyncedHabitRule[];
  checkIns: SyncedHabitCheckIn[];
  sleepSessions: SyncedSleepSession[];
  loading: boolean;
  saving: boolean;
  savingId: string | null;
  onCreate: (fields: HabitFields, sleepRule?: SleepHabitRuleFields) => Promise<boolean>;
  onStatusChange: (item: SyncedHabit, status: HabitStatus) => void;
  onDeletionChange: (item: SyncedHabit, operation: "trash" | "restore") => void;
  onCheckIn: (item: SyncedHabit, date: string, status: HabitCheckInStatus) => Promise<boolean>;
  onConfirmSleepSuggestion: (item: SyncedHabit, rule: SyncedHabitRule, session: SyncedSleepSession) => Promise<boolean>;
  onRefresh: () => void;
};

export function HabitsSection({ connection, online, todayDate, habits, rules, checkIns, sleepSessions, loading, saving, savingId, onCreate, onStatusChange, onDeletionChange, onCheckIn, onConfirmSleepSuggestion, onRefresh }: Props) {
  const [view, setView] = useState<"active" | "archived" | "trash">("active");
  const [name, setName] = useState("");
  const [trackingType, setTrackingType] = useState<HabitTrackingType>("boolean");
  const [targetValue, setTargetValue] = useState("1");
  const [targetUnit, setTargetUnit] = useState("");
  const [automationMode, setAutomationMode] = useState<HabitAutomationMode>("manual");
  const [sleepRuleType, setSleepRuleType] = useState<SleepHabitRuleType>("sleep_start_before");
  const [thresholdTime, setThresholdTime] = useState("23:30");
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null);
  const records = useMemo(() => habits.map((item) => item.record), [habits]);
  const byId = useMemo(() => new Map(habits.map((item) => [item.record.id, item])), [habits]);
  const active = useMemo(() => activeHabits(records).map((record) => byId.get(record.id)!), [byId, records]);
  const archived = useMemo(() => archivedHabits(records).map((record) => byId.get(record.id)!), [byId, records]);
  const trash = useMemo(() => trashedHabits(records).map((record) => byId.get(record.id)!), [byId, records]);
  const visible = view === "active" ? active : view === "archived" ? archived : trash;
  const selected = active.find((item) => item.record.id === selectedHabitId) ?? active[0] ?? null;
  const month = todayDate.slice(0, 7);
  const monthly = useMemo(() => selected ? checkInsForMonth(checkIns.map((item) => item.record), selected.record.id, month) : [], [checkIns, month, selected]);
  const checkInByDate = new Map(monthly.map((record) => [record.data.local_date, record]));
  const days = month ? Array.from({ length: new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate() }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`) : [];
  const busy = saving || savingId !== null;
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
    if (saved) { setName(""); setTrackingType("boolean"); setTargetValue("1"); setTargetUnit(""); setAutomationMode("manual"); }
  }

  return <section className="learning-card habit-card" aria-labelledby="habits-title">
    <div className="card-heading">
      <div><p className="eyebrow">Phase 4 · Habits</p><h2 id="habits-title">习惯与打卡</h2><p className="learning-subtitle">先开放可解释的手工打卡；自动判断必须等规则版本和证据来源就绪后才启用。</p></div>
      <div className="learning-view-actions"><button className="view-button" type="button" aria-pressed={view === "active"} onClick={() => setView("active")}>进行中 {active.length}</button><button className="view-button" type="button" aria-pressed={view === "archived"} onClick={() => setView("archived")}>已归档 {archived.length}</button><button className="view-button" type="button" aria-pressed={view === "trash"} onClick={() => setView("trash")}>回收站 {trash.length}</button><button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || loading}>{loading ? "刷新中…" : "从 GitHub 刷新"}</button></div>
    </div>
    {view === "active" ? <form className="learning-form habit-form" onSubmit={submit}>
      <label>习惯名称<input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} placeholder="例如：阅读" disabled={!connection || busy} /></label>
      <label>追踪方式<select value={trackingType} onChange={(event) => setTrackingType(event.target.value as HabitTrackingType)} disabled={!connection || busy}><option value="boolean">完成 / 未完成</option><option value="count">次数</option><option value="duration">时长</option><option value="threshold">阈值</option></select></label>
      {trackingType !== "boolean" ? <><label>目标值<input type="number" min="0.01" step="0.01" value={targetValue} onChange={(event) => setTargetValue(event.target.value)} disabled={!connection || busy} /></label><label>单位<input value={targetUnit} maxLength={64} onChange={(event) => setTargetUnit(event.target.value)} placeholder="minutes / pages / times" disabled={!connection || busy} /></label></> : null}
      <label>记录方式<select value={automationMode} onChange={(event) => setAutomationMode(event.target.value as HabitAutomationMode)} disabled={!connection || busy}><option value="manual">仅手工打卡</option><option value="rule_assisted">已确认睡眠辅助</option></select></label>
      {automationMode === "rule_assisted" ? <><label>睡眠规则<select value={sleepRuleType} onChange={(event) => { const next = event.target.value as SleepHabitRuleType; setSleepRuleType(next); setThresholdTime(next === "sleep_start_before" ? "23:30" : "07:00"); }} disabled={!connection || busy}><option value="sleep_start_before">不晚于此时间入睡</option><option value="wake_before">不晚于此时间起床</option></select></label><label>时间阈值<input type="time" value={thresholdTime} onChange={(event) => setThresholdTime(event.target.value)} disabled={!connection || busy} /></label></> : null}
      <footer><span>{automationMode === "rule_assisted" ? "只读取已确认的夜间睡眠，并等待你确认判定后才打卡。" : "默认每天执行、仅手工打卡；保存到 Private GitHub。"}</span><button className="primary-button" type="submit" disabled={!connection || !todayDate || !name.trim() || busy || online === false || (trackingType !== "boolean" && (!targetUnit.trim() || Number(targetValue) <= 0)) || (automationMode === "rule_assisted" && (!thresholdTime || trackingType !== "boolean"))}>{busy ? "保存中…" : "创建习惯"}</button></footer>
    </form> : null}
    {!connection ? <p className="empty-note">连接后显示 Private 仓库中的习惯。</p> : loading && habits.length === 0 ? <p className="empty-note">正在读取习惯…</p> : visible.length === 0 ? <p className="empty-note">当前视图还没有习惯。</p> : <ol className="learning-list">{visible.map((item) => {
      const today = checkIns.find((candidate) => candidate.record.data.habit_id === item.record.id && candidate.record.data.local_date === todayDate && candidate.record.deleted_at === null);
      const ruleCount = rules.filter((rule) => rule.record.data.habit_id === item.record.id).length;
      return <li key={item.record.id}>
        <div><strong>{item.record.data.name}</strong><code>{item.record.data.tracking_type} · {item.record.data.target_json.value}{item.record.data.target_json.unit ? ` ${item.record.data.target_json.unit}` : ""}</code><small>{item.record.data.status === "paused" ? "已暂停" : item.record.data.status === "archived" ? "已归档" : "进行中"} · {ruleCount} 个规则版本 · v{item.record.version}</small></div>
        <div className="learning-item-actions">{view === "active" ? <><button className="text-button" type="button" onClick={() => { setSelectedHabitId(item.record.id); void onCheckIn(item, todayDate, today?.record.data.status === "completed" ? "unknown" : "completed"); }} disabled={busy || online === false || !todayDate}>{today?.record.data.status === "completed" ? "撤销今日" : "今日完成"}</button><button className="text-button" type="button" onClick={() => onStatusChange(item, item.record.data.status === "paused" ? "active" : "paused")} disabled={busy || online === false}>{item.record.data.status === "paused" ? "继续" : "暂停"}</button><button className="text-button" type="button" onClick={() => onStatusChange(item, "archived")} disabled={busy || online === false}>归档</button></> : view === "archived" ? <button className="text-button" type="button" onClick={() => onStatusChange(item, "active")} disabled={busy || online === false}>恢复进行</button> : null}<button className="text-button" type="button" onClick={() => onDeletionChange(item, view === "trash" ? "restore" : "trash")} disabled={busy || online === false}>{savingId === item.record.id ? "…" : view === "trash" ? "恢复" : "移到回收站"}</button></div>
      </li>;
    })}</ol>}
    {view === "active" && sleepSuggestions.length > 0 ? <div className="habit-heatmap"><div><strong>待确认的睡眠判定 {sleepSuggestions.length} 条</strong><span>依据正式 SleepSession 与对应规则计算；点击前不会写入打卡。</span></div><ol className="learning-list">{sleepSuggestions.map((suggestion) => <li key={`${suggestion.habit.record.id}:${suggestion.rule.record.id}:${suggestion.session.record.id}`}><div><strong>{suggestion.habit.record.data.name} · {suggestion.localDate}</strong><code>{suggestion.status === "completed" ? "建议：完成" : "建议：未完成"}</code><small>{suggestion.explanation} · 规则 v{suggestion.rule.record.data.rule_version}</small></div><button className="primary-button" type="button" onClick={() => void onConfirmSleepSuggestion(suggestion.habit, suggestion.rule, suggestion.session)} disabled={busy || online === false}>{savingId === suggestion.habit.record.id ? "写入中…" : "确认判定并打卡"}</button></li>)}</ol></div> : null}
    {view === "active" && selected ? <div className="habit-heatmap"><div><strong>{selected.record.data.name} · {month}</strong><span>绿色为完成；灰色为尚无记录。Heatmap 由 canonical check-in 即时派生。</span></div><div className="habit-heatmap-grid" aria-label={`${selected.record.data.name} ${month} 打卡 Heatmap`}>{days.map((date) => <button key={date} type="button" title={`${date} · ${checkInByDate.get(date)?.data.status ?? "无记录"}`} data-status={checkInByDate.get(date)?.data.status ?? "none"} onClick={() => setSelectedHabitId(selected.record.id)}><span>{Number(date.slice(-2))}</span></button>)}</div></div> : null}
  </section>;
}
