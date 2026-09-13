import { describe, expect, it } from "vitest";
import { createWorkspaceRecord, serializeRecord } from "./protocol";
import { createConfirmedHealthMetricData, parseHealthMetricRecord } from "./health-metrics";
import { createConfirmedSleepSessionData, parseSleepSessionRecord } from "./sleep-sessions";
import { confirmHealthStaging, correctPendingHealthStaging, correctPendingSleepHealthStaging, createHealthStagingData, createSleepHealthStagingData, parseHealthStagingRecord, rejectHealthStaging } from "./health-staging-records";

const candidate = { metric_type: "resting_heart_rate", measured_at: "2026-09-13T00:00:00.000Z", local_date: "2026-09-13", timezone: "Asia/Shanghai", value: 58, unit: "bpm", aggregation_period: "instant" as const };
const timestamp = "2026-09-13T01:00:00.000Z";

describe("Health staging confirmation boundary", () => {
  it("keeps a new manual metric pending", () => {
    const record = createWorkspaceRecord({ entityType: "health_staging_record", id: "health_staging_1", ownerId: "github_lubannn", timestamp, data: createHealthStagingData({ source_label: "manual", normalized_json: candidate }, timestamp) });
    expect(parseHealthStagingRecord(serializeRecord(record))).toEqual(record);
    expect(record.data).toMatchObject({ status: "pending", canonical_record_id: null });
  });

  it("versions corrections and forbids a second decision", () => {
    const record = createWorkspaceRecord({ entityType: "health_staging_record", id: "health_staging_1", ownerId: "github_lubannn", timestamp, data: createHealthStagingData({ source_label: "manual", normalized_json: candidate }, timestamp) });
    const corrected = correctPendingHealthStaging(record, { source_label: "COROS CSV", normalized_json: { ...candidate, value: 57 } }, "2026-09-13T02:00:00.000Z");
    expect(corrected).toMatchObject({ version: 2, data: { status: "pending", normalized_json: { value: 57 } } });
    const rejected = rejectHealthStaging(corrected, "重复导入", "2026-09-13T03:00:00.000Z");
    expect(() => confirmHealthStaging(rejected, "health_metric_1", "2026-09-13T04:00:00.000Z")).toThrow("HEALTH_STAGING_NOT_PENDING");
  });

  it("creates canonical data only from a confirmed staging decision", () => {
    const record = createWorkspaceRecord({ entityType: "health_staging_record", id: "health_staging_1", ownerId: "github_lubannn", timestamp, data: createHealthStagingData({ source_label: "manual", normalized_json: candidate }, timestamp) });
    const confirmed = confirmHealthStaging(record, "health_metric_1", "2026-09-13T02:00:00.000Z");
    if (confirmed.data.health_type !== "metric") throw new Error("unexpected staging type");
    const metric = createWorkspaceRecord({ entityType: "health_metric", id: "health_metric_1", ownerId: record.owner_id, timestamp: confirmed.updated_at, data: createConfirmedHealthMetricData(confirmed.data.normalized_json, record.id) });
    expect(parseHealthMetricRecord(serializeRecord(metric))).toEqual(metric);
    expect(confirmed.data.canonical_record_id).toBe(metric.id);
  });

  it("keeps sleep pending until the user confirms its classification", () => {
    const data = createSleepHealthStagingData({ source_label: "manual", normalized_json: { start_at: "2026-09-12T15:30:00.000Z", end_at: "2026-09-12T23:00:00.000Z", local_date: "2026-09-12", timezone: "Asia/Shanghai", session_type: "main_sleep" } }, timestamp);
    const record = createWorkspaceRecord({ entityType: "health_staging_record", id: "health_staging_sleep_1", ownerId: "github_lubannn", timestamp, data });
    expect(parseHealthStagingRecord(serializeRecord(record))).toEqual(record);
    expect(record.data).toMatchObject({ health_type: "sleep_session", status: "pending", normalized_json: { duration_minutes: 450 } });
  });

  it("versions sleep corrections and creates a canonical session only after confirmation", () => {
    const data = createSleepHealthStagingData({ source_label: "manual", normalized_json: { start_at: "2026-09-12T15:00:00.000Z", end_at: "2026-09-12T22:00:00.000Z", local_date: "2026-09-12", timezone: "Asia/Shanghai", session_type: "unknown" } }, timestamp);
    const record = createWorkspaceRecord({ entityType: "health_staging_record", id: "health_staging_sleep_1", ownerId: "github_lubannn", timestamp, data });
    const corrected = correctPendingSleepHealthStaging(record, { source_label: "manual", normalized_json: { ...data.normalized_json, end_at: "2026-09-12T23:00:00.000Z", session_type: "main_sleep" } }, "2026-09-13T02:00:00.000Z");
    const confirmed = confirmHealthStaging(corrected, "sleep_session_1", "2026-09-13T03:00:00.000Z");
    if (confirmed.data.health_type !== "sleep_session") throw new Error("unexpected staging type");
    const session = createWorkspaceRecord({ entityType: "sleep_session", id: "sleep_session_1", ownerId: record.owner_id, timestamp: confirmed.updated_at, data: createConfirmedSleepSessionData(confirmed.data.normalized_json, record.id) });
    expect(corrected).toMatchObject({ version: 2, data: { classification: "main_sleep", diagnostics_json: [] } });
    expect(parseSleepSessionRecord(serializeRecord(session))).toEqual(session);
    expect(session.data).toMatchObject({ duration_minutes: 480, confirmation_status: "confirmed", user_adjusted: true });
  });

  it("rejects impossible sleep ranges", () => {
    expect(() => createSleepHealthStagingData({ source_label: "manual", normalized_json: { start_at: "2026-09-13T01:00:00.000Z", end_at: "2026-09-13T00:00:00.000Z", local_date: "2026-09-13", timezone: "Asia/Shanghai", session_type: "nap" } }, timestamp)).toThrow("INVALID_HEALTH_STAGING_DETAILS");
    expect(() => createSleepHealthStagingData({ source_label: "manual", normalized_json: { start_at: "2026-09-12T15:00:00.000Z", end_at: "2026-09-12T23:00:00.000Z", local_date: "2026-09-13", timezone: "Asia/Shanghai", session_type: "main_sleep" } }, timestamp)).toThrow("INVALID_HEALTH_STAGING_DETAILS");
  });
});
