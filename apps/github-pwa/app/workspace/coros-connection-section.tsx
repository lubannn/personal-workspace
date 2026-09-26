"use client";

import { useCallback, useEffect, useState } from "react";
import { readCookie, type ConnectionMethod } from "./page-model";

type CorosStatus = {
  connected: boolean;
  state: "paused" | "enabled" | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
};

type ViewState = "loading" | "unavailable" | "login-required" | "ready" | "error";

const COROS_AUTH_ORIGINS = new Set([
  "https://mcpcn.coros.com",
  "https://mcpeu.coros.com",
  "https://mcpus.coros.com",
]);

function corosAuthorizationUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("COROS_AUTHORIZATION_URL_INVALID");
  const url = new URL(value);
  if (!COROS_AUTH_ORIGINS.has(url.origin) || url.pathname !== "/oauth2/authorize") {
    throw new Error("COROS_AUTHORIZATION_URL_INVALID");
  }
  return url.toString();
}

export function CorosConnectionSection({ connectionMethod }: { connectionMethod: ConnectionMethod | null }) {
  const [view, setView] = useState<ViewState>("loading");
  const [status, setStatus] = useState<CorosStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    if (connectionMethod !== "github-app") {
      setView("login-required");
      setStatus(null);
      return;
    }
    setView("loading");
    try {
      const response = await fetch("/coros/status", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 503) { setView("unavailable"); return; }
      if (response.status === 401) { setView("login-required"); return; }
      if (!response.ok) throw new Error("COROS_STATUS_FAILED");
      const next = await response.json() as CorosStatus;
      if (typeof next.connected !== "boolean" || (next.state !== null && next.state !== "paused" && next.state !== "enabled")) {
        throw new Error("COROS_STATUS_INVALID");
      }
      setStatus(next);
      setView("ready");
    } catch {
      setView("error");
    }
  }, [connectionMethod]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function mutate(path: "/coros/start" | "/coros/disconnect") {
    const csrf = readCookie("__Host-pw_csrf");
    if (!csrf) { setMessage("GitHub 登录会话已失效，请重新登录。"); return; }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(path, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { accept: "application/json", "x-pw-csrf": csrf },
      });
      if (!response.ok) throw new Error("COROS_CONNECTION_MUTATION_FAILED");
      const result = await response.json() as { authorizationUrl?: string };
      if (path === "/coros/start") {
        window.location.assign(corosAuthorizationUrl(result.authorizationUrl));
      } else {
        setConfirmDisconnect(false);
        setMessage("已删除工作台保存的 COROS 凭据；如需撤销 COROS 侧授权，请在 COROS 中单独操作。");
        await refresh();
      }
    } catch {
      setMessage("操作没有完成，连接状态未确认。请刷新状态后重试。");
    } finally {
      setBusy(false);
    }
  }

  return <section className="learning-card health-card" aria-labelledby="coros-connection-title">
    <div className="card-heading"><div><p className="eyebrow">COROS · Automatic sync</p><h2 id="coros-connection-title">COROS 独立连接</h2>
      <p className="learning-subtitle">工作台需要单独授权；Codex 插件的连接不会自动转给这里。当前版本仅准备连接，自动入库尚未启用。</p></div>
      <div className="learning-view-actions"><button className="secondary-button" type="button" onClick={() => void refresh()} disabled={busy || connectionMethod !== "github-app"}>刷新状态</button></div>
    </div>
    {view === "loading" ? <p>正在检查连接状态…</p> : null}
    {view === "unavailable" ? <p>连接器尚未上线；现有手工导入不受影响。</p> : null}
    {view === "login-required" ? <p>请先使用 GitHub App 登录工作台，才能单独连接 COROS。备用 GitHub token 不能建立后台同步。</p> : null}
    {view === "error" ? <p role="alert">暂时无法读取 COROS 连接状态，未进行任何同步。</p> : null}
    {view === "ready" && status ? <div>
      <p>{status.connected ? status.state === "paused" ? "已连接 · 自动同步暂停" : "已连接 · 自动同步已启用" : "尚未连接 COROS"}</p>
      {status.lastSyncAt ? <p>最近成功同步：{new Date(status.lastSyncAt).toLocaleString("zh-CN")}</p> : null}
      {status.lastErrorCode ? <p role="alert">最近同步错误：{status.lastErrorCode}</p> : null}
      {!status.connected ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void mutate("/coros/start")}>{busy ? "正在准备…" : "连接 COROS"}</button> :
        confirmDisconnect ? <div className="learning-view-actions"><button className="danger-button" type="button" disabled={busy} onClick={() => void mutate("/coros/disconnect")}>确认断开</button><button className="secondary-button" type="button" disabled={busy} onClick={() => setConfirmDisconnect(false)}>取消</button></div> :
          <button className="danger-outline-button" type="button" disabled={busy} onClick={() => setConfirmDisconnect(true)}>断开 COROS</button>}
    </div> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
