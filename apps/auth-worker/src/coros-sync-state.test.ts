import { describe, expect, it } from "vitest";
import { initialSyncProgress, nextSyncWindow, shiftDate, todayInTimezone } from "./coros-sync-state";

const now = new Date("2024-02-01T16:30:00.000Z");

describe("COROS sync window selection", () => {
  it("uses the account's local day across the UTC date boundary", () => {
    expect(todayInTimezone(now, "Asia/Shanghai")).toBe("2024-02-02");
    const progress = initialSyncProgress("2024-01-01", "Asia/Shanghai");
    expect(nextSyncWindow(progress, now)).toEqual({ domain: "sleep", recent: true, from: "2024-01-31", through: "2024-02-02" });
    progress.domains.sleep.lastRecentAt = now.toISOString();
    expect(nextSyncWindow(progress, now)).toEqual({ domain: "workout", recent: true, from: "2024-01-27", through: "2024-02-02" });
  });
  it("keeps domain cursors independent and chooses the oldest unfinished history", () => {
    const progress = initialSyncProgress("2024-01-01", "Asia/Shanghai");
    progress.domains.sleep.lastRecentAt = now.toISOString(); progress.domains.workout.lastRecentAt = now.toISOString();
    progress.domains.sleep.backfillNext = "2024-01-10";
    expect(progress.domains.workout.backfillNext).toBe("2024-01-01");
    expect(nextSyncWindow(progress, now)).toEqual({ domain: "workout", recent: false, from: "2024-01-01", through: "2024-01-03" });
  });
  it("allows the healthy domain to continue while another domain waits to retry", () => {
    const progress = initialSyncProgress("2024-01-01", "Asia/Shanghai");
    progress.domains.sleep.retryAfter = "2024-02-01T17:00:00.000Z";
    expect(nextSyncWindow(progress, now)?.domain).toBe("workout");
    expect(nextSyncWindow(progress, new Date("2024-02-01T17:00:00.000Z"))?.domain).toBe("sleep");
  });
  it("resumes a partially checked recent window without claiming the full range complete", () => {
    const progress = initialSyncProgress("2024-01-01", "Asia/Shanghai");
    progress.domains.sleep.lastRecentAt = now.toISOString(); progress.domains.workout.recentNext = "2024-01-30";
    expect(nextSyncWindow(progress, now)).toEqual({ domain: "workout", recent: true, from: "2024-01-30", through: "2024-02-02" });
  });
  it("stops historical coverage at today and correctly rolls over leap days", () => {
    expect(shiftDate("2024-02-28", 1)).toBe("2024-02-29");
    expect(shiftDate("2024-02-29", 1)).toBe("2024-03-01");
    const progress = initialSyncProgress("2024-02-02", "Asia/Shanghai");
    for (const key of ["sleep", "workout"] as const) progress.domains[key].lastRecentAt = now.toISOString();
    expect(nextSyncWindow(progress, now)).toEqual({ domain: "sleep", recent: false, from: "2024-02-02", through: "2024-02-02" });
  });
});
