import type { SyncedTravelVisit } from "../../../../src/lib/github-data/travel-sync";
import { travelCitiesForProvince } from "../../../../src/lib/github-data/travel-cities";

export type TravelSortOrder = "desc" | "asc";

export function travelVisitsForDisplay(files: readonly SyncedTravelVisit[], order: TravelSortOrder = "desc") {
  const direction = order === "desc" ? -1 : 1;
  // Preserve the existing start-date + record-id order by default. Copy before
  // sorting: display choices must never change the synchronized collection.
  return files.filter(item => item.record.deleted_at === null).sort((a, b) => direction * (
    a.record.data.start_date.localeCompare(b.record.data.start_date) || a.record.id.localeCompare(b.record.id)
  ));
}

export function travelProvinceVisits(sortedVisits: readonly SyncedTravelVisit[], provinceId: string) {
  return sortedVisits.filter(item => item.record.data.province_id === provinceId);
}

export function travelCityCoverage(files: readonly SyncedTravelVisit[], provinceId: string) {
  const options = travelCitiesForProvince(provinceId);
  const visits = files.filter(item => item.record.deleted_at === null && item.record.data.province_id === provinceId);
  // Exact catalog names only. Historical user text is never guessed or renamed.
  return { visited: new Set(visits.filter(item => options.includes(item.record.data.city)).map(item => item.record.data.city)), unmatched: visits.filter(item => !options.includes(item.record.data.city)) };
}
