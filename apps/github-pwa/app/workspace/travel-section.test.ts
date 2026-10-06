import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TravelSection } from "./travel-section";
import boundaries from "./travel-map/provinces.json";
import { TRAVEL_PROVINCES } from "../../../../src/lib/github-data/travel-visits";
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
});
