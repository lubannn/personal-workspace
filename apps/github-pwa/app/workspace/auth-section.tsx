"use client";

import type { FormEvent } from "react";

import type { AuthAvailability, Connection, ConnectionMethod } from "./page-model";
import { formatWorkspaceDate } from "./workspace-date";

type Props = {
  online: boolean | null;
  connection: Connection | null;
  todayDate: string;
  connectionMethod: ConnectionMethod | null;
  authAvailability: AuthAvailability;
  owner: string;
  repository: string;
  token: string;
  connecting: boolean;
  confirmingRevokeAll: boolean;
  revokingAll: boolean;
  errorMessage: string;
  statusMessage: string;
  onOwnerChange: (value: string) => void;
  onRepositoryChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onConnect: (event: FormEvent<HTMLFormElement>) => void;
  onDisconnect: () => void;
  onConfirmingRevokeAllChange: (value: boolean) => void;
  onRevokeAll: () => void;
};

export function AuthSection(props: Props) {
  const { online, connection, todayDate, connectionMethod, authAvailability, owner, repository, token, connecting, confirmingRevokeAll, revokingAll, errorMessage, statusMessage, onOwnerChange, onRepositoryChange, onTokenChange, onConnect, onDisconnect, onConfirmingRevokeAllChange, onRevokeAll } = props;
  return <>
    <header className="topbar" id="top">
      <a className="brand" href="#top" aria-label="Nexus 工作台首页"><span aria-hidden="true">N</span><h1>Nexus</h1></a>
      <div className="topbar-date"><span>今天</span><time dateTime={todayDate || undefined}>{formatWorkspaceDate(todayDate)}</time></div>
      <div className="topbar-actions">
        <a className="topbar-journal-link" href="#journal-title">写日记 <span aria-hidden="true">↗</span></a>
        <div className={`network ${online === false ? "offline" : ""}`}><i /> {online === null ? "检测网络" : online ? connection ? "Private repo 已连接" : "GitHub 可连接" : "当前离线"}</div>
      </div>
    </header>
    <section className={`connection-card ${connection ? "connected" : ""}`} aria-labelledby="connection-title">
      <div className="connection-copy">
        <p className="eyebrow">Private connection</p><h2 id="connection-title">{connection ? "私人数据已连接" : "连接你的数据仓库"}</h2>
        <p>{connection ? `${connection.repository} · Private · ${connection.timezone}` : authAvailability === "configured" ? "使用 GitHub App 登录；访问令牌只进入当前页面内存。也可继续使用 fine-grained token 作为备用方式。" : "使用只授权 personal-workspace-data 的 fine-grained token；需要 Metadata 读取和 Contents 读写权限。"}</p>
      </div>
      {connection ? <div className="connection-actions">
        <span className="private-badge">Private verified</span>
        <button className="secondary-button" type="button" onClick={onDisconnect} disabled={revokingAll}>{connectionMethod === "github-app" ? "退出当前设备" : "断开并清除"}</button>
        {connectionMethod === "github-app" ? confirmingRevokeAll ? <div className="revoke-confirm" role="group" aria-label="确认撤销全部设备">
          <span>所有设备都需要重新登录。</span><button className="danger-button" type="button" onClick={onRevokeAll} disabled={revokingAll}>{revokingAll ? "正在撤销…" : "确认撤销全部设备"}</button>
          <button className="secondary-button" type="button" onClick={() => onConfirmingRevokeAllChange(false)} disabled={revokingAll}>取消</button>
        </div> : <button className="danger-outline-button" type="button" onClick={() => onConfirmingRevokeAllChange(true)}>撤销全部设备</button> : null}
      </div> : <form className="connection-form" onSubmit={onConnect}>
        {authAvailability === "configured" ? <a className="github-login-button" href="/auth/login">使用 GitHub 登录</a> : authAvailability === "checking" ? <span className="auth-checking">正在检查 GitHub App 登录…</span> : null}
        <label>Owner<input value={owner} onChange={(event) => onOwnerChange(event.target.value)} autoCapitalize="none" spellCheck={false} /></label>
        <label>Repository<input value={repository} onChange={(event) => onRepositoryChange(event.target.value)} autoCapitalize="none" spellCheck={false} /></label>
        <label className="token-field">Fine-grained token<input type="password" value={token} onChange={(event) => onTokenChange(event.target.value)} autoComplete="new-password" spellCheck={false} placeholder="github_pat_…" /></label>
        <button type="submit" disabled={connecting || online === false || !token}>{connecting ? "正在安全检查…" : "使用 Token 连接"}</button>
        <a className="token-help" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">在 GitHub 创建备用最小权限令牌 ↗</a>
      </form>}
    </section>
    {(errorMessage || statusMessage) ? <div className={`message-bar ${errorMessage ? "error" : "success"}`} role={errorMessage ? "alert" : "status"}>{errorMessage || statusMessage}</div> : null}
  </>;
}
