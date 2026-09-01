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
import { parseTimeEntryRecord } from "../../../../src/lib/github-data/time-entries";
import { parseProjectRecord } from "../../../../src/lib/github-data/projects";
import { parseProjectPhaseRecord } from "../../../../src/lib/github-data/project-phases";
import { parseMilestoneRecord } from "../../../../src/lib/github-data/milestones";
import { parseProjectNoteRecord } from "../../../../src/lib/github-data/project-notes";
import { parseProjectFileReferenceRecord } from "../../../../src/lib/github-data/project-file-references";
import { parseActivityEventRecord } from "../../../../src/lib/github-data/activity-events";
import { parseCalendarEventRecord } from "../../../../src/lib/github-data/calendar-events";
import { parseReportDraftRecord } from "../../../../src/lib/github-data/report-drafts";
import { parseJournalEntryRecord } from "../../../../src/lib/github-data/journal-entries";
import { parseJournalSegmentRecord } from "../../../../src/lib/github-data/journal-segments";
import { parseJournalRevisionRecord } from "../../../../src/lib/github-data/journal-revisions";
import { parseJournalImportCheckpointRecord } from "../../../../src/lib/github-data/journal-import-checkpoints";
import { parseCaptureRecord } from "../../../../src/lib/github-data/workspace";
import { friendlyError, type SyncedActivityEvent, type SyncedCalendarEvent, type SyncedCapture, type SyncedJournalEntry, type SyncedJournalImportCheckpoint, type SyncedJournalRevision, type SyncedJournalSegment, type SyncedMilestone, type SyncedProject, type SyncedProjectFileReference, type SyncedProjectNote, type SyncedProjectPhase, type SyncedReportDraft, type SyncedTask, type SyncedTimeEntry } from "./page-model";

type Options = {
  adapterRef: MutableRefObject<GitHubContentsAdapter | null>;
  setErrorMessage: (message: string) => void;
  setDashboardClean: () => void;
};

