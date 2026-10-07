"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { readCookie, type ConnectionMethod } from "./page-model";
import { drainCorosHistory } from "./coros-history-client";
import { createCorosRefreshUpdates } from "./coros-refresh-updates";

function friendlyError(code: string) {
  if (/PAUSED/u.test(code)) return "请先在 COROS 连接设置中恢复自动更新。";
  if (/AUTH|TOKEN|CONNECTION_REQUIRED/u.test(code)) return "请检查 GitHub 登录及 COROS 连接后重试。";
  if (/RATE|LIMIT/u.test(code)) return "COROS 暂时限流，已保存的记录仍保留，稍后重试。";
  if (/CONFIG/u.test(code)) return "COROS 同步连接尚未准备好。";
  return "更新未全部完成，已入库的记录保留，可稍后重试。";
}

export function CorosRefreshButton({ connectionMethod, disabled = false }: { connectionMethod: ConnectionMethod | null; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, [connectionMethod]);

  async function update() {
    if (controller.current || connectionMethod !== "github-app") return;
    const csrf = readCookie("__Host-pw_csrf");
    if (!csrf) { setMessage("GitHub 登录已失效，请重新登录后更新。"); return; }
    const current = new AbortController(); controller.current = current;
    setBusy(true); setMessage("正在从 COROS 读取近期睡眠与运动…");
    window.dispatchEvent(new CustomEvent("coros-sync-running", { detail: { running: true } }));
    const updates = createCorosRefreshUpdates(detail => window.dispatchEvent(new CustomEvent("coros-sync-updated", { detail })));
    try {
      const result = await drainCorosHistory({ csrf, signal: current.signal, recentOnly: true, onUpdate: update => {
        updates.update(update);
        if (update.status === "busy") setMessage("后台已有更新正在进行，正在等待完成…");
        else if (update.status === "processed") {
          const request = update.progress?.request?.sequence;
          const recordsReady = request !== undefined && ["sleep", "workout"].every(domain =>
            update.progress?.domains[domain as "sleep" | "workout"].recentRequestSequence === request);
          setMessage(recordsReady ? "睡眠与运动已检查，正在更新健康指标…" : "正在更新近期睡眠与运动…");
        }
      } });
      if (current.signal.aborted) return;
      if (result.status === "complete") setMessage("近期睡眠与运动已更新。");
      else if (result.status === "busy") setMessage("后台正在更新，完成后记录会自动刷新。");
      else if (result.status === "deferred") setMessage("COROS 暂时需要等待，后台会继续处理已提交的更新。");
      else if (result.status === "limit") setMessage("近期记录已分批更新，剩余部分会在后台继续。");
      else setMessage(friendlyError(result.errorCode ?? ""));
    } catch (error) {
      if (!current.signal.aborted) {
        setMessage(friendlyError(error instanceof Error ? error.message : ""));
      }
    } finally {
      if (!current.signal.aborted) updates.finish();
      window.dispatchEvent(new CustomEvent("coros-sync-running", { detail: { running: false } }));
      if (controller.current === current) { controller.current = null; setBusy(false); }
    }
  }

  return <div className="coros-refresh-action"><button type="button" className="secondary-button health-records-refresh" disabled={disabled || busy || connectionMethod !== "github-app"} title="从 COROS 立即读取近期更新并保存到 GitHub" onClick={() => void update()}><RefreshCw size={13} aria-hidden="true" />{busy ? "更新 COROS 中…" : "额外更新"}</button>{message ? <span className="coros-refresh-message" role="status">{message}</span> : null}</div>;
}
