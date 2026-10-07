"use client";

import { useRef, useState, type FormEvent, type Ref } from "react";
import { TRAVEL_PROVINCES, createTravelVisitData, isTravelDate, visitedTravelProvinces, type TravelVisitFields } from "../../../../src/lib/github-data/travel-visits";
import { travelCitiesForProvince, retainedTravelCity, isTravelCitySelection, changeTravelProvince } from "../../../../src/lib/github-data/travel-cities";
import type { SyncedTravelVisit } from "../../../../src/lib/github-data/travel-sync";
import type { Connection } from "./page-model";
import { travelProvinceVisits, travelVisitsForDisplay, type TravelSortOrder } from "./travel-list-view";
import { TravelProvinceMap } from "./travel-province-map";
import boundaries from "./travel-map/provinces.json";
import "./travel.css";

const emptyFields: TravelVisitFields = { province_id: "", city: "", start_date: "", end_date: "", notes: "" };
type Props = {
  nationalMapRequest?: number;
  connection: Connection | null; online: boolean | null; files: SyncedTravelVisit[];
  loading: boolean; ready: boolean; saving: boolean; error: string;
  onRefresh: () => void; onSave: (fields: TravelVisitFields, current?: SyncedTravelVisit) => Promise<boolean>;
  onDelete: (current: SyncedTravelVisit) => Promise<boolean>; onRestore: (current: SyncedTravelVisit) => Promise<boolean>;
};

