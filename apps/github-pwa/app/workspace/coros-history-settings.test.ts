import { describe, expect, it, vi } from "vitest";
import { initialSyncProgress } from "../../../auth-worker/src/coros-sync-state";
import { corosCheckedRangeText, corosHistorySources, corosSyncErrorMessage, saveCorosHistorySettings } from "./coros-history-settings";

const progress = () => initialSyncProgress("2024-02-01", "Asia/Shanghai");
const options = () => ({ state: "paused" as const, running: false, historyScopeSupported: true,
  progress: progress(), startDate: "2024-01-01", csrf: "synthetic-csrf" });

describe("COROS checked range display", () => {
  it("shows empty/uninitialized sources without claiming the configured range or latest value was checked", () => {
    expect(corosCheckedRangeText()).toBe("已检查区间：尚无已确认区间");
    const p = progress(); p.domains.sleep.latestRecordDate = "2024-02-20";
    expect(corosCheckedRangeText(p.domains.sleep)).toBe("已检查区间：尚无已确认区间");
  });

  it("retains separate historical and recent legacy endpoints, never guessing from configuration or records", () => {
    const p = progress();
    Object.assign(p.domains.sleep, { backfillThrough: "2024-02-05", recentThrough: "2024-03-20", latestRecordDate: "2024-03-19" });
    expect(corosCheckedRangeText(p.domains.sleep)).toBe("历史检查截止 2024-02-05（起点未记录，范围待核验）；近期检查截止 2024-03-20（起点未记录，范围待核验）");
  });

  it("shows each source's actual intervals independently, including a single partially checked recent day", () => {
    const p = progress(), domain = p.domains.sleep;
    domain.checkedRanges = [{ from: "2024-02-01", through: "2024-02-05" }, { from: "2024-03-20", through: "2024-03-20" }];
    domain.backfillThrough = "2024-02-05"; domain.recentThrough = "2024-03-20";
    p.domains.workout.checkedRanges = [{ from: "2024-02-04", through: "2024-02-06" }];
    const sources = corosHistorySources(p);
    expect(corosCheckedRangeText(sources[0].progress)).toBe("已检查区间：2024-02-01 至 2024-02-05；2024-03-20 至 2024-03-20");
    expect(corosCheckedRangeText(sources[1].progress)).toBe("已检查区间：2024-02-04 至 2024-02-06");
    expect(corosCheckedRangeText(sources[2].progress)).toBe("已检查区间：尚无已确认区间");
  });

  it("keeps unknown legacy coverage visible beside newly proven checks", () => {
    const p = progress();
    p.domains.sleep.backfillThrough = "2024-02-05";
    p.domains.sleep.checkedRanges = [{ from: "2024-03-18", through: "2024-03-20" }];
    expect(corosCheckedRangeText(p.domains.sleep)).toBe("已检查区间：2024-03-18 至 2024-03-20；历史检查截止 2024-02-05（起点未记录，范围待核验）");
  });
});

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


describe("safe OAuth messages", () => {
  it.each([
    ["COROS_OAUTH_RESOURCE_METADATA_HTTP_307", "COROS 资源发现", "HTTP 307", "重定向"],
    ["COROS_OAUTH_RESOURCE_METADATA_HTTP_307_BODY_MISSING", "COROS 资源发现", "HTTP 307", "重定向"],
    ["COROS_OAUTH_AUTH_METADATA_HTTP_403", "COROS 授权服务发现", "HTTP 403", "授权服务响应"],
    ["COROS_OAUTH_REFRESH_HTTP_400_INVALID_GRANT", "COROS 授权刷新", "HTTP 400", "invalid_grant"],
    ["COROS_OAUTH_REFRESH_HTTP_401_INVALID_CLIENT", "COROS 授权刷新", "HTTP 401", "服务端注册配置"],
    ["COROS_OAUTH_REFRESH_HTTP_200_BODY_MISSING", "COROS 授权刷新", "HTTP 200", "缺少正文"],
    ["COROS_OAUTH_REFRESH_HTTP_429", "COROS 授权刷新", "HTTP 429", "限流"],
    ["COROS_OAUTH_REFRESH_TIMEOUT", "COROS 授权刷新", "超时", "进度保留"],
    ["COROS_OAUTH_REFRESH_TRANSPORT_FAILED", "COROS 授权刷新", "网络请求失败", "进度保留"],
  ])("shows actionable bounded facts for %s", (code, ...facts) => {
    const message = corosSyncErrorMessage(code)!;
    for (const fact of facts) expect(message).toContain(fact);
    expect(message).not.toContain("重新连接");
  });
  it.each(["COROS_OAUTH_REFRESH_HTTP_400_INVALID_GRANT_PRIVATE_CANARY", "COROS_OAUTH_REFRESH_HTTP_999",
    "COROS_OAUTH_REFRESH_HTTP_400?token=synthetic-private-canary"])("never reflects unsafe input %s", code => {
    const message = corosSyncErrorMessage(code)!;
    expect(message).not.toContain(code); expect(message).not.toContain("CANARY"); expect(message).not.toContain("synthetic-private");
  });
});
