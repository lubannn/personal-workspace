import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubConflictError, type GitHubContentsAdapter } from "../../../src/lib/github-data/github-contents";
import { parseHealthMetricRecord } from "../../../src/lib/github-data/health-metrics";
import { mapCorosSleepHrv } from "./coros-health-mapping";
import { collectCorosHealth } from "./coros-health-sync";
import { initializeBulkHealthProgress } from "./coros-health-history";
import { writeCorosHealthMetrics } from "./coros-health-writer";
import { initializeActivityProgress, initialSyncProgress, shiftDate } from "./coros-sync-state";
import { runCorosSync, type CorosSyncDependencies } from "./coros-sync";
import type { CorosReadResult } from "./coros-read-client";
import { buildHealthBaseline, classifyHealthDay } from "../../github-pwa/app/workspace/health-status";
import { SYNC_TEST_NOW, syncTestDatabase } from "./coros-sync-test-helpers";

// Independently checked live shapes: adjacent date blocks; early single-day
// average only; early multi-day range without baseline. All dates and values here
// are synthetic, and raw time-series points intentionally differ from assessments.
const from = "2024-01-02", through = "2024-01-08";
const options = { startDate: from, endDate: through, timezone: "Asia/Shanghai", observedAt: SYNC_TEST_NOW };
const text = (value: string): CorosReadResult => ({ format: "content", payload: [{ type: "text", text: JSON.stringify(value) }] });
const iso = (value: unknown) => String(value).replace(/^(\d{4})(\d{2})(\d{2})$/u, "$1-$2-$3");
function response(blocks: string[], separator = "\n") {
  return text(`Sleep HRV — ${from} to ${through}\n========================\nNote: dates are wake-up days (each value comes from the night that ended that morning).\n\nHRV Assessment — Last ${blocks.length} days\n========================\n\n${blocks.join(separator)}\n\nSleep HRV Time Series — Last ${blocks.length} days\n========================\n\n${from}:\n  timestamp=1, timezone=32, hrv=999 ms, status=4, confidence=1000`);
}
const averageOnly = (date = from) => `${date}:\n  HRV Avg: 42 ms`;
function sevenDays(separator = "\n") {
  return response(Array.from({ length: 7 }, (_, index) => {
    const date = shiftDate(from, index);
    return `${date}:\n  HRV Avg: ${41 + index} ms — Normal\n  Normal Range: 30 - 60 ms${index < 4 ? "" : "\n  Baseline: 40 ms"}`;
  }).reverse(), separator);
}

describe("official historical HRV assessments", () => {
  it("retains average-only early days without inventing evaluation, range or baseline", () => {
    const mapped = mapCorosSleepHrv(response([averageOnly()]), options);
    expect(mapped.map(item => [item.candidate.metric_type, item.candidate.value])).toEqual([["sleep_hrv_avg", 42]]);
    expect(mapped[0]).toMatchObject({ measurementTimeKind: "observed_at", candidate: { local_date: from, unit: "ms", aggregation_period: "daily" } });
    expect(mapped[0].dayComplete).toBeUndefined();
    const rating = classifyHealthDay({ date: from, dayComplete: true, sleepScore: 95, hrvMs: mapped[0].candidate.value,
      hrvBaselineMs: null, hrvNormalRangeLowMs: null }, buildHealthBaseline([]), "2024-02-01");
    expect(rating.status).toBe("insufficient"); expect(rating.missing).toContain("HRV 基线（0/21）");
  });

  it.each(["\n", "\n\n"])("parses date blocks separated by %j and keeps optional fields on their own day", separator => {
    const mapped = mapCorosSleepHrv(sevenDays(separator), options);
    expect(mapped).toHaveLength(17);
    expect(mapped.filter(item => item.candidate.metric_type === "sleep_hrv_avg").map(item => item.candidate.value)).toEqual([47, 46, 45, 44, 43, 42, 41]);
    expect(mapped.filter(item => item.candidate.metric_type === "sleep_hrv_baseline").map(item => item.candidate.local_date)).toEqual(["2024-01-08", "2024-01-07", "2024-01-06"]);
    expect(mapped.some(item => item.candidate.value === 999)).toBe(false);
  });

  it("accepts optional range and baseline independently of the evaluation suffix", () => {
    const mapped = mapCorosSleepHrv(response([
      `${from}:\n  HRV Avg: 42 ms\n  Normal Range: 30 - 60 ms`,
      `2024-01-03:\n  HRV Avg: 43 ms\n  Baseline: 40 ms`,
      `2024-01-04:\n  HRV Avg: 44 ms\n  Normal Range: 30 - 60 ms\n  Baseline: 40 ms`,
    ]), options);
    expect(mapped.map(item => [item.candidate.local_date, item.candidate.metric_type])).toEqual([
      [from, "sleep_hrv_avg"], [from, "sleep_hrv_normal_range_low"],
      ["2024-01-03", "sleep_hrv_avg"], ["2024-01-03", "sleep_hrv_baseline"],
      ["2024-01-04", "sleep_hrv_avg"], ["2024-01-04", "sleep_hrv_normal_range_low"], ["2024-01-04", "sleep_hrv_baseline"],
    ]);
  });

  it.each([
    `${from}:\n  HRV Avg: 42 bpm`,
    `${from}:\n  HRV Avg: 42 ms\n  Normal Range: 60 - 30 ms`,
    `${from}:\n  HRV Avg: 42 ms\n  Baseline: 40 ms\n  Baseline: 41 ms`,
    `${from}:\n  HRV Avg: 42 ms\n  Unknown: 40 ms`,
    `${from}:\n  HRV Avg: 4.2.1 ms`,
    `${from}:\n  HRV Avg: -42 ms`,
    "2024-01-01:\n  HRV Avg: 42 ms",
    `${averageOnly()}\n${averageOnly()}`,
  ])("rejects ambiguous, invalid or out-of-scope assessment %j", block => {
    expect(() => mapCorosSleepHrv(response([block]), options)).toThrow("COROS_SYNC_HEALTH_FORMAT_UNSUPPORTED");
  });
});