export function TravelSection({ nationalMapRequest = 0, connection, online, files, loading, ready, saving, error, onRefresh, onSave, onDelete, onRestore }: Props) {
  const [fields, setFields] = useState<TravelVisitFields>(emptyFields);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SyncedTravelVisit | undefined>();
  const [formError, setFormError] = useState("");
  const [view, setView] = useState<"time" | "province">("time");
  const [sortOrder, setSortOrder] = useState<TravelSortOrder>("desc");
  const [mapProvince, setMapProvince] = useState("");
  const [seenNationalMapRequest, setSeenNationalMapRequest] = useState(nationalMapRequest);
  // Navigation also fires when the travel tab is already active. Reset only
  // presentation state; retain the mounted component and all unsaved fields.
  if (seenNationalMapRequest !== nationalMapRequest) {
    setSeenNationalMapRequest(nationalMapRequest);
    setView("time"); setMapProvince("");
  }
  const submitRef = useRef(false);
  const cityRef = useRef<HTMLSelectElement>(null);
  const visited = visitedTravelProvinces(files.map(item => item.record));
  const active = travelVisitsForDisplay(files, sortOrder);
  const province = TRAVEL_PROVINCES.find(province => province.id === mapProvince);
  const provinceVisits = travelProvinceVisits(active, mapProvince);
  const trash = files.filter(item => item.record.deleted_at !== null);
  const disabled = !connection || online === false || loading || saving || !ready;
  const dateError = travelDateError(fields);
  function cancel() { setFormOpen(false); setEditing(undefined); setFields(emptyFields); setFormError(""); }
  function selectProvince(id: string) {
    setView("province"); setMapProvince(id);
  }
  function selectCity(city: string) {
    if (saving) return;
    setFields(previous => ({ ...changeTravelProvince(previous, mapProvince, editing?.record.data), city })); setFormOpen(true); setFormError("");
    cityRef.current?.focus();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || submitRef.current) return;
    if (dateError) { setFormError(dateError); return; }
    if (!isTravelCitySelection(fields.province_id, fields.city, editing?.record.data)) {
      setFormError("请选择该省的城市，或明确保留原记录的城市。"); return;
    }
    try { createTravelVisitData(fields); }
    catch { setFormError("请选择省级区域，选择城市及有效的开始、结束日期；结束日期不得早于开始日期。"); return; }
    submitRef.current = true; setFormError("");
    try { if (await onSave(fields, editing)) cancel(); }
    finally { submitRef.current = false; }
  }
  function visitRow(item: SyncedTravelVisit) {
    return <li key={item.record.id}>
      <TravelVisitDetails item={item} />
      <div className="travel-actions"><button type="button" disabled={disabled} aria-label={`编辑${item.record.data.city} ${item.record.data.start_date}`} onClick={() => { setEditing(item); setFields(item.record.data); setFormOpen(true); setFormError(""); }}>编辑</button><button type="button" disabled={disabled || editing?.record.id === item.record.id} aria-label={`删除${item.record.data.city} ${item.record.data.start_date}`} onClick={() => void onDelete(item)}>删除</button></div>
    </li>;
  }
  return <section className="travel-section" aria-labelledby="travel-title">
    <div className="travel-heading"><div><p className="eyebrow">TRAVEL</p><h2 id="travel-title">旅行</h2><p className="muted">记下去过的城市，点亮走过的省份。</p></div>
      <button type="button" onClick={onRefresh} disabled={!connection || online === false || loading || saving}>{loading ? "读取中…" : "刷新记录"}</button></div>
    {!connection && <p className="muted">连接私人数据仓库后，可保存和同步旅行记录。</p>}
    {online === false && <p role="status">当前离线，连接网络后可保存。</p>}
    {error && <p role="alert">{error}</p>}
    <div className="travel-stats" aria-live="polite"><strong>{!connection || !ready ? "—" : visited.size} / 34 <span>省级区域</span></strong><span>{!connection || !ready ? "—" : active.length} 条到访记录</span></div>
    <div className="travel-legend"><span><i className="travel-swatch visited" />已去</span><span><i className="travel-swatch" />未去</span></div>
    <div className="travel-national-map" hidden={view === "province" && Boolean(mapProvince)}>
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
    </div>
    {!formOpen && <button type="button" className="primary-button" disabled={disabled} onClick={() => { setFields(emptyFields); setFormOpen(true); }}>新增到访</button>}
    {formOpen && <form className="travel-form" onSubmit={submit}>
      <h3>{editing ? "编辑到访" : "新增到访"}</h3>
      <fieldset disabled={disabled}>
        <label>所属省级区域<select aria-label="所属省级区域" required value={fields.province_id} onChange={event => setFields(changeTravelProvince(fields, event.target.value, editing?.record.data))}><option value="">请选择</option>{TRAVEL_PROVINCES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <TravelCitySelect provinceId={fields.province_id} city={fields.city} original={editing?.record.data} selectRef={cityRef} onChange={city => setFields({ ...fields, city })} />
        <label>开始日期<input required type="date" min="0001-01-01" max="9999-12-31" value={fields.start_date} onChange={event => { const startDate = event.target.value; setFields(previous => changeTravelStartDate(previous, startDate)); setFormError(""); }} /></label>
        <label>结束日期<input required type="date" min={fields.start_date || "0001-01-01"} max="9999-12-31" value={fields.end_date} aria-invalid={dateError ? true : undefined} aria-describedby={dateError ? "travel-date-error" : undefined} onInvalid={() => setFormError("请选择有效的结束日期，且不得早于开始日期。")} onChange={event => { setFields({ ...fields, end_date: event.target.value }); setFormError(""); }} /></label>
        <label className="travel-notes-field">备注（可选）<textarea aria-label="备注（可选）" rows={3} maxLength={2000} value={fields.notes ?? ""} placeholder="景点、到访提示等" onChange={event => setFields({ ...fields, notes: event.target.value })} /></label>
      </fieldset>
      {dateError && <p id="travel-date-error" role="alert">{dateError}</p>}
      {formError && <p role="alert">{formError}</p>}
      <div className="travel-actions"><button className="primary-button" type="submit" disabled={disabled || Boolean(dateError)}>{saving ? "保存中…" : "保存到访"}</button><button type="button" disabled={saving} onClick={cancel}>取消</button></div>
    </form>}
    <div className="travel-visit-list">
      <h3>到访记录</h3>
      <div className="travel-list-controls">
        <label>查看方式<select aria-label="到访记录查看方式" value={view} onChange={event => setView(event.target.value as "time" | "province")}><option value="time">按时间查看（全部城市）</option><option value="province">按省份查看（城市地图）</option></select></label>
        <label>时间顺序<select aria-label="到访记录时间顺序" value={sortOrder} onChange={event => setSortOrder(event.target.value as TravelSortOrder)}><option value="desc">时间倒序（新到旧）</option><option value="asc">时间正序（旧到新）</option></select></label>
      </div>
      <p className="travel-list-order muted">{view === "time" ? "所有城市的每次到访完整显示，" : "所选省份的每次到访完整显示，"}按开始日期{sortOrder === "desc" ? "从新到旧" : "从旧到新"}；同日记录顺序固定。</p>
      {view === "time" ? <>
        {!loading && ready && active.length === 0 && <p className="muted">还没有记录。新增一次到访，就会点亮所属省份。</p>}
        <ul className="travel-records">{active.map(visitRow)}</ul>
      </> : <>
        <div className="travel-province-navigation">
          <label>查看省份<select aria-label="查看省份" value={mapProvince} onChange={event => setMapProvince(event.target.value)}><option value="">请选择省份</option>{TRAVEL_PROVINCES.map(province => <option key={province.id} value={province.id}>{province.label}</option>)}</select></label>
          <button type="button" onClick={() => { setMapProvince(""); setView("time"); }}>返回全国</button>
        </div>
        {province ? <>
          <TravelProvinceMap key={province.id} provinceId={province.id} label={province.label} files={files} selectedCity={fields.province_id === province.id && formOpen ? fields.city : ""} saving={saving} onSelectCity={selectCity} />
          <h4>{province.label}到访记录（{provinceVisits.length} 条）</h4>
          {!loading && ready && provinceVisits.length === 0 && <p className="muted">该省还没有到访记录。</p>}
          <ul className="travel-records">{provinceVisits.map(visitRow)}</ul>
        </> : <p className="muted">从全国地图或省份下拉选择一个省份，查看城市已去与未去。</p>}
      </>}
    </div>
    <details className="travel-trash"><summary>回收站（{trash.length}）</summary><ul className="travel-records">{trash.map(item => <li key={item.record.id}><TravelVisitDetails item={item} /><button type="button" disabled={disabled} onClick={() => void onRestore(item)}>恢复</button></li>)}</ul></details>
  </section>;
}

