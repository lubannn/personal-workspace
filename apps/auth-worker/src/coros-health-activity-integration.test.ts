import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubConflictError } from "../../../src/lib/github-data/github-contents";
import { parseHealthMetricRecord } from "../../../src/lib/github-data/health-metrics";
import { recordPath, serializeRecord } from "../../../src/lib/github-data/protocol";
import { collectCorosActivityTotals, mapCorosActivityDetail } from "./coros-health-activity";
import { collectCorosHealth, nextHealthSyncWindow } from "./coros-health-sync";
import { corosMetricId, writeCorosHealthMetrics } from "./coros-health-writer";
import { initializeBulkHealthProgress } from "./coros-health-history";
import { runCorosSync, type CorosSyncDependencies } from "./coros-sync";
import { mapCorosWorkouts } from "./coros-sync-mapping";
import { initialSyncProgress, shiftDate } from "./coros-sync-state";
import { SYNC_TEST_NOW, syncTestDatabase } from "./coros-sync-test-helpers";
import { decryptRefreshToken } from "./security";
import type { CorosReadResult, CorosReadTool } from "./coros-read-client";

// The observed historical list/detail/HRV grammars; all identities, dates,
// durations and health values below are independently synthetic.
const text = (value: string) => ({ format: "content" as const, payload: [{ type: "text", text: JSON.stringify(value) }] });
const iso = (value: unknown) => String(value).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
const key = Buffer.alloc(32, 7).toString("base64url");
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const activities = Array.from({ length: 8 }, (_, i) => ({ id: String(101 + i), date: shiftDate("2024-01-01", i),
  moving: 600 + i, elapsed: i === 6 ? 7200 : 600 + i - (i === 1 ? 1 : 0), load: 11 + i }));
