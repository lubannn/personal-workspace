import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubConflictError } from "../../../src/lib/github-data/github-contents";
import { parseHealthMetricRecord } from "../../../src/lib/github-data/health-metrics";
import { COROS_SYNC_INDEX_PATH } from "../../../src/lib/github-data/coros-sync-index";
import { parseRecord } from "../../../src/lib/github-data/protocol";
import { collectCorosHealth, nextHealthSyncWindow } from "./coros-health-sync";
import { writeCorosHealthMetrics } from "./coros-health-writer";
import { writeCorosSyncBatch } from "./coros-sync-writer";
import { runCorosSync, type CorosSyncDependencies } from "./coros-sync";
import { COROS_SCHEDULED_BUDGET, runScheduledCorosSync, scheduledCorosFetch } from "./coros-sync-scheduled";
import { COROS_SYNC_SOURCES, initialSyncProgress, shiftDate } from "./coros-sync-state";
import { SYNC_TEST_NOW, syncTestDatabase } from "./coros-sync-test-helpers";

// Nonempty observed source grammars; every date, identity and value is synthetic.
const text = (value: string) => ({ format: "content" as const, payload: [{ type: "text", text: JSON.stringify(value) }] });
const iso = (value: unknown) => String(value).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
function dates(from: string, through: string) { const values: string[] = []; for (let d = from; d <= through; d = shiftDate(d, 1)) values.push(d); return values; }
const activities = dates("2023-10-01", "2024-02-01").filter((_, i) => i % 7 === 2).map(date => ({ date, id: String(Date.parse(`${date}T04:00:00Z`) / 1000) }));
function response(tool: string, args: Record<string, unknown>) {
  const from = iso(args.startDate), through = iso(args.endDate);
  if (tool === "querySleepOverview") return text("Sleep Overview\n========================\nNote: each record below is dated by its wake-up day.\n\n"
    + dates(from, through).map(d => `${d}\nSleep Score: 80\nMain Sleep: 8h 0min\nMain Sleep Window: ${shiftDate(d, -1)} 23:00 - ${d} 07:00\nNaps Total: 0 min`).join("\n\n"));
  if (tool === "querySportRecords") {
    const rows = activities.filter(a => a.date >= from && a.date <= through);
    if (!rows.length) throw new Error("TEST_EXPECTED_NONEMPTY_LIST");
    return text(`Sport Records — ${from} to ${through} (${rows.length} records)\n========================\n\n`
      + rows.map((a, i) => `${i + 1}. Jump Rope — ${a.date}\n   Time Window: startTimestamp=${a.id} | endTimestamp=${Number(a.id) + 600}\n   Duration: 10:00 | Sets: 500\n   LabelId: ${a.id} | SportType: 901`).join("\n\n"));
  }
  if (tool === "getActivityDetail") return text("🚶 Jump Rope Activity Details\n========================================\n\nWorkout Time: 10:00\nTotal Reps: 500\nMax Continuous Jumps: 200\nAverage Rope Speed: 120 rpm\nAverage Heart Rate: 100 bpm\nCalories: 50 kcal\nTraining Load: 11\nPerceived Effort: Easy");
  if (tool === "querySleepHrv") return text(`Sleep HRV — ${from} to ${through}\n========================\nNote: dates are wake-up days (each value comes from the night that ended that morning).\n\nHRV Assessment — Last 7 days\n========================\n\n`
    + dates(from, through).map(d => `${d}:\n  HRV Avg: 40 ms`).join("\n")
    + "\n\nSleep HRV Time Series — Last 7 days\n========================\n\nNo raw samples in this synthetic response.");
  const relative = dates(shiftDate("2024-02-01", 1 - Number(args.days)), "2024-02-01");
  if (tool === "queryDailyHealthData") return text(`Daily Health Data — Last ${args.days} days | Resting HR: 50 bpm | HRV Baseline: 40 ms\nNote: sleep entries are dated by their wake-up day.`
    + relative.map(d => `\n\n--- ${d.replaceAll("-", "")} ---\nSteps: 200 | Calories: 10 kcal | Exercise: 0 min`).join(""));
  if (tool === "queryRestingHeartRate") return text(`Resting Heart Rate — Last ${args.days} days\n========================\n\n`
    + relative.map((d, i) => `${d}: ${i % 2 ? "No data" : "50 bpm"}`).join("\n"));
  throw new Error(`UNEXPECTED_TEST_TOOL_${tool}`);
}
function fixture(start = "2024-01-01", historyThrough = "2024-01-14") {
  let db = syncTestDatabase(); db.connection(); db.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");
  const p = initialSyncProgress(start, "Asia/Shanghai"); p.request = { sequence: 1, through: "2024-02-01", historyThrough };
  nextHealthSyncWindow(p, new Date());
  for (const d of [...Object.values(p.domains), p.health!, p.health!.activity!, ...Object.values(p.health!.bulk!)]) d.recentRequestSequence = 1;
  db.job(p);
  const files = new Map<string, string>(), snapshots = new Map<string, Map<string, string>>(); let revision = 1;
  const sha = (value: string) => createHash("sha1").update(`blob ${Buffer.byteLength(value)}\0`).update(value).digest("hex");
  const adapter = {
    readText: vi.fn(async () => ({ path: "workspace.json", blobSha: "a".repeat(40), sizeBytes: 100, text: JSON.stringify({ schema_version: 1,
      workspace_id: "test-workspace", owner_id: "test-owner", owner_login: "example-owner", locale: "zh-CN", timezone: "Asia/Shanghai" }) })),
    readBranchSnapshot: vi.fn(async () => { const tree = String(revision + 100).padStart(40, "0"); snapshots.set(tree, new Map(files));
      return { branch: "main", headCommitSha: String(revision).padStart(40, "0"), rootTreeSha: tree }; }),
    listTreeFiles: vi.fn(async (tree: string) => [...snapshots.get(tree)!].map(([path, value]) => ({ type: "file" as const, path,
      name: path.split("/").at(-1)!, blobSha: sha(value), sizeBytes: Buffer.byteLength(value) }))),
    readBlobTexts: vi.fn<Parameters<typeof writeCorosHealthMetrics>[0]["readBlobTexts"]>(async entries => entries.map(entry => ({ ...entry,
      text: [...snapshots.values()].flatMap(s => [...s]).find(([path, value]) => path === entry.path && sha(value) === entry.blobSha)![1] }))),
    writeAtomicFiles: vi.fn<Parameters<typeof writeCorosHealthMetrics>[0]["writeAtomicFiles"]>(async input => {
      if (input.expectedHeadCommitSha !== String(revision).padStart(40, "0")) throw new GitHubConflictError();
      await input.beforeRefUpdate?.(); input.files.forEach(entry => files.set(entry.path, entry.text)); revision++;
      return { commitSha: String(revision).padStart(40, "0"), treeSha: String(revision + 100).padStart(40, "0"), files: input.files.map(entry => ({ path: entry.path, blobSha: sha(entry.text) })) };
    }),
  };
  const turns: string[] = [];
  const deps: CorosSyncDependencies = {
    refresh: vi.fn(async () => { turns.push(db.saved()!.progress.scheduling!.historySource!); return { resourceUrl: "https://mcpcn.coros.com/mcp", accessToken: "synthetic-token", githubUserId: "42" }; }),
    read: vi.fn(async (_url, _token, tool, args) => response(tool, args)), adapter: vi.fn().mockResolvedValue(adapter),
    write: writeCorosSyncBatch, health: collectCorosHealth, writeMetrics: writeCorosHealthMetrics,
  };
  return { get db() { return db; }, deps, files, adapter, turns,
    restart() { const snapshot = db.sqlite.serialize(); const key = db.env.TOKEN_ENCRYPTION_KEY; db.sqlite.close(); db = syncTestDatabase(snapshot); db.env.TOKEN_ENCRYPTION_KEY = key; } };
}

