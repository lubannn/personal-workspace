import { describe, expect, it } from "vitest";
import { clearRejectedCredentialBackoff } from "./coros-credential-backoff";
import { initialSyncProgress } from "./coros-sync-state";
import { nextHealthSyncWindow } from "./coros-health-sync";
import { initializeBulkHealthProgress } from "./coros-health-history";

const code = "COROS_OAUTH_REFRESH_HTTP_400_INVALID_GRANT";
function fixture() {
  const p = initialSyncProgress("2024-01-01", "Asia/Shanghai");
  p.request = { sequence: 1, through: "2024-02-01" }; p.backfillEnd = "2024-02-01";
  nextHealthSyncWindow(p, new Date("2024-02-01T04:00:00Z")); initializeBulkHealthProgress(p);
  for (const d of [p.domains.sleep, p.domains.workout, p.health!, p.health!.activity!, ...Object.values(p.health!.bulk!)]) {
    d.backfillNext = "2024-01-08"; d.backfillThrough = "2024-01-07"; d.recentNext = "2024-01-29";
    d.checkedRanges = [{ from: "2024-01-01", through: "2024-01-07" }, { from: "2024-01-22", through: "2024-01-28" }];
    d.retryAfter = "2099-01-01T00:00:00.000Z"; d.lastErrorCode = code; d.lastErrorStage = "credentials_refresh";
  }
  p.health!.encryptedActivityCache = "opaque-synthetic-cache";
  p.lastErrorCode = code; p.lastErrorStage = "credentials_refresh"; p.failureCount = 9;
  return p;
}
describe("superseded rejected credential backoff", () => {
  it("clears all six sources and the matching shared failure without changing data checkpoints", () => {
    const p = fixture(); const expected = structuredClone(p);
    for (const d of [expected.domains.sleep, expected.domains.workout, expected.health!, expected.health!.activity!, ...Object.values(expected.health!.bulk!)]) {
      d.retryAfter = null; d.lastErrorCode = null; d.lastErrorStage = null;
    }
    expected.lastErrorCode = null; expected.lastErrorStage = null; expected.failureCount = 0;
    expect(clearRejectedCredentialBackoff(p)).toBe(true); expect(p).toEqual(expected);
    expect(clearRejectedCredentialBackoff(p)).toBe(false);
  });
  it.each([
    ["COROS_OAUTH_REFRESH_HTTP_429", "credentials_refresh"],
    ["COROS_OAUTH_REFRESH_HTTP_429_INVALID_GRANT", "credentials_refresh"],
    [code, "health_collect"], [code, null],
    ["COROS_OAUTH_EXCHANGE_HTTP_400_INVALID_GRANT", "credentials_refresh"],
    ["COROS_OAUTH_REFRESH_HTTP_400_INVALID_CLIENT", "credentials_refresh"],
    ["COROS_READ_RESULT_TOO_LARGE", "queryDailyHealthData"],
    ["COROS_SYNC_HEALTH_DETAIL_FORMAT_UNSUPPORTED", "health_collect"],
  ] as const)("preserves %s at %s and its shared failure count", (otherCode, stage) => {
    const p = fixture();
    const d = p.health!.bulk!.dailyHealth; d.lastErrorCode = otherCode; d.lastErrorStage = stage;
    const before = structuredClone(d);
    clearRejectedCredentialBackoff(p);
    expect(d).toEqual(before); expect(p.failureCount).toBe(9);
    expect(p.health!.bulk!.restingHeartRate.retryAfter).toBeNull();
  });
  it("never unblocks a capacity/range source, even if a stale credential error coexists", () => {
    const p = fixture(); const d = p.health!.bulk!.dailyHealth;
    d.blockedCode = "COROS_READ_RESULT_TOO_LARGE";
    const before = structuredClone(d); clearRejectedCredentialBackoff(p);
    expect(d).toEqual(before); expect(p.failureCount).toBe(9);
  });
});
