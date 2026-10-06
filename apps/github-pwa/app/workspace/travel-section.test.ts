import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { changeTravelStartDate, travelDateError, TravelCitySelect, TravelSection } from "./travel-section";
import boundaries from "./travel-map/provinces.json";
import { createWorkspaceRecord } from "../../../../src/lib/github-data/protocol";
import { createTravelVisitData, TRAVEL_PROVINCES } from "../../../../src/lib/github-data/travel-visits";
import { WORKSPACE_MODULE_COLLECTIONS } from "./workspace-module-loading";
import { WORKSPACE_TABS, workspaceTabFromHash } from "./workspace-tab-navigation";

describe("travel UI registration and geography", () => {
  it("registers a sibling tab and loads only travel", () => {
    expect(WORKSPACE_TABS.find(t => t.id === "travel")?.label).toBe("旅游");
    expect(workspaceTabFromHash("#travel-title")).toBe("travel");
    expect(WORKSPACE_MODULE_COLLECTIONS.travel).toEqual(["travel"]);
  });
  it("matches all 34 sourced boundaries to persistent region identifiers", () => {
    expect(boundaries.map(r => r.id).sort()).toEqual(TRAVEL_PROVINCES.map(p => p.id).sort());
    expect(boundaries.every(r => r.path.startsWith("M") && r.path.endsWith("Z"))).toBe(true);
    for (const region of boundaries) {
      for (const point of region.path.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)) {
        expect(Number(point[1])).toBeGreaterThanOrEqual(0);
        expect(Number(point[1])).toBeLessThanOrEqual(790);
        expect(Number(point[2])).toBeGreaterThanOrEqual(0);
        expect(Number(point[2])).toBeLessThanOrEqual(540);
      }
    }
  });
  it("provides keyboard map buttons and roomy province-list controls including Hong Kong/Macao", () => {
    const html = renderToStaticMarkup(createElement(TravelSection, { connection: null, online: true, files: [], loading: false, ready: false, saving: false, error: "", onRefresh: () => {}, onSave: async () => true, onDelete: async () => true, onRestore: async () => true }));
    expect(html.match(/role="button" tabindex="0"/g)).toHaveLength(34);
    expect(html).toContain('aria-label="香港特别行政区，未去"');
    expect(html).toContain('aria-label="澳门特别行政区，未去"');
    expect(html).toContain('disabled="">新增到访');
    expect(html).toContain("Apache-2.0");
  });
  it("renders ranges, same-day visits and escaped multiline notes in active/trash lists", () => {
    const files = [
      { city: "杭州", start_date: "2026-10-01", end_date: "2026-10-03", notes: "西湖\n<script>提示</script>" },
      { city: "上海", start_date: "2026-10-04", end_date: "2026-10-04", notes: "" },
    ].map((fields, index) => ({ record: { ...createWorkspaceRecord({ entityType: "travel_visit", id: `travel_${index}`, ownerId: "test_owner", data: createTravelVisitData({ province_id: "330000", ...fields }) }), deleted_at: index ? "2026-10-05T00:00:00.000Z" : null }, path: `data/travel-visits/travel_${index}.json`, blobSha: "test" }));
    const html = renderToStaticMarkup(createElement(TravelSection, { connection: { ownerId: "test_owner", repository: "example/synthetic", ownerLogin: "example", timezone: "Asia/Shanghai" }, online: true, files, loading: false, ready: true, saving: false, error: "", onRefresh: () => {}, onSave: async () => true, onDelete: async () => true, onRestore: async () => true }));
    expect(html).toContain('<time dateTime="2026-10-01">2026-10-01</time> 至 <time dateTime="2026-10-03">2026-10-03</time>');
    expect(html).toContain('2026-10-04</time>（同日）');
    expect(html).toContain('西湖\n&lt;script&gt;提示&lt;/script&gt;');
    expect(html).not.toContain('<script>提示');
    expect(html.match(/class="travel-notes"/g)).toHaveLength(1);
  });
  it("renders only the selected province's cities and an explicit old-value retention option", () => {
    const props = { provinceId: "330000", city: "杭州", original: { province_id: "330000", city: "杭州" }, onChange: () => {} };
    const html = renderToStaticMarkup(createElement(TravelCitySelect, props));
    expect(html).toContain('aria-label="城市"');
    expect(html).toContain('required=""');
    expect(html).toContain('value="杭州" selected="">保留原记录：杭州');
    expect(html).toContain('<option value="杭州市">杭州市</option>');
    expect(html).not.toContain('南京市');
    const switched = renderToStaticMarkup(createElement(TravelCitySelect, { ...props, provinceId: "320000", city: "" }));
    expect(switched).toContain('南京市');
    expect(switched).not.toContain('保留原记录：杭州');
    expect(switched).not.toContain('杭州市');
    const empty = renderToStaticMarkup(createElement(TravelCitySelect, { ...props, provinceId: "", city: "" }));
    expect(empty).toContain('disabled=""');
    expect(empty).toContain('请先选择省级区域');
  });
});

describe("travel date editing", () => {
  const fields = { province_id: "330000", city: "杭州市", start_date: "", end_date: "2026-10-05", notes: "原备注\n保持原样" };
  it("moves a previously entered end date to the later start date without changing other fields or the original", () => {
    expect(changeTravelStartDate(fields, "2026-10-06")).toEqual({ ...fields, start_date: "2026-10-06", end_date: "2026-10-06" });
    expect(fields.start_date).toBe("");
    expect(fields.end_date).toBe("2026-10-05");
  });
  it("keeps same-day, later, and empty end dates unchanged", () => {
    expect(changeTravelStartDate(fields, "2026-10-05")).toEqual({ ...fields, start_date: "2026-10-05" });
    expect(changeTravelStartDate(fields, "2026-10-04")).toEqual({ ...fields, start_date: "2026-10-04" });
    expect(changeTravelStartDate({ ...fields, end_date: "" }, "2026-10-06")).toEqual({ ...fields, start_date: "2026-10-06", end_date: "" });
  });
  it("does not silently replace an invalid endpoint or an empty start", () => {
    expect(changeTravelStartDate({ ...fields, end_date: "2026-02-30" }, "2026-10-06").end_date).toBe("2026-02-30");
    expect(changeTravelStartDate(fields, "").end_date).toBe(fields.end_date);
    expect(changeTravelStartDate(fields, "2026-02-30").end_date).toBe(fields.end_date);
  });
  it("reports invalid or reversed dates, while allowing same-day and incomplete fields for editing", () => {
    expect(travelDateError({ start_date: "2026-10-06", end_date: "2026-10-05" })).toBe("结束日期不得早于开始日期。");
    expect(travelDateError({ start_date: "2026-10-06", end_date: "2026-02-30" })).toBe("请输入有效的结束日期。");
    expect(travelDateError({ start_date: "2026-02-30", end_date: "2026-10-06" })).toBe("请输入有效的开始日期。");
    expect(travelDateError({ start_date: "2026-10-06", end_date: "2026-10-06" })).toBe("");
    expect(travelDateError({ start_date: "2026-10-06", end_date: "" })).toBe("");
    expect(travelDateError({ start_date: "", end_date: "2026-10-05" })).toBe("");
  });
});