const increment = { id: "999", date: "2024-02-02", moving: 600, elapsed: 600, load: 21 };
function sportList(from: string, through: string) {
  const rows = [...activities, increment].filter(a => a.date >= from && a.date <= through).reverse();
  if (!rows.length) throw new Error("TEST_EXPECTED_NONEMPTY_ACTIVITIES");
  return text(`Sport Records — ${from} to ${through} (${rows.length} records)\n========================\n\n`
    + rows.map((a, i) => {
      const start = Date.parse(`${a.date}T04:00:00Z`) / 1000;
      return `${i + 1}. Jump Rope — ${a.date}\n   Location: synthetic\n   Time Window: startTimestamp=${start} | endTimestamp=${start + a.elapsed}\n   Duration: ${clock(a.moving)} | Sets: 500\n   Average Pace: 4:00 /km | Avg HR: 100 bpm | Calories: 50 kcal\n   LabelId: ${a.id} | SportType: 901`;
    }).join("\n\n"));
}
function jumpDetail(id = "101", load?: string) {
  const a = [...activities, increment].find(a => a.id === id)!;
  return text(`🚶 Jump Rope Activity Details\n========================================\n\nWorkout Time: ${clock(a.moving)}\nTotal Reps: 500\nMax Continuous Jumps: 200\nAverage Rope Speed: 120 rpm\nAverage Heart Rate: 100 bpm\nCalories: 50 kcal\nTraining Load: ${load ?? a.load}\nPerceived Effort: Easy`);
}
function hrv(from: string, through: string) {
  const dates: string[] = []; for (let d = from; d <= through; d = shiftDate(d, 1)) dates.push(d);
  return text(`Sleep HRV — ${from} to ${through}\n========================\nNote: dates are wake-up days (each value comes from the night that ended that morning).\n\nHRV Assessment — Last ${dates.length} days\n========================\n\n`
    + dates.map((d, i) => `${d}:\n  HRV Avg: ${41 + i} ms — Normal\n  Normal Range: 30 - 60 ms${i < 3 ? "\n  Baseline: 45 ms" : ""}`).join("\n")
    + `\n\nSleep HRV Time Series — Last ${dates.length} days\n========================\n\n`
    + dates.map(d => `${d}:\n  timestamp=1, timezone=32, hrv=999 ms, status=0, confidence=1000`).join("\n"));
}
function reader() {
  return vi.fn(async (tool: CorosReadTool, args: Record<string, unknown>): Promise<CorosReadResult> => {
    if (tool === "querySportRecords") return sportList(iso(args.startDate), iso(args.endDate));
    if (tool === "getActivityDetail") return jumpDetail(String(args.labelId));
    if (tool === "querySleepHrv") return hrv(iso(args.startDate), iso(args.endDate));
    if (tool === "queryRecoveryStatus") return text("Recovery Status\n========================\n\nRecovery: 60%\nLevel: Rest recommended\nEstimated Full Recovery: 2h");
    if (tool === "queryDailyHealthData") return text(`Daily Health Data — Last ${args.days} days | Resting HR: 50 bpm | HRV Baseline: 40 ms\nNote: sleep entries are dated by their wake-up day.\n\n--- 20240101 ---\nSteps: 100 | Calories: 10 kcal | Exercise: 5 min`);
    throw new Error(`UNEXPECTED_TEST_TOOL_${tool}`);
  });
}
function setup() {
  const db = syncTestDatabase(); db.connection(); db.env.TOKEN_ENCRYPTION_KEY = key;
  const p = initialSyncProgress("2024-01-01", "Asia/Shanghai"); p.request = { sequence: 1, through: "2024-02-01", historyThrough: "2024-01-07" };
  nextHealthSyncWindow(p, new Date());
  for (const d of [...Object.values(p.domains), ...Object.values(initializeBulkHealthProgress(p))]) {
    d.recentRequestSequence = 1; d.backfillNext = "2024-02-01"; d.backfillThrough = "2024-01-31";
  }
  p.health!.recentRequestSequence = 1; p.health!.activity!.recentRequestSequence = 1; db.job(p);
  const files = new Map<string, string>(); let version = 1;
  const adapter = {
    readText: vi.fn(async () => ({ text: JSON.stringify({ schema_version: 1, workspace_id: "test-workspace", owner_id: "test-owner",
      owner_login: "example-owner", locale: "zh-CN", timezone: "Asia/Shanghai" }) })),
    readBranchSnapshot: vi.fn(async () => ({ branch: "main", headCommitSha: String(version).padStart(40, "0"), rootTreeSha: "b".repeat(40) })),
    listTreeFiles: vi.fn(async () => [...files].map(([path, text]) => ({ type: "file" as const, name: path.split("/").at(-1)!, path, blobSha: "a".repeat(40), sizeBytes: text.length }))),
    readBlobTexts: vi.fn<Parameters<typeof writeCorosHealthMetrics>[0]["readBlobTexts"]>(async entries => entries.map(entry => ({ ...entry, text: files.get(entry.path)! }))),
    writeAtomicFiles: vi.fn<Parameters<typeof writeCorosHealthMetrics>[0]["writeAtomicFiles"]>(async input => {
      if (input.expectedHeadCommitSha !== String(version).padStart(40, "0")) throw new GitHubConflictError();
      await input.beforeRefUpdate?.(); input.files.forEach(entry => files.set(entry.path, entry.text)); version++;
      return { commitSha: String(version).padStart(40, "0"), treeSha: "b".repeat(40), files: input.files.map(entry => ({ path: entry.path, blobSha: "a".repeat(40) })) };
    }),
  };
  const read = reader();
  const deps: CorosSyncDependencies = {
    refresh: vi.fn().mockResolvedValue({ resourceUrl: "https://mcpcn.coros.com/mcp", accessToken: "synthetic-token" }),
    read: vi.fn(async (_resource, _token, name, args) => read(name, args)), adapter: vi.fn().mockResolvedValue(adapter),
    write: vi.fn(), health: collectCorosHealth, writeMetrics: writeCorosHealthMetrics,
  };
  return { db, files, adapter, read, deps, records: () => [...files.values()].map(parseHealthMetricRecord) };
}

