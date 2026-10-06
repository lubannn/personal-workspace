import { createHash, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHealthMetricRecord } from "../../../src/lib/github-data/health-metrics";
import { createPrivateDataInstallationAdapter } from "./github-installation";
import { scheduledCorosFetch } from "./coros-sync-scheduled";
import { runCorosSync, type CorosSyncDependencies } from "./coros-sync";
import { collectCorosHealth, nextHealthSyncWindow } from "./coros-health-sync";
import { writeCorosHealthMetrics } from "./coros-health-writer";
import { initialSyncProgress, shiftDate } from "./coros-sync-state";
import { SYNC_TEST_NOW, syncTestDatabase } from "./coros-sync-test-helpers";

// Generated test identity and entirely synthetic source/data; no live requests.
const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const api = "https://api.github.com", resource = "https://mcpcn.coros.com/mcp";
const sha = (value: string) => createHash("sha1").update(value).digest("hex");
function fixture() {
  let db = syncTestDatabase(); db.connection(); db.env.GITHUB_APP_PRIVATE_KEY = key;
  db.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");
  const p = initialSyncProgress("2024-01-01", "Asia/Shanghai");
  p.request = { sequence: 1, through: "2024-02-01", historyThrough: "2024-01-07" };
  nextHealthSyncWindow(p, new Date());
  for (const d of [...Object.values(p.domains), p.health!, p.health!.activity!, ...Object.values(p.health!.bulk!)]) {
    d.recentRequestSequence = 1; d.backfillNext = "2024-02-02";
  }
  p.health!.activity!.backfillNext = "2024-01-01"; db.job(p);
  const files = new Map<string, string>(), staged = new Map<string, string>(); let revision = 1;
  const tools: string[] = [];
  const network = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    expect(init?.redirect).toBe("manual");
    if (url === resource) {
      if (!init?.body) return Response.json({}); // Earlier work in the same invocation.
      const { tool, args } = JSON.parse(String(init.body)); tools.push(tool);
      const from = String(args.startDate).replace(/^(\d{4})(\d{2})(\d{2})$/u, "$1-$2-$3"), through = String(args.endDate).replace(/^(\d{4})(\d{2})(\d{2})$/u, "$1-$2-$3");
      let text: string;
      if (tool === "querySleepHrv") {
        const dates: string[] = []; for (let date = from; date <= through; date = shiftDate(date, 1)) dates.push(date);
        text = `Sleep HRV — ${from} to ${through}\n========================\nNote: dates are wake-up days (each value comes from the night that ended that morning).\n\nHRV Assessment — Last 7 days\n========================\n\n`
          + dates.map(date => `${date}:\n  HRV Avg: 40 ms`).join("\n")
          + "\n\nSleep HRV Time Series — Last 7 days\n========================\n\nNo raw samples in this synthetic response.";
      } else if (tool === "querySportRecords") {
        const timestamp = Date.parse("2024-01-03T04:00:00Z") / 1000;
        text = `Sport Records — ${from} to ${through} (1 records)\n========================\n\n1. Jump Rope — 2024-01-03\n   Time Window: startTimestamp=${timestamp} | endTimestamp=${timestamp + 600}\n   Duration: 10:00 | Sets: 500\n   LabelId: ${timestamp} | SportType: 901`;
      } else if (tool === "getActivityDetail") {
        text = "🚶 Jump Rope Activity Details\n========================================\n\nWorkout Time: 10:00\nTotal Reps: 500\nMax Continuous Jumps: 200\nAverage Rope Speed: 120 rpm\nAverage Heart Rate: 100 bpm\nCalories: 50 kcal\nTraining Load: 11\nPerceived Effort: Easy";
      } else throw new Error("UNEXPECTED_SYNTHETIC_TOOL");
      return Response.json({ format: "content", payload: [{ type: "text", text: JSON.stringify(text) }] });
    }
    expect(new URL(url).origin).toBe(api);
    if (url.endsWith("/access_tokens")) return Response.json({ token: "synthetic-installation-token", expires_at: "2099-01-01T00:00:00Z" }, { status: 201 });
    const route = url.slice(api.length);
    if (route === "/repos/example-owner/private-data") return Response.json({ full_name: "example-owner/private-data", private: true, visibility: "private", default_branch: "main" });
    if (route.includes("/contents/workspace.json")) {
      const text = JSON.stringify({ schema_version: 1, workspace_id: "synthetic", owner_id: "test-owner", owner_login: "example-owner", timezone: "Asia/Shanghai", locale: "zh-CN" });
      return Response.json({ type: "file", path: "workspace.json", sha: sha(text), size: Buffer.byteLength(text), encoding: "base64", content: Buffer.from(text).toString("base64") });
    }
    if (route.endsWith("/git/ref/heads/main")) return Response.json({ ref: "refs/heads/main", object: { type: "commit", sha: sha(`commit-${revision}`) } });
    if (route.includes("/git/commits/") && init?.method !== "POST") return Response.json({ sha: sha(`commit-${revision}`), tree: { sha: sha(`tree-${revision}`) } });
    if (route.includes("/git/trees/") && init?.method !== "POST") return Response.json({ truncated: false, tree: [...files].map(([path, text]) => ({ path, type: "blob", sha: sha(text), size: Buffer.byteLength(text) })) });
    if (route === "/graphql" && Object.keys(JSON.parse(String(init?.body)).variables).some(key => key.startsWith("expression"))) {
      const { variables } = JSON.parse(String(init?.body)) as { variables: Record<string, string> };
      return Response.json({ data: { repository: Object.fromEntries(Object.entries(variables).filter(([key]) => key.startsWith("expression")).map(([key, expression]) => {
        const value = files.get(expression.slice(41));
        return [`blob${key.slice(10)}`, value === undefined ? null : { __typename: "Blob", oid: sha(value), byteSize: Buffer.byteLength(value), isTruncated: false, text: value }];
      })) } });
    }
    if (route.endsWith("/git/trees") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)); for (const entry of body.tree) staged.set(entry.path, entry.content);
      return Response.json({ sha: sha("new-tree") }, { status: 201 });
    }
    if (route.endsWith("/git/commits") && init?.method === "POST") return Response.json({ sha: sha("new-commit"), tree: { sha: sha("new-tree") } }, { status: 201 });
    if (route.endsWith("/git/refs/heads/main") && init?.method === "PATCH") {
      expect(JSON.parse(String(init.body))).toMatchObject({ force: false });
      for (const [path, text] of staged) files.set(path, text); revision++;
      return Response.json({ ref: "refs/heads/main", object: { type: "commit", sha: sha("new-commit") } });
    }
    if (route === "/rate_limit") return Response.json({});
    throw new Error("UNEXPECTED_SYNTHETIC_GITHUB_ENDPOINT");
  });
  function dependencies(fetcher: typeof fetch): CorosSyncDependencies {
    return { refresh: vi.fn().mockResolvedValue({ resourceUrl: resource, accessToken: "synthetic-coros-token", githubUserId: "42" }),
      read: async (_url, _token, tool, args) => (await fetcher(resource, { method: "POST", body: JSON.stringify({ tool, args }) })).json(),
      health: collectCorosHealth, write: vi.fn(), writeMetrics: writeCorosHealthMetrics,
      adapter: config => createPrivateDataInstallationAdapter(config, fetcher) };
  }
  return { get db() { return db; }, files, tools, network, dependencies,
    restart() { const snapshot = db.sqlite.serialize(), env = db.env; db.sqlite.close(); db = syncTestDatabase(snapshot); db.env = { ...env, DB: db.db }; } };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SYNC_TEST_NOW); });
