import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { changeTravelDatePart, travelDateFromParts, travelDateParts, travelMonthDays, TravelDateSelect } from "./travel-date-select";

describe("visible travel year/month/day controls", () => {
  it("round-trips full local dates including historical years without UTC conversion", () => {
    for (const date of ["2024-02-29", "0001-01-01", "9999-12-31"]) expect(travelDateFromParts(travelDateParts(date))).toBe(date);
    expect(travelDateParts("")).toEqual({ year: "", month: "", day: "" });
  });
  it("uses valid leap years and month lengths", () => {
    expect(travelMonthDays("2024", "02")).toBe(29);
    expect(travelMonthDays("2025", "02")).toBe(28);
    expect(travelMonthDays("1900", "02")).toBe(28);
    expect(travelMonthDays("2000", "02")).toBe(29);
    expect(travelMonthDays("2026", "04")).toBe(30);
    expect(travelMonthDays("2026", "01")).toBe(31);
    for (const [year, month] of [["", "02"], ["0000", "02"], ["202", "02"], ["2026", "13"]]) expect(travelMonthDays(year, month)).toBe(0);
  });
  it("clamps an existing day when changing year/month, while keeping empty day empty", () => {
    expect(changeTravelDatePart(travelDateParts("2024-02-29"), "year", "2025")).toEqual(travelDateParts("2025-02-28"));
    expect(changeTravelDatePart(travelDateParts("2026-01-31"), "month", "04")).toEqual(travelDateParts("2026-04-30"));
    expect(changeTravelDatePart({ year: "2026", month: "01", day: "" }, "month", "02").day).toBe("");
  });
  it("requires all three valid parts, keeping partial dates empty for the save guard", () => {
    for (const parts of [{ year: "2026", month: "01", day: "" }, { year: "", month: "01", day: "01" }, { year: "2026", month: "", day: "01" }, { year: "0000", month: "01", day: "01" }, { year: "2026", month: "02", day: "30" }]) expect(travelDateFromParts(parts)).toBe("");
  });
  it("renders an accessible, visible day dropdown with appropriate options and end-date lower bound", () => {
    const html = renderToStaticMarkup(createElement(TravelDateSelect, { label: "结束日期", value: "2024-02-29", min: "2024-02-28", onChange: () => {}, onInvalid: () => {} }));
    expect(html).not.toContain('type="date"');
    expect(html).toContain('aria-label="结束日期年"');
    expect(html).toContain('aria-label="结束日期月"');
    expect(html).toContain('aria-label="结束日期日"');
    expect(html).toContain('value="29" selected="">29日');
    expect(html).not.toContain('value="30"');
    expect(html).toContain('value="27" disabled="">27日');
    expect(html).toContain('value="28">28日');
    expect(html.match(/required=""/g)).toHaveLength(3);
    const empty = renderToStaticMarkup(createElement(TravelDateSelect, { label: "开始日期", value: "", onChange: () => {}, onInvalid: () => {} }));
    expect(empty).toContain('aria-label="开始日期日" required="" disabled=""');
  });
});
