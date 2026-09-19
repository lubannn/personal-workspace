import type { CorosFileDiagnostic } from "./coros-file-preflight";

export const COROS_ACTIVITY_MAPPING_VERSION = "1";

export type CorosSourceActivity = {
  sourceIdentity: string;
  sport: string | null;
  startAt: string | null;
  endAt: string | null;
  elapsedSeconds: number | null;
  movingSeconds: number | null;
  distanceMeters: number | null;
  calories: number | null;
  averageHeartRate: number | null;
  maximumHeartRate: number | null;
  averageCadence: number | null;
  averagePower: number | null;
  trackpoints: number;
};

export type CorosWorkoutProposal = {
  importKey: string;
  duplicate: boolean;
  duplicateReason: "same-preview" | "known-import" | null;
  diagnostics: CorosFileDiagnostic[];
  activity_type: "run" | "ride" | "swim" | "walk" | "hike" | "strength" | "other";
  start_at: string;
  end_at: string;
  timezone: string;
  duration_seconds: number;
  distance: number | null;
  distance_unit: "m";
  training_load: null;
  metrics_json: {
    elapsed_seconds: number;
    moving_seconds: number | null;
    calories: number | null;
    average_heart_rate_bpm: number | null;
    maximum_heart_rate_bpm: number | null;
    average_cadence_rpm: number | null;
    average_power_watts: number | null;
    trackpoints: number;
  };
  confirmation_status: "pending";
  staging_record_id: null;
};

export type CorosMappingDryRun = {
  mappingVersion: typeof COROS_ACTIVITY_MAPPING_VERSION;
  batchIdentity: string;
  candidates: CorosWorkoutProposal[];
  diagnostics: CorosFileDiagnostic[];
  readyForStagingDesign: boolean;
  localOnly: true;
  commitEnabled: false;
};

export async function mapCorosActivities(options: {
  sourceSha256: string;
  parserVersion: string;
  timezone: string;
  activities: CorosSourceActivity[];
  knownImportKeys?: Iterable<string>;
}): Promise<CorosMappingDryRun> {
  const diagnostics: CorosFileDiagnostic[] = [];
  const known = new Set(options.knownImportKeys ?? []);
  const seen = new Set<string>();
  const identities = [...options.activities].map((activity) => activity.sourceIdentity).sort();
  const batchIdentity = await digestKey([options.sourceSha256, options.parserVersion, COROS_ACTIVITY_MAPPING_VERSION, ...identities]);
  const candidates: CorosWorkoutProposal[] = [];

  for (const activity of options.activities) {
    const importKey = await digestKey([options.sourceSha256, options.parserVersion, activity.sourceIdentity]);
    const samePreview = seen.has(importKey);
    seen.add(importKey);
    const knownImport = known.has(importKey);
    const start = parseInstant(activity.startAt);
    const explicitEnd = parseInstant(activity.endAt);
    const elapsed = positive(activity.elapsedSeconds);
    const derivedEnd = start && elapsed ? new Date(start.valueOf() + elapsed * 1000) : null;
    const end = explicitEnd ?? derivedEnd;
    const duration = elapsed ?? (start && end ? (end.valueOf() - start.valueOf()) / 1000 : null);
    const candidateDiagnostics: CorosFileDiagnostic[] = [];
    const diagnose = (code: string, message: string, severity: CorosFileDiagnostic["severity"]) => {
      const diagnostic = problem(code, message, severity, activity.sourceIdentity);
      candidateDiagnostics.push(diagnostic);
      diagnostics.push(diagnostic);
    };

    if (!start) diagnose("ACTIVITY_START_MISSING", "活动缺少有效开始时间，不能建立 Workout 候选。", "blocking");
    if (!end) diagnose("ACTIVITY_END_MISSING", "活动缺少结束时间和可用时长，不能建立 Workout 候选。", "blocking");
    if (!duration || duration > 7 * 24 * 60 * 60) diagnose("ACTIVITY_DURATION_INVALID", "活动时长必须大于 0 且不超过 7 天。", "blocking");
    if (!explicitEnd && derivedEnd) diagnose("ACTIVITY_END_DERIVED", "结束时间由开始时间与 elapsed time 推导。", "warning");
    if (activity.trackpoints === 0) diagnose("ACTIVITY_TRACKPOINTS_MISSING", "没有轨迹点；只保留活动摘要，不生成 GPS 或时序明细。", "warning");
    if (samePreview || knownImport) diagnose("ACTIVITY_DUPLICATE", samePreview ? "同一预览内出现重复活动身份。" : "该活动身份已在本地会话中预览过。", "warning");

    if (!start || !end || !duration || duration > 7 * 24 * 60 * 60) continue;
    candidates.push({
      importKey,
      duplicate: samePreview || knownImport,
      duplicateReason: samePreview ? "same-preview" : knownImport ? "known-import" : null,
      diagnostics: candidateDiagnostics,
      activity_type: normalizeSport(activity.sport),
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      timezone: safeTimezone(options.timezone),
      duration_seconds: Math.round(duration),
      distance: nonNegative(activity.distanceMeters),
      distance_unit: "m",
      training_load: null,
      metrics_json: {
        elapsed_seconds: Math.round(duration),
        moving_seconds: positive(activity.movingSeconds),
        calories: nonNegative(activity.calories),
        average_heart_rate_bpm: positive(activity.averageHeartRate),
        maximum_heart_rate_bpm: positive(activity.maximumHeartRate),
        average_cadence_rpm: positive(activity.averageCadence),
        average_power_watts: positive(activity.averagePower),
        trackpoints: activity.trackpoints,
      },
      confirmation_status: "pending",
      staging_record_id: null,
    });
  }

  return {
    mappingVersion: COROS_ACTIVITY_MAPPING_VERSION,
    batchIdentity,
    candidates,
    diagnostics,
    readyForStagingDesign: candidates.length > 0 && !diagnostics.some((item) => item.severity === "blocking"),
    localOnly: true,
    commitEnabled: false,
  };
}

function problem(code: string, message: string, severity: CorosFileDiagnostic["severity"], identity: string): CorosFileDiagnostic {
  return { code, severity, message: `${message}（${identity}）` };
}

function parseInstant(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function positive(value: number | null) { return value !== null && Number.isFinite(value) && value > 0 ? value : null; }
function nonNegative(value: number | null) { return value !== null && Number.isFinite(value) && value >= 0 ? value : null; }
function safeTimezone(value: string) { try { new Intl.DateTimeFormat("en", { timeZone: value }); return value; } catch { return "Asia/Shanghai"; } }

function normalizeSport(value: string | null): CorosWorkoutProposal["activity_type"] {
  const sport = value?.toLowerCase().replace(/[\s_-]+/gu, "") ?? "";
  if (["running", "run", "trailrunning", "treadmill"].includes(sport)) return "run";
  if (["cycling", "biking", "bike", "ride", "roadcycling", "indoorcycling"].includes(sport)) return "ride";
  if (["swimming", "swim", "lapswimming", "openwaterswimming"].includes(sport)) return "swim";
  if (["walking", "walk"].includes(sport)) return "walk";
  if (["hiking", "hike"].includes(sport)) return "hike";
  if (["strengthtraining", "strength", "weighttraining"].includes(sport)) return "strength";
  return "other";
}

async function digestKey(parts: string[]) {
  const bytes = new TextEncoder().encode(parts.map((part) => `${part.length}:${part}`).join("|"));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