/** Local private-store substitute: invokes the real writer and production D1 SQL. */
function pipeline() {
  const f = syncTestDatabase(); f.connection();
  const p = initialSyncProgress(from, "Asia/Shanghai");
  p.request = { sequence: 1, through: "2024-02-01", historyThrough: through };
  for (const d of Object.values(p.domains)) { d.recentRequestSequence = 1; d.backfillNext = "2024-01-09"; }
  p.health = { ...initialSyncProgress(from, p.timezone).domains.sleep, recentRequestSequence: 1 };
  for (const d of Object.values(initializeBulkHealthProgress(p))) { d.recentRequestSequence = 1; d.backfillNext = "2024-01-09"; }
  initializeActivityProgress(p).backfillNext = "2024-01-09";
  f.job(p);
  const files = new Map<string, string>(); let version = 1;
  const adapter = {
    readText: vi.fn(async () => ({ text: JSON.stringify({ schema_version: 1, workspace_id: "synthetic", owner_id: "test-owner", owner_login: "example-owner", locale: "zh-CN", timezone: "Asia/Shanghai" }) })),
    readBranchSnapshot: vi.fn(async () => ({ branch: "main", headCommitSha: String(version).padStart(40, "0"), rootTreeSha: "b".repeat(40) })),
    listTreeFiles: vi.fn(async () => [...files].map(([path, value]) => ({ type: "file" as const, name: path.split("/").at(-1)!, path, blobSha: "a".repeat(40), sizeBytes: value.length }))),
    readBlobTexts: vi.fn<Parameters<typeof writeCorosHealthMetrics>[0]["readBlobTexts"]>(async entries => entries.map(entry => ({ ...entry, text: files.get(entry.path)! }))),
    writeAtomicFiles: vi.fn<Parameters<typeof writeCorosHealthMetrics>[0]["writeAtomicFiles"]>(async input => {
      if (input.expectedHeadCommitSha !== String(version).padStart(40, "0")) throw new GitHubConflictError();
      await input.beforeRefUpdate?.(); input.files.forEach(entry => files.set(entry.path, entry.text)); version++;
      return { commitSha: String(version).padStart(40, "0"), treeSha: "b".repeat(40), files: input.files.map(entry => ({ path: entry.path, blobSha: "a".repeat(40) })) };
    }),
  };
  const read = vi.fn<CorosSyncDependencies["read"]>().mockImplementation(async (_url, _token, tool, args) => {
    if (tool === "querySleepHrv") return args.startDate === args.endDate ? response([averageOnly(iso(args.startDate))]) : sevenDays();
    if (tool === "querySportRecords") return text(`No sport records found from ${iso(args.startDate)} to ${iso(args.endDate)}.`);
    throw new Error("UNEXPECTED_READ");
  });
  const deps: CorosSyncDependencies = {
    refresh: vi.fn().mockResolvedValue({ resourceUrl: "https://mcpcn.coros.com/mcp", accessToken: "synthetic-token" }),
    read, adapter: vi.fn().mockResolvedValue(adapter as unknown as GitHubContentsAdapter),
    write: vi.fn(), health: collectCorosHealth, writeMetrics: writeCorosHealthMetrics,
  };
  const records = () => [...files.values()].map(parseHealthMetricRecord);
  return { f, files, adapter, read, deps, records };
}

