"use client";

import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { GitHubContentsAdapter, GitHubDataError } from "../../../src/lib/github-data/github-contents";
import {
  buildPortableWorkspaceExport,
  inspectPortableWorkspaceExport,
  serializePortableWorkspaceExport,
  type ExportInspectionIssue,
} from "../../../src/lib/github-data/portable-export";
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

type AuthAvailability = "checking" | "unavailable" | "configured";
type ConnectionMethod = "github-app" | "personal-token";

type AuthStatus = {
  configured?: boolean;
  authenticated?: boolean;
  login?: string | null;
};

type SessionToken = {
  accessToken?: string;
};

type PortabilityResult = {
  fileName: string;
  valid: boolean;
  files: number;
  captures: number;
  errors: ExportInspectionIssue[];
  warnings: ExportInspectionIssue[];
};

const DEFAULT_OWNER = "lubannn";
const DEFAULT_REPOSITORY = "personal-workspace-data";

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const entry = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
}

async function openPrivateRepository(rawToken: string, owner: string, repository: string) {
  const adapter = new GitHubContentsAdapter({
    owner: owner.trim(),
    repository: repository.trim(),
    branch: "main",
    token: rawToken.trim(),
  });
  const repositoryStatus = await adapter.verifyPrivateRepository();
  const descriptor = parseWorkspaceDescriptor((await adapter.readText("workspace.json")).text);
  return {
    adapter,
    connection: {
      repository: repositoryStatus.fullName,
      ownerId: descriptor.owner_id,
      ownerLogin: descriptor.owner_login,
      timezone: descriptor.timezone,
    } satisfies Connection,
  };
}

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
  const authBootstrapStarted = useRef(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [owner, setOwner] = useState(DEFAULT_OWNER);
  const [repository, setRepository] = useState(DEFAULT_REPOSITORY);
  const [token, setToken] = useState("");
  const [connection, setConnection] = useState<Connection | null>(null);
  const [connectionMethod, setConnectionMethod] = useState<ConnectionMethod | null>(null);
  const [authAvailability, setAuthAvailability] = useState<AuthAvailability>("checking");
  const [connecting, setConnecting] = useState(false);
  const [loadingCaptures, setLoadingCaptures] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const [checkingRestore, setCheckingRestore] = useState(false);
  const [confirmingRevokeAll, setConfirmingRevokeAll] = useState(false);
  const [revokingAll, setRevokingAll] = useState(false);
  const [capture, setCapture] = useState("");
  const [recentCaptures, setRecentCaptures] = useState<CaptureRecord[]>([]);
  const [savedCapture, setSavedCapture] = useState<SavedCapture | null>(null);
  const [exportResult, setExportResult] = useState<PortabilityResult | null>(null);
  const [restoreResult, setRestoreResult] = useState<PortabilityResult | null>(null);
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

  useEffect(() => {
    if (authBootstrapStarted.current) return;
    authBootstrapStarted.current = true;

    const authResult = new URLSearchParams(window.location.search).get("auth");

    async function bootstrapGitHubAppSession() {
      try {
        await Promise.resolve();
        if (authResult === "denied") setErrorMessage("GitHub 登录已取消，私人数据没有被授权。");
        if (authResult === "failed") setErrorMessage("GitHub 登录没有完成，请稍后重试。");

        const statusResponse = await fetch("/auth/status", {
          credentials: "same-origin",
          headers: { accept: "application/json" },
        });
        if (!statusResponse.ok) {
          setAuthAvailability("unavailable");
          return;
        }
        const status = (await statusResponse.json()) as AuthStatus;
        if (!status.configured) {
          setAuthAvailability("unavailable");
          return;
        }
        setAuthAvailability("configured");
        if (!status.authenticated) return;

        const csrf = readCookie("__Host-pw_csrf");
        if (!csrf) {
          setErrorMessage("登录会话缺少安全校验信息，请重新使用 GitHub 登录。");
          return;
        }

        setConnecting(true);
        const tokenResponse = await fetch("/auth/token", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            accept: "application/json",
            "x-pw-csrf": csrf,
          },
        });
        if (!tokenResponse.ok) {
          setErrorMessage("GitHub 登录会话已失效，请重新登录。");
          return;
        }
        const sessionToken = (await tokenResponse.json()) as SessionToken;
        if (!sessionToken.accessToken) throw new Error("MissingSessionAccessToken");

        const opened = await openPrivateRepository(
          sessionToken.accessToken,
          DEFAULT_OWNER,
          DEFAULT_REPOSITORY,
        );
        adapterRef.current = opened.adapter;
        setConnection(opened.connection);
        setConnectionMethod("github-app");
        setStatusMessage(`已通过 GitHub App 登录${status.login ? `（${status.login}）` : ""}，访问令牌仅保留在当前页面内存中。`);
        await loadRecentCaptures(opened.adapter);
      } catch (error) {
        adapterRef.current = null;
        setConnection(null);
        setConnectionMethod(null);
        setErrorMessage(error instanceof GitHubDataError ? friendlyError(error) : "GitHub 登录会话连接失败，请重新登录。");
      } finally {
        setConnecting(false);
        if (authResult) {
          window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
        }
      }
    }

    void bootstrapGitHubAppSession();
  }, []);

  const readiness = useMemo(() => [
    { label: "Static PWA", detail: "Mac 关机时仍可打开", done: true },
    { label: "Private data repo", detail: "可见性连接时强制检查", done: true },
    { label: "GitHub authorization", detail: connection ? (connectionMethod === "github-app" ? "GitHub App 会话已授权" : "当前页面已授权") : authAvailability === "configured" ? "等待 GitHub 登录" : "等待最小权限令牌", done: Boolean(connection) },
    { label: "Real sync", detail: connection ? "Quick Capture 已启用" : "连接后写入真实文件", done: Boolean(connection) },
  ], [authAvailability, connection, connectionMethod]);

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
      const opened = await openPrivateRepository(token, owner, repository);
      adapterRef.current = opened.adapter;
      setConnection(opened.connection);
      setConnectionMethod("personal-token");
      setToken("");
      setStatusMessage("已通过 Private 仓库检查。令牌仅保留在当前页面内存中。");
      await loadRecentCaptures(opened.adapter);
    } catch (error) {
      adapterRef.current = null;
      setConnection(null);
      setConnectionMethod(null);
      setErrorMessage(friendlyError(error));
    } finally {
      setConnecting(false);
    }
  }

  function clearConnection(message: string) {
    adapterRef.current = null;
    setConnection(null);
    setConnectionMethod(null);
    setToken("");
    setCapture("");
    setRecentCaptures([]);
    setSavedCapture(null);
    setExportResult(null);
    setRestoreResult(null);
    setExportProgress("");
    setConfirmingRevokeAll(false);
    setErrorMessage("");
    setStatusMessage(message);
  }

  async function disconnect() {
    if (connectionMethod === "github-app") {
      const csrf = readCookie("__Host-pw_csrf");
      if (csrf) {
        try {
          await fetch("/auth/logout", {
            method: "POST",
            credentials: "same-origin",
            headers: { "x-pw-csrf": csrf },
          });
        } catch {
          // Local credentials are still cleared even if the network logout cannot complete.
        }
      }
    }
    clearConnection("已退出当前设备；页面中的令牌和私人内容已清除。");
  }

  async function revokeAllSessions() {
    if (connectionMethod !== "github-app" || revokingAll) return;
    const csrf = readCookie("__Host-pw_csrf");
    if (!csrf) {
      setConfirmingRevokeAll(false);
      setErrorMessage("登录会话缺少安全校验信息，请刷新页面后重试。");
      return;
    }

    setRevokingAll(true);
    setErrorMessage("");
    try {
      const response = await fetch("/auth/logout-all", {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-pw-csrf": csrf },
      });
      if (!response.ok) throw new Error("SessionRevocationFailed");
      clearConnection("已撤销全部设备会话；所有设备需要重新使用 GitHub 登录。");
    } catch {
      setErrorMessage("无法撤销全部设备会话，请稍后重试。");
    } finally {
      setRevokingAll(false);
    }
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

  async function listCaptureFiles(adapter: GitHubContentsAdapter) {
    try {
      return (await adapter.listDirectory("data/captures"))
        .filter((item) => item.type === "file" && item.name.endsWith(".json"))
        .sort((left, right) => left.path.localeCompare(right.path));
    } catch (error) {
      if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return [];
      throw error;
    }
  }

  async function downloadPortableExport() {
    const adapter = adapterRef.current;
    if (!adapter || !connection || exporting || online === false) return;
    setExporting(true);
    setExportResult(null);
    setErrorMessage("");
    setStatusMessage("");
    try {
      setExportProgress("正在读取 workspace.json…");
      const workspaceFile = await adapter.readText("workspace.json");
      const candidates = await listCaptureFiles(adapter);
      const captureFiles = [];
      const batchSize = 6;
      for (let index = 0; index < candidates.length; index += batchSize) {
        setExportProgress(`正在读取 Capture ${Math.min(index + batchSize, candidates.length)} / ${candidates.length}…`);
        captureFiles.push(...await Promise.all(
          candidates.slice(index, index + batchSize).map((item) => adapter.readText(item.path)),
        ));
      }

      setExportProgress("正在生成 SHA-256 manifest…");
      const generatedAt = new Date().toISOString();
      const portableExport = await buildPortableWorkspaceExport({
        repository: connection.repository,
        branch: "main",
        workspaceFile,
        captureFiles,
        generatedAt,
      });
      const inspection = await inspectPortableWorkspaceExport(portableExport);
      const compactTime = generatedAt.replaceAll(/\D/g, "").slice(0, 14);
      const fileName = `personal-workspace-export-${compactTime}.json`;
      const blob = new Blob([serializePortableWorkspaceExport(portableExport)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportResult({
        fileName,
        valid: inspection.valid,
        files: inspection.counts.files,
        captures: inspection.counts.captures,
        errors: inspection.errors,
        warnings: inspection.warnings,
      });
      setStatusMessage(inspection.valid
        ? "开放 JSON 导出已下载，并已通过恢复预检。"
        : "导出已下载，但预检发现异常；请先保留文件并查看下方诊断。");
    } catch (error) {
      setErrorMessage(error instanceof GitHubDataError ? friendlyError(error) : "无法生成导出，请稍后重试。");
    } finally {
      setExporting(false);
      setExportProgress("");
    }
  }

  async function preflightRestore(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || checkingRestore) return;
    setCheckingRestore(true);
    setRestoreResult(null);
    try {
      if (file.size > 50 * 1024 * 1024) {
        setRestoreResult({
          fileName: file.name,
          valid: false,
          files: 0,
          captures: 0,
          errors: [{ code: "EXPORT_TOO_LARGE", message: "当前预检仅接受 50 MB 以内的 JSON 文件。" }],
          warnings: [],
        });
        return;
      }
      const inspection = await inspectPortableWorkspaceExport(JSON.parse(await file.text()) as unknown);
      setRestoreResult({
        fileName: file.name,
        valid: inspection.valid,
        files: inspection.counts.files,
        captures: inspection.counts.captures,
        errors: inspection.errors,
        warnings: inspection.warnings,
      });
    } catch {
      setRestoreResult({
        fileName: file.name,
        valid: false,
        files: 0,
        captures: 0,
        errors: [{ code: "INVALID_JSON", message: "文件不是有效的 JSON，未执行任何恢复操作。" }],
        warnings: [],
      });
    } finally {
      setCheckingRestore(false);
    }
  }

  function renderPortabilityResult(result: PortabilityResult) {
    return (
      <div className={`portability-result ${result.valid ? "valid" : "invalid"}`} role="status">
        <strong>{result.valid ? "预检通过" : "预检未通过"}</strong>
        <span>{result.fileName}</span>
        <p>{result.files} 个文件 · {result.captures} 条 Capture</p>
        {result.errors.length > 0 ? (
          <ul>{result.errors.slice(0, 5).map((issue, index) => (
            <li key={`${issue.code}-${issue.path ?? index}`}>{issue.path ? `${issue.path}：` : ""}{issue.message}</li>
          ))}</ul>
        ) : null}
        {result.warnings.length > 0 ? (
          <ul>{result.warnings.slice(0, 3).map((issue, index) => (
            <li key={`${issue.code}-${index}`}>{issue.message}</li>
          ))}</ul>
        ) : null}
      </div>
    );
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
            : authAvailability === "configured"
              ? "使用 GitHub App 登录；访问令牌只进入当前页面内存。也可继续使用 fine-grained token 作为备用方式。"
              : "使用只授权 personal-workspace-data 的 fine-grained token；需要 Metadata 读取和 Contents 读写权限。"}</p>
        </div>
        {connection ? (
          <div className="connection-actions">
            <span className="private-badge">Private verified</span>
            <button className="secondary-button" type="button" onClick={disconnect} disabled={revokingAll}>
              {connectionMethod === "github-app" ? "退出当前设备" : "断开并清除"}
            </button>
            {connectionMethod === "github-app" ? confirmingRevokeAll ? (
              <div className="revoke-confirm" role="group" aria-label="确认撤销全部设备">
                <span>所有设备都需要重新登录。</span>
                <button className="danger-button" type="button" onClick={revokeAllSessions} disabled={revokingAll}>
                  {revokingAll ? "正在撤销…" : "确认撤销全部设备"}
                </button>
                <button className="secondary-button" type="button" onClick={() => setConfirmingRevokeAll(false)} disabled={revokingAll}>取消</button>
              </div>
            ) : (
              <button className="danger-outline-button" type="button" onClick={() => setConfirmingRevokeAll(true)}>撤销全部设备</button>
            ) : null}
          </div>
        ) : (
          <form className="connection-form" onSubmit={connect}>
            {authAvailability === "configured" ? (
              <a className="github-login-button" href="/auth/login">使用 GitHub 登录</a>
            ) : authAvailability === "checking" ? (
              <span className="auth-checking">正在检查 GitHub App 登录…</span>
            ) : null}
            <label>Owner<input value={owner} onChange={(event) => setOwner(event.target.value)} autoCapitalize="none" spellCheck={false} /></label>
            <label>Repository<input value={repository} onChange={(event) => setRepository(event.target.value)} autoCapitalize="none" spellCheck={false} /></label>
            <label className="token-field">Fine-grained token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="new-password" spellCheck={false} placeholder="github_pat_…" /></label>
            <button type="submit" disabled={connecting || online === false || !token}>{connecting ? "正在安全检查…" : "使用 Token 连接"}</button>
            <a className="token-help" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">在 GitHub 创建备用最小权限令牌 ↗</a>
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
            <p>{connectionMethod === "github-app"
              ? "页面刷新时会由服务端登录会话换取新的短期访问令牌；令牌只进入当前页面内存。断开连接会撤销本设备会话并清除已读取内容。"
              : "手动 Token 在刷新或关闭页面后需要重新输入。断开连接会立即清除当前页面内的令牌和已读取内容。"}</p>
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

      <section className="portability-card" aria-labelledby="portability-title">
        <div className="card-heading">
          <div><p className="eyebrow">Phase 1C · Data portability</p><h2 id="portability-title">导出与恢复预检</h2></div>
          <span className={`memory-pill ${connection ? "live" : ""}`}>{connection ? "Private 数据已就绪" : "连接后可导出"}</span>
        </div>
        <div className="portability-grid">
          <article>
            <span className="step-number">01</span>
            <h3>下载开放数据包</h3>
            <p>读取 workspace.json 和全部 Capture，生成带 SHA-256、Git blob SHA、文件数量与 schema 版本的 JSON。</p>
            <button className="primary-button" type="button" onClick={downloadPortableExport} disabled={!connection || exporting || online === false}>
              {exporting ? exportProgress || "正在生成…" : "导出并下载 JSON"}
            </button>
            {exportResult ? renderPortabilityResult(exportResult) : null}
          </article>
          <article>
            <span className="step-number">02</span>
            <h3>只读恢复预检</h3>
            <p>在当前浏览器校验文件版本、所有者、路径、数量和哈希。本阶段不会上传，也不会写入或覆盖 GitHub。</p>
            <label className={`file-picker ${checkingRestore ? "disabled" : ""}`}>
              {checkingRestore ? "正在检查…" : "选择 JSON 导出文件"}
              <input type="file" accept="application/json,.json" onChange={preflightRestore} disabled={checkingRestore} />
            </label>
            {restoreResult ? renderPortabilityResult(restoreResult) : null}
          </article>
        </div>
        <div className="portability-boundary">
          <strong>当前安全边界</strong>
          <p>导出包含你的私人正文，请自行安全保存。本轮恢复只做预检；真正写回空仓库将在独立确认和冲突保护完成后开放。</p>
        </div>
      </section>

      <footer className="page-footer">
        <span>Personal Workspace</span>
        <span>GitHub live sync · Phase 1C</span>
      </footer>
    </main>
  );
}
