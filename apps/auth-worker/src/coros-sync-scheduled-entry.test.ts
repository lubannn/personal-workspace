import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import { runScheduledCorosSync } from "./coros-sync-scheduled";

vi.mock("./coros-sync-scheduled", () => ({ runScheduledCorosSync: vi.fn() }));
afterEach(() => vi.resetAllMocks());
describe("scheduled invocation ownership", () => {
  it("awaits the entire bounded runner rather than detaching work behind an HTTP response", async () => {
    let release!: () => void;
    vi.mocked(runScheduledCorosSync).mockImplementation(() => new Promise(resolve => { release = () => resolve({ batches: 1, errors: 0, result: { status: "complete" } }); }));
    let settled = false;
    const invocation = worker.scheduled({}, {}).then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    expect(runScheduledCorosSync).toHaveBeenCalledExactlyOnceWith({});
    release(); await invocation; expect(settled).toBe(true);
  });
  it("propagates an unexpected interruption to the scheduled event", async () => {
    vi.mocked(runScheduledCorosSync).mockRejectedValue(new Error("synthetic interrupted checkpoint"));
    await expect(worker.scheduled({}, {})).rejects.toThrow("interrupted checkpoint");
  });
});
