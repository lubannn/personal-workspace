import { parseRecord, type WorkspaceRecord } from "./protocol";

export const TRAVEL_PROVINCES = [
  ["110000", "北京", "北京市"], ["120000", "天津", "天津市"], ["130000", "河北", "河北省"],
  ["140000", "山西", "山西省"], ["150000", "内蒙古", "内蒙古自治区"], ["210000", "辽宁", "辽宁省"],
  ["220000", "吉林", "吉林省"], ["230000", "黑龙江", "黑龙江省"], ["310000", "上海", "上海市"],
  ["320000", "江苏", "江苏省"], ["330000", "浙江", "浙江省"], ["340000", "安徽", "安徽省"],
  ["350000", "福建", "福建省"], ["360000", "江西", "江西省"], ["370000", "山东", "山东省"],
  ["410000", "河南", "河南省"], ["420000", "湖北", "湖北省"], ["430000", "湖南", "湖南省"],
  ["440000", "广东", "广东省"], ["450000", "广西", "广西壮族自治区"], ["460000", "海南", "海南省"],
  ["500000", "重庆", "重庆市"], ["510000", "四川", "四川省"], ["520000", "贵州", "贵州省"],
  ["530000", "云南", "云南省"], ["540000", "西藏", "西藏自治区"], ["610000", "陕西", "陕西省"],
  ["620000", "甘肃", "甘肃省"], ["630000", "青海", "青海省"], ["640000", "宁夏", "宁夏回族自治区"],
  ["650000", "新疆", "新疆维吾尔自治区"], ["710000", "台湾", "台湾省"],
  ["810000", "香港", "香港特别行政区"], ["820000", "澳门", "澳门特别行政区"],
].map(([id, name, label]) => ({ id, name, label }));

export type TravelVisitData = { travel_visit_version: 2; province_id: string; city: string; start_date: string; end_date: string; notes: string };
export type TravelVisitRecord = WorkspaceRecord<TravelVisitData>;
export type TravelVisitFields = Omit<TravelVisitData, "travel_visit_version" | "notes"> & { notes?: string };

// Preserve a calendar date exactly. Never convert visit dates into UTC instants.
export function isTravelDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export function createTravelVisitData(fields: TravelVisitFields): TravelVisitData {
  if (fields.notes !== undefined && typeof fields.notes !== "string") throw new Error("INVALID_TRAVEL_VISIT");
  const data: TravelVisitData = {
    travel_visit_version: 2,
    province_id: fields.province_id,
    city: typeof fields.city === "string" ? fields.city.trim() : "",
    start_date: fields.start_date,
    end_date: fields.end_date,
    notes: fields.notes?.trim() ?? "",
  };
  if (!TRAVEL_PROVINCES.some(p => p.id === data.province_id)
    || !data.city || data.city.length > 100
    || !isTravelDate(data.start_date) || !isTravelDate(data.end_date) || data.end_date < data.start_date
    || data.notes.length > 2000) throw new Error("INVALID_TRAVEL_VISIT");
  return data;
}

export function parseTravelVisitRecord(text: string): TravelVisitRecord {
  const record = parseRecord(text);
  if (record.entity_type !== "travel_visit") throw new Error("INVALID_TRAVEL_VISIT");
  const data = record.data;
  if (data.travel_visit_version !== 1 && data.travel_visit_version !== 2) throw new Error("INVALID_TRAVEL_VISIT");
  // Normalize legacy single dates in memory only. Reading never rewrites cloud files.
  // A subsequent edit/delete/restore writes this record in the current format.
  const normalized = createTravelVisitData({
    province_id: data.province_id as string,
    city: data.city as string,
    start_date: (data.travel_visit_version === 1 ? data.visited_on : data.start_date) as string,
    end_date: (data.travel_visit_version === 1 ? data.visited_on : data.end_date) as string,
    notes: data.notes as string | undefined,
  });
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(record.id) || !Number.isSafeInteger(record.version)
    || typeof record.created_at !== "string" || Number.isNaN(Date.parse(record.created_at))
    || typeof record.updated_at !== "string" || Number.isNaN(Date.parse(record.updated_at))
    || !(record.deleted_at === null || (typeof record.deleted_at === "string" && !Number.isNaN(Date.parse(record.deleted_at))))) throw new Error("INVALID_TRAVEL_VISIT");
  return { ...record, data: normalized } as TravelVisitRecord;
}

export function visitedTravelProvinces(records: TravelVisitRecord[]) {
  return new Set(records.filter(record => record.deleted_at === null).map(record => record.data.province_id));
}
