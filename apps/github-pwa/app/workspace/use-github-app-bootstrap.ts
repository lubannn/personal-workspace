"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

import { GitHubContentsAdapter, GitHubDataError } from "../../../../src/lib/github-data/github-contents";
import {
  DEFAULT_OWNER,
  DEFAULT_REPOSITORY,
  friendlyError,
  openPrivateRepository,
  readCookie,
  type AuthAvailability,
  type Connection,
  type ConnectionMethod,
} from "./page-model";

type AuthStatus = { configured?: boolean; authenticated?: boolean; login?: string | null };
type SessionToken = { accessToken?: string };

type Options = {
  adapterRef: MutableRefObject<GitHubContentsAdapter | null>;
  setConnection: (connection: Connection | null) => void;
  setConnectionMethod: (method: ConnectionMethod | null) => void;
  setAuthAvailability: (availability: AuthAvailability) => void;
  setConnecting: (connecting: boolean) => void;
  setErrorMessage: (message: string) => void;
  setStatusMessage: (message: string) => void;
  loadRecentCaptures: (adapter: GitHubContentsAdapter) => Promise<void>;
  loadDashboardLayout: (adapter: GitHubContentsAdapter, ownerId: string) => Promise<void>;
  loadTasks: (adapter: GitHubContentsAdapter) => Promise<void>;
};

export function useGitHubAppBootstrap(options: Options) {
  const started = useRef(false);
  const { adapterRef, setConnection, setConnectionMethod, setAuthAvailability, setConnecting, setErrorMessage, setStatusMessage, loadRecentCaptures, loadDashboardLayout, loadTasks } = options;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const authResult = new URLSearchParams(window.location.search).get("auth");

    async function bootstrap() {
      try {
        await Promise.resolve();
        if (authResult === "denied") setErrorMessage("GitHub 登录已取消，私人数据没有被授权。");
        if (authResult === "failed") setErrorMessage("GitHub 登录没有完成，请稍后重试。");
        const statusResponse = await fetch("/auth/status", { credentials: "same-origin", headers: { accept: "application/json" } });
        if (!statusResponse.ok) { setAuthAvailability("unavailable"); return; }
        const status = (await statusResponse.json()) as AuthStatus;
        if (!status.configured) { setAuthAvailability("unavailable"); return; }
        setAuthAvailability("configured");
        if (!status.authenticated) return;
        const csrf = readCookie("__Host-pw_csrf");
        if (!csrf) { setErrorMessage("登录会话缺少安全校验信息，请重新使用 GitHub 登录。"); return; }
        setConnecting(true);
        const tokenResponse = await fetch("/auth/token", { method: "POST", credentials: "same-origin", headers: { accept: "application/json", "x-pw-csrf": csrf } });
        if (!tokenResponse.ok) { setErrorMessage("GitHub 登录会话已失效，请重新登录。"); return; }
        const sessionToken = (await tokenResponse.json()) as SessionToken;
        if (!sessionToken.accessToken) throw new Error("MissingSessionAccessToken");
        const opened = await openPrivateRepository(sessionToken.accessToken, DEFAULT_OWNER, DEFAULT_REPOSITORY);
        adapterRef.current = opened.adapter;
        setConnection(opened.connection);
        setConnectionMethod("github-app");
        setStatusMessage(`已通过 GitHub App 登录${status.login ? `（${status.login}）` : ""}，访问令牌仅保留在当前页面内存中。`);
        await Promise.all([loadRecentCaptures(opened.adapter), loadDashboardLayout(opened.adapter, opened.connection.ownerId), loadTasks(opened.adapter)]);
      } catch (error) {
        adapterRef.current = null;
        setConnection(null);
        setConnectionMethod(null);
        setErrorMessage(error instanceof GitHubDataError ? friendlyError(error) : "GitHub 登录会话连接失败，请重新登录。");
      } finally {
        setConnecting(false);
        if (authResult) window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
      }
    }

    void bootstrap();
  }, [adapterRef, loadDashboardLayout, loadRecentCaptures, loadTasks, setAuthAvailability, setConnecting, setConnection, setConnectionMethod, setErrorMessage, setStatusMessage]);
}
