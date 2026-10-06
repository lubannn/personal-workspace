import { describe, expect, it } from "vitest";
import { TRAVEL_PROVINCES } from "./travel-visits";
import { changeTravelProvince, isTravelCitySelection, retainedTravelCity, travelCitiesForProvince } from "./travel-cities";
import mainland from "./travel-city-data/mainland-cities.source.json";
import direct from "./travel-city-data/mainland-direct-units.source.json";
import taiwan from "./travel-city-data/taiwan-counties.source.json";

const fields = { province_id: "330000", city: "杭州市", start_date: "2026-10-01", end_date: "2026-10-03", notes: "西湖" };
describe("province-scoped travel cities", () => {
  it("covers every province and all sourced prefectural cities/regions and direct-admin units", () => {
    for (const province of TRAVEL_PROVINCES) {
      const options = travelCitiesForProvince(province.id);
      expect(options.length).toBeGreaterThan(0);
      expect(new Set(options).size).toBe(options.length);
      expect(options.every(name => name && !/市辖区|直辖县级行政区划/.test(name))).toBe(true);
    }
    for (const city of mainland.filter(c => !["11", "12", "31", "50"].includes(c.provinceCode) && !c.code.endsWith("90"))) {
      expect(travelCitiesForProvince(city.provinceCode + "0000")).toContain(city.name);
    }
    for (const city of direct) expect(travelCitiesForProvince(city.provinceCode + "0000")).toContain(city.name);
    expect(TRAVEL_PROVINCES.flatMap(p => travelCitiesForProvince(p.id))).toHaveLength(393);
    expect(travelCitiesForProvince("999999")).toEqual([]);
  });
  it("offers municipality/special-region units and all 22 Taiwan counties/cities", () => {
    for (const [id, name] of [["110000", "北京市"], ["120000", "天津市"], ["310000", "上海市"], ["500000", "重庆市"], ["810000", "香港"], ["820000", "澳门"]]) expect(travelCitiesForProvince(id)).toEqual([name]);
    expect(travelCitiesForProvince("710000")).toEqual(taiwan.filter(name => /[市縣]$/u.test(name)));
    expect(travelCitiesForProvince("710000")).toHaveLength(22);
    expect(travelCitiesForProvince("150000")).toContain("阿拉善盟");
    expect(travelCitiesForProvince("650000")).toContain("喀什地区");
    expect(travelCitiesForProvince("510000")).toContain("甘孜藏族自治州");
    expect(travelCitiesForProvince("420000")).toContain("神农架林区");
  });
  it("checks ownership and required selection without inferring province from text", () => {
    expect(isTravelCitySelection("330000", "杭州市")).toBe(true);
    expect(isTravelCitySelection("320000", "杭州市")).toBe(false);
    expect(isTravelCitySelection("330000", "")).toBe(false);
    expect(isTravelCitySelection("330000", "杭州")).toBe(false);
    expect(isTravelCitySelection("", "杭州市")).toBe(false);
  });
  it("keeps exact unmatched original values only for their original province, including same-name legacy records", () => {
    const originals = [{ province_id: "330000", city: "同名城市" }, { province_id: "320000", city: "同名城市" }];
    for (const original of originals) {
      expect(retainedTravelCity(original.province_id, original)).toBe(original.city);
      expect(isTravelCitySelection(original.province_id, original.city, original)).toBe(true);
      const other = original.province_id === "330000" ? "320000" : "330000";
      expect(isTravelCitySelection(other, original.city, original)).toBe(false);
    }
    expect(retainedTravelCity("330000", fields)).toBeNull();
    expect(isTravelCitySelection("330000", "任意新文本", originals[0])).toBe(false);
  });
  it("clears mismatched cities for both province-dropdown and map changes, preserves other fields", () => {
    expect(changeTravelProvince(fields, "330000")).toEqual(fields);
    expect(changeTravelProvince(fields, "320000")).toEqual({ ...fields, province_id: "320000", city: "" });
    const old = { ...fields, city: "杭州（历史文本）" };
    expect(changeTravelProvince(old, "330000", old)).toEqual(old);
    const switched = changeTravelProvince(old, "320000", old);
    expect(switched.city).toBe("");
    expect(changeTravelProvince(switched, "330000", old).city).toBe("");
  });
});