describe("historical jump-rope details and official HRV through persistence", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SYNC_TEST_NOW); });
  afterEach(() => vi.useRealTimers());

  it("checks active time independently of elapsed pauses and one-second display rounding", () => {
    const workouts = mapCorosWorkouts(sportList("2024-01-01", "2024-01-08"), { startDate: "2024-01-01", endDate: "2024-01-08", timezone: "Asia/Shanghai" }).items;
    for (const workout of workouts) expect(mapCorosActivityDetail(jumpDetail(workout.sourceId.slice(8)), workout))
      .toEqual({ elevationGainMeters: null, trainingLoad: Number(workout.sourceId.slice(8)) - 90 });
    const workout = workouts.find(w => w.sourceId === "workout:101")!;
    const change = (a: string, b: string) => text(JSON.parse(String(jumpDetail().payload[0].text)).replace(a, b));
    expect(() => mapCorosActivityDetail(change("Workout Time: 10:00", "Workout Time: 12:00"), workout)).toThrow("MISMATCH");
    expect(() => mapCorosActivityDetail(change("Workout Time: 10:00\n", ""), workout)).toThrow("FORMAT_UNSUPPORTED");
    expect(() => mapCorosActivityDetail(change("Workout Time: 10:00", "Workout Time: 10:60"), workout)).toThrow("FORMAT_UNSUPPORTED");
    expect(() => mapCorosActivityDetail(change("Total Reps: 500", "Total Time: 15:00"), workout)).toThrow("MISMATCH");
    expect(() => mapCorosActivityDetail(jumpDetail(), { ...workout, candidate: { ...workout.candidate,
      metrics_json: { ...workout.candidate.metrics_json, coros_sport_type: 104 } } })).toThrow("FORMAT_UNSUPPORTED");
    expect(() => mapCorosActivityDetail(change("🚶 Jump Rope", "🏃 Hike"), workout)).toThrow("FORMAT_UNSUPPORTED");
    expect(() => mapCorosActivityDetail(jumpDetail(), { ...workout, candidate: { ...workout.candidate,
      metrics_json: { ...workout.candidate.metrics_json, moving_seconds: null } } })).toThrow("FORMAT_UNSUPPORTED");
    expect(() => mapCorosActivityDetail(change("Total Reps: 500", "Workout Time: 10:00"), workout)).toThrow("FORMAT_UNSUPPORTED");
    expect(() => mapCorosActivityDetail(jumpDetail("101", "11 load"), workout)).toThrow("FORMAT_UNSUPPORTED");
    expect(mapCorosActivityDetail(jumpDetail("101", "No data"), workout)).toEqual({ elevationGainMeters: null, trainingLoad: null });
    expect(mapCorosActivityDetail(change("Training Load: 11\n", ""), workout)).toEqual({ elevationGainMeters: null, trainingLoad: null });
    expect(mapCorosActivityDetail(jumpDetail("101", "0"), workout)).toEqual({ elevationGainMeters: null, trainingLoad: 0 });
  });

  it("commits HRV independently, resumes one encrypted detail after SQLite restart, and checks nonempty recent increments", async () => {
    const f = setup(); let db = f.db;
    try {
      expect(await runCorosSync(db.env, new Date(), f.deps, { forceDue: true })).toMatchObject({ status: "processed", batch: { created: 17 } });
      expect(db.saved()?.progress.health).toMatchObject({ backfillNext: "2024-01-08", activity: { backfillNext: "2024-01-01", backfillThrough: null } });
      expect(f.read.mock.calls.map(([name]) => name)).toEqual(["querySleepHrv"]);
      for (let count = 1; count <= 7; count++) {
        const result = await runCorosSync(db.env, new Date(), f.deps, { forceDue: true });
        expect(result.status).toBe("processed");
        expect(f.read.mock.calls.filter(([name]) => name === "querySleepHrv")).toHaveLength(1);
        expect(f.read.mock.calls.filter(([name]) => name === "getActivityDetail")).toHaveLength(count);
        if (count < 7) {
          expect(result.continuation).toEqual({ detailsRead: 1 });
          expect(db.saved()?.progress.health?.activity?.backfillThrough).toBeNull();
          expect(db.saved()?.progress.health?.activity?.checkedRanges).toBeUndefined();
          expect(f.adapter.writeAtomicFiles).toHaveBeenCalledTimes(1);
        }
        if (count === 3) {
          const saved = db.saved()!;
          expect(saved.progress_json).not.toMatch(/trainingLoad|elevationGainMeters|workout:10|synthetic-token/);
          expect(JSON.parse(await decryptRefreshToken(saved.progress.health!.encryptedActivityCache!, key)).entries).toHaveLength(3);
          const snapshot = db.sqlite.serialize(); db.sqlite.close(); db = syncTestDatabase(snapshot); db.env.TOKEN_ENCRYPTION_KEY = key;
        }
      }
      expect(db.saved()?.progress.health?.activity).toMatchObject({ backfillNext: "2024-01-08", backfillThrough: "2024-01-07", checkedRanges: [{ from: "2024-01-01", through: "2024-01-07" }] });
      expect(f.records()).toHaveLength(24);
      expect(f.records().filter(r => r.data.metric_type === "training_load").map(r => [r.data.local_date, r.data.value]).sort()).toEqual(activities.slice(0, 7).map(a => [a.date, a.load]));
      expect(f.records().some(r => r.data.metric_type === "elevation_gain" || r.data.value === 999)).toBe(false);
      expect(f.adapter.writeAtomicFiles).toHaveBeenCalledTimes(2);
      f.read.mockClear(); expect((await runCorosSync(db.env, new Date(), f.deps, { forceDue: true })).status).toBe("complete"); expect(f.read).not.toHaveBeenCalled();
      db.sqlite.exec("UPDATE coros_sync_jobs SET request_seq = 2, requested_through = '2024-02-02'");
      const p = db.saved()!.progress; for (const d of [...Object.values(p.domains), ...Object.values(p.health!.bulk!)]) d.recentRequestSequence = 2;
      db.saveProgress(p); vi.setSystemTime("2024-02-02T04:00:00Z");
      expect((await runCorosSync(db.env, new Date(), f.deps, { forceDue: true })).status).toBe("processed");
      expect(f.read.mock.calls.map(([name]) => name)).toEqual(["queryRecoveryStatus", "querySleepHrv"]);
      f.read.mockClear(); const incrementProgress = db.saved()!.progress; incrementProgress.scheduling = { lastKind: "history", recentSource: "hrv" }; db.saveProgress(incrementProgress);
      expect(await runCorosSync(db.env, new Date(), f.deps, { forceDue: true })).toMatchObject({ status: "processed" });
      expect(f.read.mock.calls.map(([name]) => name)).toEqual(["querySportRecords", "getActivityDetail"]);
      expect(f.records().find(r => r.data.local_date === increment.date && r.data.metric_type === "training_load")?.data.value).toBe(increment.load);
      expect(db.saved()?.progress.health).toMatchObject({ backfillNext: "2024-01-08", recentRequestSequence: 2, activity: { backfillNext: "2024-01-08", recentRequestSequence: 2 } });
      expect(db.saved()?.lease_token).toBeNull();
    } finally { db.sqlite.close(); }
  });

  it("isolates a bad activity detail from committed HRV and an independent daily source", async () => {
    const f = setup(), base = f.read.getMockImplementation()!;
    try {
      await runCorosSync(f.db.env, new Date(), f.deps, { forceDue: true });
      f.read.mockImplementation(async (name, args) => name === "getActivityDetail" && args.labelId === "105" ? text("unrecognized detail") : base(name, args));
      for (let i = 0; i < 2; i++) expect((await runCorosSync(f.db.env, new Date(), f.deps, { forceDue: true })).continuation).toEqual({ detailsRead: 1 });
      expect(await runCorosSync(f.db.env, new Date(), f.deps, { forceDue: true })).toMatchObject({ status: "error", errorCode: "COROS_SYNC_HEALTH_DETAIL_FORMAT_UNSUPPORTED" });
      expect(f.db.saved()?.progress.health).toMatchObject({ backfillNext: "2024-01-08", lastErrorCode: null, activity: { backfillNext: "2024-01-01", lastErrorCode: "COROS_SYNC_HEALTH_DETAIL_FORMAT_UNSUPPORTED" } });
      expect(f.records()).toHaveLength(17);
      const p = f.db.saved()!.progress; p.health!.bulk!.dailyHealth.backfillNext = "2024-01-01"; f.db.saveProgress(p);
      expect((await runCorosSync(f.db.env, new Date(), f.deps, { forceDue: true })).status).toBe("processed");
      expect(f.db.saved()?.progress.health?.bulk?.dailyHealth.backfillNext).toBe("2024-01-08");
      expect(f.read.mock.calls.filter(([name]) => name === "querySleepHrv")).toHaveLength(1);
      expect(f.records().some(r => r.data.metric_type === "training_load")).toBe(false);
    } finally { f.db.sqlite.close(); }
  });

  it("replays a committed HRV window after lost coverage and expired lease without another commit", async () => {
    const f = setup(); let db = f.db;
    try {
      const prepare = db.db.prepare.bind(db.db);
      vi.spyOn(db.db, "prepare").mockImplementation(query => {
        const statement = prepare(query); if (query.includes("next_run_at = CASE")) statement.run = async () => { throw new Error("synthetic checkpoint interruption"); }; return statement;
      });
      await expect(runCorosSync(db.env, new Date(), f.deps, { forceDue: true })).rejects.toThrow("checkpoint interruption");
      expect(f.records()).toHaveLength(17); expect(db.saved()?.progress.health?.backfillNext).toBe("2024-01-01");
      const snapshot = db.sqlite.serialize(); db.sqlite.close(); db = syncTestDatabase(snapshot); db.env.TOKEN_ENCRYPTION_KEY = key;
      vi.setSystemTime("2024-02-01T04:11:00Z"); f.read.mockClear();
      // The interrupted turn yielded fairly to activity. Complete that saved
      // turn, then explicitly select the HRV replay without resetting its cursor.
      const p = db.saved()!.progress; p.scheduling = { lastKind: "recent", historySource: "workout" }; db.saveProgress(p);
      expect(await runCorosSync(db.env, new Date(), f.deps, { forceDue: true })).toMatchObject({ status: "processed", batch: { created: 0, unchanged: 17 } });
      expect(f.read.mock.calls.map(([name]) => name)).toEqual(["querySleepHrv"]); expect(f.adapter.writeAtomicFiles).toHaveBeenCalledTimes(1);
      expect(db.saved()?.progress.health?.backfillNext).toBe("2024-01-08");
    } finally { db.sqlite.close(); }
  });

  it("holds the failed source cursor and preserves CAS, tombstones and manual edits", async () => {
    const f = setup();
    try {
      f.adapter.writeAtomicFiles.mockRejectedValueOnce(new Error("GITHUB_UNAVAILABLE"));
      expect((await runCorosSync(f.db.env, new Date(), f.deps, { forceDue: true })).status).toBe("error");
      expect(f.files.size).toBe(0); expect(f.db.saved()?.progress.health?.backfillNext).toBe("2024-01-01");
      vi.setSystemTime("2024-02-01T04:20:00Z");
      const p = f.db.saved()!.progress; p.scheduling = { lastKind: "recent", historySource: "workout" }; f.db.saveProgress(p);
      f.adapter.writeAtomicFiles.mockRejectedValueOnce(new GitHubConflictError());
      expect(await runCorosSync(f.db.env, new Date(), f.deps, { forceDue: true })).toMatchObject({ status: "processed", batch: { created: 17 } });
      for (let i = 0; i < 7; i++) await runCorosSync(f.db.env, new Date(), f.deps, { forceDue: true });
      const result = await collectCorosActivityTotals(f.read, "2024-01-01", "2024-01-07", f.db.saved()!.progress, async () => {}, new Date().toISOString(), key);
      const item = result.items[0], path = recordPath("health_metric", corosMetricId(item)); const old = parseHealthMetricRecord(f.files.get(path)!);
      f.files.set(path, serializeRecord({ ...old, deleted_at: new Date().toISOString() }));
      expect(await writeCorosHealthMetrics(f.adapter, { ownerId: "test-owner", items: [item], timestamp: new Date().toISOString() })).toMatchObject({ unchanged: 1 });
      f.files.set(path, serializeRecord({ ...old, data: { ...old.data, value: 88 } })); const edited = f.files.get(path);
      await expect(writeCorosHealthMetrics(f.adapter, { ownerId: "test-owner", items: [{ ...item, candidate: { ...item.candidate, value: 99 } }], timestamp: new Date().toISOString() })).rejects.toThrow("STORED_RECORD_MODIFIED");
      expect(f.files.get(path)).toBe(edited); expect(f.db.saved()?.lease_token).toBeNull();
    } finally { f.db.sqlite.close(); }
  });
});
