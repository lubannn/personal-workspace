import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "./manifest.json";
import { travelCitiesForProvince } from "../../../../../src/lib/github-data/travel-cities";
import { TRAVEL_PROVINCES } from "../../../../../src/lib/github-data/travel-visits";
import type { TravelCityMapData } from "../travel-province-map";

const readMap = (id: string): TravelCityMapData => JSON.parse(readFileSync(new URL(`../../../public/travel-city-maps/${id}.json`, import.meta.url), "utf8"));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
describe("licensed static city-map geography", () => {
  it("accounts for all 34 provinces / 393 catalog units with 389 mapped and four explicit missing boundaries", () => {
    expect(Object.keys(manifest).sort()).toEqual(TRAVEL_PROVINCES.map(p => p.id).sort());
    expect(Object.values(manifest).reduce((sum, p) => sum + p.catalog_count, 0)).toBe(393);
    expect(Object.values(manifest).reduce((sum, p) => sum + p.mapped_count, 0)).toBe(389);
    expect(readMap("540000").missing).toEqual(["那曲市"]);
    expect(new Set(readMap("650000").missing)).toEqual(new Set(["新星市", "白杨市", "胡杨河市"]));
    expect(Object.values(manifest).reduce((sum, p) => sum + p.missing.length, 0)).toBe(4);
  });
  it("keeps reproducible source/output hashes and every real polygon/ring, without invented city shapes", () => {
    for (const [id, info] of Object.entries(manifest)) {
      const bytes = readFileSync(new URL(`../../../public/travel-city-maps/${id}.json`, import.meta.url));
      expect(hash(bytes)).toBe(info.output_sha256);
      const isWhole = info.source.endsWith("china.json");
      const source = readFileSync(new URL(isWhole ? "../travel-map/china.source.json" : `sources/${info.source.split("/").at(-1)}`, import.meta.url));
      expect(hash(source)).toBe(info.source_sha256);
      const features = JSON.parse(source.toString()).features.filter((f: { id: string }) => !isWhole || f.id === id);
      const rings = features.flatMap((f: { geometry: { type: string; coordinates: string[] | string[][] } }) => f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat());
      const map = readMap(id);
      expect(map.regions.reduce((sum, r) => sum + (r.path.match(/M/g)?.length ?? 0), 0)).toBe(rings.length);
      expect(bytes.length).toBeLessThan(100_000); // Only the selected province is fetched.
      const names = map.regions.map(r => r.city).filter(Boolean);
      expect(new Set(names).size).toBe(names.length);
      expect([...names, ...map.missing].sort()).toEqual([...travelCitiesForProvince(id)].sort());
      for (const region of map.regions) {
        expect(region.path).toMatch(/^M.*Z$/);
        for (const point of region.path.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)) {
          expect(Number(point[1])).toBeGreaterThanOrEqual(14.9); expect(Number(point[1])).toBeLessThanOrEqual(775.1);
          expect(Number(point[2])).toBeGreaterThanOrEqual(14.9); expect(Number(point[2])).toBeLessThanOrEqual(525.1);
        }
      }
    }
  });
  it("retains historical unmatched regions neutrally and respects municipality/HK/Macao/Taiwan catalog granularity", () => {
    expect(readMap("370000").regions.filter(r => !r.city).map(r => r.sourceName)).toEqual(["莱芜市"]);
    expect(readMap("540000").regions.filter(r => !r.city).map(r => r.sourceName)).toEqual(["那曲地区"]);
    expect(readMap("710000").regions.filter(r => r.city)).toHaveLength(22);
    expect(readMap("710000").regions.some(r => r.sourceName === "台北市" && r.city === "臺北市")).toBe(true);
    for (const id of ["110000", "120000", "310000", "500000", "810000", "820000"]) {
      expect(readMap(id).regions).toHaveLength(1);
      expect(readMap(id).regions[0].city).toBe(travelCitiesForProvince(id)[0]);
    }
    expect(readFileSync(new URL("../../../public/travel-city-maps/LICENSE", import.meta.url), "utf8")).toContain("Apache License");
    expect(readFileSync(new URL("../../../public/travel-city-maps/NOTICE", import.meta.url), "utf8")).toContain("Apache");
  });
});
