import { describe, expect, it } from "vitest";
import { acceptSyncRequest, initialSyncProgress, nextSyncWindow, shiftDate, todayInTimezone, type SyncProgress } from "./coros-sync-state";

const now = new Date("2024-02-01T16:30:00.000Z");
const domains = ["sleep", "workout"] as const;
function requested(start = "2024-01-01", through = "2024-02-02", sequence = 1) {
  const progress = initialSyncProgress(start, "Asia/Shanghai");
  acceptSyncRequest(progress, { request_seq: sequence, requested_through: through });
  return progress;
}
function recentComplete(progress: SyncProgress) {
  for (const domain of domains) progress.domains[domain].recentRequestSequence = progress.request!.sequence;
}

describe("COROS explicitly requested sync windows", () => {
  it("uses the account's local day to create a request and prioritizes recent sleep then workouts", () => {
    expect(todayInTimezone(now, "Asia/Shanghai")).toBe("2024-02-02");
    const progress = requested("2024-01-01", todayInTimezone(now, "Asia/Shanghai"));
    expect(nextSyncWindow(progress, now)).toEqual({ domain: "sleep", recent: true, from: "2024-01-31", through: "2024-02-02" });
    progress.domains.sleep.recentRequestSequence = 1;
    expect(nextSyncWindow(progress, now)).toEqual({ domain: "workout", recent: true, from: "2024-01-27", through: "2024-02-02" });
  });

  it("does no work without an accepted request, regardless of wall-clock time", () => {
    const progress = initialSyncProgress("2024-01-01", "Asia/Shanghai");
    expect(nextSyncWindow(progress, now)).toBeNull();
    expect(nextSyncWindow(progress, new Date("2026-10-03T12:00:00.000Z"))).toBeNull();
    acceptSyncRequest(progress, { request_seq: 0, requested_through: null });
    expect(nextSyncWindow(progress, now)).toBeNull();
  });

  it("does not repeat completed work after two hours, midnight, or a month without a new request", () => {
    const progress = requested(); recentComplete(progress);
    for (const domain of domains) {
      progress.domains[domain].lastRecentAt = now.toISOString();
      progress.domains[domain].backfillNext = "2024-02-03";
      progress.domains[domain].backfillThrough = "2024-02-02";
    }
    for (const time of ["2024-02-01T18:30:00.000Z", "2024-02-02T18:30:00.000Z", "2024-03-02T18:30:00.000Z"]) {
      expect(nextSyncWindow(progress, new Date(time))).toBeNull();
    }
  });

  it("keeps the requested end date fixed when processing crosses local midnight", () => {
    const progress = requested("2024-01-01", "2024-02-01");
    expect(nextSyncWindow(progress, now)).toEqual({ domain: "sleep", recent: true, from: "2024-01-30", through: "2024-02-01" });
    progress.domains.sleep.recentRequestSequence = 1;
    expect(nextSyncWindow(progress, new Date("2024-02-03T00:00:00Z"))).toEqual({ domain: "workout", recent: true, from: "2024-01-26", through: "2024-02-01" });
    recentComplete(progress);
    for (const domain of domains) progress.domains[domain].backfillNext = "2024-02-01";
    expect(nextSyncWindow(progress, new Date("2024-02-03T00:00:00Z"))).toEqual({ domain: "sleep", recent: false, from: "2024-02-01", through: "2024-02-01" });
  });

  it("keeps domain cursors independent and chooses the oldest unfinished historical interval", () => {
    const progress = requested(); recentComplete(progress);
    progress.domains.sleep.backfillNext = "2024-01-10";
    expect(progress.domains.workout.backfillNext).toBe("2024-01-01");
    expect(nextSyncWindow(progress, now)).toEqual({ domain: "workout", recent: false, from: "2024-01-01", through: "2024-01-03" });
  });

  it("allows the healthy domain to continue while another requested domain waits to retry", () => {
    const progress = requested(); progress.domains.sleep.retryAfter = "2024-02-01T17:00:00.000Z";
    expect(nextSyncWindow(progress, now)?.domain).toBe("workout");
    expect(nextSyncWindow(progress, new Date("2024-02-01T17:00:00.000Z"))?.domain).toBe("sleep");
  });

  it("resumes a partially checked recent window until that request has been completed", () => {
    const progress = requested(); progress.domains.sleep.recentRequestSequence = 1; progress.domains.workout.recentNext = "2024-01-30";
    expect(nextSyncWindow(progress, now)).toEqual({ domain: "workout", recent: true, from: "2024-01-30", through: "2024-02-02" });
  });

  it("after a month away checks recent records first and then fills every missing date from the saved cursor", () => {
    const progress = requested("2023-05-01", "2024-01-01"); recentComplete(progress);
    for (const domain of domains) { progress.domains[domain].backfillThrough = "2024-01-01"; progress.domains[domain].backfillNext = "2024-01-02"; }
    acceptSyncRequest(progress, { request_seq: 2, requested_through: "2024-02-02" });
    expect(nextSyncWindow(progress, now)).toEqual({ domain: "sleep", recent: true, from: "2024-01-31", through: "2024-02-02" });
    progress.domains.sleep.recentRequestSequence = 2;
    expect(nextSyncWindow(progress, now)).toEqual({ domain: "workout", recent: true, from: "2024-01-27", through: "2024-02-02" });
    progress.domains.workout.recentRequestSequence = 2;
    const dates = { sleep: [] as string[], workout: [] as string[] };
    for (let iteration = 0; iteration < 30; iteration++) {
      const window = nextSyncWindow(progress, now); if (!window) break;
      expect(window.recent).toBe(false);
      for (let date = window.from; date <= window.through; date = shiftDate(date, 1)) dates[window.domain].push(date);
      progress.domains[window.domain].backfillNext = shiftDate(window.through, 1);
      progress.domains[window.domain].backfillThrough = window.through;
    }
    for (const domain of domains) {
      expect(dates[domain]).toHaveLength(32);
      expect(dates[domain][0]).toBe("2024-01-02"); expect(dates[domain].at(-1)).toBe("2024-02-02");
      expect(new Set(dates[domain]).size).toBe(32);
    }
    expect(nextSyncWindow(progress, now)).toBeNull(); expect(progress.backfillEnd).toBe("2024-01-01");
  });

  it("resets recent partial progress only for a newer request, without moving historical cursors backwards", () => {
    const progress = requested(); recentComplete(progress);
    for (const domain of domains) {
      progress.domains[domain].recentNext = "2024-02-01"; progress.domains[domain].retryAfter = "2024-02-03T00:00:00Z";
      progress.domains[domain].backfillNext = "2024-01-20"; progress.domains[domain].backfillThrough = "2024-01-19";
      progress.domains[domain].created = 10;
    }
    const saved = structuredClone(progress);
    acceptSyncRequest(progress, { request_seq: 1, requested_through: "2024-02-03" }); expect(progress).toEqual(saved);
    acceptSyncRequest(progress, { request_seq: 0, requested_through: "2024-01-01" }); expect(progress).toEqual(saved);
    acceptSyncRequest(progress, { request_seq: 2, requested_through: "2024-02-03" });
    for (const domain of domains) expect(progress.domains[domain]).toMatchObject({ recentNext: null, retryAfter: null,
      backfillNext: "2024-01-20", backfillThrough: "2024-01-19", created: 10, recentRequestSequence: 1 });
    expect(progress.request).toEqual({ sequence: 2, through: "2024-02-03" }); expect(progress.backfillEnd).toBe("2024-02-02");
    expect(nextSyncWindow(progress, now)?.recent).toBe(true);
  });

  it("clamps recent queries to the selected start date and correctly rolls over leap days", () => {
    expect(shiftDate("2024-02-28", 1)).toBe("2024-02-29"); expect(shiftDate("2024-02-29", 1)).toBe("2024-03-01");
    const progress = requested("2024-02-02", "2024-02-02");
    expect(nextSyncWindow(progress, now)).toEqual({ domain: "sleep", recent: true, from: "2024-02-02", through: "2024-02-02" });
    recentComplete(progress);
    expect(nextSyncWindow(progress, now)).toEqual({ domain: "sleep", recent: false, from: "2024-02-02", through: "2024-02-02" });
  });
});