export function changeTravelStartDate(fields: TravelVisitFields, startDate: string): TravelVisitFields {
  return { ...fields, start_date: startDate, end_date: isTravelDate(startDate) && isTravelDate(fields.end_date) && startDate > fields.end_date ? startDate : fields.end_date };
}

export function travelDateError(fields: Pick<TravelVisitFields, "start_date" | "end_date">): string {
  if (fields.start_date && !isTravelDate(fields.start_date)) return "请输入有效的开始日期。";
  if (fields.end_date && !isTravelDate(fields.end_date)) return "请输入有效的结束日期。";
  return isTravelDate(fields.start_date) && isTravelDate(fields.end_date) && fields.end_date < fields.start_date ? "结束日期不得早于开始日期。" : "";
}

function TravelVisitDetails({ item }: { item: SyncedTravelVisit }) {
  const data = item.record.data;
  return <div className="travel-record-content">
    <div className="travel-record-meta"><strong>{data.city}</strong><span>{TRAVEL_PROVINCES.find(p => p.id === data.province_id)!.label}</span><span className="travel-dates"><time dateTime={data.start_date}>{data.start_date}</time>{data.end_date === data.start_date ? "（同日）" : <> 至 <time dateTime={data.end_date}>{data.end_date}</time></>}</span></div>
    {data.notes && <p className="travel-notes">{data.notes}</p>}
  </div>;
}

export function TravelCitySelect({ provinceId, city, original, selectRef, onChange }: {
  provinceId: string; city: string; original?: Pick<TravelVisitFields, "province_id" | "city">;
  selectRef?: Ref<HTMLSelectElement>; onChange: (city: string) => void;
}) {
  const options = travelCitiesForProvince(provinceId);
  const retained = retainedTravelCity(provinceId, original);
  return <label>城市<select aria-label="城市" ref={selectRef} required disabled={!options.length} value={city} onChange={event => onChange(event.target.value)}>
    <option value="">{provinceId ? "请选择城市" : "请先选择省级区域"}</option>
    {retained && <option value={retained}>保留原记录：{retained}</option>}
    {options.map(name => <option value={name} key={name}>{name}</option>)}
  </select></label>;
}
