import { describe, expect, it } from "vitest";
import { createWorkspaceRecord, serializeRecord } from "./protocol";
import { createConfirmedHealthMetricData, parseHealthMetricRecord } from "./health-metrics";
import { confirmHealthStaging, correctPendingHealthStaging, createHealthStagingData, parseHealthStagingRecord, rejectHealthStaging } from "./health-staging-records";

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
    const metric = createWorkspaceRecord({ entityType: "health_metric", id: "health_metric_1", ownerId: record.owner_id, timestamp: confirmed.updated_at, data: createConfirmedHealthMetricData(confirmed.data.normalized_json, record.id) });
    expect(parseHealthMetricRecord(serializeRecord(metric))).toEqual(metric);
    expect(confirmed.data.canonical_record_id).toBe(metric.id);
  });
});