describe("one source per cron invocation", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SYNC_TEST_NOW); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it("rotates six nonempty sources across ticks, finishes the saved scope and does no historical replay after SQLite restart", async () => {
    const f = fixture();
    try {
      let complete = false;
      for (let tick = 0; tick < 40; tick++) {
        vi.setSystemTime(Date.parse(SYNC_TEST_NOW) + tick * 600_000);
        const result = await runScheduledCorosSync(f.db.env, f.deps);
        expect(result.batches).toBe(1); expect(f.db.saved()?.lease_token).toBeNull();
        if (result.result?.status === "complete") { complete = true; break; }
        expect(result.result?.status).toBe("processed");
      }
      expect(complete).toBe(true); expect(f.turns.slice(0, 6)).toEqual([...COROS_SYNC_SOURCES]);
      const p = f.db.saved()!.progress;
      for (const d of [...Object.values(p.domains), p.health!, p.health!.activity!, ...Object.values(p.health!.bulk!)]) expect(d).toMatchObject({ backfillNext: "2024-01-15", backfillThrough: "2024-01-14", recentRequestSequence: 1 });
      const records = [...f.files].filter(([path]) => path !== COROS_SYNC_INDEX_PATH).map(([, value]) => parseRecord(value));
      expect(records.filter(r => r.entity_type === "sleep_session")).toHaveLength(14); expect(records.filter(r => r.entity_type === "workout")).toHaveLength(2);
      const metrics = [...f.files].filter(([path]) => path.startsWith("data/health-metrics/")).map(([, value]) => parseHealthMetricRecord(value));
      expect(metrics.filter(r => r.data.metric_type === "sleep_hrv_avg")).toHaveLength(14); expect(metrics.filter(r => r.data.metric_type === "steps")).toHaveLength(14);
      expect(metrics.filter(r => r.data.metric_type === "training_load" && r.data.value > 0)).toHaveLength(2); expect(metrics.every(r => r.data.local_date <= "2024-01-14")).toBe(true);
      const commits = f.adapter.writeAtomicFiles.mock.calls.length, before = new Map(f.files); f.restart();
      vi.setSystemTime(Date.now() + 1800_000); expect((await runScheduledCorosSync(f.db.env, f.deps)).result?.status).toBe("complete");
      expect(f.adapter.writeAtomicFiles).toHaveBeenCalledTimes(commits); expect(f.files).toEqual(before);
    } finally { f.db.sqlite.close(); }
  });
  it("stops after one successful batch even with a large historical backlog", async () => {
    const f = fixture("2023-10-01", "2024-01-31");
    try { expect((await runScheduledCorosSync(f.db.env, f.deps)).batches).toBe(COROS_SCHEDULED_BUDGET.batches); expect(f.turns).toEqual(["sleep"]); }
    finally { f.db.sqlite.close(); }
  });
  it("yields at the wall deadline without advancing coverage", async () => {
    const f = fixture(), read = f.deps.read;
    f.deps.read = async (...args) => { const result = await read(...args); vi.setSystemTime(Date.now() + COROS_SCHEDULED_BUDGET.wallTimeMs); return result; };
    try { expect((await runScheduledCorosSync(f.db.env, f.deps)).result).toMatchObject({ status: "deferred", errorCode: "COROS_SYNC_BUDGET_EXHAUSTED" }); expect(f.files.size).toBe(0); expect(f.db.saved()?.progress.failureCount).toBe(0); }
    finally { f.db.sqlite.close(); }
  });
  it.each(["COROS_READ_RATE_LIMITED", "COROS_READ_TIMEOUT", "COROS_SYNC_FORMAT_UNSUPPORTED", "COROS_READ_UPSTREAM_UNAVAILABLE"])("preserves %s even if cleanup used the remaining request budget", async code => {
    const f = fixture(); if (code === "COROS_SYNC_FORMAT_UNSUPPORTED") { const p = f.db.saved()!.progress; p.domains.sleep.backfillNext = "2024-01-14"; f.db.saveProgress(p); } const budget = scheduledCorosFetch(Date.now() + 480_000, async () => Response.json({}));
    f.deps.read = async () => { for (let i = 0; i < 40; i++) await budget.fetch("https://mcpcn.coros.com/mcp"); await budget.fetch("https://mcpcn.coros.com/mcp").catch(() => {}); throw new Error(code); };
    try { const result = await runCorosSync(f.db.env, new Date(), f.deps, { budgetExhausted: budget.denied }); expect(result).toMatchObject({ status: "error", errorCode: code }); expect(f.db.saved()?.progress.domains.sleep.lastErrorCode).toBe(code); expect(f.db.saved()?.progress.failureCount).toBe(1); }
    finally { f.db.sqlite.close(); }
  });
  it("releases the lease after pause and starts no second source", async () => {
    const f = fixture(), read = f.deps.read;
    f.deps.read = async (...args) => { const result = await read(...args); f.db.sqlite.exec("UPDATE coros_connections SET state = 'paused'"); return result; };
    try { expect((await runScheduledCorosSync(f.db.env, f.deps)).result?.errorCode).toBe("COROS_SYNC_CANCELLED"); expect(f.db.saved()?.lease_token).toBeNull(); expect(f.files.size).toBe(0); expect(f.turns).toEqual(["sleep"]); }
    finally { f.db.sqlite.close(); }
  });
  it("never starts a second batch with an accepted newer request", async () => {
    const f = fixture(), refresh = f.deps.refresh;
    f.deps.refresh = async (...args) => { f.db.sqlite.exec("UPDATE coros_sync_jobs SET request_seq = 2, requested_through = '2024-02-02'"); return refresh(...args); };
    try { const result = await runScheduledCorosSync(f.db.env, f.deps); expect(result.batches).toBe(1); expect(result.result?.progress?.request?.sequence).toBe(1); expect(f.db.saved()?.next_run_at).toBe(SYNC_TEST_NOW); }
    finally { f.db.sqlite.close(); }
  });
  it("permits only one invocation to hold the atomic lease", async () => {
    const f = fixture(), refresh = f.deps.refresh; let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
    f.deps.refresh = async (...args) => { enter(); await wait; return refresh(...args); };
    try { const first = runScheduledCorosSync(f.db.env, f.deps); await entered; expect((await runScheduledCorosSync(f.db.env, f.deps)).result?.status).toBe("busy"); release(); expect((await first).result?.status).toBe("processed"); expect(f.turns).toEqual(["sleep"]); }
    finally { f.db.sqlite.close(); }
  });
});

describe("actual scheduled transport request budget", () => {
  it("counts every fetch, rejects uncounted redirects and stops before the 41st upstream operation", async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response("synthetic"));
    const budget = scheduledCorosFetch(Date.now() + 60_000, upstream);
    for (let i = 0; i < 40; i++) await budget.fetch("https://mcpcn.coros.com/mcp");
    expect(budget.exhausted()).toBe(true); expect(budget.denied()).toBe(false);
    await expect(budget.fetch("https://mcpcn.coros.com/mcp")).rejects.toThrow("COROS_SYNC_BUDGET_EXHAUSTED");
    expect(upstream).toHaveBeenCalledTimes(40); expect(budget.denied()).toBe(true);
    expect(upstream.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
  });
});
