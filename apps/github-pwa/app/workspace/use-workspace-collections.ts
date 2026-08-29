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
import { parseProjectRecord } from "../../../../src/lib/github-data/projects";
import { parseProjectPhaseRecord } from "../../../../src/lib/github-data/project-phases";
import { parseMilestoneRecord } from "../../../../src/lib/github-data/milestones";
import { parseProjectNoteRecord } from "../../../../src/lib/github-data/project-notes";
import { parseActivityEventRecord } from "../../../../src/lib/github-data/activity-events";
import { parseCaptureRecord } from "../../../../src/lib/github-data/workspace";
import { friendlyError, type SyncedActivityEvent, type SyncedCapture, type SyncedMilestone, type SyncedProject, type SyncedProjectNote, type SyncedProjectPhase, type SyncedTask } from "./page-model";

type Options = {
  adapterRef: MutableRefObject<GitHubContentsAdapter | null>;
  setErrorMessage: (message: string) => void;
  setDashboardClean: () => void;
};

export function useWorkspaceCollections({ adapterRef, setErrorMessage, setDashboardClean }: Options) {
  const [captureFiles, setCaptureFiles] = useState<SyncedCapture[]>([]);
  const [taskFiles, setTaskFiles] = useState<SyncedTask[]>([]);
  const [projectFiles, setProjectFiles] = useState<SyncedProject[]>([]);
  const [projectPhaseFiles, setProjectPhaseFiles] = useState<SyncedProjectPhase[]>([]);
  const [milestoneFiles, setMilestoneFiles] = useState<SyncedMilestone[]>([]);
  const [projectNoteFiles, setProjectNoteFiles] = useState<SyncedProjectNote[]>([]);
  const [activityEventFiles, setActivityEventFiles] = useState<SyncedActivityEvent[]>([]);
  const [dashboardLayout, setDashboardLayout] = useState<DashboardLayout | null>(null);
  const [dashboardBlobSha, setDashboardBlobSha] = useState<string | null>(null);
  const [loadingCaptures, setLoadingCaptures] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingProjectPhases, setLoadingProjectPhases] = useState(false);
  const [loadingMilestones, setLoadingMilestones] = useState(false);
  const [loadingProjectNotes, setLoadingProjectNotes] = useState(false);
  const [loadingActivityEvents, setLoadingActivityEvents] = useState(false);
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

  const loadProjects = useCallback(async (adapter = adapterRef.current) => {
    if (!adapter) return;
    setLoadingProjects(true);
    setErrorMessage("");
    try {
      let items;
      try {
        items = await adapter.listDirectory("data/projects");
      } catch (error) {
        if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") {
          setProjectFiles([]);
          return;
        }
        throw error;
      }
      const candidates = items
        .filter((item) => item.type === "file" && item.name.endsWith(".json"))
        .sort((left, right) => right.name.localeCompare(left.name));
      const records: SyncedProject[] = [];
      const batchSize = 6;
      for (let index = 0; index < candidates.length; index += batchSize) {
        records.push(...(await Promise.all(candidates.slice(index, index + batchSize).map(async (item) => {
          try {
            const file = await adapter.readText(item.path);
            return { record: parseProjectRecord(file.text), path: file.path, blobSha: file.blobSha };
          } catch {
            return null;
          }
        }))).filter((item): item is SyncedProject => item !== null));
      }
      setProjectFiles(records);
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setLoadingProjects(false);
    }
  }, [adapterRef, setErrorMessage]);

  const loadProjectPhases = useCallback(async (adapter = adapterRef.current) => {
    if (!adapter) return;
    setLoadingProjectPhases(true);
    setErrorMessage("");
    try {
      let items;
      try {
        items = await adapter.listDirectory("data/project-phases");
      } catch (error) {
        if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") {
          setProjectPhaseFiles([]);
          return;
        }
        throw error;
      }
      const candidates = items
        .filter((item) => item.type === "file" && item.name.endsWith(".json"))
        .sort((left, right) => right.name.localeCompare(left.name));
      const records: SyncedProjectPhase[] = [];
      const batchSize = 6;
      for (let index = 0; index < candidates.length; index += batchSize) {
        records.push(...(await Promise.all(candidates.slice(index, index + batchSize).map(async (item) => {
          try {
            const file = await adapter.readText(item.path);
            return { record: parseProjectPhaseRecord(file.text), path: file.path, blobSha: file.blobSha };
          } catch {
            return null;
          }
        }))).filter((item): item is SyncedProjectPhase => item !== null));
      }
      setProjectPhaseFiles(records);
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setLoadingProjectPhases(false);
    }
  }, [adapterRef, setErrorMessage]);

  const loadMilestones = useCallback(async (adapter = adapterRef.current) => {
    if (!adapter) return;
    setLoadingMilestones(true);
    setErrorMessage("");
    try {
      let items;
      try {
        items = await adapter.listDirectory("data/milestones");
      } catch (error) {
        if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") {
          setMilestoneFiles([]);
          return;
        }
        throw error;
      }
      const candidates = items
        .filter((item) => item.type === "file" && item.name.endsWith(".json"))
        .sort((left, right) => right.name.localeCompare(left.name));
      const records: SyncedMilestone[] = [];
      const batchSize = 6;
      for (let index = 0; index < candidates.length; index += batchSize) {
        records.push(...(await Promise.all(candidates.slice(index, index + batchSize).map(async (item) => {
          try {
            const file = await adapter.readText(item.path);
            return { record: parseMilestoneRecord(file.text), path: file.path, blobSha: file.blobSha };
          } catch {
            return null;
          }
        }))).filter((item): item is SyncedMilestone => item !== null));
      }
      setMilestoneFiles(records);
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setLoadingMilestones(false);
    }
  }, [adapterRef, setErrorMessage]);

  const loadProjectNotes = useCallback(async (adapter = adapterRef.current) => {
    if (!adapter) return;
    setLoadingProjectNotes(true);
    setErrorMessage("");
    try {
      let items;
      try {
        items = await adapter.listDirectory("data/project-notes");
      } catch (error) {
        if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") {
          setProjectNoteFiles([]);
          return;
        }
        throw error;
      }
      const candidates = items
        .filter((item) => item.type === "file" && item.name.endsWith(".json"))
        .sort((left, right) => right.name.localeCompare(left.name));
      const records: SyncedProjectNote[] = [];
      const batchSize = 6;
      for (let index = 0; index < candidates.length; index += batchSize) {
        records.push(...(await Promise.all(candidates.slice(index, index + batchSize).map(async (item) => {
          try {
            const file = await adapter.readText(item.path);
            return { record: parseProjectNoteRecord(file.text), path: file.path, blobSha: file.blobSha };
          } catch {
            return null;
          }
        }))).filter((item): item is SyncedProjectNote => item !== null));
      }
      setProjectNoteFiles(records);
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setLoadingProjectNotes(false);
    }
  }, [adapterRef, setErrorMessage]);

  const loadActivityEvents = useCallback(async (adapter = adapterRef.current) => {
    if (!adapter) return;
    setLoadingActivityEvents(true);
    setErrorMessage("");
    try {
      let items;
      try {
        items = await adapter.listDirectory("data/activity-events");
      } catch (error) {
        if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") {
          setActivityEventFiles([]);
          return;
        }
        throw error;
      }
      const candidates = items
        .filter((item) => item.type === "file" && item.name.endsWith(".json"))
        .sort((left, right) => right.name.localeCompare(left.name));
      const records: SyncedActivityEvent[] = [];
      const batchSize = 6;
      for (let index = 0; index < candidates.length; index += batchSize) {
        records.push(...(await Promise.all(candidates.slice(index, index + batchSize).map(async (item) => {
          try {
            const file = await adapter.readText(item.path);
            return { record: parseActivityEventRecord(file.text), path: file.path, blobSha: file.blobSha };
          } catch {
            return null;
          }
        }))).filter((item): item is SyncedActivityEvent => item !== null));
      }
      setActivityEventFiles(records);
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setLoadingActivityEvents(false);
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
    setProjectFiles([]);
    setProjectPhaseFiles([]);
    setMilestoneFiles([]);
    setProjectNoteFiles([]);
    setActivityEventFiles([]);
    setDashboardLayout(null);
    setDashboardBlobSha(null);
  }

  return {
    captureFiles,
    setCaptureFiles,
    taskFiles,
    setTaskFiles,
    projectFiles,
    setProjectFiles,
    projectPhaseFiles,
    setProjectPhaseFiles,
    milestoneFiles,
    setMilestoneFiles,
    projectNoteFiles,
    setProjectNoteFiles,
    activityEventFiles,
    setActivityEventFiles,
    dashboardLayout,
    setDashboardLayout,
    dashboardBlobSha,
    setDashboardBlobSha,
    loadingCaptures,
    loadingTasks,
    loadingProjects,
    loadingProjectPhases,
    loadingMilestones,
    loadingProjectNotes,
    loadingActivityEvents,
    loadingDashboard,
    loadRecentCaptures,
    loadTasks,
    loadProjects,
    loadProjectPhases,
    loadMilestones,
    loadProjectNotes,
    loadActivityEvents,
    loadDashboardLayout,
    clearCollections,
  };
}
