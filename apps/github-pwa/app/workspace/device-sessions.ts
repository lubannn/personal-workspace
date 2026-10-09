import type { ConnectionMethod } from "./page-model";

export type DeviceSession = {
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
};

export type DeviceSessionsState =
  | { status: "closed" | "loading" | "personal-token" }
  | { status: "loaded"; sessions: DeviceSession[] }
  | { status: "error"; message: string };

function parseSessions(payload: unknown): DeviceSession[] {
  if (!payload || typeof payload !== "object" || !("sessions" in payload) || !Array.isArray(payload.sessions)) {
    throw new Error("InvalidSessionList");
  }
  return payload.sessions.map((entry: unknown) => {
    if (!entry || typeof entry !== "object"
      || !("deviceName" in entry) || (entry.deviceName !== null && typeof entry.deviceName !== "string")
      || !("createdAt" in entry) || typeof entry.createdAt !== "string" || !Number.isFinite(Date.parse(entry.createdAt))
      || !("lastUsedAt" in entry) || typeof entry.lastUsedAt !== "string" || !Number.isFinite(Date.parse(entry.lastUsedAt))
      || !("current" in entry) || typeof entry.current !== "boolean") {
      throw new Error("InvalidSessionList");
    }
    return { deviceName: entry.deviceName, createdAt: entry.createdAt, lastUsedAt: entry.lastUsedAt, current: entry.current };
  });
}

/** No persistent storage. Closing invalidates even responses that ignore abort. */
export class DeviceSessionsStore {
  private state: DeviceSessionsState = { status: "closed" };
  private request: AbortController | null = null;
  private listeners = new Set<() => void>();

  constructor(private fetcher: typeof fetch = (...args) => fetch(...args)) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(state: DeviceSessionsState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }

  close = () => {
    this.request?.abort();
    this.request = null;
    this.publish({ status: "closed" });
  };

  open = async (method: ConnectionMethod | null) => {
    this.close();
    if (method !== "github-app") {
      if (method === "personal-token") this.publish({ status: "personal-token" });
      return;
    }
    const request = new AbortController();
    this.request = request;
    this.publish({ status: "loading" });
    try {
      const response = await this.fetcher("/auth/sessions", {
        credentials: "same-origin", cache: "no-store", signal: request.signal,
      });
      if (!response.ok) {
        if (response.status === 401) {
          if (this.request === request) this.publish({ status: "error", message: "登录会话已失效，请重新登录后查看。" });
          return;
        }
        throw new Error("SessionListFailed");
      }
      const sessions = parseSessions(await response.json());
      if (this.request === request && !request.signal.aborted) this.publish({ status: "loaded", sessions });
    } catch {
      if (this.request === request && !request.signal.aborted) {
        this.publish({ status: "error", message: "无法加载设备会话，请稍后重试。" });
      }
    } finally {
      if (this.request === request) this.request = null;
    }
  };
}
