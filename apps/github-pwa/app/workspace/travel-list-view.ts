import type { SyncedTravelVisit } from "../../../../src/lib/github-data/travel-sync";
import { TRAVEL_PROVINCES } from "../../../../src/lib/github-data/travel-visits";

export type TravelSortOrder = "desc" | "asc";

export function travelVisitsForDisplay(files: readonly SyncedTravelVisit[], order: TravelSortOrder = "desc") {
  const direction = order === "desc" ? -1 : 1;
  // Preserve the existing start-date + record-id order by default. Copy before
  // sorting: display choices must never change the synchronized collection.
  return files.filter(item => item.record.deleted_at === null).sort((a, b) => direction * (
    a.record.data.start_date.localeCompare(b.record.data.start_date) || a.record.id.localeCompare(b.record.id)
  ));
}

export function groupTravelVisitsByProvince(sortedVisits: readonly SyncedTravelVisit[]) {
  return TRAVEL_PROVINCES.map(province => ({
    province,
    visits: sortedVisits.filter(item => item.record.data.province_id === province.id),
  })).filter(group => group.visits.length > 0);
}