afterEach(() => vi.useRealTimers());
describe("Worker GitHub transport under the scheduled budget", () => {
  it.each([37, 36, 35])("yields after %s earlier calls, retaining details and resuming with real mapping/writing after restart", async earlierCalls => {
    const f = fixture();
    try {
      const before = structuredClone(f.db.saved()!.progress.health!.activity!);
      const budget = scheduledCorosFetch(Date.now() + 480_000, f.network);
      // Three nonempty source reads then Git calls exhaust the cap at repository
      // validation, workspace contents, or the writer's snapshot request.
      for (let i = 0; i < earlierCalls; i++) await budget.fetch(resource);
      expect(await runCorosSync(f.db.env, new Date(), f.dependencies(budget.fetch), { budgetExhausted: budget.denied })).toMatchObject({ status: "deferred", errorCode: "COROS_SYNC_BUDGET_EXHAUSTED" });
      expect(f.network).toHaveBeenCalledTimes(40); expect(budget.denied()).toBe(true);
      expect(f.network.mock.calls.at(-1)?.[0]).toBe(`${api}${earlierCalls === 37 ? "/app/installations/456/access_tokens"
        : earlierCalls === 36 ? "/repos/example-owner/private-data" : "/repos/example-owner/private-data/contents/workspace.json"}`);
      expect(f.network.mock.calls.some(([url]) => String(url).endsWith("/rate_limit"))).toBe(false);
      const saved = f.db.saved()!;
      expect(saved.progress.failureCount).toBe(0); expect(saved.progress.lastErrorCode).toBeNull();
      expect(saved.progress.health?.activity).toMatchObject({ backfillNext: before.backfillNext, backfillThrough: before.backfillThrough, recentRequestSequence: before.recentRequestSequence });
      expect(saved.progress.health!.activity!.checkedRanges).toEqual(before.checkedRanges);
      expect(saved.progress.health!.activity!.retryAfter).toBeUndefined(); expect(saved.progress.health!.activity!.lastErrorCode).toBeUndefined();
      expect(saved.progress.health!.encryptedActivityCache).toBeTruthy(); expect(saved.lease_token).toBeNull(); expect(f.files.size).toBe(0);
      const encrypted = saved.progress.health!.encryptedActivityCache; f.restart();
      expect(f.db.saved()!.progress.health!.encryptedActivityCache).toBe(encrypted);
      vi.setSystemTime("2024-02-01T04:10:00Z");
      const next = scheduledCorosFetch(Date.now() + 480_000, f.network), oldCalls = f.network.mock.calls.length;
      expect(await runCorosSync(f.db.env, new Date(), f.dependencies(next.fetch), { budgetExhausted: next.denied })).toMatchObject({ status: "processed" });
      expect(f.network.mock.calls.length - oldCalls).toBeLessThanOrEqual(40); expect(next.denied()).toBe(false);
      expect(f.tools.filter(tool => tool === "getActivityDetail")).toHaveLength(1);
      const records = [...f.files.values()].map(parseHealthMetricRecord);
      expect(records.filter(record => record.data.metric_type === "sleep_hrv_avg")).toHaveLength(0);
      expect(records.some(record => record.data.metric_type === "training_load" && record.data.value > 0)).toBe(true);
      expect(records.some(record => record.data.metric_type === "elevation_gain" && record.data.local_date === "2024-01-03")).toBe(false);
      expect(f.db.saved()!.progress.health?.activity).toMatchObject({ backfillNext: "2024-01-08", backfillThrough: "2024-01-07", checkedRanges: [{ from: "2024-01-01", through: "2024-01-07" }], retryAfter: null });
      expect(f.db.saved()!.progress.failureCount).toBe(0); expect(f.db.saved()!.lease_token).toBeNull();
    } finally { f.db.sqlite.close(); }
  });

  it.each(["synthetic-network-failure", "COROS_SYNC_BUDGET_EXHAUSTED"])("keeps a real transport failure (%s) even when its probe hits the cap", async message => {
    const f = fixture(), good = f.network.getMockImplementation()!;
    f.network.mockImplementation((input, init) => String(input) === `${api}/repos/example-owner/private-data`
      ? Promise.reject(new TypeError(message)) : good(input, init));
    try {
      const budget = scheduledCorosFetch(Date.now() + 480_000, f.network);
      for (let i = 0; i < 36; i++) await budget.fetch(resource);
      expect(await runCorosSync(f.db.env, new Date(), f.dependencies(budget.fetch), { budgetExhausted: budget.denied })).toMatchObject({
        status: "error", errorCode: "GITHUB_CROSS_ORIGIN_BLOCKED", progress: { failureCount: 1, lastErrorStage: "github_adapter" },
      });
      expect(budget.denied()).toBe(true); expect(f.network).toHaveBeenCalledTimes(40);
      expect(f.network.mock.calls.at(-1)?.[0]).toBe(`${api}/repos/example-owner/private-data`);
      expect(f.db.saved()!.progress.health?.activity).toMatchObject({ backfillNext: "2024-01-01", retryAfter: "2024-02-01T04:20:00.000Z" });
      expect(f.db.saved()!.progress.health!.activity!.checkedRanges).toBeUndefined(); expect(f.files.size).toBe(0); expect(f.db.saved()!.lease_token).toBeNull();
    } finally { f.db.sqlite.close(); }
  });
});
