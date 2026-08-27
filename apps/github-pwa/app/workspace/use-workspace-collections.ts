"use client";

import { useCallback, useState, type MutableRefObject } from "react";

import { GitHubContentsAdapter, GitHubDataError } from "../../../../src/lib/github-data/github-contents";
import {
  DASHBOARD_LAYOUT_PATH,
  createDefaultDashboardLayout,
  parseDashboardLayout,
  type DashboardLayout,
} from "../../../../src/lib/github-data/dashboard-layout";
import { parseTaskRecord } from "../../../../src/lib/github-data/tasks";
import { parseCaptureRecord } from "../../../../src/lib/github-data/workspace";
import { friendlyError, type SyncedCapture, type SyncedTask } from "./page-model";

type Options = {
  adapterRef: MutableRefObject<GitHubContentsAdapter | null>;
  setErrorMessage: (message: string) => void;
  setDashboardClean: () => void;
};

export function useWorkspaceCollections({ adapterRef, setErrorMessage, setDashboardClean }: Options) {
  const [captureFiles, setCaptureFiles] = useState<SyncedCapture[]>([]);
  const [taskFiles, setTaskFiles] = useState<SyncedTask[]>([]);
  const [dashboardLayout, setDashboardLayout] = useState<DashboardLayout | null>(null);
  const [dashboardBlobSha, setDashboardBlobSha] = useState<string | null>(null);
  const [loadingCaptures, setLoadingCaptures] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingDashboard, setLoadingDashboard] = useState(false);

  const loadRecentCaptures = useCallback(async (adapter = adapterRef.current) => {
    if (!adapter) return;
    setLoadingCaptures(true);
    setErrorMessage("");
    try {
      let items;
      try {
        items = await adapter.listDirectory("data/captures");
      } catch (error) {
        if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") {
          setCaptureFiles([]);
          return;
        }
        throw error;
      }
      const candidates = items
        .filter((item) => item.type === "file" && item.name.endsWith(".json"))
        .sort((left, right) => right.name.localeCompare(left.name));
      const records: SyncedCapture[] = [];
      const batchSize = 6;
      for (let index = 0; index < candidates.length; index += batchSize) {
        records.push(...(await Promise.all(candidates.slice(index, index + batchSize).map(async (item) => {
          try {
            const file = await adapter.readText(item.path);
            return { record: parseCaptureRecord(file.text), path: file.path, blobSha: file.blobSha };
          } catch {
            return null;
          }
        }))).filter((item): item is SyncedCapture => item !== null));
      }
      setCaptureFiles(records);
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setLoadingCaptures(false);
    }
  }, [adapterRef, setErrorMessage]);

  const loadTasks = useCallback(async (adapter = adapterRef.current) => {
    if (!adapter) return;
    setLoadingTasks(true);
    setErrorMessage("");
    try {
      let items;
      try {
        items = await adapter.listDirectory("data/tasks");
      } catch (error) {
        if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") {
          setTaskFiles([]);
          return;
        }
        throw error;
      }
      const candidates = items
        .filter((item) => item.type === "file" && item.name.endsWith(".json"))
        .sort((left, right) => right.name.localeCompare(left.name));
      const records: SyncedTask[] = [];
      const batchSize = 6;
      for (let index = 0; index < candidates.length; index += batchSize) {
        records.push(...(await Promise.all(candidates.slice(index, index + batchSize).map(async (item) => {
          try {
            const file = await adapter.readText(item.path);
            return { record: parseTaskRecord(file.text), path: file.path, blobSha: file.blobSha };
          } catch {
            return null;
          }
        }))).filter((item): item is SyncedTask => item !== null));
      }
      setTaskFiles(records);
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setLoadingTasks(false);
    }
  }, [adapterRef, setErrorMessage]);

  const loadDashboardLayout = useCallback(async (
    adapter = adapterRef.current,
    ownerId?: string,
  ) => {
    if (!adapter || !ownerId) return;
    setLoadingDashboard(true);
    setErrorMessage("");
    try {
      const file = await adapter.readText(DASHBOARD_LAYOUT_PATH);
      const layout = parseDashboardLayout(file.text);
      if (layout.owner_id !== ownerId) throw new Error("DASHBOARD_OWNER_MISMATCH");
      setDashboardLayout(layout);
      setDashboardBlobSha(file.blobSha);
      setDashboardClean();
    } catch (error) {
      if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") {
        setDashboardLayout(createDefaultDashboardLayout(ownerId));
        setDashboardBlobSha(null);
        setDashboardClean();
        return;
      }
      setErrorMessage(error instanceof Error && error.message === "DASHBOARD_OWNER_MISMATCH"
        ? "Dashboard 布局的 owner 与当前 workspace 不一致，已停止读取。"
        : friendlyError(error));
    } finally {
      setLoadingDashboard(false);
    }
  }, [adapterRef, setDashboardClean, setErrorMessage]);

  function clearCollections() {
    setCaptureFiles([]);
    setTaskFiles([]);
    setDashboardLayout(null);
    setDashboardBlobSha(null);
  }

  return {
    captureFiles,
    setCaptureFiles,
    taskFiles,
    setTaskFiles,
    dashboardLayout,
    setDashboardLayout,
    dashboardBlobSha,
    setDashboardBlobSha,
    loadingCaptures,
    loadingTasks,
    loadingDashboard,
    loadRecentCaptures,
    loadTasks,
    loadDashboardLayout,
    clearCollections,
  };
}
