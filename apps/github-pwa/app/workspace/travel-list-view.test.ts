import { describe, expect, it } from "vitest";
import { createWorkspaceRecord, serializeRecord } from "../../../../src/lib/github-data/protocol";
import { createTravelVisitData, parseTravelVisitRecord } from "../../../../src/lib/github-data/travel-visits";
import type { SyncedTravelVisit } from "../../../../src/lib/github-data/travel-sync";
import { groupTravelVisitsByProvince, travelVisitsForDisplay } from "./travel-list-view";

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
  it("groups only provinces with active visits and keeps chosen time order inside each province", () => {
    const groups = groupTravelVisitsByProvince(travelVisitsForDisplay(input));
    expect(groups.map(group => group.province.id)).toEqual(["320000", "330000", "810000"]);
    expect(ids(groups[1].visits)).toEqual(["travel_c", "travel_a"]);
    expect(ids(groupTravelVisitsByProvince(travelVisitsForDisplay(input, "asc"))[1].visits)).toEqual(["travel_a", "travel_c"]);
    expect(groups[0].visits[0].record.data.city).toBe(groups[1].visits[1].record.data.city);
    expect(groups[1].visits[0].record.data.notes).toBe("保留备注");
    expect(groups[2].visits[0].record.data).toMatchObject({ start_date: "2024-02-29", end_date: "2024-02-29" });
  });
  it("handles empty collections, deleted-only collections, and one province without extra groups", () => {
    expect(travelVisitsForDisplay([])).toEqual([]);
    expect(groupTravelVisitsByProvince(travelVisitsForDisplay([deleted]))).toEqual([]);
    expect(groupTravelVisitsByProvince(travelVisitsForDisplay([a, c]))).toHaveLength(1);
  });
});
