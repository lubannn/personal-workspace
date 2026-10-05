import { describe, expect, it, vi } from "vitest";
import { initialSyncProgress } from "../../../auth-worker/src/coros-sync-state";
import { corosHistorySources, corosSyncErrorMessage, saveCorosHistorySettings } from "./coros-history-settings";

const progress = () => initialSyncProgress("2024-02-01", "Asia/Shanghai");
const options = () => ({ state: "paused" as const, running: false, historyScopeSupported: true,
  progress: progress(), startDate: "2024-01-01", csrf: "synthetic-csrf" });

describe("explicit COROS history settings", () => {
  it.each([
    [{ historyScopeSupported: false }, "COROS_SYNC_HISTORY_UNSUPPORTED"],
    [{ state: "enabled" as const }, "COROS_SYNC_PAUSE_REQUIRED"],
    [{ running: true }, "COROS_SYNC_HISTORY_BUSY"],
    [{ csrf: "" }, "COROS_AUTH_REQUIRED"],
    [{ startDate: "2024-02-30" }, "COROS_SYNC_INVALID_DATE"],
    [{ startDate: "2024-02-02" }, "COROS_SYNC_INVALID_DATE"],
  ])("rejects unavailable or unsafe controls before fetching: %j", async (patch, error) => {
    const fetcher = vi.fn();
    await expect(saveCorosHistorySettings({ ...options(), ...patch, fetcher })).rejects.toThrow(error);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("saves scope only, using same-origin auth without enabling, queuing or draining", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ state: "paused", historyStartDate: "2024-01-01", queued: false }));
    expect(await saveCorosHistorySettings({ ...options(), fetcher })).toEqual({ state: "paused", historyStartDate: "2024-01-01", queued: false });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/coros/history", expect.objectContaining({ method: "POST", credentials: "same-origin",
      headers: expect.objectContaining({ "x-pw-csrf": "synthetic-csrf" }), body: JSON.stringify({ startDate: "2024-01-01" }) }));
  });

  it("names only the source deliberately reset, without resetting unrelated sources", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ state: "paused", historyStartDate: "2024-01-01", queued: false }));
    await saveCorosHistorySettings({ ...options(), retryBlockedSource: "dailyHealth", fetcher });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ startDate: "2024-01-01", retryBlockedSources: ["dailyHealth"] });
  });

  it("handles an old backend even if capability discovery races deployment", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "COROS_ROUTE_NOT_FOUND" }, { status: 404 }));
    await expect(saveCorosHistorySettings({ ...options(), fetcher })).rejects.toThrow("COROS_SYNC_HISTORY_UNSUPPORTED");
    expect(corosSyncErrorMessage("COROS_SYNC_HISTORY_UNSUPPORTED")).toContain("当前范围与暂停状态保持不变");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never accepts an enable/queue response as a successful scope save", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ state: "enabled", historyStartDate: "2024-01-01", queued: true }));
    await expect(saveCorosHistorySettings({ ...options(), fetcher })).rejects.toThrow("COROS_SYNC_RESPONSE_INVALID");
  });

  it("retains separate visible source failures and missing coverage", () => {
    const p = progress();
    p.domains.sleep.lastErrorCode = "COROS_SYNC_FORMAT_UNSUPPORTED"; p.domains.sleep.retryAfter = "2024-03-01T00:00:00Z";
    p.health = { ...p.domains.workout, bulk: {
      dailyHealth: { ...p.domains.workout, blockedCode: "COROS_READ_RESULT_TOO_LARGE", observedDates: ["2024-02-01"], unconfirmedZeroDates: ["2024-02-02"] },
      restingHeartRate: { ...p.domains.workout, lastErrorCode: "COROS_READ_TIMEOUT", retryAfter: "2024-03-01T01:00:00Z" },
    } };
    const sources = corosHistorySources(p);
    expect(sources.map(source => source.label)).toEqual(["睡眠", "运动", "HRV与活动指标", "日健康", "静息心率"]);
    expect(sources[0].progress?.retryAfter).toBe("2024-03-01T00:00:00Z");
    expect(sources[3]).toMatchObject({ resetSource: "dailyHealth", progress: { blockedCode: "COROS_READ_RESULT_TOO_LARGE" } });
    expect(corosSyncErrorMessage(sources[3].progress?.blockedCode)).toContain("已停止自动重试");
    expect(sources[4].progress?.backfillThrough).toBeNull();
  });
});
