import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HealthBlobCache } from "../../../../src/lib/github-data/health-blob-cache";
import type { GitHubStoredFile } from "../../../../src/lib/github-data/github-contents";
import { HealthArchiveReader } from "./health-archive-reader";
import { createWorkspaceRecord, recordPath, serializeRecord } from "../../../../src/lib/github-data/protocol";
import { createAutomaticSleepSessionData, createConfirmedSleepSessionData, type SleepSessionRecord } from "../../../../src/lib/github-data/sleep-sessions";
import { createAutomaticWorkoutData, createConfirmedWorkoutData, type WorkoutRecord } from "../../../../src/lib/github-data/workouts";
import { corosSyncIndexEntry, COROS_SYNC_INDEX_PATH } from "../../../../src/lib/github-data/coros-sync-index";
import { mapCorosActivities } from "../../../../src/lib/github-data/coros-activity-mapping";
import { planCorosWorkoutStaging } from "../../../../src/lib/github-data/coros-workout-staging-plan";
import { confirmWorkoutHealthStaging } from "../../../../src/lib/github-data/health-staging-records";
import { createAutomaticHealthMetricData } from "../../../../src/lib/github-data/health-metrics";

const timestamp = "2026-10-04T02:00:00.000Z";
const provenance = { kind: "coros_mcp" as const, source_id: "synthetic", source_sha256: "a".repeat(64), mapping_version: 1 as const, retrieved_at: timestamp };
const sha = (text: string) => createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex");
function sleep(date: string, score = 84) {
  const start = new Date(Date.parse(`${date}T00:00:00Z`) - 9 * 3600_000).toISOString();
  const end = new Date(Date.parse(start) + 8 * 3600_000).toISOString();
  return createWorkspaceRecord({ entityType: "sleep_session", id: `sleep_${date.replaceAll("-", "")}`, ownerId: "owner_test", timestamp,
    data: createAutomaticSleepSessionData({ start_at: start, end_at: end, local_date: new Date(Date.parse(`${date}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10), timezone: "Asia/Shanghai", session_type: "main_sleep", duration_minutes: 480 }, provenance,
      { asleep_minutes: 450, awake_minutes: 30, wake_date: date, score }) });
}
function workout(date: string) {
  return createWorkspaceRecord({ entityType: "workout", id: `workout_${date.replaceAll("-", "")}`, ownerId: "owner_test", timestamp,
    data: createAutomaticWorkoutData({ activity_type: "run", start_at: `${date}T00:00:00Z`, end_at: `${date}T01:00:00Z`, timezone: "Asia/Shanghai", duration_seconds: 3600, distance: 6250, distance_unit: "m", training_load: null,
      metrics_json: { elapsed_seconds: 3600, moving_seconds: null, calories: null, average_heart_rate_bpm: null, maximum_heart_rate_bpm: null, average_cadence_rpm: null, average_power_watts: null, trackpoints: 0 } }, provenance) });
}
function fake(records: (SleepSessionRecord | WorkoutRecord)[]) {
  const files = new Map(records.map(record => [recordPath(record.entity_type, record.id), serializeRecord(record)]));
  const reindex = () => files.set(COROS_SYNC_INDEX_PATH, serializeRecord(createWorkspaceRecord({ entityType: "coros_sync_index", id: "index", ownerId: "owner_test", timestamp,
    data: { index_version: 1, records: [...files].filter(([path]) => /^data\/(sleep-sessions|workouts)\//.test(path)).map(([, text]) => corosSyncIndexEntry(JSON.parse(text), sha(text))) } })));
  reindex();
  const calls: string[][] = [];
  const adapter = {
    listHealthArchive: vi.fn(async () => [...files].map(([path, text]) => ({ type: "file" as const, name: path.split("/").at(-1)!, path, blobSha: sha(text), sizeBytes: Buffer.byteLength(text) }))),
    readBlobTexts: vi.fn(async (items: readonly { path: string; blobSha: string; sizeBytes: number }[]) => {
      calls.push(items.map(item => item.path));
      return items.map(item => ({ ...item, text: files.get(item.path)! }));
    }),
  };
  return { files, adapter, calls, reindex, reader: new HealthArchiveReader(adapter) };
}

afterEach(() => vi.unstubAllGlobals());

describe("incremental health month reads", () => {
  it("reads metric history once for stable baselines, reuses SHAs across months, and removes revised/deleted signals", async () => {
    const f = fake([sleep("2026-10-04"), sleep("2026-09-30")]);
    const metric = (value: number) => createWorkspaceRecord({ entityType: "health_metric", id: "metric_synthetic", ownerId: "owner_test", timestamp,
      data: createAutomaticHealthMetricData({ metric_type: "resting_heart_rate", value, unit: "bpm", local_date: "2026-08-15", measured_at: timestamp, timezone: "Asia/Shanghai", aggregation_period: "daily" }, provenance, true) });
    const path = recordPath("health_metric", "metric_synthetic");
    f.files.set(path, serializeRecord(metric(50)));
    const first = await f.reader.load();
    expect(first.healthMetrics).toHaveLength(1);
    expect(first.months).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(f.calls.flat().filter(item => item === path)).toHaveLength(1);
    f.calls.length = 0;
    const older = await f.reader.load("2026-09");
    expect(older.healthMetrics).toEqual(first.healthMetrics);
    expect(f.calls.flat()).not.toContain(path);
    f.calls.length = 0;
    f.files.set(path, serializeRecord(metric(60)));
    const updated = await f.reader.load("2026-09", { refresh: true });
    expect(updated.healthMetrics![0].record.data.value).toBe(60);
    expect(f.calls.flat()).toEqual([path]);
    f.files.delete(path);
    expect((await f.reader.load("2026-09", { refresh: true })).healthMetrics).toEqual([]);
    expect(f.reader.snapshot().months).toEqual(["2026-09", "2026-10"]);
    f.files.set(path, "{}");
    await expect(f.reader.load("2026-09", { refresh: true })).rejects.toThrow("HEALTH_RECORD_INVALID");
  });

  it("loads only selected-month metric bodies, avoids historical revisions, and fetches changed SHAs only when needed", async () => {
    const f = fake([]);
    const metric = (date: string, value = 50) => {
      const id = `coros_metric_${date.replaceAll("-", "")}_resting_heart_rate_daily`;
      return createWorkspaceRecord({ entityType: "health_metric", id, ownerId: "owner_test", timestamp,
        data: createAutomaticHealthMetricData({ metric_type: "resting_heart_rate", value, unit: "bpm", local_date: date, measured_at: timestamp, timezone: "Asia/Shanghai", aggregation_period: "daily" }, provenance) });
    };
    for (let i = 0; i < 650; i++) {
      const date = new Date(Date.parse("2025-01-01") + i * 86400_000).toISOString().slice(0, 10);
      const record = metric(date); f.files.set(recordPath("health_metric", record.id), serializeRecord(record));
    }
    f.files.set("data/health-metrics/coros_metric_revision_synthetic.json", "must not be read");
    const september = await f.reader.load("2026-09"); expect(september.healthMetrics).toHaveLength(30);
    expect(f.calls.flat()).toHaveLength(30); expect(f.calls.flat().every(path => path.includes("coros_metric_202609"))).toBe(true);
    f.calls.length = 0; await f.reader.load("2026-09"); expect(f.calls.flat()).toHaveLength(0);
    await f.reader.load("2026-08"); f.calls.length = 0;
    const revised = metric("2026-08-15", 60); const path = recordPath("health_metric", revised.id); f.files.set(path, serializeRecord(revised));
    await f.reader.load("2026-09", { refresh: true }); expect(f.calls.flat()).toHaveLength(0);
    await f.reader.load("2026-08"); expect(f.calls.flat()).toEqual([path]);
    expect(f.reader.snapshot().healthMetrics!.find(item => item.path === path)?.record.data.value).toBe(60);
  });

  it("reads only the newest month and latest workout, makes zero requests when revisiting, and fetches only one revised body", async () => {
    const records = Array.from({ length: 650 }, (_, i) => sleep(new Date(Date.parse("2025-01-01") + i * 86400_000).toISOString().slice(0, 10)));
    // Keep a large archive, with exactly four days in the newest month.
    const history = records.filter(record => record.data.sleep_metrics_json.wake_date <= "2026-09-30");
    const f = fake([...history, ...[1, 2, 3, 4].map(day => sleep(`2026-10-0${day}`)), workout("2026-09-27"), workout("2025-05-15")]);
    const first = await f.reader.load();
    expect(first).toMatchObject({ month: "2026-10", latestSleep: "2026-10-04", latestWorkout: "2026-09-27", latestReady: true, loadedMonths: ["2026-10"] });
    expect(first.sleepSessions).toHaveLength(4);
    expect(f.calls.flat()).toHaveLength(6); // one index + four sleeps + one latest workout; no historical bodies
    const callCount = f.adapter.readBlobTexts.mock.calls.length;
    await f.reader.load("2026-10");
    expect(f.adapter.listHealthArchive).toHaveBeenCalledTimes(1);
    expect(f.adapter.readBlobTexts).toHaveBeenCalledTimes(callCount);
    await f.reader.load("2026-10", { refresh: true });
    expect(f.adapter.readBlobTexts).toHaveBeenCalledTimes(callCount);
    const revised = sleep("2026-10-03", 95);
    f.files.set(recordPath(revised.entity_type, revised.id), serializeRecord(revised)); f.reindex(); f.calls.length = 0;
    const next = await f.reader.load("2026-10", { refresh: true });
    expect(f.calls.flat()).toEqual([recordPath(revised.entity_type, revised.id)]);
    expect(next.sleepSessions.find(item => item.record.id === revised.id)?.record.data.sleep_metrics_json.score).toBe(95);
    f.calls.length = 0;
    await f.reader.load("2025-05");
    expect(f.calls.flat()).toHaveLength(32); // 31 sleeps and that month's one workout
    f.calls.length = 0;
    await f.reader.load("2026-10");
    expect(f.calls).toHaveLength(0);
  });

  it("notices new records before the index is updated, removes deleted records, and never resurrects physically removed records", async () => {
    const f = fake([sleep("2026-09-30"), workout("2026-09-27")]);
    await f.reader.load();
    const added = sleep("2026-10-01"); const path = recordPath(added.entity_type, added.id);
    f.files.set(path, serializeRecord(added));
    expect(await f.reader.load(undefined, { refresh: true })).toMatchObject({ month: "2026-10", latestSleep: "2026-10-01" });
    f.files.delete(path);
    expect((await f.reader.load(undefined, { refresh: true })).sleepSessions.some(item => item.path === path)).toBe(false);
    const oldPath = recordPath("sleep_session", "sleep_20260930");
    const old = JSON.parse(f.files.get(oldPath)!); old.deleted_at = timestamp;
    f.files.set(oldPath, serializeRecord(old));
    expect(await f.reader.load(undefined, { refresh: true })).toMatchObject({ latestSleep: null });
  });

  it("loads only matching v1 workout staging and revalidates changed source evidence", async () => {
    const mapping = await mapCorosActivities({ sourceSha256: "a".repeat(64), parserVersion: "1", timezone: "Asia/Shanghai", activities: [{ sourceIdentity: "one", sport: "Biking", startAt: "2026-09-27T00:00:00Z", endAt: "2026-09-27T00:30:00Z", elapsedSeconds: 1800, movingSeconds: null, distanceMeters: 1000, calories: null, averageHeartRate: null, maximumHeartRate: null, averageCadence: null, averagePower: null, trackpoints: 0 }] });
    const plan = await planCorosWorkoutStaging({ format: "tcx", sourceSha256: "a".repeat(64), parserVersion: "1", mapping });
    const pending = createWorkspaceRecord({ entityType: "health_staging_record", id: plan.items[0].stagingRecordId, ownerId: "owner_test", timestamp, data: plan.items[0].proposedData });
    const reviewed = confirmWorkoutHealthStaging(pending, timestamp);
    const data = createConfirmedWorkoutData(pending, timestamp);
    const canonical = createWorkspaceRecord({ entityType: "workout", id: `workout_${data.import_key}`, ownerId: "owner_test", timestamp, data });
    const f = fake([sleep("2026-10-04"), canonical]);
    const sourcePath = recordPath(reviewed.entity_type, reviewed.id);
    f.files.set(sourcePath, serializeRecord(reviewed));
    expect((await f.reader.load()).workouts).toHaveLength(1);
    expect(f.calls.flat()).toContain(sourcePath);
    f.files.set(sourcePath, serializeRecord({ ...reviewed, deleted_at: timestamp }));
    const next = await f.reader.load("2026-10", { refresh: true });
    expect(next.workouts).toHaveLength(0);
    expect(next.latestWorkout).toBeNull();
    expect(next.unverifiedWorkoutCount).toBe(1);
    f.files.delete(sourcePath);
    await f.reader.load("2026-10", { refresh: true });
    f.files.set(sourcePath, serializeRecord(reviewed));
    expect((await f.reader.load("2026-10", { refresh: true })).latestWorkout).toBe("2026-09-27");
  });

  it("uses a manual night's wake month across the month boundary and supports missing/corrupt indexes", async () => {
    const automatic = sleep("2026-10-01");
    const { start_at, end_at, local_date, timezone, session_type, duration_minutes } = automatic.data;
    const candidate = { start_at, end_at, local_date, timezone, session_type, duration_minutes };
    const manual = { ...automatic, data: createConfirmedSleepSessionData(candidate, "staging_manual") };
    for (const indexText of [null, "{}"]) {
      const f = fake([manual]);
      if (indexText === null) f.files.delete(COROS_SYNC_INDEX_PATH); else f.files.set(COROS_SYNC_INDEX_PATH, indexText);
      expect(await f.reader.load()).toMatchObject({ month: "2026-10", latestSleep: "2026-10-01" });
    }
  });

  it("keeps a failed month incomplete, retries only missing bodies, and stops cancelled navigation", async () => {
    const f = fake([sleep("2026-10-04"), sleep("2026-09-30")]);
    await f.reader.load();
    f.adapter.readBlobTexts.mockRejectedValueOnce(new Error("network down"));
    await expect(f.reader.load("2026-09")).rejects.toThrow("network down");
    expect(f.reader.snapshot().loadedMonths).not.toContain("2026-09");
    expect((await f.reader.load("2026-09")).loadedMonths).toContain("2026-09");
    const controller = new AbortController(); controller.abort();
    const count = f.adapter.listHealthArchive.mock.calls.length;
    await expect(f.reader.load("2026-10", { signal: controller.signal, refresh: true })).rejects.toMatchObject({ name: "AbortError" });
    expect(f.adapter.listHealthArchive).toHaveBeenCalledTimes(count);
    f.adapter.listHealthArchive.mockRejectedValueOnce(new Error("access revoked"));
    await expect(f.reader.load("2026-10", { refresh: true })).rejects.toThrow("access revoked");
  });
  it("reuses only date/SHA metadata across logins, and reads a changed record without downloading the full index again", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    const f = fake([sleep("2026-10-04"), sleep("2025-05-15"), workout("2026-09-27")]);
    const adapter = { ...f.adapter, healthArchiveMetadataCacheKey: () => "test-health-metadata" };
    await new HealthArchiveReader(adapter).load();
    expect([...values.values()].join("")).not.toMatch(/score|duration|source_sha256|start_at|end_at|source_id/);
    f.calls.length = 0;
    const changed = sleep("2026-10-04", 95);
    const path = recordPath(changed.entity_type, changed.id);
    f.files.set(path, serializeRecord(changed)); f.reindex();
    const next = await new HealthArchiveReader(adapter).load();
    expect(f.calls.flat()).not.toContain(COROS_SYNC_INDEX_PATH);
    expect(f.calls.flat()).not.toContain(recordPath("sleep_session", "sleep_20250515"));
    expect(next.sleepSessions[0].record.data.sleep_metrics_json.score).toBe(95);
    // An incomplete/corrupt optional cache is safely rebuilt.
    const cached = JSON.parse(values.get("test-health-metadata")!); cached.count += 1;
    values.set("test-health-metadata", JSON.stringify(cached)); f.calls.length = 0;
    await new HealthArchiveReader(adapter).load();
    expect(f.calls.flat()).toContain(COROS_SYNC_INDEX_PATH);
  });

  it("publishes the completed visible month before waiting for latest-workout verification", async () => {
    const f = fake([sleep("2026-10-04"), workout("2026-09-27")]);
    const read = f.adapter.readBlobTexts.getMockImplementation()!;
    f.adapter.readBlobTexts.mockImplementation(async items => {
      if (items.some(item => item.path.startsWith("data/workouts/"))) throw new Error("latest workout unavailable");
      return read(items);
    });
    const progress = vi.fn();
    await expect(f.reader.load(undefined, { onProgress: progress })).rejects.toThrow("latest workout unavailable");
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ month: "2026-10", loadedMonths: ["2026-10"], latestReady: false, sleepSessions: expect.any(Array) }));
    expect(f.reader.snapshot().sleepSessions).toHaveLength(1);
  });

  it("does not commit a cancelled month's delayed response over the newly selected month", async () => {
    const f = fake([sleep("2026-10-04"), sleep("2026-09-30")]);
    await f.reader.load();
    const read = f.adapter.readBlobTexts.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.adapter.readBlobTexts.mockImplementationOnce(async items => { await gate; return read(items); });
    const controller = new AbortController();
    const old = f.reader.load("2026-09", { signal: controller.signal });
    const rejected = expect(old).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await f.reader.load("2026-10");
    release(); await rejected;
    expect(f.reader.snapshot()).toMatchObject({ month: "2026-10", loadedMonths: ["2026-10"] });
  });

  it("restores previously viewed months after a new login without body requests, while changed and removed records use fresh metadata", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    const bodies = new Map<string, GitHubStoredFile>();
    const cache: HealthBlobCache = {
      async read(files) { return files.flatMap(file => { const stored = bodies.get(file.blobSha); return stored ? [{ ...stored, path: file.path }] : []; }); },
      async remember(files) { files.forEach(file => bodies.set(file.blobSha, file)); },
      async clear() { bodies.clear(); },
    };
    const f = fake([sleep("2026-10-04"), sleep("2026-09-30"), workout("2026-09-27")]);
    const adapter = { ...f.adapter, healthArchiveMetadataCacheKey: () => "persistent-health-test" };
    const first = new HealthArchiveReader(adapter, "Asia/Shanghai", cache);
    await first.load(); await first.load("2026-09"); f.calls.length = 0;
    const second = new HealthArchiveReader(adapter, "Asia/Shanghai", cache);
    await second.load(); await second.load("2026-09");
    expect(f.calls).toHaveLength(0);
    expect(f.adapter.listHealthArchive).toHaveBeenCalledTimes(2); // one authenticated check per login
    const revised = sleep("2026-09-30", 95); const path = recordPath(revised.entity_type, revised.id);
    f.files.set(path, serializeRecord(revised)); f.reindex();
    const updated = await second.load("2026-09", { refresh: true });
    expect(f.calls.flat()).toEqual([path]);
    expect(updated.sleepSessions.find(item => item.path === path)?.record.data.sleep_metrics_json.score).toBe(95);
    f.files.delete(path);
    expect((await second.load("2026-09", { refresh: true })).sleepSessions.some(item => item.path === path)).toBe(false);
    const readCache = vi.spyOn(cache, "read"); readCache.mockClear();
    f.adapter.listHealthArchive.mockRejectedValueOnce(new Error("GITHUB_FORBIDDEN"));
    await expect(new HealthArchiveReader(adapter, "Asia/Shanghai", cache).load()).rejects.toThrow("GITHUB_FORBIDDEN");
    expect(readCache).not.toHaveBeenCalled();
    await first.clearLocalCache(); expect(bodies.size).toBe(0);
  });

  it("prefetches only immediate neighbor months without changing the selected month or scanning history", async () => {
    const f = fake([sleep("2026-10-04"), sleep("2026-09-30"), sleep("2026-08-31"), sleep("2025-01-01")]);
    await f.reader.load(); f.calls.length = 0;
    await f.reader.prefetchNeighbors("2026-10");
    expect(f.reader.snapshot().month).toBe("2026-10");
    expect(f.calls.flat()).toEqual([recordPath("sleep_session", "sleep_20260930")]);
    f.calls.length = 0;
    expect((await f.reader.load("2026-09")).loadedMonths).toContain("2026-09");
    expect(f.calls).toHaveLength(0);
    const controller = new AbortController(); controller.abort();
    await expect(f.reader.prefetchNeighbors("2026-09", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(f.calls).toHaveLength(0);
  });

  it("does not mistake seven pending source reads for failed verification when prefetch is cancelled", async () => {
    const mapping = await mapCorosActivities({ sourceSha256: "a".repeat(64), parserVersion: "1", timezone: "Asia/Shanghai",
      activities: Array.from({ length: 7 }, (_, index) => {
        const date = `2026-08-0${index + 1}`;
        return { sourceIdentity: `synthetic-${index}`, sport: "Biking", startAt: `${date}T00:00:00Z`, endAt: `${date}T00:30:00Z`, elapsedSeconds: 1800,
          movingSeconds: null, distanceMeters: 1000, calories: null, averageHeartRate: null, maximumHeartRate: null, averageCadence: null, averagePower: null, trackpoints: 0 };
      }) });
    const plan = await planCorosWorkoutStaging({ format: "tcx", sourceSha256: "a".repeat(64), parserVersion: "1", mapping });
    const pending = plan.items.map(item => createWorkspaceRecord({ entityType: "health_staging_record", id: item.stagingRecordId, ownerId: "owner_test", timestamp, data: item.proposedData }));
    const canonical = pending.map(item => {
      const data = createConfirmedWorkoutData(item, timestamp);
      return createWorkspaceRecord({ entityType: "workout", id: `workout_${data.import_key}`, ownerId: "owner_test", timestamp, data });
    });
    const f = fake([sleep("2026-10-04"), sleep("2026-09-30"), workout("2026-09-27"), ...canonical]);
    for (const item of pending) f.files.set(recordPath(item.entity_type, item.id), serializeRecord(confirmWorkoutHealthStaging(item, timestamp)));
    await f.reader.load("2026-09");
    const read = f.adapter.readBlobTexts.getMockImplementation()!;
    let release!: () => void; let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const sourceRequested = new Promise<void>(resolve => { started = resolve; });
    f.adapter.readBlobTexts.mockImplementation(async items => {
      if (items.some(item => item.path.startsWith("data/health-staging-records/"))) { started(); await gate; }
      return read(items);
    });
    const controller = new AbortController();
    const prefetch = f.reader.prefetchNeighbors("2026-09", controller.signal);
    const cancelled = expect(prefetch).rejects.toMatchObject({ name: "AbortError" });
    await sourceRequested;
    expect(f.reader.snapshot()).toMatchObject({ unverifiedWorkoutCount: 0 });
    expect(f.reader.snapshot().workouts).toHaveLength(1); // Pending evidence never makes a workout visible either.
    controller.abort();
    expect((await f.reader.load("2026-10")).unverifiedWorkoutCount).toBe(0);
    release(); await cancelled;
    const finished = await f.reader.load("2026-08");
    expect(finished.workouts).toHaveLength(8);
    expect(finished.unverifiedWorkoutCount).toBe(0);
    // Actual missing or mismatched evidence still fails the check.
    f.files.delete(recordPath("health_staging_record", pending[0].id));
    const invalid = await f.reader.load("2026-08", { refresh: true });
    expect(invalid.unverifiedWorkoutCount).toBe(1);
    expect(invalid.workouts).toHaveLength(7);
  });

});
