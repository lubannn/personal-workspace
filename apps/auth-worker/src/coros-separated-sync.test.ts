import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHealthMetricRecord } from "../../../src/lib/github-data/health-metrics";
import { recordPath, serializeRecord } from "../../../src/lib/github-data/protocol";
import { separatedSyncFixture } from "./coros-separated-test-helpers";
import { runCorosSync } from "./coros-sync";
import { runScheduledCorosSync } from "./coros-sync-scheduled";
import { parseSyncProgress, syncProgressDomains } from "./coros-sync-state";
import { SYNC_TEST_NOW } from "./coros-sync-test-helpers";
import { decryptRefreshToken } from "./security";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SYNC_TEST_NOW); });
afterEach(() => vi.useRealTimers());
describe("separate HRV and activity through real OAuth/MCP/Git clients and SQLite", () => {
  it("commits seven HRV days, checkpoints a nonempty detail without Git, restarts, completes activities and never scans completed history again", async () => {
    const f = await separatedSyncFixture();
    try {
      expect((await runScheduledCorosSync(f.db.env, f.dependencies)).result).toMatchObject({ status: "processed", batch: { created: 17, from: "2024-01-01", through: "2024-01-07" } });
      expect(f.tools.map(t => t.name)).toEqual(["querySleepHrv"]); expect(f.commits).toBe(1);
      expect(f.db.saved()?.progress.health).toMatchObject({ backfillNext: "2024-01-08", activity: { backfillNext: "2024-01-01", backfillThrough: null } });
      f.tools.length = 0; f.requests.length = 0; vi.setSystemTime(Date.now() + 600_000);
      expect((await runScheduledCorosSync(f.db.env, f.dependencies)).result).toMatchObject({ status: "processed", continuation: { detailsRead: 1 } });
      expect(f.tools.map(t => t.name)).toEqual(["querySportRecords", "getActivityDetail"]);
      expect(f.requests.some(url => url.startsWith("https://api.github.com"))).toBe(false);
      expect(f.db.saved()?.progress.health?.activity?.checkedRanges).toBeUndefined(); expect(f.commits).toBe(1);
      expect(JSON.parse(await decryptRefreshToken(f.db.saved()!.progress.health!.encryptedActivityCache!, f.db.env.TOKEN_ENCRYPTION_KEY!)).entries).toHaveLength(1);
      f.restart(); f.tools.length = 0; vi.setSystemTime(Date.now() + 600_000);
      expect((await runScheduledCorosSync(f.db.env, f.dependencies)).result?.status).toBe("processed");
      expect(f.tools.map(t => t.name)).toEqual(["querySportRecords", "getActivityDetail"]); expect(f.tools[1].args.labelId).toBe("102");
      expect(f.db.saved()?.progress.health?.activity).toMatchObject({ backfillNext: "2024-01-08", backfillThrough: "2024-01-07" });
      const records = [...f.files.values()].map(parseHealthMetricRecord);
      expect(records.filter(r => r.data.metric_type === "sleep_hrv_avg")).toHaveLength(7);
      expect(records.filter(r => r.data.metric_type === "training_load" && r.data.value > 0)).toHaveLength(2);
      expect(records.some(r => r.data.metric_type === "elevation_gain" && ["2024-01-03", "2024-01-04"].includes(r.data.local_date))).toBe(false);
      expect(records.some(r => r.data.value === 999)).toBe(false); expect(f.commits).toBe(2);
      f.tools.length = 0; f.restart(); expect((await runCorosSync(f.db.env, new Date(), f.dependencies, { forceDue: true })).status).toBe("complete"); expect(f.tools).toHaveLength(0);
      f.db.sqlite.exec("UPDATE coros_sync_jobs SET request_seq = 2, requested_through = '2024-02-02'");
      const p = f.db.saved()!.progress; for (const d of [...Object.values(p.domains), ...Object.values(p.health!.bulk!)]) d.recentRequestSequence = 2; f.db.saveProgress(p);
      vi.setSystemTime("2024-02-02T04:00:00Z");
      expect((await runCorosSync(f.db.env, new Date(), f.dependencies, { forceDue: true, recentOnly: true })).status).toBe("processed");
      expect(f.tools.map(t => t.name)).toEqual(["queryRecoveryStatus", "querySleepHrv"]); f.tools.length = 0;
      expect((await runCorosSync(f.db.env, new Date(), f.dependencies, { forceDue: true, recentOnly: true })).status).toBe("processed");
      expect(f.tools.map(t => t.name)).toEqual(["querySportRecords", "getActivityDetail"]); expect(f.tools[1].args.labelId).toBe("999");
      expect(f.db.saved()?.progress.health).toMatchObject({ backfillNext: "2024-01-08", recentRequestSequence: 2, activity: { backfillNext: "2024-01-08", recentRequestSequence: 2 } });
      f.tools.length = 0;
      expect((await runCorosSync(f.db.env, new Date(), f.dependencies, { forceDue: true, recentOnly: true })).status).toBe("complete");
      expect(f.tools).toHaveLength(0);
    } finally { f.db.sqlite.close(); }
  });
  it("migrates only a legacy common success cursor, keeps opaque cache, separates an activity backoff and survives a SQLite restart", async () => {
    const f = await separatedSyncFixture();
    try {
      const p = f.db.saved()!.progress;
      delete p.health!.activity; Object.assign(p.health!, { backfillNext: "2024-01-03", backfillThrough: "2024-01-02", latestRecordDate: "2024-01-07", created: 17,
        checkedRanges: [{ from: "2024-01-01", through: "2024-01-07" }], encryptedActivityCache: "opaque-synthetic-cache", retryAfter: "2099-01-01T00:00:00Z", lastErrorCode: "COROS_SYNC_HEALTH_DETAIL_FORMAT_UNSUPPORTED", lastErrorStage: "health_collect" });
      f.db.saveProgress(p); f.restart();
      const migrated = f.db.saved()!.progress;
      expect(migrated.health).toMatchObject({ backfillNext: "2024-01-03", backfillThrough: "2024-01-02", created: 17, retryAfter: null, encryptedActivityCache: "opaque-synthetic-cache" });
      expect(migrated.health?.activity).toMatchObject({ backfillNext: "2024-01-03", backfillThrough: "2024-01-02", latestRecordDate: null, created: 0, retryAfter: "2099-01-01T00:00:00Z" });
      expect(migrated.health?.activity?.checkedRanges).toBeUndefined();
      f.db.saveProgress(migrated); f.restart(); expect(f.db.saved()!.progress).toEqual(migrated);
      expect((await runCorosSync(f.db.env, new Date(), f.dependencies, { forceDue: true })).status).toBe("processed");
      expect(f.tools.map(t => t.name)).toEqual(["querySleepHrv"]); expect(f.db.saved()?.progress.health?.activity?.backfillNext).toBe("2024-01-03");
    } finally { f.db.sqlite.close(); }
  });
  it("keeps activity failures out of the HRV gate and preserves a validated encrypted detail", async () => {
    const f = await separatedSyncFixture();
    try {
      await runCorosSync(f.db.env, new Date(), f.dependencies, { forceDue: true });
      await runCorosSync(f.db.env, new Date(), f.dependencies, { forceDue: true });
      f.faults.detailId = "102";
      expect(await runCorosSync(f.db.env, new Date(), f.dependencies, { forceDue: true })).toMatchObject({ status: "error", errorCode: "COROS_SYNC_HEALTH_DETAIL_FORMAT_UNSUPPORTED" });
      expect(f.db.saved()?.progress.health).toMatchObject({ backfillNext: "2024-01-08", lastErrorCode: null, retryAfter: null, activity: { backfillNext: "2024-01-01", lastErrorCode: "COROS_SYNC_HEALTH_DETAIL_FORMAT_UNSUPPORTED" } });
      expect(f.tools.filter(t => t.name === "querySleepHrv")).toHaveLength(1); expect(f.commits).toBe(1);
      f.restart(); expect(f.db.saved()?.progress.health?.encryptedActivityCache).toBeTruthy();
    } finally { f.db.sqlite.close(); }
  });
  it("retains shared authorization failure for every source without advancing either cursor", async () => {
    const f = await separatedSyncFixture(); f.faults.invalidGrant = true;
    try {
      expect(await runCorosSync(f.db.env, new Date(), f.dependencies, { forceDue: true })).toMatchObject({ status: "error", errorCode: "COROS_OAUTH_REFRESH_HTTP_400_INVALID_GRANT" });
      for (const d of syncProgressDomains(f.db.saved()!.progress)) expect(d).toMatchObject({ lastErrorCode: "COROS_OAUTH_REFRESH_HTTP_400_INVALID_GRANT", lastErrorStage: "credentials_refresh", retryAfter: "2024-02-01T04:20:00.000Z" });
      expect(f.tools).toHaveLength(0); expect(f.commits).toBe(0); f.restart();
      expect((await runCorosSync(f.db.env, new Date(), f.dependencies, { forceDue: true })).status).toBe("deferred");
    } finally { f.db.sqlite.close(); }
  });
  it("leaves HRV coverage unchanged on Git failure and protects tombstones and user edits on replay", async () => {
    const f = await separatedSyncFixture(); f.faults.write = true;
    try {
      expect((await runCorosSync(f.db.env, new Date(), f.dependencies, { forceDue: true })).status).toBe("error"); expect(f.db.saved()?.progress.health?.backfillNext).toBe("2024-01-01");
      f.faults.write = false; vi.setSystemTime("2024-02-01T04:20:00Z");
      const p = f.db.saved()!.progress; p.scheduling = { lastKind: "recent", historySource: "workout" }; f.db.saveProgress(p);
      expect((await runCorosSync(f.db.env, new Date(), f.dependencies, { forceDue: true })).status).toBe("processed");
      const original = [...f.files.values()].map(parseHealthMetricRecord).find(r => r.data.metric_type === "sleep_hrv_avg")!;
      const path = recordPath("health_metric", original.id); f.files.set(path, serializeRecord({ ...original, deleted_at: SYNC_TEST_NOW }));
      const replay = f.db.saved()!.progress; replay.health!.backfillNext = "2024-01-01"; replay.scheduling = { lastKind: "recent", historySource: "workout" }; f.db.saveProgress(replay);
      expect((await runCorosSync(f.db.env, new Date(), f.dependencies, { forceDue: true })).status).toBe("processed"); expect(parseHealthMetricRecord(f.files.get(path)!).deleted_at).toBe(SYNC_TEST_NOW);
      f.files.set(path, serializeRecord({ ...original, data: { ...original.data, value: 88 } }));
      const edited = f.files.get(path); const next = f.db.saved()!.progress; next.health!.backfillNext = "2024-01-01"; next.scheduling = { lastKind: "recent", historySource: "workout" }; f.db.saveProgress(next);
      // An unchanged source fingerprint preserves local edits without rewriting.
      expect((await runCorosSync(f.db.env, new Date(), f.dependencies, { forceDue: true })).status).toBe("processed"); expect(f.files.get(path)).toBe(edited);
    } finally { f.db.sqlite.close(); }
  });
  it("rejects malformed activity progress and accepts the legacy scheduling key without inventing intervals", async () => {
    const f = await separatedSyncFixture();
    try {
      const p = f.db.saved()!.progress; (p.scheduling as unknown) = { lastKind: "history", historySource: "hrvActivity" };
      expect(parseSyncProgress(JSON.stringify(p)).scheduling?.historySource).toBe("activity");
      p.health!.activity!.backfillNext = "2024-02-30"; expect(() => parseSyncProgress(JSON.stringify(p))).toThrow("STATE_INVALID");
    } finally { f.db.sqlite.close(); }
  });
  it.each([
    ["COROS_SYNC_HEALTH_DETAIL_MISMATCH", "health_collect", false, true],
    ["COROS_SYNC_HEALTH_FORMAT_UNSUPPORTED", "health_collect", true, false],
    ["COROS_OAUTH_REFRESH_HTTP_400_INVALID_GRANT", "credentials_refresh", true, true],
  ] as const)("routes a proved legacy error %s without advancing either source", async (code, stage, hrvGate, activityGate) => {
    const f = await separatedSyncFixture();
    try {
      const p = f.db.saved()!.progress; delete p.health!.activity;
      Object.assign(p.health!, { lastErrorCode: code, lastErrorStage: stage, retryAfter: "2099-01-01T00:00:00Z" });
      f.db.saveProgress(p); f.restart(); const migrated = f.db.saved()!.progress.health!;
      expect(Boolean(migrated.retryAfter)).toBe(hrvGate); expect(Boolean(migrated.activity!.retryAfter)).toBe(activityGate);
      expect(migrated.backfillNext).toBe("2024-01-01"); expect(migrated.activity!.backfillNext).toBe("2024-01-01");
    } finally { f.db.sqlite.close(); }
  });
});
