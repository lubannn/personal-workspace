import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TRAVEL_PROVINCES } from "../../../../../src/lib/github-data/travel-visits";
import type { TravelCityMapData } from "../travel-province-map";
import { cityLabelLeader, layoutCityMapLabels } from "./label-layout";

describe("complete city-map labels", () => {
  it.each(TRAVEL_PROVINCES)("fits every mapped name without overlap in $label, including narrow containers", province => {
    const map: TravelCityMapData = JSON.parse(readFileSync(new URL(`../../../public/travel-city-maps/${province.id}.json`, import.meta.url), "utf8"));
    // Container widths, not viewport widths: include surrounding mobile padding.
    for (const width of [218, 250, 318, 540, 850]) {
      const layout = layoutCityMapLabels(map.regions, width);
      expect(layout.labels.map(l => l.lines.join("")).sort()).toEqual(map.regions.flatMap(r => r.city ? [r.city] : []).sort());
      expect(layout.fontSize * width / 790).toBeGreaterThanOrEqual(13 - 0.001);
      for (const [index, label] of layout.labels.entries()) {
        expect(label.x - label.width / 2).toBeGreaterThanOrEqual(0);
        expect(label.x + label.width / 2).toBeLessThanOrEqual(790);
        expect(label.y - label.height / 2).toBeGreaterThanOrEqual(0);
        expect(label.y + label.height / 2).toBeLessThanOrEqual(layout.height);
        for (const other of layout.labels.slice(index + 1)) {
          expect(Math.abs(label.x - other.x) >= (label.width + other.width) / 2 ||
            Math.abs(label.y - other.y) >= (label.height + other.height) / 2).toBe(true);
        }
        const end = cityLabelLeader(label);
        if (end) {
          expect(Math.max(Math.abs(end.x - label.x) / (label.width / 2), Math.abs(end.y - label.y) / (label.height / 2))).toBeCloseTo(1);
        }
      }
    }
  });
  it("adds space for coincident long names and keeps their original leader anchors", () => {
    const regions = Array.from({ length: 32 }, (_, i) => ({ city: `合成自治州完整城市名称${i}`, x: 395, y: 270 }));
    const layout = layoutCityMapLabels(regions, 218);
    expect(layout.height).toBeGreaterThan(540);
    expect(layout.labels).toHaveLength(32);
    expect(layout.labels.every(l => l.anchorX === 395 && l.anchorY === 270 + layout.mapOffsetY)).toBe(true);
    expect(layoutCityMapLabels(regions, 218)).toEqual(layout);
    expect(layoutCityMapLabels([], 218).labels).toEqual([]);
  });
});
