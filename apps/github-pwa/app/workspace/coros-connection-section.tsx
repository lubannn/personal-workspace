"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SyncProgress } from "../../../auth-worker/src/coros-sync-state";
import { readCookie, type ConnectionMethod } from "./page-model";
import "./health-records.css";
import { CorosConflicts } from "./coros-conflicts";
import { drainCorosHistory } from "./coros-history-client";

type CorosStatus = {
  connected: boolean;
  state: "paused" | "enabled" | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
  sync?: {
    readiness: { ready: boolean; missing: string[]; trigger: "daily_first_login"; backfillIntervalMinutes: number };
    progress: SyncProgress | null;
    running: boolean;
    nextRunAt: string | null;
    dailyRequestedDate?: string | null;
  };
};
type CorosPreview = { machineReadable: boolean; format: "structured" | "content"; fields: string[]; blockTypes: string[] };
type ViewState = "loading" | "unavailable" | "login-required" | "ready" | "error";
type Mutation = "/coros/start" | "/coros/disconnect" | "/coros/enable" | "/coros/pause" | "/coros/sync";
const COROS_AUTH_ORIGINS = new Set(["https://mcpcn.coros.com", "https://mcpeu.coros.com", "https://mcpus.coros.com"]);

function corosAuthorizationUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("COROS_AUTHORIZATION_URL_INVALID");
  const url = new URL(value);
  if (!COROS_AUTH_ORIGINS.has(url.origin) || url.pathname !== "/oauth2/authorize") throw new Error("COROS_AUTHORIZATION_URL_INVALID");
  return url.toString();
}
function displayTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "尚无记录";
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}
function errorMessage(code: string | null | undefined) {
  if (!code) return null;
  if (/CONFIG|INSTALLATION|GITHUB_APP|OWNER_MISMATCH|WORKSPACE_MISMATCH/iu.test(code)) return "后台写入连接尚未准备好，需要完成服务端配置后再同步。";
  if (code === "COROS_SYNC_INVALID_DATE") return "历史开始日期无效，请选择不晚于今天的日期。";
  if (/TIMEOUT/iu.test(code)) return "连接响应超时，本批未完成；已有记录仍保留，可稍后重试。";
  if (/TOKEN|AUTHORIZATION|UNAUTHORIZED|CREDENTIAL|AUTH_REQUIRED/iu.test(code)) return "COROS 授权暂时不可用。请重新连接后恢复同步。";
  if (/FORMAT|MAPPING|READ_RESULT|READ_TOOL_UNAVAILABLE|TRUNCATED/iu.test(code)) return "COROS 返回的数据格式需要核对，本批没有继续入库。已有记录仍保留。";
  if (/RATE|LIMIT|429/iu.test(code)) return "COROS 暂时限制了读取频率，本批更新需要稍后再尝试。";
  if (/CONFLICT/iu.test(code)) return "部分记录与已保存内容不一致，已保留原记录并标记待核对。";
  return "最近一次同步没有完成，已有记录仍保留。";
}
function validStartDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) return false;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return value <= today;
}

