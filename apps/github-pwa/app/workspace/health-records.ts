import { isWorkoutLinkedToStaging } from "../../../../src/lib/github-data/workouts";
import type { CorosSleepMetrics } from "../../../../src/lib/github-data/sleep-sessions";
import type { SyncedHealthStagingRecord, SyncedSleepSession, SyncedWorkout } from "./page-model";

export const HEALTH_RECORDS_PAGE_SIZE = 10;

export type HealthRecordSource = { kind: "manual" | "coros_file" | "coros_mcp" | "unknown"; label: string };
export type HealthRecordRow = {
  id: string;
  startAt: string;
  endAt: string;
  timezone: string;
  source: HealthRecordSource;
  recordDate?: string;
};
export type SleepRecordRow = HealthRecordRow & { category: string; durationSeconds: number; asleepSeconds: number | null; awakeSeconds: number | null; score: number | null; dateCorrection: CorosSleepMetrics["date_correction"] | null };
export type WorkoutRecordRow = HealthRecordRow & { activity: string; durationSeconds: number; distanceMetres: number | null };
export type HealthDateRange = { from: string; to: string };

export function safeHealthTimezone(timezone: string): string {
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); return timezone; }
  catch { return "UTC"; }
}

export function healthLocalParts(instant: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: safeHealthTimezone(timezone), year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

export function buildHealthRecordRows(sleepSessions: SyncedSleepSession[], workouts: SyncedWorkout[], staging: SyncedHealthStagingRecord[]) {
  const stagingById = new Map(staging.map((item) => [item.record.id, item.record]));
  const unknownSource: HealthRecordSource = { kind: "unknown", label: "来源待核实" };
  const sleepRows: SleepRecordRow[] = sleepSessions
    .filter(({ record }) => record.deleted_at === null && (record.data.sleep_session_version === 2 || record.data.confirmation_status === "confirmed"))
    .map(({ record }) => {
      const data = record.data;
      const source = data.sleep_session_version === 1 ? stagingById.get(data.staging_record_id) : undefined;
      const linked = source && source.deleted_at === null && source.owner_id === record.owner_id
        && source.data.health_type === "sleep_session" && source.data.status === "confirmed"
        && source.data.canonical_record_id === record.id
        && Object.entries(source.data.normalized_json).every(([key, value]) => data[key as keyof typeof data] === value);
      return {
        id: record.id, startAt: data.start_at, endAt: data.end_at, timezone: data.timezone,
        category: ({ main_sleep: "夜间睡眠", nap: "小睡", unknown: "未分类" })[data.session_type],
        durationSeconds: data.duration_minutes * 60,
        recordDate: data.sleep_session_version === 2 ? data.sleep_metrics_json.wake_date : undefined,
        asleepSeconds: data.sleep_session_version === 2 && data.sleep_metrics_json.asleep_minutes !== null ? data.sleep_metrics_json.asleep_minutes * 60 : null,
        awakeSeconds: data.sleep_session_version === 2 && data.sleep_metrics_json.awake_minutes !== null ? data.sleep_metrics_json.awake_minutes * 60 : null,
        score: data.sleep_session_version === 2 ? data.sleep_metrics_json.score : null,
        dateCorrection: data.sleep_session_version === 2 ? data.sleep_metrics_json.date_correction ?? null : null,
        source: data.sleep_session_version === 2 ? { kind: "coros_mcp" as const, label: "COROS · 自动同步" } : linked ? { kind: "manual" as const, label: source.data.source.label === "手工录入" ? "手工录入" : `手工录入 · ${source.data.source.label}` } : unknownSource,
      };
    }).sort(latestFirst);
  const workoutRows: WorkoutRecordRow[] = workouts
    .filter(({ record }) => record.deleted_at === null && (record.data.workout_version === 2 || record.data.confirmation_status === "confirmed"))
    .map(({ record }) => {
      const data = record.data;
      const source = data.workout_version === 1 ? stagingById.get(data.staging_record_id) : undefined;
      const linked = source?.data.health_type === "workout" && isWorkoutLinkedToStaging(record, source);
      return {
        id: record.id, startAt: data.start_at, endAt: data.end_at, timezone: data.timezone,
        activity: ({ run: "跑步", ride: "骑行", swim: "游泳", walk: "步行", hike: "徒步", strength: "力量训练", other: "其他活动" } as Record<string, string>)[data.activity_type] ?? data.activity_type,
        durationSeconds: data.duration_seconds, distanceMetres: data.distance,
        source: data.workout_version === 2 ? { kind: "coros_mcp" as const, label: "COROS · 自动同步" } : linked && source.data.source.kind === "coros_file" ? { kind: "coros_file" as const, label: `COROS · ${source.data.source.format.toUpperCase()}` } : unknownSource,
      };
    }).sort(latestFirst);
  return { sleepRows, workoutRows };
}

function latestFirst(left: HealthRecordRow, right: HealthRecordRow) {
  return Date.parse(right.startAt) - Date.parse(left.startAt) || left.id.localeCompare(right.id);
}

export function summarizeHealthRecords(rows: HealthRecordRow[], timezone: string) {
  const dates = rows.map((row) => row.recordDate ?? healthLocalParts(row.startAt, timezone).date).sort();
  return { count: rows.length, earliest: dates[0] ?? null, latest: dates.at(-1) ?? null };
}

export function healthRangeError(range: HealthDateRange): string | null {
  const valid = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  };
  if ((range.from && !valid(range.from)) || (range.to && !valid(range.to))) return "请输入有效的日期。";
  if (range.from && range.to && range.from > range.to) return "开始日期不能晚于结束日期。";
  return null;
}

export function filterHealthRecords<T extends HealthRecordRow>(rows: T[], range: HealthDateRange, timezone: string): T[] {
  if (healthRangeError(range)) return [];
  return rows.filter((row) => {
    const date = row.recordDate ?? healthLocalParts(row.startAt, timezone).date;
    return (!range.from || date >= range.from) && (!range.to || date <= range.to);
  });
}

export function paginateHealthRecords<T>(rows: T[], requestedPage: number) {
  const pages = Math.max(1, Math.ceil(rows.length / HEALTH_RECORDS_PAGE_SIZE));
  const page = Math.max(1, Math.min(pages, requestedPage));
  return { rows: rows.slice((page - 1) * HEALTH_RECORDS_PAGE_SIZE, page * HEALTH_RECORDS_PAGE_SIZE), page, pages, count: rows.length };
}

export function formatHealthDuration(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const remainder = total % 60;
  return [hours ? `${hours} 小时` : "", minutes ? `${minutes} 分钟` : "", remainder ? `${remainder} 秒` : ""].filter(Boolean).join(" ") || "0 分钟";
}

export function formatHealthDistance(metres: number | null): string {
  if (metres === null) return "距离未记录";
  return metres >= 1000 ? `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(metres / 1000)} 公里` : `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(metres)} 米`;
}
