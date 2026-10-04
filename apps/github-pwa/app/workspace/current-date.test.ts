import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchWorkspaceDate } from "./current-date";

describe("workspace date refresh", () => {
  let browser: EventTarget;
  let documentTarget: EventTarget & { visibilityState: string };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T15:59:55.000Z"));
    browser = Object.assign(new EventTarget(), { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
    documentTarget = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("window", browser);
    vi.stubGlobal("document", documentTarget);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("refreshes at midnight instead of a full minute after mounting and cleans up", () => {
    const dates: string[] = [];
    const stop = watchWorkspaceDate("Asia/Shanghai", (date) => dates.push(date));
    expect(dates).toEqual(["2026-10-04"]);
    vi.advanceTimersByTime(5010);
    expect(dates).toEqual(["2026-10-04", "2026-10-05"]);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    browser.dispatchEvent(new Event("focus"));
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(dates).toHaveLength(2);
  });
  it("refreshes on focus and returning from a background tab without losing the draft", () => {
    const publish = vi.fn();
    const stop = watchWorkspaceDate("Asia/Shanghai", publish);
    vi.setSystemTime(new Date("2026-10-04T16:01:00.000Z"));
    browser.dispatchEvent(new Event("focus"));
    expect(publish).toHaveBeenLastCalledWith("2026-10-05");
    expect(vi.getTimerCount()).toBe(1);
    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(publish).toHaveBeenCalledTimes(2);
    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(publish).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1);
    stop();
  });
});
