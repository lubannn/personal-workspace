"use client";

import { useEffect, useRef } from "react";
import type { DeviceSessionsState } from "./device-sessions";

function sessionTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function DeviceSessionsContent({ state, timezone, onRetry }: {
  state: DeviceSessionsState; timezone: string; onRetry: () => void;
}) {
  return <>
    <p className="device-sessions-description">这里显示仍有效的登录会话。同一设备的不同浏览器或重复登录可能有多条记录，并不代表实时在线。</p>
    <p className="device-sessions-description">最近认证时间仅表示认证刷新时间。时间按 {timezone} 显示。</p>
    {state.status === "personal-token" ? <p role="status">当前使用 Token 连接，没有可查询的服务器设备会话清单。</p> : null}
    {state.status === "loading" ? <p role="status">正在加载设备会话…</p> : null}
    {state.status === "error" ? <div role="alert"><p>{state.message}</p><button className="secondary-button" type="button" onClick={onRetry}>重试</button></div> : null}
    {state.status === "loaded" ? state.sessions.length === 0 ? <p role="status">没有有效的登录会话。</p> : <ul className="device-sessions-list">
      {state.sessions.map((session, index) => <li key={index}>
        <div><strong>{session.deviceName?.trim() || "未命名设备"}</strong>{session.current ? <span className="private-badge">当前会话（本机）</span> : null}</div>
        <dl>
          <div><dt>登录时间</dt><dd><time dateTime={session.createdAt}>{sessionTime(session.createdAt, timezone)}</time></dd></div>
          <div><dt>最近认证时间</dt><dd><time dateTime={session.lastUsedAt}>{sessionTime(session.lastUsedAt, timezone)}</time></dd></div>
        </dl>
      </li>)}
    </ul> : null}
  </>;
}

export function DeviceSessionsDialog({ state, timezone, onClose, onRetry }: {
  state: DeviceSessionsState; timezone: string; onClose: () => void; onRetry: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => {
      element?.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return <dialog ref={dialog} className="device-sessions-dialog" aria-labelledby="device-sessions-title" onCancel={onClose} onClose={(event) => { if (!event.currentTarget.open) onClose(); }} onKeyDown={(event) => {
    if (event.key !== "Tab") return;
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <div className="device-sessions-heading"><h2 id="device-sessions-title">所有设备</h2><button className="secondary-button" type="button" autoFocus onClick={onClose}>关闭</button></div>
    <DeviceSessionsContent state={state} timezone={timezone} onRetry={onRetry} />
  </dialog>;
}
