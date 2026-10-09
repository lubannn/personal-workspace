import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DeviceSessionsStore } from "./device-sessions";
import { DeviceSessionsContent } from "./device-sessions-dialog";

const session = { deviceName: null, createdAt: "2026-10-01T00:00:00.000Z", lastUsedAt: "2026-10-08T00:00:00.000Z", current: true };
const result = () => Response.json({ sessions: [session] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("device session request lifecycle", () => {
  it("loads via same-origin cookie only, without caching or identity parameters", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(result());
    const store = new DeviceSessionsStore(fetcher);
    const loading = store.open("github-app");
    expect(store.getSnapshot()).toEqual({ status: "loading" });
    await loading;
    expect(fetcher).toHaveBeenCalledWith("/auth/sessions", { credentials: "same-origin", cache: "no-store", signal: expect.any(AbortSignal) });
    expect(store.getSnapshot()).toEqual({ status: "loaded", sessions: [session] });
    store.close();
    expect(store.getSnapshot()).toEqual({ status: "closed" });
  });

  it("never fetches for PAT or a disconnected account", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const store = new DeviceSessionsStore(fetcher);
    await store.open("personal-token");
    expect(store.getSnapshot()).toEqual({ status: "personal-token" });
    await store.open(null);
    expect(store.getSnapshot()).toEqual({ status: "closed" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([401, 500])("shows safe errors for %s and supports retry", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ token: "DO NOT DISPLAY" }, { status })).mockResolvedValueOnce(result());
    const store = new DeviceSessionsStore(fetcher);
    await store.open("github-app");
    expect(store.getSnapshot()).toMatchObject({ status: "error", message: expect.stringContaining(status === 401 ? "重新登录" : "重试") });
    expect(JSON.stringify(store.getSnapshot())).not.toContain("DO NOT DISPLAY");
    await store.open("github-app");
    expect(store.getSnapshot()).toMatchObject({ status: "loaded" });
  });

  it("cancels on close/logout and ignores a late response even when abort is ignored", async () => {
    const pending = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
    const store = new DeviceSessionsStore(fetcher);
    const loading = store.open("github-app");
    const signal = fetcher.mock.calls[0][1]!.signal!;
    store.close();
    expect(signal.aborted).toBe(true);
    pending.resolve(result());
    await loading;
    expect(store.getSnapshot()).toEqual({ status: "closed" });
  });

  it("keeps the new request after repeated open/close and stale failures", async () => {
    const first = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockReturnValueOnce(first.promise).mockResolvedValueOnce(result());
    const store = new DeviceSessionsStore(fetcher);
    const old = store.open("github-app");
    store.close();
    await store.open("github-app");
    first.resolve(Response.json({}, { status: 401 }));
    await old;
    expect(store.getSnapshot()).toEqual({ status: "loaded", sessions: [session] });
  });

  it("discards a response whose body completes after logout", async () => {
    const body = deferred<unknown>();
    const response = result();
    vi.spyOn(response, "json").mockReturnValue(body.promise);
    const store = new DeviceSessionsStore(vi.fn<typeof fetch>().mockResolvedValue(response));
    const loading = store.open("github-app");
    await Promise.resolve();
    store.close();
    body.resolve({ sessions: [session] });
    await loading;
    expect(store.getSnapshot()).toEqual({ status: "closed" });
  });

  it("rejects malformed lists and copies only display fields", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ sessions: [{ ...session, current: 1 }] })).mockResolvedValueOnce(Response.json({ sessions: [{ ...session, token: "secret" }] }));
    const store = new DeviceSessionsStore(fetcher);
    await store.open("github-app");
    expect(store.getSnapshot()).toMatchObject({ status: "error" });
    await store.open("github-app");
    expect(store.getSnapshot()).toEqual({ status: "loaded", sessions: [session] });
  });
});

describe("device session display", () => {
  it("shows legacy names, the current session, duplicate sessions and precise semantics", () => {
    const html = renderToStaticMarkup(createElement(DeviceSessionsContent, { state: { status: "loaded", sessions: [session, { ...session, current: false, deviceName: " " }] }, timezone: "Asia/Shanghai", onRetry: () => {} }));
    expect(html.match(/未命名设备/g)).toHaveLength(2);
    expect(html.match(/当前会话（本机）/g)).toHaveLength(1);
    expect(html).toContain("并不代表实时在线");
    expect(html).toContain("最近认证时间仅表示认证刷新时间");
    expect(html).toContain("08:00");
  });
  it("explains PAT limitations and handles empty lists", () => {
    const props = { timezone: "UTC", onRetry: () => {} };
    expect(renderToStaticMarkup(createElement(DeviceSessionsContent, { ...props, state: { status: "personal-token" } }))).toContain("没有可查询的服务器设备会话清单");
    expect(renderToStaticMarkup(createElement(DeviceSessionsContent, { ...props, state: { status: "loaded", sessions: [] } }))).toContain("没有有效的登录会话");
  });
});
