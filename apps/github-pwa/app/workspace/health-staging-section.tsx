"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { HealthStagingFields } from "../../../../src/lib/github-data/health-staging-records";
import type { Connection, SyncedHealthMetric, SyncedHealthStagingRecord } from "./page-model";

type Props = {
  connection: Connection | null;
  online: boolean | null;
  todayDate: string;
  staging: SyncedHealthStagingRecord[];
  metrics: SyncedHealthMetric[];
  loading: boolean;
  saving: boolean;
  savingId: string | null;
  onCreate: (fields: HealthStagingFields) => Promise<boolean>;
  onCorrect: (item: SyncedHealthStagingRecord, fields: HealthStagingFields) => Promise<boolean>;
  onConfirm: (item: SyncedHealthStagingRecord) => void;
  onReject: (item: SyncedHealthStagingRecord, reason: string) => void;
  onRefresh: () => void;
};

export function HealthStagingSection({ connection, online, todayDate, staging, metrics, loading, saving, savingId, onCreate, onCorrect, onConfirm, onReject, onRefresh }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [source, setSource] = useState("手工录入");
  const [metricType, setMetricType] = useState("resting_heart_rate");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("bpm");
  const [localDate, setLocalDate] = useState(todayDate);
  const pending = useMemo(() => staging.filter((item) => item.record.deleted_at === null && item.record.data.status === "pending"), [staging]);
  const reviewed = useMemo(() => staging.filter((item) => item.record.deleted_at === null && item.record.data.status !== "pending"), [staging]);
  const busy = saving || savingId !== null;

  function fields(): HealthStagingFields {
    const date = localDate || todayDate;
    return { source_label: source, normalized_json: { metric_type: metricType, measured_at: `${date}T12:00:00.000Z`, local_date: date, timezone: connection?.timezone ?? "Asia/Shanghai", value: Number(value), unit, aggregation_period: "instant" } };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = editingId ? staging.find((item) => item.record.id === editingId) : null;
    const saved = current ? await onCorrect(current, fields()) : await onCreate(fields());
    if (saved) { setEditingId(null); setValue(""); }
  }

  function beginEdit(item: SyncedHealthStagingRecord) {
    setEditingId(item.record.id); setSource(item.record.data.source.label); setMetricType(item.record.data.normalized_json.metric_type);
    setValue(String(item.record.data.normalized_json.value)); setUnit(item.record.data.normalized_json.unit); setLocalDate(item.record.data.normalized_json.local_date);
  }

  return <section className="learning-card health-card" aria-labelledby="health-title">
    <div className="card-heading"><div><p className="eyebrow">Phase 4 · Health Staging</p><h2 id="health-title">健康数据暂存</h2><p className="learning-subtitle">录入先进入待确认区；确认前不会成为正式健康记录，也不会触发习惯打卡。</p></div><div className="learning-view-actions"><span className="memory-pill">待确认 {pending.length}</span><button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || loading}>{loading ? "刷新中…" : "从 GitHub 刷新"}</button></div></div>
    <form className="learning-form habit-form" onSubmit={submit}>
      <label>来源<input value={source} maxLength={120} onChange={(event) => setSource(event.target.value)} disabled={!connection || busy} /></label>
      <label>指标类型<input value={metricType} maxLength={64} pattern="[a-z0-9][a-z0-9_-]*" onChange={(event) => setMetricType(event.target.value)} placeholder="resting_heart_rate" disabled={!connection || busy} /></label>
      <label>数值<input type="number" step="any" value={value} onChange={(event) => setValue(event.target.value)} disabled={!connection || busy} /></label>
      <label>单位<input value={unit} maxLength={64} onChange={(event) => setUnit(event.target.value)} placeholder="bpm / kg / mmHg" disabled={!connection || busy} /></label>
      <label>本地日期<input type="date" value={localDate || todayDate} onChange={(event) => setLocalDate(event.target.value)} disabled={!connection || busy} /></label>
      <footer><span>暂存记录保留来源和每次更正版本。</span><div>{editingId ? <button className="secondary-button" type="button" onClick={() => setEditingId(null)} disabled={busy}>取消更正</button> : null}<button className="primary-button" type="submit" disabled={!connection || !source.trim() || !metricType.trim() || !unit.trim() || !(localDate || todayDate) || !Number.isFinite(Number(value)) || value === "" || busy || online === false}>{busy ? "保存中…" : editingId ? "保存更正" : "加入待确认区"}</button></div></footer>
    </form>
    {!connection ? <p className="empty-note">连接后显示 Private 仓库中的健康暂存记录。</p> : pending.length === 0 ? <p className="empty-note">没有待确认记录。</p> : <ol className="learning-list">{pending.map((item) => <li key={item.record.id}><div><strong>{item.record.data.normalized_json.metric_type}</strong><code>{item.record.data.normalized_json.value} {item.record.data.normalized_json.unit}</code><small>{item.record.data.normalized_json.local_date} · {item.record.data.source.label} · 暂存 v{item.record.version}</small></div><div className="learning-item-actions"><button className="text-button" type="button" onClick={() => beginEdit(item)} disabled={busy}>更正</button><button className="text-button" type="button" onClick={() => onReject(item, "用户在暂存审核中拒绝")} disabled={busy || online === false}>拒绝</button><button className="primary-button" type="button" onClick={() => onConfirm(item)} disabled={busy || online === false}>{savingId === item.record.id ? "处理中…" : "确认并入库"}</button></div></li>)}</ol>}
    <div className="habit-heatmap"><div><strong>正式健康记录 {metrics.length} 条</strong><span>最近审核 {reviewed.length} 条；已拒绝的数据不会写入正式记录。</span></div>{metrics.length > 0 ? <ol className="learning-list">{metrics.slice(0, 5).map((item) => <li key={item.record.id}><div><strong>{item.record.data.metric_type}</strong><code>{item.record.data.value} {item.record.data.unit}</code><small>{item.record.data.local_date} · 已由你确认</small></div></li>)}</ol> : null}</div>
  </section>;
}
