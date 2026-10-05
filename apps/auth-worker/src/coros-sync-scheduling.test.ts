import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextFairSyncWindow, nextSyncTick, recordSyncTurn } from "./coros-sync-scheduling";
import { initializeBulkHealthProgress } from "./coros-health-history";
import { acceptSyncRequest, COROS_SYNC_SOURCES, initialSyncProgress, parseSyncProgress, shiftDate } from "./coros-sync-state";
import { runCorosSync, type CorosSyncDependencies } from "./coros-sync";
import { SYNC_TEST_NOW, syncTestDatabase } from "./coros-sync-test-helpers";

const now = new Date("2026-10-05T10:00:00Z");
function requested() {
  const p = initialSyncProgress("2025-05-01", "Asia/Shanghai");
  acceptSyncRequest(p, { request_seq: 1, requested_through: "2026-10-05" }, now);
  p.health ??= { ...initialSyncProgress(p.startDate, p.timezone).domains.sleep };
  initializeBulkHealthProgress(p);
  return p;
}

describe("bounded COROS source and history scheduling", () => {
  it("includes pending health sources in the first record checkpoint", () => {
    const p = initialSyncProgress("2025-05-01", "Asia/Shanghai");
    acceptSyncRequest(p, { request_seq: 1, requested_through: "2026-10-05" }, now);
    expect(nextFairSyncWindow(p, now, true, true)?.domain).toBe("sleep");
    expect(p.health?.backfillNext).toBe(p.startDate);
    expect(p.health?.bulk?.dailyHealth.backfillNext).toBe(p.startDate);
    expect(p.health?.bulk?.restingHeartRate.recentRequestSequence).toBeUndefined();
  });

  it("gives all five historical sources a turn even when recent work stays unfinished and requests repeat", () => {
    const p = requested();
    const histories: string[] = [], recents: string[] = [];
    for (let turn = 0; turn < 20; turn++) {
      acceptSyncRequest(p, { request_seq: turn + 2, requested_through: "2026-10-05" }, now);
      const window = nextFairSyncWindow(p, now, true)!;
      const source = window.domain === "health" ? window.source ?? "hrvActivity" : window.domain;
      (window.recent ? recents : histories).push(source);
      const maximum = window.domain === "sleep" ? 3 : window.domain === "workout" ? (window.recent ? 7 : 30) : window.domain === "health" && window.source && !window.recent ? 28 : 7;
      expect(window.from >= p.startDate).toBe(true);
      expect(window.through <= (window.recent ? "2026-10-05" : "2026-10-04")).toBe(true);
      expect((Date.parse(window.through) - Date.parse(window.from)) / 86_400_000 + 1).toBeLessThanOrEqual(maximum);
      recordSyncTurn(p, window);
      // Models a pending response: selection alone never moves any coverage.
    }
    expect(histories).toEqual([...COROS_SYNC_SOURCES, ...COROS_SYNC_SOURCES]);
    expect(recents).toEqual([...COROS_SYNC_SOURCES, ...COROS_SYNC_SOURCES]);
    for (const d of [...Object.values(p.domains), p.health!, ...Object.values(p.health!.bulk!)]) {
      expect(d.backfillNext).toBe(p.startDate); expect(d.backfillThrough).toBeNull();
    }
    expect(parseSyncProgress(JSON.stringify(p))).toEqual(p);
  });

  it("skips sources on backoff or a capacity block in both scheduling kinds", () => {
    const p = requested();
    p.domains.sleep.retryAfter = "2026-10-05T10:20:00Z";
    p.health!.bulk!.dailyHealth.blockedCode = "COROS_READ_RESULT_TOO_LARGE";
    p.health!.bulk!.restingHeartRate.retryAfter = "2026-10-05T10:20:00Z";
    const chosen = [];
    for (let turn = 0; turn < 8; turn++) {
      const window = nextFairSyncWindow(p, now, true)!;
      chosen.push(window.domain === "health" ? window.source ?? "hrvActivity" : window.domain);
      recordSyncTurn(p, window);
    }
    expect(chosen).toEqual(["workout", "workout", "hrvActivity", "hrvActivity", "workout", "workout", "hrvActivity", "hrvActivity"]);
  });

  it("uses all turns for remaining history when recent observations are complete", () => {
    const p = requested();
    for (const d of [...Object.values(p.domains), p.health!, ...Object.values(p.health!.bulk!)]) d.recentRequestSequence = 1;
    for (const source of COROS_SYNC_SOURCES) {
      const window = nextFairSyncWindow(p, now, true)!;
      expect(window.recent).toBe(false);
      expect(window.domain === "health" ? window.source ?? "hrvActivity" : window.domain).toBe(source);
      recordSyncTurn(p, window);
    }
    expect(nextFairSyncWindow(p, now, true, true)).toBeNull();
  });

  it("preserves partial recent cursors and rate-limit backoff across same-day extra updates", () => {
    const p = requested(), domains = [...Object.values(p.domains), p.health!, ...Object.values(p.health!.bulk!)];
    for (const d of domains) {
      d.recentNext = "2026-10-03"; d.retryAfter = "2026-10-05T10:20:00Z";
      d.backfillNext = "2025-06-26"; d.backfillThrough = "2025-06-25";
    }
    for (let sequence = 2; sequence <= 10; sequence++) {
      acceptSyncRequest(p, { request_seq: sequence, requested_through: "2026-10-05" }, now);
      for (const d of domains) expect(d).toMatchObject({ recentNext: "2026-10-03", retryAfter: "2026-10-05T10:20:00Z", backfillNext: "2025-06-26", backfillThrough: "2025-06-25" });
      expect(nextFairSyncWindow(p, now, true)).toBeNull();
    }
    expect(p.request?.sequence).toBe(10);
  });

  it("refreshes a completed recent source while retaining another source's partial checkpoint", () => {
    const p = requested(); p.domains.sleep.recentRequestSequence = 1;
    p.domains.sleep.recentNext = "2026-10-05"; p.health!.recentNext = "2026-10-03";
    acceptSyncRequest(p, { request_seq: 2, requested_through: "2026-10-05" }, now);
    expect(p.domains.sleep.recentNext).toBeNull(); expect(p.health!.recentNext).toBe("2026-10-03");
  });

  it("aligns the next tick independently of subsecond invocation jitter", () => {
    expect(nextSyncTick(new Date("2024-02-01T04:00:00.500Z"))).toBe("2024-02-01T04:10:00.000Z");
    expect(nextSyncTick(new Date("2024-02-01T04:10:00.000Z"))).toBe("2024-02-01T04:20:00.000Z");
  });
});