describe("historical source shape through persistence and coverage", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SYNC_TEST_NOW); });
  afterEach(() => vi.useRealTimers());

  it("commits all seven checked days, leaves absent baselines absent, then reports the bounded scope complete", async () => {
    const h = pipeline();
    try {
      const result = await runCorosSync(h.f.env, new Date(), h.deps, { forceDue: true });
      expect(result).toMatchObject({ status: "processed", batch: { domain: "health", from, through, created: 17 } });
      expect(h.read.mock.calls.map(call => call[2])).toEqual(["querySleepHrv"]);
      expect(h.adapter.writeAtomicFiles).toHaveBeenCalledTimes(1);
      expect(h.f.saved()?.progress.health).toMatchObject({ backfillNext: "2024-01-09", backfillThrough: through, lastErrorCode: null });
      expect(h.records().filter(record => record.data.metric_type === "sleep_hrv_avg")).toHaveLength(7);
      expect(h.records().filter(record => record.data.metric_type === "sleep_hrv_baseline")).toHaveLength(3);
      expect(h.records().filter(record => record.data.metric_type === "sleep_hrv_avg").every(record => record.data.value > 0 && record.data.value < 100)).toBe(true);
      expect([...h.files.values()].join("\n")).not.toMatch(/time_series|timestamp=|confidence=|HRV Assessment/);
      expect((await runCorosSync(h.f.env, new Date(), h.deps, { forceDue: true })).status).toBe("complete");
      expect(h.adapter.writeAtomicFiles).toHaveBeenCalledTimes(1);
    } finally { h.f.sqlite.close(); }
  });

  it("requeries sparse multi-day data singly and advances only the confirmed first day", async () => {
    const h = pipeline();
    h.read.mockImplementation(async (_url, _token, tool, args) => tool === "querySleepHrv"
      ? response(args.startDate === args.endDate ? [averageOnly()] : [averageOnly(), averageOnly(through)])
      : text(`No sport records found from ${iso(args.startDate)} to ${iso(args.endDate)}.`));
    try {
      expect(await runCorosSync(h.f.env, new Date(), h.deps, { forceDue: true })).toMatchObject({ status: "processed", batch: { from, through: from, created: 1 } });
      expect(h.read.mock.calls.map(call => call[2])).toEqual(["querySleepHrv", "querySleepHrv"]);
      expect(h.f.saved()?.progress.health).toMatchObject({ backfillNext: "2024-01-03", backfillThrough: from });
      expect(h.records().map(record => record.data.metric_type).sort()).toEqual(["sleep_hrv_avg"]);
      expect(h.records().find(record => record.data.metric_type === "sleep_hrv_avg")?.data.value).toBe(42);
    } finally { h.f.sqlite.close(); }
  });

  it("keeps the cursor on a failed write and restores from saved progress after backoff", async () => {
    const h = pipeline(); h.adapter.writeAtomicFiles.mockRejectedValueOnce(new Error("GITHUB_WRITE_FAILED"));
    try {
      expect(await runCorosSync(h.f.env, new Date(), h.deps, { forceDue: true })).toMatchObject({ status: "error", errorCode: "GITHUB_WRITE_FAILED" });
      expect(h.files.size).toBe(0); expect(h.f.saved()?.progress.health?.backfillNext).toBe(from);
      expect((await runCorosSync(h.f.env, new Date(), h.deps, { forceDue: true })).status).toBe("deferred");
      vi.setSystemTime("2024-02-01T04:20:00.000Z");
      // Each call parses committed D1 state again; no process-local progress is carried forward.
      expect(await runCorosSync(h.f.env, new Date(), h.deps, { forceDue: true })).toMatchObject({ status: "processed", batch: { created: 17 } });
      expect(h.f.saved()?.progress.health).toMatchObject({ backfillNext: "2024-01-09", backfillThrough: through });
      expect(h.files.size).toBe(17);
    } finally { h.f.sqlite.close(); }
  });

  it("replays idempotently when persistence succeeds but the invocation ends before coverage is saved", async () => {
    const h = pipeline(); let interrupted = true;
    h.deps.writeMetrics = async (...args) => {
      const result = await writeCorosHealthMetrics(...args);
      if (interrupted) { interrupted = false; throw new Error("COROS_SYNC_CANCELLED"); }
      return result;
    };
    try {
      expect((await runCorosSync(h.f.env, new Date(), h.deps, { forceDue: true })).status).toBe("error");
      expect(h.files.size).toBe(17); expect(h.f.saved()?.progress.health?.backfillNext).toBe(from);
      vi.setSystemTime("2024-02-01T04:20:00.000Z");
      expect(await runCorosSync(h.f.env, new Date(), h.deps, { forceDue: true })).toMatchObject({ status: "processed", batch: { created: 0, updated: 0, unchanged: 17 } });
      expect(h.adapter.writeAtomicFiles).toHaveBeenCalledTimes(1);
      expect(h.files.size).toBe(17); expect(h.f.saved()?.progress.health?.backfillNext).toBe("2024-01-09");
    } finally { h.f.sqlite.close(); }
  });

  it("retains an unknown response layout failure without writing metrics or advancing coverage", async () => {
    const h = pipeline(); h.read.mockImplementation(async (_url, _token, _tool, args) => response([`${iso(args.startDate)}:\n  HRV Avg: 42 ms\n  Unexpected: 1 ms`]));
    try {
      expect(await runCorosSync(h.f.env, new Date(), h.deps, { forceDue: true })).toMatchObject({ status: "error", errorCode: "COROS_SYNC_HEALTH_FORMAT_UNSUPPORTED", progress: { lastErrorStage: "health_collect" } });
      expect(h.files.size).toBe(0); expect(h.adapter.writeAtomicFiles).not.toHaveBeenCalled();
      expect(h.f.saved()?.progress.health).toMatchObject({ backfillNext: from, backfillThrough: null });
      expect(h.f.saved()?.progress_json).not.toContain("HRV Avg");
    } finally { h.f.sqlite.close(); }
  });
});
