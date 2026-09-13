"use client";

import { useMemo, useState, type FormEvent } from "react";
import { localDateTimeToIso } from "../../../../src/lib/github-data/calendar-events";
import type { HealthStagingFields, SleepSessionType, SleepStagingFields } from "../../../../src/lib/github-data/health-staging-records";
import type { Connection, SyncedHealthMetric, SyncedHealthStagingRecord, SyncedSleepSession } from "./page-model";

type Props = {
  connection: Connection | null;
  online: boolean | null;
  todayDate: string;
  staging: SyncedHealthStagingRecord[];
  metrics: SyncedHealthMetric[];
  sleepSessions: SyncedSleepSession[];
  loading: boolean;
  saving: boolean;
  savingId: string | null;
  onCreate: (fields: HealthStagingFields) => Promise<boolean>;
  onCorrect: (item: SyncedHealthStagingRecord, fields: HealthStagingFields) => Promise<boolean>;
  onCreateSleep: (fields: SleepStagingFields) => Promise<boolean>;
  onCorrectSleep: (item: SyncedHealthStagingRecord, fields: SleepStagingFields) => Promise<boolean>;
  onConfirm: (item: SyncedHealthStagingRecord) => void;
  onReject: (item: SyncedHealthStagingRecord, reason: string) => void;
  onRefresh: () => void;
};

