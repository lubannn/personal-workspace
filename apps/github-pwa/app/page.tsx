"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { GitHubContentsAdapter, GitHubDataError } from "../../../src/lib/github-data/github-contents";
import { createWorkspaceRecord, recordPath, serializeRecord } from "../../../src/lib/github-data/protocol";
import {
  newestCaptures,
  parseCaptureRecord,
  parseWorkspaceDescriptor,
  type CaptureRecord,
} from "../../../src/lib/github-data/workspace";

type Connection = {
  repository: string;
  ownerId: string;
  ownerLogin: string;
  timezone: string;
};

type SavedCapture = {
  path: string;
  commitSha: string;
  text: string;
};

function friendlyError(error: unknown) {
  if (error instanceof GitHubDataError) {
    if (error.code === "GITHUB_UNAUTHORIZED") return "令牌无效或已过期，请重新创建后再连接。";
    if (error.code === "GITHUB_FORBIDDEN") return "令牌权限不足：需要该数据仓库的 Contents 读写权限。";
    if (error.code === "GITHUB_NOT_FOUND") return "找不到数据仓库或 workspace.json，请检查仓库名称与令牌授权范围。";
    if (error.code === "GITHUB_REPOSITORY_NOT_PRIVATE") return "安全检查未通过：数据仓库必须保持 Private。";
    if (error.code === "GITHUB_SYNC_CONFLICT") return "文件已在另一台设备更新，请刷新后重试。";
    if (error.code === "GITHUB_NETWORK_ERROR") return "浏览器无法访问 GitHub API。请确认当前网络能打开 api.github.com，然后重试。";
    if (error.code === "GITHUB_CROSS_ORIGIN_BLOCKED") return "浏览器可以打开 GitHub API，但拦截了工作台的跨站请求。请关闭广告拦截/隐私扩展，或使用无痕窗口重试。";
    if (error.code === "GITHUB_AUTH_REQUEST_BLOCKED") return "普通 GitHub API 请求正常，但浏览器拦截了带授权信息的请求。请关闭广告拦截/隐私扩展，或使用无痕窗口重试。";
    if (error.code === "GITHUB_RATE_LIMITED") return "GitHub API 请求次数已达上限，请稍后再试。";
    if (error.code === "GITHUB_BAD_REQUEST") return "GitHub 拒绝了连接请求（HTTP 400）。请使用 fine-grained token，并只授权 personal-workspace-data。";
    if (error.code === "GITHUB_UNAVAILABLE") return `GitHub 服务暂时不可用（HTTP ${error.status}），请稍后重试。`;
    if (error.code === "GITHUB_API_ERROR") return `GitHub 返回了异常响应（HTTP ${error.status}），请截图此提示给我。`;
  }
  if (error instanceof SyntaxError) return "数据仓库中的 JSON 格式无效。";
  if (error instanceof Error && error.message === "INVALID_WORKSPACE_DESCRIPTOR") {
    return "数据仓库中的 workspace.json 结构不符合当前版本，请让我修复初始化文件。";
  }
  return "连接 GitHub 时发生错误，请稍后重试。";
}

function formatCaptureTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function GitHubWorkspacePage() {
  const adapterRef = useRef<GitHubContentsAdapter | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [owner, setOwner] = useState("lubannn");
  const [repository, setRepository] = useState("personal-workspace-data");
  const [token, setToken] = useState("");
  const [connection, setConnection] = useState<Connection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [loadingCaptures, setLoadingCaptures] = useState(false);
  const [saving, setSaving] = useState(false);
  const [capture, setCapture] = useState("");
  const [recentCaptures, setRecentCaptures] = useState<CaptureRecord[]>([]);
  const [savedCapture, setSavedCapture] = useState<SavedCapture | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      adapterRef.current = null;
    };
  }, []);

  const readiness = useMemo(() => [
    { label: "Static PWA", detail: "Mac 关机时仍可打开", done: true },
    { label: "Private data repo", detail: "可见性连接时强制检查", done: true },
    { label: "GitHub authorization", detail: connection ? "当前页面已授权" : "等待最小权限令牌", done: Boolean(connection) },
    { label: "Real sync", detail: connection ? "Quick Capture 已启用" : "连接后写入真实文件", done: Boolean(connection) },
  ], [connection]);

  async function loadRecentCaptures(adapter = adapterRef.current) {
    if (!adapter) return;
    setLoadingCaptures(true);
    setErrorMessage("");
    try {
      let items;
      try {
        items = await adapter.listDirectory("data/captures");
      } catch (error) {
        if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") {
          setRecentCaptures([]);
          return;
        }
        throw error;
      }
      const candidates = items
        .filter((item) => item.type === "file" && item.name.endsWith(".json"))
        .sort((left, right) => right.name.localeCompare(left.name))
        .slice(0, 20);
      const records = await Promise.all(candidates.map(async (item) => {
        try {
          return parseCaptureRecord((await adapter.readText(item.path)).text);
        } catch {
          return null;
        }
      }));
      setRecentCaptures(newestCaptures(records.filter((record): record is CaptureRecord => record !== null)));
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setLoadingCaptures(false);
    }
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!owner.trim() || !repository.trim() || !token || online === false) return;
    setConnecting(true);
    setErrorMessage("");
    setStatusMessage("");
    setSavedCapture(null);
    try {
      const adapter = new GitHubContentsAdapter({
        owner: owner.trim(),
        repository: repository.trim(),
        branch: "main",
        token: token.trim(),
      });
      const repositoryStatus = await adapter.verifyPrivateRepository();
      const descriptor = parseWorkspaceDescriptor((await adapter.readText("workspace.json")).text);
      adapterRef.current = adapter;
      setConnection({
        repository: repositoryStatus.fullName,
        ownerId: descriptor.owner_id,
        ownerLogin: descriptor.owner_login,
        timezone: descriptor.timezone,
      });
      setToken("");
      setStatusMessage("已通过 Private 仓库检查。令牌仅保留在当前页面内存中。");
      await loadRecentCaptures(adapter);
    } catch (error) {
      adapterRef.current = null;
      setConnection(null);
      setErrorMessage(friendlyError(error));
    } finally {
      setConnecting(false);
    }
  }

  function disconnect() {
    adapterRef.current = null;
    setConnection(null);
    setToken("");
    setCapture("");
    setRecentCaptures([]);
    setSavedCapture(null);
    setErrorMessage("");
    setStatusMessage("已断开；当前页面中的令牌和私人内容已清除。");
  }

  async function saveCapture() {
    const adapter = adapterRef.current;
    const text = capture.trim();
    if (!adapter || !connection || !text || saving || online === false) return;
    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");
    const timestamp = new Date().toISOString();
    const timePart = timestamp.replaceAll(/\D/g, "").slice(0, 17);
    const id = `capture_${timePart}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const record = createWorkspaceRecord({
      entityType: "capture",
      id,
      ownerId: connection.ownerId,
      timestamp,
      data: { raw_text: text, status: "inbox" as const },
    });
    const path = recordPath("capture", id);
    try {
      const result = await adapter.writeText({
        path,
        text: serializeRecord(record),
        message: `capture: save ${id}`,
      });
      setCapture("");
      setSavedCapture({ path: result.path, commitSha: result.commitSha, text });
      setRecentCaptures((current) => newestCaptures([record, ...current]));
      setStatusMessage("已保存到 Private 数据仓库，可在其他设备刷新后读取。");
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="preview-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Personal Workspace">
          <span>PW</span>
          <strong>Personal<br />Workspace</strong>
        </a>
        <div className={`network ${online === false ? "offline" : ""}`}>
          <i /> {online === null ? "检测网络" : online ? connection ? "Private repo 已连接" : "GitHub 可连接" : "当前离线"}
        </div>
      </header>

      <section className="hero" id="top">
        <p className="eyebrow">GitHub-backed workspace</p>
        <h1>工作台不再<br />依赖某一台电脑。</h1>
        <p className="lede">公开 Pages 只提供应用外壳；连接后，当前浏览器直接读写你的 Private 数据仓库。令牌不会进入 Git，也不会写入浏览器持久存储。</p>
        <div className="hero-meta">
          <span>Public app</span><span>Private data</span><span>Memory-only token</span>
        </div>
      </section>

      <section className={`connection-card ${connection ? "connected" : ""}`} aria-labelledby="connection-title">
        <div className="connection-copy">
          <p className="eyebrow">Private connection</p>
          <h2 id="connection-title">{connection ? "私人数据已连接" : "连接你的数据仓库"}</h2>
          <p>{connection
            ? `${connection.repository} · Private · ${connection.timezone}`
            : "使用只授权 personal-workspace-data 的 fine-grained token；需要 Metadata 读取和 Contents 读写权限。"}</p>
        </div>
        {connection ? (
          <div className="connection-actions">
            <span className="private-badge">Private verified</span>
            <button className="secondary-button" type="button" onClick={disconnect}>断开并清除</button>
          </div>
        ) : (
          <form className="connection-form" onSubmit={connect}>
            <label>Owner<input value={owner} onChange={(event) => setOwner(event.target.value)} autoCapitalize="none" spellCheck={false} /></label>
            <label>Repository<input value={repository} onChange={(event) => setRepository(event.target.value)} autoCapitalize="none" spellCheck={false} /></label>
            <label className="token-field">Fine-grained token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="new-password" spellCheck={false} placeholder="github_pat_…" /></label>
            <button type="submit" disabled={connecting || online === false || !token}>{connecting ? "正在安全检查…" : "连接 Private 仓库"}</button>
            <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">在 GitHub 创建最小权限令牌 ↗</a>
          </form>
        )}
      </section>

      {(errorMessage || statusMessage) ? (
        <div className={`message-bar ${errorMessage ? "error" : "success"}`} role={errorMessage ? "alert" : "status"}>
          {errorMessage || statusMessage}
        </div>
      ) : null}

      <section className="content-grid">
        <article className="capture-card">
          <div className="card-heading">
            <div><p className="eyebrow">Quick Capture</p><h2>随手记下一件事</h2></div>
            <span className={`memory-pill ${connection ? "live" : ""}`}>{connection ? "保存到 Private GitHub" : "需要先连接"}</span>
          </div>
          <textarea
            value={capture}
            onChange={(event) => setCapture(event.target.value)}
            placeholder={connection ? "任务、想法、提醒，先记下来再整理…" : "连接 Private 数据仓库后即可保存…"}
            maxLength={10_000}
            disabled={!connection || saving}
          />
          <footer>
            <span>{capture.length} / 10,000</span>
            <button type="button" onClick={saveCapture} disabled={!connection || !capture.trim() || saving || online === false}>{saving ? "正在保存…" : "保存 Capture"}</button>
          </footer>
          {savedCapture ? (
            <div className="file-preview">
              <code>{savedCapture.path}</code>
              <p>{savedCapture.text}</p>
              <span className="commit-note">Commit {savedCapture.commitSha.slice(0, 8)} · Private repository</span>
            </div>
          ) : <p className="empty-note">每次保存生成一个开放 JSON 文件和一条 Git 历史记录。</p>}
        </article>

        <aside className="status-card">
          <p className="eyebrow">Live readiness</p>
          <h2>运行状态</h2>
          <ol>
            {readiness.map((item) => (
              <li key={item.label} className={item.done ? "done" : "waiting"}>
                <i>{item.done ? "✓" : "·"}</i>
                <div><strong>{item.label}</strong><span>{item.detail}</span></div>
              </li>
            ))}
          </ol>
          <div className="boundary-note">
            <strong>凭据边界</strong>
            <p>刷新或关闭页面后需要重新输入令牌。断开连接会立即清除当前页面内的令牌和已读取内容。</p>
          </div>
        </aside>
      </section>

      <section className="recent-card" aria-labelledby="recent-title">
        <div className="card-heading">
          <div><p className="eyebrow">Cross-device inbox</p><h2 id="recent-title">最近 Capture</h2></div>
          <button className="secondary-button" type="button" onClick={() => loadRecentCaptures()} disabled={!connection || loadingCaptures}>{loadingCaptures ? "刷新中…" : "从 GitHub 刷新"}</button>
        </div>
        {!connection ? <p className="empty-note">连接后显示 Private 仓库中的最近记录。</p>
          : recentCaptures.length === 0 ? <p className="empty-note">Inbox 还是空的，可以保存第一条记录。</p>
            : <ul className="recent-list">{recentCaptures.map((item) => (
              <li key={item.id}>
                <time dateTime={item.created_at}>{formatCaptureTime(item.created_at)}</time>
                <p>{item.data.raw_text}</p>
                <span>{item.data.status}</span>
              </li>
            ))}</ul>}
      </section>

      <footer className="page-footer">
        <span>Personal Workspace</span>
        <span>GitHub live sync · Phase 1B</span>
      </footer>
    </main>
  );
}
