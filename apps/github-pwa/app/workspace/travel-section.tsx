"use client";

import { useRef, useState, type FormEvent } from "react";
import { TRAVEL_PROVINCES, createTravelVisitData, visitedTravelProvinces, type TravelVisitFields } from "../../../../src/lib/github-data/travel-visits";
import type { SyncedTravelVisit } from "../../../../src/lib/github-data/travel-sync";
import type { Connection } from "./page-model";
import boundaries from "./travel-map/provinces.json";
import "./travel.css";

const emptyFields: TravelVisitFields = { province_id: "", city: "", visited_on: "" };
type Props = {
  connection: Connection | null; online: boolean | null; files: SyncedTravelVisit[];
  loading: boolean; ready: boolean; saving: boolean; error: string;
  onRefresh: () => void; onSave: (fields: TravelVisitFields, current?: SyncedTravelVisit) => Promise<boolean>;
  onDelete: (current: SyncedTravelVisit) => Promise<boolean>; onRestore: (current: SyncedTravelVisit) => Promise<boolean>;
};

export function TravelSection({ connection, online, files, loading, ready, saving, error, onRefresh, onSave, onDelete, onRestore }: Props) {
  const [fields, setFields] = useState<TravelVisitFields>(emptyFields);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SyncedTravelVisit | undefined>();
  const [formError, setFormError] = useState("");
  const submitRef = useRef(false);
  const cityRef = useRef<HTMLInputElement>(null);
  const visited = visitedTravelProvinces(files.map(item => item.record));
  const active = files.filter(item => item.record.deleted_at === null).sort((a, b) => b.record.data.visited_on.localeCompare(a.record.data.visited_on) || b.record.id.localeCompare(a.record.id));
  const trash = files.filter(item => item.record.deleted_at !== null);
  const disabled = !connection || online === false || loading || saving || !ready;
  function cancel() { setFormOpen(false); setEditing(undefined); setFields(emptyFields); setFormError(""); }
  function selectProvince(id: string) {
    if (saving) return;
    setFields(previous => ({ ...previous, province_id: id })); setFormOpen(true); setFormError("");
    cityRef.current?.focus();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || submitRef.current) return;
    try { createTravelVisitData(fields); }
    catch { setFormError("请选择省级区域，填写城市和有效的到访日期。"); return; }
    submitRef.current = true; setFormError("");
    try { if (await onSave(fields, editing)) cancel(); }
    finally { submitRef.current = false; }
  }
  return <section className="travel-section" aria-labelledby="travel-title">
    <div className="travel-heading"><div><p className="eyebrow">TRAVEL</p><h2 id="travel-title">旅游</h2><p className="muted">记下去过的城市，点亮走过的省份。</p></div>
      <button type="button" onClick={onRefresh} disabled={!connection || online === false || loading || saving}>{loading ? "读取中…" : "刷新记录"}</button></div>
    {!connection && <p className="muted">连接私人数据仓库后，可保存和同步旅游记录。</p>}
    {online === false && <p role="status">当前离线，连接网络后可保存。</p>}
    {error && <p role="alert">{error}</p>}
    <div className="travel-stats" aria-live="polite"><strong>{!connection || !ready ? "—" : visited.size} / 34 <span>省级区域</span></strong><span>{!connection || !ready ? "—" : active.length} 条到访记录</span></div>
    <div className="travel-legend"><span><i className="travel-swatch visited" />已去</span><span><i className="travel-swatch" />未去</span></div>
    <svg className="travel-map" viewBox="0 0 790 540" role="group" aria-label="中国省级到访地图；可选择区域或使用下方省份列表">
      {boundaries.map(region => <g key={region.id}>
        <path d={region.path} fillRule="evenodd" className={`travel-region${visited.has(region.id) ? " visited" : ""}${fields.province_id === region.id && formOpen ? " selected" : ""}`}
          role="button" tabIndex={0} aria-label={`${TRAVEL_PROVINCES.find(p => p.id === region.id)!.label}，${visited.has(region.id) ? "已去" : "未去"}`} aria-pressed={visited.has(region.id)}
          onClick={() => selectProvince(region.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectProvince(region.id); } }}>
          <title>{region.name} · {visited.has(region.id) ? "已去" : "未去"}</title>
        </path>
        {!["110000", "120000", "310000", "810000", "820000"].includes(region.id) && <text x={region.x} y={region.y} aria-hidden="true">{region.name}</text>}
      </g>)}
      {/* Labels point at the actual small regions; province-list buttons supply roomy targets. */}
      {boundaries.filter(r => ["110000", "120000", "310000", "810000", "820000"].includes(r.id)).map(r => {
        const offset = r.id === "810000" ? [25, 22] : r.id === "820000" ? [-25, 35] : [25, -8];
        return <g key={`label-${r.id}`} aria-hidden="true"><line x1={r.x} y1={r.y} x2={r.x + offset[0]} y2={r.y + offset[1]} /><text x={r.x + offset[0]} y={r.y + offset[1]}>{r.name}</text></g>;
      })}
    </svg>
    <div className="travel-provinces" role="group" aria-label="全部34个省级区域">
      {TRAVEL_PROVINCES.map(province => <button type="button" key={province.id} className={visited.has(province.id) ? "visited" : ""} aria-label={`${province.label}，${visited.has(province.id) ? "已去" : "未去"}`} aria-pressed={visited.has(province.id)} onClick={() => selectProvince(province.id)} disabled={saving}><span aria-hidden="true">{visited.has(province.id) ? "✓ " : ""}</span>{province.name}</button>)}
    </div>
    <p className="travel-source muted">示意地图 · <a href="https://github.com/apache/echarts/tree/4.9.0/map" target="_blank" rel="noreferrer">Apache ECharts 4.9.0</a>（Apache-2.0），边界经投影简化；小区域也可在省份列表选择。</p>
    {!formOpen && <button type="button" className="primary-button" disabled={disabled} onClick={() => { setFields(emptyFields); setFormOpen(true); }}>新增到访</button>}
    {formOpen && <form className="travel-form" onSubmit={submit}>
      <h3>{editing ? "编辑到访" : "新增到访"}</h3>
      <fieldset disabled={disabled}>
        <label>所属省级区域<select aria-label="所属省级区域" required value={fields.province_id} onChange={event => setFields({ ...fields, province_id: event.target.value })}><option value="">请选择</option>{TRAVEL_PROVINCES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <label>城市<input ref={cityRef} required maxLength={100} value={fields.city} placeholder="填写城市名称" onChange={event => setFields({ ...fields, city: event.target.value })} /></label>
        <label>到访日期<input required type="date" min="0001-01-01" max="9999-12-31" value={fields.visited_on} onChange={event => setFields({ ...fields, visited_on: event.target.value })} /></label>
      </fieldset>
      {formError && <p role="alert">{formError}</p>}
      <div className="travel-actions"><button className="primary-button" type="submit" disabled={disabled}>{saving ? "保存中…" : "保存到访"}</button><button type="button" disabled={saving} onClick={cancel}>取消</button></div>
    </form>}
    <h3>到访记录</h3>
    {!loading && ready && active.length === 0 && <p className="muted">还没有记录。新增一次到访，就会点亮所属省份。</p>}
    <ul className="travel-records">{active.map(item => <li key={item.record.id}>
      <div><strong>{item.record.data.city}</strong><span>{TRAVEL_PROVINCES.find(p => p.id === item.record.data.province_id)!.label}</span><time dateTime={item.record.data.visited_on}>{item.record.data.visited_on}</time></div>
      <div className="travel-actions"><button type="button" disabled={disabled} aria-label={`编辑${item.record.data.city} ${item.record.data.visited_on}`} onClick={() => { setEditing(item); setFields(item.record.data); setFormOpen(true); setFormError(""); }}>编辑</button><button type="button" disabled={disabled || editing?.record.id === item.record.id} aria-label={`删除${item.record.data.city} ${item.record.data.visited_on}`} onClick={() => void onDelete(item)}>删除</button></div>
    </li>)}</ul>
    <details className="travel-trash"><summary>回收站（{trash.length}）</summary><ul className="travel-records">{trash.map(item => <li key={item.record.id}><div><strong>{item.record.data.city}</strong><span>{TRAVEL_PROVINCES.find(p => p.id === item.record.data.province_id)!.label}</span><time dateTime={item.record.data.visited_on}>{item.record.data.visited_on}</time></div><button type="button" disabled={disabled} onClick={() => void onRestore(item)}>恢复</button></li>)}</ul></details>
  </section>;
}