export function HealthStagingSection({ connection, online, todayDate, staging, metrics, sleepSessions, loading, saving, savingId, onCreate, onCorrect, onCreateSleep, onCorrectSleep, onConfirm, onReject, onRefresh }: Props) {
  const [entryType, setEntryType] = useState<"metric" | "sleep_session">("metric");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [source, setSource] = useState("手工录入");
  const [metricType, setMetricType] = useState("resting_heart_rate");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("bpm");
  const [localDate, setLocalDate] = useState(todayDate);
  const [sleepStartDate, setSleepStartDate] = useState(todayDate);
  const [sleepStartTime, setSleepStartTime] = useState("23:00");
  const [sleepEndDate, setSleepEndDate] = useState(() => nextDate(todayDate));
  const [sleepEndTime, setSleepEndTime] = useState("07:00");
  const [sleepType, setSleepType] = useState<SleepSessionType>("main_sleep");
  const [formError, setFormError] = useState("");
  const pending = useMemo(() => staging.filter((item) => item.record.deleted_at === null && item.record.data.status === "pending"), [staging]);
  const reviewed = useMemo(() => staging.filter((item) => item.record.deleted_at === null && item.record.data.status !== "pending"), [staging]);
  const busy = saving || savingId !== null;

  function fields(): HealthStagingFields {
    const date = localDate || todayDate;
    return { source_label: source, normalized_json: { metric_type: metricType, measured_at: `${date}T12:00:00.000Z`, local_date: date, timezone: connection?.timezone ?? "Asia/Shanghai", value: Number(value), unit, aggregation_period: "instant" } };
  }

  function sleepFields(): SleepStagingFields {
    const timezone = connection?.timezone ?? "Asia/Shanghai";
    const startDate = sleepStartDate || todayDate;
    const endDate = sleepEndDate || nextDate(startDate);
    return { source_label: source, normalized_json: { start_at: localDateTimeToIso(startDate, sleepStartTime, timezone), end_at: localDateTimeToIso(endDate, sleepEndTime, timezone), local_date: startDate, timezone, session_type: sleepType } };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = editingId ? staging.find((item) => item.record.id === editingId) : null;
    setFormError("");
    try {
      const saved = entryType === "metric"
        ? current ? await onCorrect(current, fields()) : await onCreate(fields())
        : current ? await onCorrectSleep(current, sleepFields()) : await onCreateSleep(sleepFields());
      if (saved) { setEditingId(null); setValue(""); }
    } catch {
      setFormError("开始或结束时间无效，请检查日期、时间和时区。");
    }
  }

  function beginEdit(item: SyncedHealthStagingRecord) {
    setEditingId(item.record.id); setSource(item.record.data.source.label); setEntryType(item.record.data.health_type);
    if (item.record.data.health_type === "metric") {
      setMetricType(item.record.data.normalized_json.metric_type); setValue(String(item.record.data.normalized_json.value)); setUnit(item.record.data.normalized_json.unit); setLocalDate(item.record.data.normalized_json.local_date);
    } else {
      const sleep = item.record.data.normalized_json;
      const start = new Date(sleep.start_at); const end = new Date(sleep.end_at);
      const localParts = (instant: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: sleep.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant).reduce<Record<string, string>>((result, part) => ({ ...result, [part.type]: part.value }), {});
      const startParts = localParts(start); const endParts = localParts(end);
      setSleepStartDate(`${startParts.year}-${startParts.month}-${startParts.day}`); setSleepStartTime(`${startParts.hour}:${startParts.minute}`);
      setSleepEndDate(`${endParts.year}-${endParts.month}-${endParts.day}`); setSleepEndTime(`${endParts.hour}:${endParts.minute}`); setSleepType(sleep.session_type);
    }
  }

  return <section className="learning-card health-card" aria-labelledby="health-title">
    <div className="card-heading"><div><p className="eyebrow">Phase 4 · Health Staging</p><h2 id="health-title">健康数据暂存</h2><p className="learning-subtitle">录入先进入待确认区；确认前不会成为正式健康记录，也不会触发习惯打卡。</p></div><div className="learning-view-actions"><span className="memory-pill">待确认 {pending.length}</span><button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || loading}>{loading ? "刷新中…" : "从 GitHub 刷新"}</button></div></div>
    <div className="learning-view-actions" role="group" aria-label="健康录入类型"><button className={entryType === "metric" ? "filter-button is-active" : "filter-button"} type="button" onClick={() => { setEntryType("metric"); setEditingId(null); }} disabled={busy}>健康指标</button><button className={entryType === "sleep_session" ? "filter-button is-active" : "filter-button"} type="button" onClick={() => { setEntryType("sleep_session"); setEditingId(null); }} disabled={busy}>睡眠记录</button></div>
    <form className="learning-form habit-form" onSubmit={submit}>
      <label>来源<input value={source} maxLength={120} onChange={(event) => setSource(event.target.value)} disabled={!connection || busy} /></label>
      {entryType === "metric" ? <><label>指标类型<input value={metricType} maxLength={64} pattern="[a-z0-9][a-z0-9_-]*" onChange={(event) => setMetricType(event.target.value)} placeholder="resting_heart_rate" disabled={!connection || busy} /></label><label>数值<input type="number" step="any" value={value} onChange={(event) => setValue(event.target.value)} disabled={!connection || busy} /></label><label>单位<input value={unit} maxLength={64} onChange={(event) => setUnit(event.target.value)} placeholder="bpm / kg / mmHg" disabled={!connection || busy} /></label><label>本地日期<input type="date" value={localDate || todayDate} onChange={(event) => setLocalDate(event.target.value)} disabled={!connection || busy} /></label></> : <><label>开始日期<input type="date" value={sleepStartDate || todayDate} onChange={(event) => setSleepStartDate(event.target.value)} disabled={!connection || busy} /></label><label>开始时间<input type="time" value={sleepStartTime} onChange={(event) => setSleepStartTime(event.target.value)} disabled={!connection || busy} /></label><label>结束日期<input type="date" value={sleepEndDate || nextDate(sleepStartDate || todayDate)} onChange={(event) => setSleepEndDate(event.target.value)} disabled={!connection || busy} /></label><label>结束时间<input type="time" value={sleepEndTime} onChange={(event) => setSleepEndTime(event.target.value)} disabled={!connection || busy} /></label><label>人工分类<select value={sleepType} onChange={(event) => setSleepType(event.target.value as SleepSessionType)} disabled={!connection || busy}><option value="main_sleep">夜间睡眠</option><option value="nap">小睡</option><option value="unknown">未确定</option></select></label></>}
      <footer><span>{entryType === "sleep_session" ? "归属日期固定为睡眠开始日；最长 36 小时。" : "暂存记录保留来源和每次更正版本。"}</span><div>{editingId ? <button className="secondary-button" type="button" onClick={() => setEditingId(null)} disabled={busy}>取消更正</button> : null}<button className="primary-button" type="submit" disabled={!connection || !source.trim() || (entryType === "metric" ? !metricType.trim() || !unit.trim() || !(localDate || todayDate) || !Number.isFinite(Number(value)) || value === "" : !(sleepStartDate || todayDate) || !sleepStartTime || !(sleepEndDate || nextDate(sleepStartDate || todayDate)) || !sleepEndTime) || busy || online === false}>{busy ? "保存中…" : editingId ? "保存更正" : "加入待确认区"}</button></div></footer>
      {formError ? <p className="error-message" role="alert">{formError}</p> : null}
    </form>
    {!connection ? <p className="empty-note">连接后显示 Private 仓库中的健康暂存记录。</p> : pending.length === 0 ? <p className="empty-note">没有待确认记录。</p> : <ol className="learning-list">{pending.map((item) => <li key={item.record.id}><div>{item.record.data.health_type === "metric" ? <><strong>{item.record.data.normalized_json.metric_type}</strong><code>{item.record.data.normalized_json.value} {item.record.data.normalized_json.unit}</code></> : <><strong>{item.record.data.normalized_json.session_type === "main_sleep" ? "夜间睡眠" : item.record.data.normalized_json.session_type === "nap" ? "小睡" : "未确定睡眠"}</strong><code>{item.record.data.normalized_json.duration_minutes} 分钟</code></>}<small>{item.record.data.normalized_json.local_date} · {item.record.data.source.label} · 暂存 v{item.record.version}</small></div><div className="learning-item-actions"><button className="text-button" type="button" onClick={() => beginEdit(item)} disabled={busy}>更正</button><button className="text-button" type="button" onClick={() => onReject(item, "用户在暂存审核中拒绝")} disabled={busy || online === false}>拒绝</button><button className="primary-button" type="button" onClick={() => onConfirm(item)} disabled={busy || online === false}>{savingId === item.record.id ? "处理中…" : "确认并入库"}</button></div></li>)}</ol>}
    <div className="habit-heatmap"><div><strong>正式健康记录 {metrics.length + sleepSessions.length} 条</strong><span>{metrics.length} 条指标 · {sleepSessions.length} 段睡眠 · 最近审核 {reviewed.length} 条。</span></div>{metrics.length + sleepSessions.length > 0 ? <ol className="learning-list">{sleepSessions.slice(0, 3).map((item) => <li key={item.record.id}><div><strong>{item.record.data.session_type === "main_sleep" ? "夜间睡眠" : item.record.data.session_type === "nap" ? "小睡" : "未确定睡眠"}</strong><code>{item.record.data.duration_minutes} 分钟</code><small>{item.record.data.local_date} · 已由你确认</small></div></li>)}{metrics.slice(0, 3).map((item) => <li key={item.record.id}><div><strong>{item.record.data.metric_type}</strong><code>{item.record.data.value} {item.record.data.unit}</code><small>{item.record.data.local_date} · 已由你确认</small></div></li>)}</ol> : null}</div>
  </section>;
}

function nextDate(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf())) return date;
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}