describe("cron jitter and recent-only drains through production claim SQL", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SYNC_TEST_NOW); });
  afterEach(() => vi.useRealTimers());
  function dependencies(): CorosSyncDependencies {
    return {
      refresh: vi.fn().mockResolvedValue({ resourceUrl: "https://mcpcn.coros.com/mcp", accessToken: "synthetic-token" }),
      read: vi.fn(async (_url, _token, _tool, args) => {
        const from = String(args.startDate).replace(/^(\d{4})(\d{2})(\d{2})$/u, "$1-$2-$3");
        const through = String(args.endDate).replace(/^(\d{4})(\d{2})(\d{2})$/u, "$1-$2-$3");
        const days = [];
        for (let d = from; d <= through; d = shiftDate(d, 1)) days.push(`${d}\nSleep detail for this day is not available yet.`);
        return { format: "content" as const, payload: [{ type: "text", text: `Sleep Overview\n========================\nNote: each record below is dated by its wake-up day.\n\n${days.join("\n\n")}` }] };
      }),
      adapter: vi.fn(), write: vi.fn(),
    };
  }

  it("processes the following cron tick when it arrives 400ms earlier than the previous invocation offset", async () => {
    const f = syncTestDatabase(); f.connection(); f.job(); const deps = dependencies();
    try {
      vi.setSystemTime("2024-02-01T04:00:00.500Z");
      expect((await runCorosSync(f.env, new Date(), deps)).status).toBe("processed");
      expect(f.saved()?.next_run_at).toBe("2024-02-01T04:10:00.000Z");
      vi.setSystemTime("2024-02-01T04:10:00.100Z");
      expect((await runCorosSync(f.env, new Date(), deps)).status).toBe("processed");
      expect(deps.read).toHaveBeenCalledTimes(2);
      expect(f.saved()?.progress.domains.sleep.backfillThrough).toBe("2024-01-03");
    } finally { f.sqlite.close(); }
  });

  it("keeps historical backlog due at the next tick when a recent-only drain finishes", async () => {
    const f = syncTestDatabase(); f.connection(); f.job(); const p = f.saved()!.progress;
    for (const d of Object.values(p.domains)) d.recentRequestSequence = 1;
    f.saveProgress(p); const deps = dependencies();
    try {
      expect((await runCorosSync(f.env, new Date(), deps, { forceDue: true, recentOnly: true })).status).toBe("complete");
      expect(deps.read).not.toHaveBeenCalled();
      expect(f.saved()?.next_run_at).toBe("2024-02-01T04:10:00.000Z");
      expect(f.saved()?.progress.domains.sleep.backfillNext).toBe("2024-01-01");
    } finally { f.sqlite.close(); }
  });
});