export function CorosConnectionSection({ connectionMethod }: { connectionMethod: ConnectionMethod | null }) {
  const [view, setView] = useState<ViewState>("loading");
  const [status, setStatus] = useState<CorosStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<CorosPreview | null>(null);
  const [startDate, setStartDate] = useState("2025-05-01");
  const [historyRunning, setHistoryRunning] = useState(false);
  const [historyWaiting, setHistoryWaiting] = useState(false);
  const [historyRetryAt, setHistoryRetryAt] = useState<string | null>(null);
  const [historyBatches, setHistoryBatches] = useState(0);
  const [historyBatch, setHistoryBatch] = useState<SyncProgress["lastBatch"]>(null);
  const historyController = useRef<AbortController | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const lastSyncAt = useRef<string | null | undefined>(undefined);
  const section = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (connectionMethod !== "github-app" || inFlight.current) return;
    const controller = new AbortController(); inFlight.current = controller;
    if (!silent) setRefreshing(true);
    try {
      const response = await fetch("/coros/status", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted) return;
      if (response.status === 503) { setView("unavailable"); return; }
      if (response.status === 401) { setView("login-required"); setStatus(null); return; }
      if (!response.ok) throw new Error("COROS_STATUS_FAILED");
      const next = await response.json() as CorosStatus;
      if (controller.signal.aborted) return;
      if (typeof next.connected !== "boolean" || (next.state !== null && next.state !== "paused" && next.state !== "enabled")) throw new Error("COROS_STATUS_INVALID");
      if (next.sync && (typeof next.sync.readiness?.ready !== "boolean" || !Array.isArray(next.sync.readiness.missing))) throw new Error("COROS_STATUS_INVALID");
      if (lastSyncAt.current !== undefined && next.lastSyncAt && next.lastSyncAt !== lastSyncAt.current) {
        window.dispatchEvent(new CustomEvent("coros-sync-updated", { detail: { lastSyncAt: next.lastSyncAt } }));
      }
      lastSyncAt.current = next.lastSyncAt;
      setStatus(next); setView("ready");
      setMessage(current => current === "同步状态暂时无法更新，以下保留上次结果。" ? "" : current);
    } catch {
      if (!controller.signal.aborted) {
        if (silent) setMessage("同步状态暂时无法更新，以下保留上次结果。"); else setView("error");
      }
    } finally {
      if (inFlight.current === controller) { inFlight.current = null; setRefreshing(false); }
    }
  }, [connectionMethod]);

  useEffect(() => {
    lastSyncAt.current = undefined;
    const timer = window.setTimeout(() => {
      busyRef.current = false; setBusy(false); setHistoryRunning(false);
      if (connectionMethod !== "github-app") { setView("login-required"); setStatus(null); }
      else { setView("loading"); void refresh(); }
    }, 0);
    return () => {
      window.clearTimeout(timer); inFlight.current?.abort(); inFlight.current = null;
      historyController.current?.abort(); historyController.current = null;
    };
  }, [connectionMethod, refresh]);

  useEffect(() => {
    if (!status?.connected || status.state !== "enabled") return;
    const poll = () => {
      if (document.visibilityState === "visible" && section.current?.getClientRects().length && !busyRef.current) void refresh(true);
    };
    const timer = window.setInterval(poll, 30_000);
    document.addEventListener("visibilitychange", poll);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, [refresh, status?.connected, status?.state]);

  async function backfillHistory() {
    if (busyRef.current || connectionMethod !== "github-app") return;
    const csrf = readCookie("__Host-pw_csrf");
    if (!csrf) { setMessage("GitHub 登录会话已失效，请重新登录。"); return; }
    const controller = new AbortController(); historyController.current = controller;
    busyRef.current = true; setBusy(true); setHistoryRunning(true); setHistoryWaiting(false); setHistoryRetryAt(null); setHistoryBatches(0); setHistoryBatch(null); setMessage("");
    inFlight.current?.abort(); inFlight.current = null; setRefreshing(false);
    let remainingConflicts = status?.sync?.progress?.conflicts ?? 0;
    try {
      const result = await drainCorosHistory({ csrf, signal: controller.signal, onUpdate: (update, processed) => {
        if (controller.signal.aborted) return;
        setHistoryBatches(processed);
        setHistoryWaiting(update.status === "busy"); setHistoryRetryAt(update.status === "busy" ? update.retryAt ?? null : null);
        if (update.batch) setHistoryBatch(update.batch);
        if (update.progress) remainingConflicts = update.progress.conflicts;
        if (update.progress) setStatus(current => current?.sync ? { ...current, lastSyncAt: update.progress!.lastSuccessAt,
          lastErrorCode: update.progress!.lastErrorCode, sync: { ...current.sync, progress: update.progress!, running: update.status === "busy" } } : current);
      } });
      if (controller.signal.aborted) return;
      if (result.status === "complete") setMessage(remainingConflicts > 0
        ? `本次历史范围已检查完成，可直接入库的记录已保存。另有 ${remainingConflicts} 项差异保留原记录，仍需在「待核对记录」中检查。`
        : "本次历史范围已检查完成，取得的睡眠与运动记录已保存。下方进度显示实际取得的最新记录日期。");
      else if (result.status === "deferred") setMessage(`本次补齐暂缓，后台会接着已保存的进度继续。${result.retryAt ? `下次可重试：${displayTime(result.retryAt)}。` : "请稍后继续。"}`);
      else if (result.status === "busy") setMessage("后台仍在处理另一批记录，已保存进度。稍后可点击「继续补齐历史」。");
      else if (result.status === "limit") setMessage("本次连续补齐已达到批次数量上限，已保存进度。可点击「继续补齐历史」处理剩余日期。");
      else setMessage(errorMessage(result.errorCode) ?? "本次补齐没有完成，已保存进度。请刷新状态后重试。");
    } catch (error) {
      if (!controller.signal.aborted) setMessage(errorMessage(error instanceof Error ? error.message : null) ?? "本次补齐暂时中断，已保存进度。请刷新状态后继续。");
    } finally {
      if (historyController.current === controller) {
        historyController.current = null; busyRef.current = false;
        setBusy(false); setHistoryRunning(false); setHistoryWaiting(false); setHistoryRetryAt(null);
        await refresh();
      }
    }
  }

  function stopHistoryBackfill() {
    historyController.current?.abort();
    setMessage("已停止本次连续补齐；已提交的一批可能仍会完成。进度已保留，每日自动同步设置不变，后台会继续处理已请求的范围。");
  }

  async function mutate(path: Mutation) {
    if (busyRef.current) return;
    const csrf = readCookie("__Host-pw_csrf");
    if (!csrf) { setMessage("GitHub 登录会话已失效，请重新登录。"); return; }
    const syncStart = status?.sync?.progress?.startDate ?? startDate;
    if (path === "/coros/enable" && !validStartDate(syncStart)) { setMessage("请选择有效的历史开始日期，不能晚于今天。"); return; }
    busyRef.current = true; setBusy(true); setMessage("");
    inFlight.current?.abort(); inFlight.current = null; setRefreshing(false);
    try {
      const response = await fetch(path, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { accept: "application/json", "content-type": "application/json", "x-pw-csrf": csrf },
        ...(path === "/coros/enable" ? { body: JSON.stringify({ startDate: syncStart }) } : {}),
      });
      const result = await response.json() as { authorizationUrl?: string; error?: string };
      if (!response.ok) { setMessage(errorMessage(result.error) ?? "操作没有完成，请刷新状态后重试。"); await refresh(); return; }
      if (path === "/coros/start") { window.location.assign(corosAuthorizationUrl(result.authorizationUrl)); return; }
      if (path === "/coros/disconnect") {
        setPreview(null); setConfirmDisconnect(false);
        setMessage("已断开工作台与 COROS 的连接，停止后续同步。已入库的记录仍保留。");
      } else if (path === "/coros/enable") setMessage("已开启每日自动同步。每天首次登录或打开工作台时更新；首次会先读取最近记录，再分批补齐所选历史范围。");
      else if (path === "/coros/pause") setMessage("已暂停自动同步；正在处理的批次可能仍会完成。恢复后会接着已有进度继续。");
      else setMessage("已请求额外更新，将在下一次后台处理时读取近期记录，通常在 10 分钟内开始。");
      await refresh();
    } catch { setMessage("操作结果暂时无法确认，请刷新状态后查看。已有记录仍保留。"); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function previewOneDay() {
    if (busyRef.current) return;
    const csrf = readCookie("__Host-pw_csrf");
    if (!csrf) { setMessage("GitHub 登录会话已失效，请重新登录。"); return; }
    busyRef.current = true; setBusy(true); setPreview(null); setMessage("");
    try {
      const response = await fetch("/coros/preview", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json", "x-pw-csrf": csrf } });
      if (!response.ok) throw new Error("COROS_PREVIEW_FAILED");
      const result = await response.json() as CorosPreview;
      if (typeof result.machineReadable !== "boolean" || !Array.isArray(result.fields)) throw new Error("COROS_PREVIEW_INVALID");
      setPreview(result);
    } catch { setMessage("读取检查没有完成，请稍后重试。此检查不会写入健康记录。"); }
    finally { busyRef.current = false; setBusy(false); }
  }

  const progress = status?.sync?.progress;
  const ready = status?.sync?.readiness.ready === true;
  const enabled = status?.connected && status.state === "enabled";
  const lastError = errorMessage(status?.lastErrorCode ?? progress?.lastErrorCode);

  return <section ref={section} className="learning-card health-card" aria-labelledby="coros-connection-title" aria-busy={busy || refreshing}>
    <div className="card-heading"><div><p className="eyebrow">COROS · Sync</p><h2 id="coros-connection-title">COROS 连接与自动同步</h2>
      <p className="learning-subtitle">开启后，每天首次登录或打开工作台时自动更新一次睡眠和运动。已提交的任务会在后台继续，手表数据需先同步到 COROS App。</p></div>
      <div className="learning-view-actions"><button className="secondary-button" type="button" onClick={() => void refresh()} disabled={busy || refreshing || connectionMethod !== "github-app"}>{refreshing ? "检查中…" : "刷新状态"}</button></div>
    </div>
    {view === "loading" ? <p role="status">正在检查连接状态…</p> : null}
    {view === "unavailable" ? <p>后台连接服务暂时不可用，请稍后重试。</p> : null}
    {view === "login-required" ? <p>请先使用 GitHub App 登录工作台，再连接 COROS。后台同步需要独立授权，聊天中的 COROS 连接不会自动连接这里。</p> : null}
    {view === "error" ? <p role="alert">暂时无法确认 COROS 同步状态，请刷新状态重试。</p> : null}
    {view === "ready" && status ? <div>
      <p><strong>{!status.connected ? "尚未连接 COROS" : enabled ? status.sync?.running ? "每日自动同步已开启 · 正在处理记录" : "每日自动同步已开启" : "COROS 已连接 · 自动同步已暂停"}</strong></p>
      {status.connected && !ready ? <p role="status">{status.sync ? "后台保存健康记录所需的连接尚未配置完整。完成服务端配置后即可开启自动同步，无需反复手动导入。" : "后台同步服务正在准备，暂时无法开启。"}</p> : null}
      {status.connected && ready ? <p className="learning-subtitle">每天首次恢复有效登录后触发一次更新；当天需要补充新记录时，可点击「额外更新」。首次历史记录每 {status.sync?.readiness.backfillIntervalMinutes ?? 10} 分钟分批补齐，也可点击「补齐历史记录」连续处理。关闭页面后，本次连续处理停止，后台仍会接着已保存进度继续。</p> : null}
      {status.connected ? <p>最近成功同步：{displayTime(status.lastSyncAt)}{enabled && status.sync?.nextRunAt ? <> · 下次后台处理：{displayTime(status.sync.nextRunAt)}</> : null}</p> : null}
      {enabled && status.sync && !status.sync.running && !status.sync.nextRunAt ? <p className="learning-subtitle">当前没有待处理批次，等待下一次每日更新或手动额外更新。</p> : null}
      {status.sync?.dailyRequestedDate ? <p className="learning-subtitle">最近每日更新请求：{status.sync.dailyRequestedDate}（北京时间）</p> : null}
      {lastError ? <p role="alert">{lastError}</p> : null}
      {historyRunning || historyBatches > 0 ? <p role="status">{historyRunning ? historyWaiting ? "后台正在处理，等待后自动继续补齐" : "正在连续补齐历史记录" : "本次连续补齐"} · 已完成 {historyBatches} 批。
        {historyWaiting && historyRetryAt ? <>预计继续时间：{displayTime(historyRetryAt)}。</> : null}
        {historyBatch ? <> 最近一批：{historyBatch.domain === "sleep" ? "睡眠" : "运动"} {historyBatch.from} 至 {historyBatch.through}，新增 {historyBatch.created} 条，已有 {historyBatch.unchanged} 条{historyBatch.conflicts > 0 ? `，待核对 ${historyBatch.conflicts} 条` : ""}。</> : null}
      </p> : null}
      {historyRunning ? <button className="secondary-button" type="button" onClick={stopHistoryBackfill}>停止本次连续补齐</button> : null}
      {progress ? <>
        <p className="learning-subtitle">首次历史范围：{progress.startDate} 至 {progress.backfillEnd ?? "等待首次请求"}。{progress.request ? <>当前请求检查至 {progress.request.through}。</> : null} 下方分别显示已检查到的日期与实际取得的最新记录；已检查的日期可能没有记录，不代表已导入全部 COROS 历史。</p>
        <div className="health-records-summary">{(["sleep", "workout"] as const).map(domain => {
          const p = progress.domains[domain];
          return <article key={domain}><div className="health-records-summary-label"><span>{domain === "sleep" ? "睡眠同步" : "运动同步"}</span></div>
            <p className="health-records-count">{p.created}<span>{domain === "sleep" ? "段新增" : "次新增"}</span></p>
            <dl className="health-records-range"><div><dt>最新记录日期</dt><dd>{p.latestRecordDate ?? "尚未取得记录"}</dd></div><div><dt>连续已检查至</dt><dd>{p.backfillThrough ?? "尚未开始"}</dd></div><div><dt>近期已检查至</dt><dd>{p.recentThrough ?? "尚未开始"}</dd></div></dl>
            {p.lastErrorCode ? <p role="alert">{errorMessage(p.lastErrorCode)}{enabled && p.retryAfter ? <> 下次重试：{displayTime(p.retryAfter)}</> : null}</p> : null}
            <p className="health-records-summary-note">{domain === "sleep" ? "按醒来日期归属，包含夜间睡眠与小睡" : "新增数量不包含已存在的记录"}</p>
          </article>;
        })}</div>
        {progress.conflicts > 0 ? <CorosConflicts count={progress.conflicts} /> : null}
      </> : null}
      {status.connected && status.state === "paused" && !progress ? <div className="health-records-date-inputs"><label>历史开始日期<input type="date" value={startDate} disabled={busy} onChange={event => setStartDate(event.target.value)} aria-describedby="coros-backfill-note" /></label><p id="coros-backfill-note" className="learning-subtitle">从这个日期分批查询可取得的记录。开启后会保存进度。</p></div> : null}
      {!status.connected ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void mutate("/coros/start")}>{busy ? "正在准备…" : "连接 COROS"}</button> :
        confirmDisconnect ? <div className="learning-view-actions"><button className="danger-button" type="button" disabled={busy} onClick={() => void mutate("/coros/disconnect")}>确认断开</button><button className="secondary-button" type="button" disabled={busy} onClick={() => setConfirmDisconnect(false)}>取消</button></div> :
          <div className="learning-view-actions">
            {enabled ? <><button className="primary-button" type="button" disabled={busy || !ready} onClick={() => void backfillHistory()}>{historyRunning ? "正在补齐历史…" : historyBatches > 0 ? "继续补齐历史" : "补齐历史记录"}</button><button className="secondary-button" type="button" disabled={busy || !ready || status.sync?.running} onClick={() => void mutate("/coros/sync")}>额外更新</button><button className="secondary-button" type="button" disabled={busy} onClick={() => void mutate("/coros/pause")}>暂停自动同步</button></> : <>
              <button className="primary-button" type="button" disabled={busy || !ready || (!progress && !validStartDate(startDate))} onClick={() => void mutate("/coros/enable")}>{progress ? "恢复自动同步" : "开启自动同步"}</button>
              <button className="secondary-button" type="button" disabled={busy} onClick={() => void previewOneDay()}>检查 COROS 读取</button>
            </>}
            {lastError?.includes("重新连接") ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void mutate("/coros/start")}>重新连接 COROS</button> : null}
            <button className="danger-outline-button" type="button" disabled={busy} onClick={() => setConfirmDisconnect(true)}>断开 COROS</button>
          </div>}
      {preview ? <p role="status">COROS 读取连接可用。这次检查没有写入记录；开启自动同步后，会逐批核对并保存可识别的睡眠和运动数据。</p> : null}
    </div> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