export function useWorkspaceCollections({ adapterRef, setErrorMessage, setDashboardClean }: Options) {
  const [captureFiles, setCaptureFiles] = useState<SyncedCapture[]>([]);
  const [taskFiles, setTaskFiles] = useState<SyncedTask[]>([]);
  const [timeEntryFiles, setTimeEntryFiles] = useState<SyncedTimeEntry[]>([]);
  const [projectFiles, setProjectFiles] = useState<SyncedProject[]>([]);
  const [projectPhaseFiles, setProjectPhaseFiles] = useState<SyncedProjectPhase[]>([]);
  const [milestoneFiles, setMilestoneFiles] = useState<SyncedMilestone[]>([]);
  const [projectNoteFiles, setProjectNoteFiles] = useState<SyncedProjectNote[]>([]);
  const [projectFileReferenceFiles, setProjectFileReferenceFiles] = useState<SyncedProjectFileReference[]>([]);
  const [activityEventFiles, setActivityEventFiles] = useState<SyncedActivityEvent[]>([]);
  const [calendarEventFiles, setCalendarEventFiles] = useState<SyncedCalendarEvent[]>([]);
  const [reportDraftFiles, setReportDraftFiles] = useState<SyncedReportDraft[]>([]);
  const [journalEntryFiles, setJournalEntryFiles] = useState<SyncedJournalEntry[]>([]);
  const [journalSegmentFiles, setJournalSegmentFiles] = useState<SyncedJournalSegment[]>([]);
  const [journalRevisionFiles, setJournalRevisionFiles] = useState<SyncedJournalRevision[]>([]);
  const [journalImportCheckpointFiles, setJournalImportCheckpointFiles] = useState<SyncedJournalImportCheckpoint[]>([]);
  const [dashboardLayout, setDashboardLayout] = useState<DashboardLayout | null>(null);
  const [dashboardBlobSha, setDashboardBlobSha] = useState<string | null>(null);
  const [loadingCaptures, setLoadingCaptures] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingTimeEntries, setLoadingTimeEntries] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingProjectPhases, setLoadingProjectPhases] = useState(false);
  const [loadingMilestones, setLoadingMilestones] = useState(false);
  const [loadingProjectNotes, setLoadingProjectNotes] = useState(false);
  const [loadingProjectFileReferences, setLoadingProjectFileReferences] = useState(false);
  const [loadingActivityEvents, setLoadingActivityEvents] = useState(false);
  const [loadingCalendarEvents, setLoadingCalendarEvents] = useState(false);
  const [loadingReportDrafts, setLoadingReportDrafts] = useState(false);
  const [loadingJournalEntries, setLoadingJournalEntries] = useState(false);
  const [loadingJournalSegments, setLoadingJournalSegments] = useState(false);
  const [loadingJournalRevisions, setLoadingJournalRevisions] = useState(false);
  const [loadingJournalImportCheckpoints, setLoadingJournalImportCheckpoints] = useState(false);
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

  const loadTimeEntries = useCallback(async (adapter = adapterRef.current) => {
    if (!adapter) return;
    setLoadingTimeEntries(true);
    setErrorMessage("");
    try {
      let items;
      try { items = await adapter.listDirectory("data/time-entries"); }
      catch (error) {
        if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") { setTimeEntryFiles([]); return; }
        throw error;
      }
      const candidates = items.filter((item) => item.type === "file" && item.name.endsWith(".json")).sort((left, right) => right.name.localeCompare(left.name));
      const records: SyncedTimeEntry[] = [];
      for (let index = 0; index < candidates.length; index += 6) {
        records.push(...(await Promise.all(candidates.slice(index, index + 6).map(async (item) => {
          try { const file = await adapter.readText(item.path); return { record: parseTimeEntryRecord(file.text), path: file.path, blobSha: file.blobSha }; }
          catch { return null; }
        }))).filter((item): item is SyncedTimeEntry => item !== null));
      }
      setTimeEntryFiles(records);
    } catch (error) { setErrorMessage(friendlyError(error)); }
    finally { setLoadingTimeEntries(false); }
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

  const loadCalendarEvents = useCallback(async (adapter = adapterRef.current) => {
    if (!adapter) return;
    setLoadingCalendarEvents(true);
    setErrorMessage("");
    try {
      let items;
      try {
        items = await adapter.listDirectory("data/calendar-events");
      } catch (error) {
        if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") {
          setCalendarEventFiles([]);
          return;
        }
        throw error;
      }
      const candidates = items
        .filter((item) => item.type === "file" && item.name.endsWith(".json"))
        .sort((left, right) => right.name.localeCompare(left.name));
      const records: SyncedCalendarEvent[] = [];
      const batchSize = 6;
      for (let index = 0; index < candidates.length; index += batchSize) {
        records.push(...(await Promise.all(candidates.slice(index, index + batchSize).map(async (item) => {
          try {
            const file = await adapter.readText(item.path);
            return { record: parseCalendarEventRecord(file.text), path: file.path, blobSha: file.blobSha };
          } catch {
            return null;
          }
        }))).filter((item): item is SyncedCalendarEvent => item !== null));
      }
      setCalendarEventFiles(records);
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setLoadingCalendarEvents(false);
    }
  }, [adapterRef, setErrorMessage]);

  const loadReportDrafts = useCallback(async (adapter = adapterRef.current) => {
    if (!adapter) return;
    setLoadingReportDrafts(true);
    setErrorMessage("");
    try {
      let items;
      try {
        items = await adapter.listDirectory("data/report-drafts");
      } catch (error) {
        if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") {
          setReportDraftFiles([]);
          return;
        }
        throw error;
      }
      const candidates = items
        .filter((item) => item.type === "file" && item.name.endsWith(".json"))
        .sort((left, right) => right.name.localeCompare(left.name));
      const records: SyncedReportDraft[] = [];
      const batchSize = 6;
      for (let index = 0; index < candidates.length; index += batchSize) {
        records.push(...(await Promise.all(candidates.slice(index, index + batchSize).map(async (item) => {
          try {
            const file = await adapter.readText(item.path);
            return { record: parseReportDraftRecord(file.text), path: file.path, blobSha: file.blobSha };
          } catch {
            return null;
          }
        }))).filter((item): item is SyncedReportDraft => item !== null));
      }
      setReportDraftFiles(records);
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setLoadingReportDrafts(false);
    }
  }, [adapterRef, setErrorMessage]);

  const loadJournalEntries = useCallback(async (adapter = adapterRef.current) => {
    if (!adapter) return;
    setLoadingJournalEntries(true);
    setErrorMessage("");
    try {
      let items;
      try { items = await adapter.listDirectory("data/journal-entries"); }
      catch (error) {
        if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") { setJournalEntryFiles([]); return; }
        throw error;
      }
      const candidates = items.filter((item) => item.type === "file" && item.name.endsWith(".json")).sort((left, right) => right.name.localeCompare(left.name));
      const records: SyncedJournalEntry[] = [];
      for (let index = 0; index < candidates.length; index += 6) {
        records.push(...(await Promise.all(candidates.slice(index, index + 6).map(async (item) => {
          try { const file = await adapter.readText(item.path); return { record: parseJournalEntryRecord(file.text), path: file.path, blobSha: file.blobSha }; }
          catch { return null; }
        }))).filter((item): item is SyncedJournalEntry => item !== null));
      }
      setJournalEntryFiles(records);
    } catch (error) { setErrorMessage(friendlyError(error)); }
    finally { setLoadingJournalEntries(false); }
  }, [adapterRef, setErrorMessage]);

  const loadJournalSegments = useCallback(async (adapter = adapterRef.current) => {
    if (!adapter) return;
    setLoadingJournalSegments(true);
    setErrorMessage("");
    try {
      let items;
      try { items = await adapter.listDirectory("data/journal-segments"); }
      catch (error) {
        if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") { setJournalSegmentFiles([]); return; }
        throw error;
      }
      const candidates = items.filter((item) => item.type === "file" && item.name.endsWith(".json")).sort((left, right) => right.name.localeCompare(left.name));
      const records: SyncedJournalSegment[] = [];
      for (let index = 0; index < candidates.length; index += 6) {
        records.push(...(await Promise.all(candidates.slice(index, index + 6).map(async (item) => {
          try { const file = await adapter.readText(item.path); return { record: parseJournalSegmentRecord(file.text), path: file.path, blobSha: file.blobSha }; }
          catch { return null; }
        }))).filter((item): item is SyncedJournalSegment => item !== null));
      }
      setJournalSegmentFiles(records);
    } catch (error) { setErrorMessage(friendlyError(error)); }
    finally { setLoadingJournalSegments(false); }
  }, [adapterRef, setErrorMessage]);

  const loadJournalRevisions = useCallback(async (adapter = adapterRef.current) => {
    if (!adapter) return;
    setLoadingJournalRevisions(true);
    setErrorMessage("");
    try {
      let items;
      try { items = await adapter.listDirectory("data/journal-revisions"); }
      catch (error) {
        if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") { setJournalRevisionFiles([]); return; }
        throw error;
      }
      const candidates = items.filter((item) => item.type === "file" && item.name.endsWith(".json")).sort((left, right) => right.name.localeCompare(left.name));
      const records: SyncedJournalRevision[] = [];
      for (let index = 0; index < candidates.length; index += 6) {
        records.push(...(await Promise.all(candidates.slice(index, index + 6).map(async (item) => {
          try { const file = await adapter.readText(item.path); return { record: parseJournalRevisionRecord(file.text), path: file.path, blobSha: file.blobSha }; }
          catch { return null; }
        }))).filter((item): item is SyncedJournalRevision => item !== null));
      }
      setJournalRevisionFiles(records);
    } catch (error) { setErrorMessage(friendlyError(error)); }
    finally { setLoadingJournalRevisions(false); }
  }, [adapterRef, setErrorMessage]);

  const loadJournalImportCheckpoints = useCallback(async (adapter = adapterRef.current) => {
    if (!adapter) return;
    setLoadingJournalImportCheckpoints(true);
    setErrorMessage("");
    try {
      let items;
      try { items = await adapter.listDirectory("data/journal-import-checkpoints"); }
      catch (error) {
        if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") { setJournalImportCheckpointFiles([]); return; }
        throw error;
      }
      const candidates = items.filter((item) => item.type === "file" && item.name.endsWith(".json")).sort((left, right) => right.name.localeCompare(left.name));
      const records: SyncedJournalImportCheckpoint[] = [];
      for (let index = 0; index < candidates.length; index += 6) {
        records.push(...(await Promise.all(candidates.slice(index, index + 6).map(async (item) => {
          try { const file = await adapter.readText(item.path); return { record: parseJournalImportCheckpointRecord(file.text), path: file.path, blobSha: file.blobSha }; }
          catch { return null; }
        }))).filter((item): item is SyncedJournalImportCheckpoint => item !== null));
      }
      setJournalImportCheckpointFiles(records);
    } catch (error) { setErrorMessage(friendlyError(error)); }
    finally { setLoadingJournalImportCheckpoints(false); }
  }, [adapterRef, setErrorMessage]);

  const loadProjectFileReferences = useCallback(async (adapter = adapterRef.current) => {
    if (!adapter) return;
    setLoadingProjectFileReferences(true);
    setErrorMessage("");
    try {
      let items;
      try {
        items = await adapter.listDirectory("data/project-file-references");
      } catch (error) {
        if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") {
          setProjectFileReferenceFiles([]);
          return;
        }
        throw error;
      }
      const candidates = items.filter((item) => item.type === "file" && item.name.endsWith(".json")).sort((left, right) => right.name.localeCompare(left.name));
      const records: SyncedProjectFileReference[] = [];
      const batchSize = 6;
      for (let index = 0; index < candidates.length; index += batchSize) {
        records.push(...(await Promise.all(candidates.slice(index, index + batchSize).map(async (item) => {
          try {
            const file = await adapter.readText(item.path);
            return { record: parseProjectFileReferenceRecord(file.text), path: file.path, blobSha: file.blobSha };
          } catch {
            return null;
          }
        }))).filter((item): item is SyncedProjectFileReference => item !== null));
      }
      setProjectFileReferenceFiles(records);
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setLoadingProjectFileReferences(false);
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
    setTimeEntryFiles([]);
    setProjectFiles([]);
    setProjectPhaseFiles([]);
    setMilestoneFiles([]);
    setProjectNoteFiles([]);
    setProjectFileReferenceFiles([]);
    setActivityEventFiles([]);
    setCalendarEventFiles([]);
    setReportDraftFiles([]);
    setJournalEntryFiles([]);
    setJournalSegmentFiles([]);
    setJournalRevisionFiles([]);
    setJournalImportCheckpointFiles([]);
    setDashboardLayout(null);
    setDashboardBlobSha(null);
  }

  return {
    captureFiles,
    setCaptureFiles,
    taskFiles,
    setTaskFiles,
    timeEntryFiles,
    setTimeEntryFiles,
    projectFiles,
    setProjectFiles,
    projectPhaseFiles,
    setProjectPhaseFiles,
    milestoneFiles,
    setMilestoneFiles,
    projectNoteFiles,
    setProjectNoteFiles,
    projectFileReferenceFiles,
    setProjectFileReferenceFiles,
    activityEventFiles,
    setActivityEventFiles,
    calendarEventFiles,
    setCalendarEventFiles,
    reportDraftFiles,
    setReportDraftFiles,
    journalEntryFiles,
    setJournalEntryFiles,
    journalSegmentFiles,
    journalRevisionFiles,
    setJournalRevisionFiles,
    journalImportCheckpointFiles,
    dashboardLayout,
    setDashboardLayout,
    dashboardBlobSha,
    setDashboardBlobSha,
    loadingCaptures,
    loadingTasks,
    loadingTimeEntries,
    loadingProjects,
    loadingProjectPhases,
    loadingMilestones,
    loadingProjectNotes,
    loadingProjectFileReferences,
    loadingActivityEvents,
    loadingCalendarEvents,
    loadingReportDrafts,
    loadingJournalEntries,
    loadingJournalSegments,
    loadingJournalRevisions,
    loadingJournalImportCheckpoints,
    loadingDashboard,
    loadRecentCaptures,
    loadTasks,
    loadTimeEntries,
    loadProjects,
    loadProjectPhases,
    loadMilestones,
    loadProjectNotes,
    loadProjectFileReferences,
    loadActivityEvents,
    loadCalendarEvents,
    loadReportDrafts,
    loadJournalEntries,
    loadJournalSegments,
    loadJournalRevisions,
    loadJournalImportCheckpoints,
    loadDashboardLayout,
    clearCollections,
  };
}
