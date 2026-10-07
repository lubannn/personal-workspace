import { expect, it, vi } from "vitest";
import type { CorosSyncRunResult } from "../../../auth-worker/src/coros-sync";
import { createCorosRefreshUpdates } from "./coros-refresh-updates";

function batch(domain: "sleep" | "workout" | "health", created = 0, updated = 0): CorosSyncRunResult {
  return { status: "processed", batch: { domain, from: "2026-10-05", through: "2026-10-07", created, updated, unchanged: 1, conflicts: 0 } };
}
it("publishes new sleep/workout before metrics finish and combines metric reloads", () => {
  const publish = vi.fn(); const updates = createCorosRefreshUpdates(publish);
  updates.update(batch("sleep", 1)); updates.update(batch("workout", 0, 1));
  expect(publish.mock.calls.map(call => call[0])).toEqual([
    { recordsChanged: true, refreshStatus: false, lastSyncAt: undefined },
    { recordsChanged: true, refreshStatus: false, lastSyncAt: undefined },
  ]);
  updates.update(batch("health", 1)); updates.update(batch("health", 0, 3)); updates.update(batch("health"));
  expect(publish).toHaveBeenCalledTimes(2);
  updates.finish(); expect(publish).toHaveBeenLastCalledWith({ recordsChanged: true, refreshStatus: true, lastSyncAt: undefined });
});
it("skips repository reloads when nothing changed but still refreshes the final status", () => {
  const publish = vi.fn(); const updates = createCorosRefreshUpdates(publish);
  updates.update(batch("sleep")); updates.update(batch("workout")); updates.update(batch("health"));
  updates.finish(); expect(publish).toHaveBeenCalledExactlyOnceWith({ recordsChanged: false, refreshStatus: true, lastSyncAt: undefined });
});
it("refreshes committed metrics even if a later batch fails or is busy", () => {
  const publish = vi.fn(); const updates = createCorosRefreshUpdates(publish);
  updates.update(batch("health", 1)); updates.update({ status: "error" }); updates.update({ status: "busy" });
  updates.finish(); expect(publish).toHaveBeenCalledExactlyOnceWith({ recordsChanged: true, refreshStatus: true, lastSyncAt: undefined });
});
