import cities from "./travel-city-data/cities.json";
import type { TravelVisitFields } from "./travel-visits";

type ExistingCity = Pick<TravelVisitFields, "province_id" | "city">;
export function travelCitiesForProvince(provinceId: string): readonly string[] {
  return (cities as Record<string, string[]>)[provinceId] ?? [];
}

export function retainedTravelCity(provinceId: string, original?: ExistingCity) {
  return original?.province_id === provinceId && original.city && !travelCitiesForProvince(provinceId).includes(original.city) ? original.city : null;
}

// Strict only for the dropdown submission. Parsers retain arbitrary historical
// city strings and never infer/reassign province ownership from a city name.
export function isTravelCitySelection(provinceId: string, city: string, original?: ExistingCity) {
  return Boolean(city) && (travelCitiesForProvince(provinceId).includes(city) || retainedTravelCity(provinceId, original) === city);
}

export function changeTravelProvince(fields: TravelVisitFields, provinceId: string, original?: ExistingCity): TravelVisitFields {
  return { ...fields, province_id: provinceId, city: isTravelCitySelection(provinceId, fields.city, original) ? fields.city : "" };
}
