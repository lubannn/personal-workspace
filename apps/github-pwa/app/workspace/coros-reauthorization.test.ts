import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { CorosConnectionSection } from "./coros-connection-section";
import { initialSyncProgress } from "../../../auth-worker/src/coros-sync-state";

// Render the real component's event handlers with controlled hooks. No browser
// runtime is available in the node test environment; effects are not exercised.
const hooks = vi.hoisted(() => ({ index: 0, values: new Map<number, unknown>() }));
vi.mock("react", async importOriginal => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, useEffect: () => {}, useCallback: (callback: unknown) => callback,
    useRef: (value: unknown) => ({ current: value }),
    useState: (initial: unknown) => {
      const index = hooks.index++;
      if (!hooks.values.has(index)) hooks.values.set(index, typeof initial === "function" ? initial() : initial);
      return [hooks.values.get(index), (next: unknown) => hooks.values.set(index,
        typeof next === "function" ? next(hooks.values.get(index)) : next)];
    } };
});

const grantError = "COROS_OAUTH_REFRESH_HTTP_400_INVALID_GRANT";
const authorizationUrl = "https://mcpcn.coros.com/oauth2/authorize?state=synthetic-state";
function status(state: "paused" | "enabled" = "paused", error: string | null = null) {
  return { connected: true, state, connectedAt: null, lastSyncAt: null, lastErrorCode: error,
    sync: { readiness: { ready: true, missing: [], trigger: "daily_first_login", backfillIntervalMinutes: 5 },
      running: false, nextRunAt: null, progress: initialSyncProgress("2024-01-01", "Asia/Shanghai") } };
}
function render(next = status()) {
  hooks.index = 0;
  hooks.values.set(0, "ready"); hooks.values.set(1, next);
  if (!hooks.values.has(8)) hooks.values.set(8, next.sync.progress.startDate);
  return CorosConnectionSection({ connectionMethod: "github-app" });
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}
function buttons(node: ReactNode): { children?: ReactNode; disabled?: boolean; onClick: () => void }[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement<{ children?: ReactNode; disabled?: boolean; onClick: () => void }>(node)) return [];
  return [...(node.type === "button" ? [node.props] : []), ...buttons(node.props.children)];
}
function button(tree: ReactNode, label: string) {
  const found = buttons(tree).find(value => text(value.children) === label);
  expect(found, label).toBeDefined(); return found!;
}
const assign = vi.fn();
beforeEach(() => {
  hooks.values.clear(); assign.mockReset();
  vi.stubGlobal("document", { cookie: "__Host-pw_csrf=synthetic-csrf" });
  vi.stubGlobal("window", { location: { assign } });
});
afterEach(() => vi.unstubAllGlobals());

describe("COROS reauthorization preserving progress", () => {
  it("keeps the paused entry visible after both connection and progress errors clear", () => {
    const tree = render();
    expect(button(tree, "重新授权（保留进度）").disabled).toBe(false);
    expect(text(tree)).toContain("授权成功后仍保持暂停");
    expect(text(tree)).toContain("已有记录与历史范围保留");
  });

  it("recognizes the fixed invalid_grant code and requires pause before POST", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const entry = button(render(status("enabled", grantError)), "重新授权（保留进度）");
    expect(entry.disabled).toBe(true);
    entry.onClick();
    expect(fetcher).not.toHaveBeenCalled(); expect(assign).not.toHaveBeenCalled();
    expect(hooks.values.get(6)).toContain("请先暂停");
  });

  it("keeps the entry after the existing pause request and a status refresh that clears errors", async () => {
    const paused = status();
    const fetcher = vi.fn(async (path: string) => Response.json(path === "/coros/status" ? paused
      : path === "/coros/start" ? { authorizationUrl } : { state: "paused" }));
    vi.stubGlobal("fetch", fetcher);
    button(render(status("enabled", grantError)), "暂停自动更新").onClick();
    await vi.waitFor(() => expect(hooks.values.get(2)).toBe(false));
    expect(hooks.values.get(1)).toEqual(paused);
    button(render(paused), "重新授权（保留进度）").onClick();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith(authorizationUrl));
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual(["/coros/pause", "/coros/status", "/coros/start"]);
  });

  it.each([2, 4])("disables reauthorization while another action or status request is active (hook %s)", index => {
    hooks.values.set(index, true);
    expect(button(render(), "重新授权（保留进度）").disabled).toBe(true);
  });

  it("uses the existing same-origin POST and CSRF before validated authorization navigation", async () => {
    const fetcher = vi.fn(async () => Response.json({ authorizationUrl })); vi.stubGlobal("fetch", fetcher);
    const previous = status(); const progress = JSON.stringify(previous.sync.progress);
    button(render(previous), "重新授权（保留进度）").onClick();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith(authorizationUrl));
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/coros/start", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json", "x-pw-csrf": "synthetic-csrf" },
    });
    expect(JSON.stringify(previous.sync.progress)).toBe(progress);
  });

  it("does not start without the existing CSRF cookie", () => {
    vi.stubGlobal("document", { cookie: "" });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    button(render(), "重新授权（保留进度）").onClick();
    expect(fetcher).not.toHaveBeenCalled(); expect(assign).not.toHaveBeenCalled();
    expect(hooks.values.get(6)).toContain("重新登录");
  });

  it.each(["request failure", "rejected URL", "HTTP failure"])("retains the old data on %s without disconnecting or resetting history", async failure => {
    const previous = status(); const saved = JSON.stringify(previous);
    const fetcher = vi.fn(async (path: string) => {
      if (path === "/coros/status") return Response.json(previous);
      if (failure === "request failure") throw new Error("synthetic network failure");
      if (failure === "HTTP failure") return Response.json({ error: "COROS_OAUTH_REGISTRATION_HTTP_400_INVALID_CLIENT" }, { status: 502 });
      return Response.json({ authorizationUrl: "https://untrusted.example/oauth2/authorize" });
    });
    vi.stubGlobal("fetch", fetcher);
    button(render(previous), "重新授权（保留进度）").onClick();
    await vi.waitFor(() => expect(hooks.values.get(2)).toBe(false));
    expect(assign).not.toHaveBeenCalled(); expect(JSON.stringify(previous)).toBe(saved);
    expect(fetcher.mock.calls.map(([path]) => path).every(path => path === "/coros/start" || path === "/coros/status")).toBe(true);
  });

  it("still connects an unconnected account using the original flow", async () => {
    const fetcher = vi.fn(async () => Response.json({ authorizationUrl })); vi.stubGlobal("fetch", fetcher);
    const next = { ...status(), connected: false };
    button(render(next), "连接 COROS").onClick();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith(authorizationUrl));
    expect(fetcher).toHaveBeenCalledWith("/coros/start", expect.objectContaining({ method: "POST" }));
  });

  it("resumes from the saved historical start after the paused callback", async () => {
    const previous = status();
    const fetcher = vi.fn(async (path: string) => Response.json(path === "/coros/status" ? previous : { state: "enabled", queued: true }));
    vi.stubGlobal("fetch", fetcher);
    button(render(previous), "恢复自动更新").onClick();
    await vi.waitFor(() => expect(hooks.values.get(2)).toBe(false));
    expect(fetcher).toHaveBeenCalledWith("/coros/enable", expect.objectContaining({
      body: JSON.stringify({ startDate: "2024-01-01" }), headers: expect.objectContaining({ "x-pw-csrf": "synthetic-csrf" }),
    }));
    expect(previous.sync.progress.startDate).toBe("2024-01-01");
  });
});
