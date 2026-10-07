"use client";

import { useEffect, useState } from "react";
import { travelCitiesForProvince } from "../../../../src/lib/github-data/travel-cities";
import type { SyncedTravelVisit } from "../../../../src/lib/github-data/travel-sync";
import { travelCityCoverage } from "./travel-list-view";
const mapBase = `${process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? ""}/travel-city-maps`;

export type TravelCityMapData = {
  version: number; province_id: string;
  regions: { sourceName: string; city: string | null; x: number; y: number; path: string }[];
  missing: string[];
};

export function TravelProvinceMap({ provinceId, label, files, selectedCity, saving, onSelectCity }: {
  provinceId: string; label: string; files: readonly SyncedTravelVisit[]; selectedCity: string; saving: boolean;
  onSelectCity: (city: string) => void;
}) {
  const [map, setMap] = useState<TravelCityMapData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${mapBase}/${provinceId}.json`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw Error("Map unavailable");
      const data = await response.json() as TravelCityMapData;
      if (data.version !== 1 || data.province_id !== provinceId || !Array.isArray(data.regions)) throw Error("Invalid map");
      if (!controller.signal.aborted) setMap(data);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [provinceId]);
  const cities = travelCitiesForProvince(provinceId);
  const { visited, unmatched } = travelCityCoverage(files, provinceId);
  const mapped = new Set(map?.regions.map(region => region.city).filter(Boolean));
  const unresolved = map?.regions.filter(region => !region.city) ?? [];
  const wholeCity = ["110000", "120000", "310000", "500000", "810000", "820000"].includes(provinceId);
  return <section className="travel-province-view" aria-label={`${label}城市地图与覆盖`}>
    <h4>{label} · 城市到访地图</h4>
    <p className="travel-city-stats" aria-live="polite">已去 {visited.size} / {cities.length} 个城市/地区{map && <> · {mapped.size} 个有对应边界</>}</p>
    {wholeCity && <p className="muted">按现有记录单元显示全市整体边界，不细分区县。</p>}
    {error ? <p role="status">城市边界暂时无法加载，请使用下面的完整城市列表。</p> : !map ? <p role="status">读取该省城市边界中…</p> : <svg className="travel-map travel-city-map" viewBox="0 0 790 540" role="group" aria-label={`${label}城市到访地图`}>
      {map.regions.map((region, index) => <g key={`${region.sourceName}-${index}`}>
        <path d={region.path} fillRule="evenodd" className={`travel-region${region.city && visited.has(region.city) ? " visited" : ""}${region.city === selectedCity ? " selected" : ""}${region.city ? "" : " unavailable"}`}
          role={region.city ? "button" : "img"} tabIndex={region.city ? 0 : undefined}
          aria-label={region.city ? `${region.city}，${visited.has(region.city) ? "已去" : "未去"}` : `${region.sourceName}，历史边界未对应当前城市`}
          aria-pressed={region.city ? visited.has(region.city) : undefined}
          onClick={() => { if (region.city && !saving) onSelectCity(region.city); }}
          onKeyDown={event => { if (region.city && !saving && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelectCity(region.city); } }}>
          <title>{region.city ?? region.sourceName} · {region.city ? visited.has(region.city) ? "已去" : "未去" : "历史边界未对应"}</title>
        </path>
        {region.city && <text x={region.x} y={region.y} aria-hidden="true">{region.city}</text>}
      </g>)}
    </svg>}
    {map?.missing.length ? <p className="travel-boundary-warning" role="status">缺少对应边界：{map.missing.join("、")}。这些城市保留在列表中，不绘制或猜测边界。</p> : null}
    {unresolved.length > 0 && <p className="travel-boundary-warning">历史边界未对应当前城市：{unresolved.map(region => region.sourceName).join("、")}。以灰色显示，不用于点亮；未拼接到其他城市。</p>}
    {unmatched.length > 0 && <p className="travel-boundary-warning">{unmatched.length} 条历史城市名称未对应城市选项，未用于点亮地图；完整记录保留在下方。</p>}
    <div className="travel-city-list" role="group" aria-label={`${label}全部城市`}>
      {cities.map(city => <button key={city} type="button" disabled={saving} className={visited.has(city) ? "visited" : ""} aria-label={`${city}，${visited.has(city) ? "已去" : "未去"}`} aria-pressed={visited.has(city)} onClick={() => onSelectCity(city)}>
        {city}{visited.has(city) ? " ✓" : ""}{map && !mapped.has(city) ? "（无对应边界）" : ""}
      </button>)}
    </div>
    <p className="travel-source muted">历史边界示意 · <a href="https://github.com/apache/echarts/tree/4.9.0/map/json/province" target="_blank" rel="noreferrer">Apache ECharts 4.9.0</a>（<a href={`${mapBase}/LICENSE`} target="_blank" rel="noreferrer">Apache-2.0</a>、<a href={`${mapBase}/NOTICE`} target="_blank" rel="noreferrer">NOTICE</a>）；小区域可从完整城市列表选择。城市名称按现有名单精确匹配，省级已去统计不代表省内所有城市已去。</p>
  </section>;
}
