import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubConflictError } from "../../../src/lib/github-data/github-contents";
import { parseHealthMetricRecord } from "../../../src/lib/github-data/health-metrics";
import { COROS_SYNC_INDEX_PATH } from "../../../src/lib/github-data/coros-sync-index";
import { parseRecord } from "../../../src/lib/github-data/protocol";
import { collectCorosHealth, nextHealthSyncWindow } from "./coros-health-sync";
import { writeCorosHealthMetrics } from "./coros-health-writer";
import { writeCorosSyncBatch } from "./coros-sync-writer";
import { corosSyncDependenciesWithFetch, runCorosSync, type CorosSyncDependencies } from "./coros-sync";
import { COROS_SCHEDULED_BUDGET, runScheduledCorosSync, scheduledCorosFetch } from "./coros-sync-scheduled";
import { COROS_SYNC_SOURCES, initialSyncProgress, shiftDate } from "./coros-sync-state";
import { encryptRefreshToken } from "./security";
import { COROS_READ_TOOL_ALLOWLIST } from "./coros-read-client";
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
  for (const d of [...Object.values(p.domains), p.health!, ...Object.values(p.health!.bulk!)]) d.recentRequestSequence = 1;
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

describe("awaited cron with bounded serial COROS batches", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SYNC_TEST_NOW); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("rotates five nonempty sources, uses real writers and SQL, finishes only the saved range, then replays without commits", async () => {
    const f = fixture();
    try {
      const result = await runScheduledCorosSync(f.db.env, f.deps);
      expect(result.result?.status).toBe("complete"); expect(result.batches).toBeGreaterThan(5); expect(result.batches).toBeLessThan(20);
      expect(f.turns.slice(0, 5)).toEqual([...COROS_SYNC_SOURCES]);
      const p = f.db.saved()!.progress;
      for (const d of [...Object.values(p.domains), p.health!, ...Object.values(p.health!.bulk!)]) {
        expect(d).toMatchObject({ backfillNext: "2024-01-15", backfillThrough: "2024-01-14", recentRequestSequence: 1 });
      }
      const records = [...f.files].filter(([path]) => path !== COROS_SYNC_INDEX_PATH).map(([, value]) => parseRecord(value));
      expect(records.filter(r => r.entity_type === "sleep_session")).toHaveLength(14);
      expect(records.filter(r => r.entity_type === "workout")).toHaveLength(2);
      const metrics = [...f.files].filter(([path]) => path.startsWith("data/health-metrics/")).map(([, value]) => parseHealthMetricRecord(value));
      expect(metrics.filter(r => r.data.metric_type === "sleep_hrv_avg")).toHaveLength(14);
      expect(metrics.filter(r => r.data.metric_type === "steps")).toHaveLength(14);
      expect(metrics.filter(r => r.data.metric_type === "resting_heart_rate")).toHaveLength(7);
      expect(metrics.filter(r => r.data.metric_type === "training_load" && r.data.value > 0)).toHaveLength(2);
      expect(metrics.some(r => r.data.metric_type === "elevation_gain" && activities.some(a => a.date === r.data.local_date))).toBe(false);
      expect(metrics.every(r => r.data.local_date <= "2024-01-14")).toBe(true);
      expect(f.db.saved()?.lease_token).toBeNull();
      const commits = f.adapter.writeAtomicFiles.mock.calls.length, before = new Map(f.files);
      f.restart(); vi.setSystemTime("2024-02-01T04:30:00Z");
      expect((await runScheduledCorosSync(f.db.env, f.deps)).result?.status).toBe("complete");
      expect(f.adapter.writeAtomicFiles).toHaveBeenCalledTimes(commits); expect(f.files).toEqual(before);
    } finally { f.db.sqlite.close(); }
  });

  it("caps successful attempts even while a large historical backlog remains", async () => {
    const f = fixture("2023-10-01", "2024-01-31");
    try {
      expect((await runScheduledCorosSync(f.db.env, f.deps)).batches).toBe(COROS_SCHEDULED_BUDGET.batches);
      expect(f.turns).toHaveLength(20); expect(f.db.saved()!.progress.domains.sleep.backfillNext < "2024-02-01").toBe(true);
      expect(f.db.saved()?.next_run_at).toBe("2024-02-01T04:10:00.000Z"); expect(f.db.saved()?.lease_token).toBeNull();
    } finally { f.db.sqlite.close(); }
  });

  it("yields on a slow call at the wall budget, retains committed earlier batches and resumes after reopening SQLite", async () => {
    const f = fixture(), read = f.deps.read;
    f.deps.read = vi.fn<CorosSyncDependencies["read"]>(async (...args) => { vi.setSystemTime(Date.now() + 64_000); return read(...args); });
    try {
      const first = await runScheduledCorosSync(f.db.env, f.deps);
      expect(first.result).toMatchObject({ status: "deferred", errorCode: "COROS_SYNC_BUDGET_EXHAUSTED" });
      expect(Date.now() - Date.parse(SYNC_TEST_NOW)).toBeLessThanOrEqual(COROS_SCHEDULED_BUDGET.wallTimeMs + 64_000);
      expect(f.files.size).toBeGreaterThan(0); expect(f.db.saved()?.progress.failureCount).toBe(0);
      expect(f.db.saved()?.lease_token).toBeNull(); const before = new Map(f.files);
      f.restart(); vi.setSystemTime("2024-02-01T04:20:00Z"); f.deps.read = read;
      expect((await runScheduledCorosSync(f.db.env, f.deps)).result?.status).toBe("complete");
      for (const [path, value] of before) if (path !== COROS_SYNC_INDEX_PATH) expect(f.files.get(path)).toBe(value);
      expect(f.db.saved()?.progress.health?.backfillNext).toBe("2024-01-15");
    } finally { f.db.sqlite.close(); }
  });

  it("keeps source retry gates, continues independent sources and stops at the error budget", async () => {
    const f = fixture(), base = f.deps.read;
    f.deps.read = vi.fn<CorosSyncDependencies["read"]>(async (...args) => ["querySleepOverview", "querySleepHrv", "queryDailyHealthData"].includes(args[2]) ? text("unknown response") : base(...args));
    try {
      expect((await runScheduledCorosSync(f.db.env, f.deps)).errors).toBe(3);
      expect(f.turns).toEqual(["sleep", "workout", "hrvActivity", "dailyHealth"]);
      expect(f.db.saved()?.progress.domains.sleep).toMatchObject({ backfillNext: "2024-01-01", retryAfter: "2024-02-01T04:20:00.000Z" });
      expect(f.db.saved()?.progress.domains.workout.backfillNext).toBe("2024-01-15");
      expect(f.db.saved()?.progress.health?.backfillNext).toBe("2024-01-01"); expect(f.db.saved()?.lease_token).toBeNull();
    } finally { f.db.sqlite.close(); }
  });

  it.each(["COROS_READ_RATE_LIMITED", "GITHUB_RATE_LIMITED", "COROS_READ_UNAUTHORIZED"])("stops immediately on shared upstream error %s", async code => {
    const f = fixture(); f.deps.read = vi.fn().mockRejectedValue(new Error(code));
    try {
      expect(await runScheduledCorosSync(f.db.env, f.deps)).toMatchObject({ batches: 1, errors: 1, result: { errorCode: code } });
      expect(f.turns).toEqual(["sleep"]); expect(f.files.size).toBe(0);
    } finally { f.db.sqlite.close(); }
  });

  it("stops atomically before accepting a new request in a continuation", async () => {
    const f = fixture(), base = f.deps.read; let changed = false;
    f.deps.read = vi.fn<CorosSyncDependencies["read"]>(async (...args) => { if (!changed) { changed = true; f.db.sqlite.exec("UPDATE coros_sync_jobs SET request_seq = 2, requested_through = '2024-02-02'"); } return base(...args); });
    try {
      expect(await runScheduledCorosSync(f.db.env, f.deps)).toMatchObject({ batches: 2, result: { status: "deferred" } });
      expect(f.turns).toEqual(["sleep"]); expect(f.db.saved()?.progress.request?.sequence).toBe(1);
      expect(f.db.saved()?.request_seq).toBe(2); expect(f.db.saved()?.lease_token).toBeNull();
      expect(f.db.saved()?.progress.domains.sleep.backfillNext).toBe("2024-01-04");
    } finally { f.db.sqlite.close(); }
  });

  it.each(["paused", "busy", "not_due", "unrequested"])("does no source work for %s", async mode => {
    const f = fixture();
    try {
      if (mode === "paused") f.db.sqlite.exec("UPDATE coros_connections SET state = 'paused'");
      if (mode === "busy") f.db.sqlite.exec("UPDATE coros_sync_jobs SET lease_token = 'other', lease_until = '2024-02-01T04:10:00Z'");
      if (mode === "not_due") f.db.sqlite.exec("UPDATE coros_sync_jobs SET next_run_at = '2024-02-01T04:10:00Z'");
      if (mode === "unrequested") { const p = initialSyncProgress("2024-01-01", "Asia/Shanghai"); f.db.saveProgress(p); f.db.sqlite.exec("UPDATE coros_sync_jobs SET request_seq = 0, requested_through = NULL"); }
      expect((await runScheduledCorosSync(f.db.env, f.deps)).batches).toBe(1); expect(f.turns).toEqual([]); expect(f.files.size).toBe(0);
      if (mode === "busy") expect(f.db.saved()?.lease_token).toBe("other");
    } finally { f.db.sqlite.close(); }
  });

  it("stops both invocations around a pause during a read, preserving prior committed batches", async () => {
    const f = fixture(), base = f.deps.read; let calls = 0;
    f.deps.read = vi.fn<CorosSyncDependencies["read"]>(async (...args) => { if (++calls === 2) f.db.sqlite.exec("UPDATE coros_connections SET state = 'paused'; UPDATE coros_sync_jobs SET lease_token = NULL, lease_until = NULL"); return base(...args); });
    try {
      expect((await runScheduledCorosSync(f.db.env, f.deps)).result?.errorCode).toBe("COROS_SYNC_CANCELLED");
      expect(f.db.saved()?.progress.domains.sleep.backfillNext).toBe("2024-01-04");
      expect([...f.files.keys()].filter(path => path.includes("sleep-sessions"))).toHaveLength(3);
      expect([...f.files.keys()].some(path => path.includes("workouts"))).toBe(false);
    } finally { f.db.sqlite.close(); }
  });

  it("treats a denied transport hidden inside a wrapped SDK error as a budget yield", async () => {
    const f = fixture(); f.deps.read = vi.fn().mockRejectedValue(new Error("COROS_READ_TRANSPORT_FAILED"));
    try {
      expect(await runCorosSync(f.db.env, new Date(), f.deps, { budgetExhausted: () => true })).toMatchObject({ status: "deferred", errorCode: "COROS_SYNC_BUDGET_EXHAUSTED" });
      expect(f.db.saved()?.progress.failureCount).toBe(0); expect(f.db.saved()?.progress.domains.sleep.retryAfter).toBeUndefined();
      expect(f.db.saved()?.lease_token).toBeNull();
    } finally { f.db.sqlite.close(); }
  });

  it.each(["COROS_READ_RATE_LIMITED", "COROS_READ_TIMEOUT", "COROS_SYNC_FORMAT_UNSUPPORTED", "COROS_READ_UPSTREAM_UNAVAILABLE"])
  ("preserves real %s backoff even if subsequent MCP cleanup exhausted the budget", async code => {
    const f = fixture(); f.deps.read = vi.fn().mockRejectedValue(new Error(code));
    try {
      expect(await runCorosSync(f.db.env, new Date(), f.deps, { budgetExhausted: () => true })).toMatchObject({ status: "error", errorCode: code });
      expect(f.db.saved()?.progress.domains.sleep).toMatchObject({ backfillNext: "2024-01-01", retryAfter: "2024-02-01T04:20:00.000Z" });
      expect(f.db.saved()?.lease_token).toBeNull();
    } finally { f.db.sqlite.close(); }
  });

  it("retains four encrypted details through independent batches and completes the same window in one cron", async () => {
    const f = fixture(), base = f.deps.read;
    f.deps.read = vi.fn<CorosSyncDependencies["read"]>(async (...args) => {
      if (args[2] !== "querySportRecords") return base(...args);
      const from = iso(args[3].startDate), through = iso(args[3].endDate);
      const all = [...dates("2024-01-01", "2024-01-07").map((date, i) => ({ date, id: String(1000 + i) })), { date: "2024-01-09", id: "1008" }];
      const rows = all.filter(a => a.date >= from && a.date <= through);
      return text(`Sport Records — ${from} to ${through} (${rows.length} records)\n========================\n\n`
        + rows.map((a, i) => { const start = Date.parse(`${a.date}T04:00:00Z`) / 1000;
          return `${i + 1}. Jump Rope — ${a.date}\n   Time Window: startTimestamp=${start} | endTimestamp=${start + 600}\n   Duration: 10:00 | Sets: 500\n   LabelId: ${a.id} | SportType: 901`; }).join("\n\n"));
    });
    try {
      expect((await runScheduledCorosSync(f.db.env, f.deps)).result?.status).toBe("complete");
      expect(f.db.saved()?.progress.health).toMatchObject({ backfillNext: "2024-01-15", lastErrorCode: null, retryAfter: null });
      expect(f.turns).toContain("dailyHealth"); expect(f.turns).toContain("restingHeartRate");
      const labels = vi.mocked(f.deps.read).mock.calls.filter(([, , name]) => name === "getActivityDetail").map(([, , , args]) => args.labelId);
      expect(labels).toEqual(["1000", "1001", "1002", "1003", "1004", "1005", "1006", "1008"]);
      expect(new Set(labels).size).toBe(labels.length);
      f.restart(); vi.setSystemTime("2024-02-01T04:30:00Z"); vi.mocked(f.deps.read).mockClear();
      expect((await runScheduledCorosSync(f.db.env, f.deps)).result?.status).toBe("complete");
      expect(f.deps.read).not.toHaveBeenCalled();
      expect(f.db.saved()?.progress.health).toMatchObject({ backfillNext: "2024-01-15", lastErrorCode: null });
    } finally { f.db.sqlite.close(); }
  });


  it("removes only the legacy normal-continuation gate and completes without waiting", async () => {
    const f = fixture();
    try {
      const p = f.db.saved()!.progress;
      p.health!.retryAfter = "2024-02-01T05:00:00.000Z";
      p.health!.lastErrorCode = p.lastErrorCode = "COROS_SYNC_ACTIVITY_DETAILS_PENDING";
      p.health!.lastErrorStage = p.lastErrorStage = "health_collect";
      f.db.saveProgress(p);
      expect((await runScheduledCorosSync(f.db.env, f.deps)).result?.status).toBe("complete");
      expect(f.db.saved()?.progress.health).toMatchObject({ backfillNext: "2024-01-15", retryAfter: null, lastErrorCode: null });
      expect(f.db.saved()?.lease_token).toBeNull();
    } finally { f.db.sqlite.close(); }
  });

  it("stops a successful-looking continuation with no newly saved details or coverage", async () => {
    const f = fixture();
    try {
      const p = f.db.saved()!.progress;
      for (const d of Object.values(p.domains)) d.backfillNext = "2024-01-15";
      f.db.saveProgress(p);
      f.deps.health = vi.fn(async (_read, window) => ({ items: [], through: window.through, observedAt: new Date().toISOString(),
        limitations: [], activityContinuation: { detailsRead: 0 }, observedDates: [], unconfirmedZeroDates: [] }));
      expect(await runScheduledCorosSync(f.db.env, f.deps)).toMatchObject({ batches: 1, errors: 0,
        result: { status: "processed", madeProgress: false, continuation: { detailsRead: 0 } } });
      expect(f.db.saved()?.progress.health).toMatchObject({ backfillNext: "2024-01-01", retryAfter: null, lastErrorCode: null });
      expect(f.db.saved()?.lease_token).toBeNull();
    } finally { f.db.sqlite.close(); }
  });

  it.each([false, true])("uses real OAuth and MCP SDK at 40 fetches, finalizes and resumes nonempty sources (cleanup failure=%s)", async cleanupFailure => {
    const f = fixture();
    const origin = "https://mcpcn.coros.com";
    let rotations = 0;
    const methods: string[] = [];
    const upstream = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("protected-resource")) return Response.json({ resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ["mcp.tools", "offline_access"] });
      if (url.includes("well-known")) return Response.json({ issuer: origin, authorization_endpoint: `${origin}/oauth2/authorize`,
        token_endpoint: `${origin}/oauth2/token`, registration_endpoint: `${origin}/connect/register`,
        code_challenge_methods_supported: ["S256"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"] });
      if (url.endsWith("/oauth2/token")) return Response.json({ access_token: "synthetic-access", refresh_token: `synthetic-refresh-${++rotations}`,
        token_type: "Bearer", expires_in: 3600, scope: "mcp.tools" });
      if (init?.method === "GET") return new Response(null, { status: 405 });
      if (init?.method === "DELETE") { methods.push("DELETE"); if (cleanupFailure) throw new Error("synthetic-cleanup-failure"); return new Response(null, { status: 204 }); }
      const rpc = JSON.parse(String(init?.body)); methods.push(rpc.method);
      if (rpc.method === "server/discover") return Response.json({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Method not found" } });
      if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      const result = rpc.method === "initialize" ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "synthetic-coros", version: "1" } }
        : rpc.method === "tools/list" ? { tools: COROS_READ_TOOL_ALLOWLIST.map(name => ({ name, inputSchema: { type: "object" } })) }
          : { content: response(rpc.params.name, rpc.params.arguments).payload };
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result }, { headers: rpc.method === "initialize" ? { "mcp-session-id": "synthetic-session" } : {} });
    });
    try {
      const encrypted = await encryptRefreshToken("synthetic-refresh-0", f.db.env.TOKEN_ENCRYPTION_KEY!);
      f.db.sqlite.prepare("UPDATE coros_connections SET encrypted_refresh_token = ?").run(encrypted);
      let completed = false, yielded = false;
      for (let invocation = 0; invocation < 12 && !completed; invocation++) {
        const before = upstream.mock.calls.length;
        const budget = scheduledCorosFetch(Date.now() + 480_000, upstream);
        const deps = { ...corosSyncDependenciesWithFetch(budget.fetch), adapter: f.deps.adapter };
        for (let batch = 0; batch < 20; batch++) {
          const result = await runCorosSync(f.db.env, new Date(), deps, { forceDue: true, budgetExhausted: budget.denied });
          expect(f.db.saved()?.lease_token).toBeNull();
          if (result.status === "complete") { completed = true; break; }
          if (result.errorCode === "COROS_SYNC_BUDGET_EXHAUSTED") { yielded = true; break; }
          expect(result.status, JSON.stringify({ code: result.errorCode, stage: result.progress?.lastErrorStage, methods })).toBe("processed");
        }
        expect(upstream.mock.calls.length - before).toBeLessThanOrEqual(40);
        expect(f.db.saved()?.progress.failureCount).toBe(0);
        f.restart();
      }
      expect(yielded).toBe(true); expect(completed).toBe(true);
      expect(methods).toContain("server/discover"); expect(methods).toContain("initialize"); expect(methods).toContain("DELETE");
      expect(upstream.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
      expect(rotations).toBeGreaterThan(5);
      for (const d of [...Object.values(f.db.saved()!.progress.domains), f.db.saved()!.progress.health!, ...Object.values(f.db.saved()!.progress.health!.bulk!)]) {
        expect(d.backfillNext).toBe("2024-01-15"); expect(d.retryAfter).toBeNull();
      }
      expect([...f.files.keys()].some(path => path.includes("sleep-sessions"))).toBe(true);
      expect([...f.files.keys()].some(path => path.includes("workouts"))).toBe(true);
      expect([...f.files.keys()].some(path => path.includes("health-metrics"))).toBe(true);
    } finally { f.db.sqlite.close(); }
  });

  it.each(["OAuth", "MCP"])("finalizes the lease on a rejected %s manual redirect", async source => {
    const f = fixture();
    try {
      const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 307, headers: { location: "https://mcpcn.coros.com/mcp" } }));
      const budget = scheduledCorosFetch(Date.now() + 60_000, upstream);
      const deps = { ...corosSyncDependenciesWithFetch(budget.fetch), adapter: f.deps.adapter,
        ...(source === "MCP" ? { refresh: f.deps.refresh } : {}) };
      expect((await runCorosSync(f.db.env, new Date(), deps)).status).toBe("error");
      expect(f.db.saved()?.lease_token).toBeNull(); expect(upstream.mock.calls.length).toBeGreaterThan(0);
      expect(upstream.mock.calls.length).toBeLessThanOrEqual(2);
      expect(f.db.saved()?.progress.failureCount).toBe(1);
    } finally { f.db.sqlite.close(); }
  });

  it("allows only one invocation to hold the existing atomic lease", async () => {
    const f = fixture(), base = f.deps.refresh;
    let entered!: () => void, release!: () => void;
    const entry = new Promise<void>(resolve => { entered = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
    f.deps.refresh = vi.fn<CorosSyncDependencies["refresh"]>(async (...args) => { entered(); await wait; return base(...args); });
    try {
      const first = runScheduledCorosSync(f.db.env, f.deps); await entry;
      expect((await runScheduledCorosSync(f.db.env, f.deps)).result?.status).toBe("busy");
      expect(f.deps.refresh).toHaveBeenCalledTimes(1); release();
      expect((await first).result?.status).toBe("complete"); expect(f.db.saved()?.lease_token).toBeNull();
    } finally { f.db.sqlite.close(); }
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
