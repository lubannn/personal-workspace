import { describe, expect, it } from "vitest";
import { createWorkspaceRecord, serializeRecord } from "../../../../src/lib/github-data/protocol";
import { createTravelVisitData, parseTravelVisitRecord } from "../../../../src/lib/github-data/travel-visits";
import type { SyncedTravelVisit } from "../../../../src/lib/github-data/travel-sync";
import { travelCityCoverage, travelProvinceVisits, travelVisitsForDisplay } from "./travel-list-view";

function visit(id: string, province: string, city: string, date: string, legacy = false): SyncedTravelVisit {
  const data = legacy ? { travel_visit_version: 1, province_id: province, city, visited_on: date } : createTravelVisitData({ province_id: province, city, start_date: date, end_date: date, notes: "保留备注" });
  const record = parseTravelVisitRecord(serializeRecord(createWorkspaceRecord({ entityType: "travel_visit", id, ownerId: "synthetic_owner", data })));
  return { record, path: `data/travel-visits/${id}.json`, blobSha: id };
}
const ids = (visits: readonly SyncedTravelVisit[]) => visits.map(item => item.record.id);

describe("travel display choices", () => {
  const a = visit("travel_a", "330000", "杭州", "2026-10-02");
  const b = visit("travel_b", "320000", "杭州", "2026-10-02");
  const c = visit("travel_c", "330000", "宁波", "2026-10-03");
  const old = visit("travel_old", "810000", "香港", "2024-02-29", true);
  const deleted = { ...visit("travel_deleted", "110000", "北京", "2026-10-04"), record: { ...a.record, id: "travel_deleted", deleted_at: "2026-10-05T00:00:00.000Z" } };
  const input = Object.freeze([a, c, deleted, old, b]);
  it("keeps default newest first and stable descending id ties, without changing cloud records", () => {
    const before = JSON.stringify(input);
    expect(ids(travelVisitsForDisplay(input))).toEqual(["travel_c", "travel_b", "travel_a", "travel_old"]);
    expect(JSON.stringify(input)).toBe(before);
    expect(travelVisitsForDisplay(input)[0]).toBe(c);
  });
  it("sorts oldest first, with stable ascending id ties even when input order changes", () => {
    expect(ids(travelVisitsForDisplay(input, "asc"))).toEqual(["travel_old", "travel_a", "travel_b", "travel_c"]);
    expect(ids(travelVisitsForDisplay([...input].reverse(), "asc"))).toEqual(["travel_old", "travel_a", "travel_b", "travel_c"]);
  });
  it("keeps every province visit in the selected order, while time view retains all cities and repeat visits", () => {
    const again = visit("travel_again", "330000", "杭州", "2026-10-04");
    const visits = travelVisitsForDisplay([...input, again]);
    expect(visits).toHaveLength(5);
    expect(ids(travelProvinceVisits(visits, "330000"))).toEqual(["travel_again", "travel_c", "travel_a"]);
    expect(ids(travelProvinceVisits(travelVisitsForDisplay([...input, again], "asc"), "330000"))).toEqual(["travel_a", "travel_c", "travel_again"]);
    expect(travelProvinceVisits(visits, "810000")[0].record.data).toMatchObject({ start_date: "2024-02-29", end_date: "2024-02-29" });
  });
  it("handles empty and deleted-only collections without hiding other cities in the time view", () => {
    expect(travelVisitsForDisplay([])).toEqual([]);
    expect(travelProvinceVisits(travelVisitsForDisplay([deleted]), "330000")).toEqual([]);
    expect(travelProvinceVisits(travelVisitsForDisplay([a, c]), "330000")).toHaveLength(2);
  });
  it("counts exact catalog cities once, rejects old spelling and other provinces, and unlights only the last active visit", () => {
    const exact = visit("travel_exact", "330000", "杭州市", "2026-10-01");
    const repeat = visit("travel_repeat", "330000", "杭州市", "2026-10-04");
    const otherProvince = visit("travel_wrong", "320000", "杭州市", "2026-10-03");
    expect([...travelCityCoverage([a, exact, repeat, otherProvince], "330000").visited]).toEqual(["杭州市"]);
    expect(travelCityCoverage([a, exact, repeat, otherProvince], "330000").unmatched).toEqual([a]);
    const erased = { ...exact, record: { ...exact.record, deleted_at: "2026-10-05T00:00:00.000Z" } };
    expect(travelCityCoverage([erased, repeat], "330000").visited.size).toBe(1);
    expect(travelCityCoverage([erased], "330000").visited.size).toBe(0);
    expect(travelCityCoverage([otherProvince], "330000").visited.size).toBe(0);
  });
});
