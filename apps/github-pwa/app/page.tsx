"use client";

import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GitHubContentsAdapter, GitHubDataError } from "../../../src/lib/github-data/github-contents";
import {
  DASHBOARD_LAYOUT_PATH,
  createDefaultDashboardLayout,
  moveDashboardWidget,
  serializeDashboardLayout,
  setDashboardWidgetEnabled,
  setDashboardWidgetSize,
  updateDashboardWidgets,
  type DashboardLayout,
  type DashboardWidgetConfig,
  type DashboardWidgetSize,
} from "../../../src/lib/github-data/dashboard-layout";
import {
  buildPortableWorkspaceExport,
  inspectPortableWorkspaceExport,
  serializePortableWorkspaceExport,
} from "../../../src/lib/github-data/portable-export";
import {
  createPortableRestorePlan,
  type PortableRestorePlan,
} from "../../../src/lib/github-data/portable-restore";
import {
  dryRunPortableWorkspaceMigrations,
  type SchemaMigrationDryRun,
} from "../../../src/lib/github-data/schema-migrations";
import {
  createWorkspaceRecord,
  recordPath,
  serializeRecord,
  setWorkspaceRecordDeleted,
  updateWorkspaceRecord,
} from "../../../src/lib/github-data/protocol";
import {
  newestCaptures,
  newestTrashedCaptures,
} from "../../../src/lib/github-data/workspace";
import {
  archivedProjects,
  cancelledProjects,
  completedProjects,
  createProjectData,
  currentProjects,
  setProjectStatus,
  trashedProjects,
  updateProjectDetails,
  updateProjectCurrentPhase,
  type ProjectEditableFields,
} from "../../../src/lib/github-data/projects";
import { createProjectPhaseData } from "../../../src/lib/github-data/project-phases";
import { createMilestoneData, setMilestoneStatus } from "../../../src/lib/github-data/milestones";
import { createProjectNoteData, updateProjectNoteDetails, type ProjectNoteEditableFields } from "../../../src/lib/github-data/project-notes";
import { createProjectFileReferenceData, type ProjectFileReferenceFields } from "../../../src/lib/github-data/project-file-references";
import { createActivityEventData, type ActivityChangeSummary } from "../../../src/lib/github-data/activity-events";
import {
  createCalendarEventData,
  localDateTimeToIso,
  setCalendarEventStatus,
  updateCalendarEventDetails,
} from "../../../src/lib/github-data/calendar-events";
import { createReportDraftData } from "../../../src/lib/github-data/report-drafts";
import type { DeterministicReport, DeterministicReportAudience } from "../../../src/lib/github-data/deterministic-reports";
import {
  archivedTasks,
  cancelledTasks,
  completedTasks,
  createSubtaskData,
  openTasks,
  setTaskStatus,
  tasksForToday,
  trashedTasks,
  updateTaskDetails,
  type TaskCategory,
  type TaskData,
  type TaskEditableFields,
  type TaskPriority,
} from "../../../src/lib/github-data/tasks";
import { createTimeEntryData } from "../../../src/lib/github-data/time-entries";
import { createJournalEntryData, hasActiveDailyJournalDate, updateJournalEntryData } from "../../../src/lib/github-data/journal-entries";
import {
  createJournalEntryAtomically,
  JOURNAL_REVISION_WRITES_ENABLED,
  updateJournalEntryAtomically,
} from "../../../src/lib/github-data/journal-revision-transactions";
import {
  DEFAULT_OWNER,
  DEFAULT_REPOSITORY,
  buildReadiness,
  friendlyError,
  friendlyJournalWriteError,
  localDateInTimezone,
  openPrivateRepository,
  readCookie,
  type AuthAvailability,
  type Connection,
  type ConnectionMethod,
  type PortabilityResult,
  type SavedCapture,
  type SyncedCapture,
  type SyncedCalendarEvent,
  type SyncedJournalEntry,
  type SyncedProject,
  type SyncedProjectPhase,
  type SyncedMilestone,
  type SyncedProjectNote,
  type SyncedReportDraft,
  type SyncedTask,
  type SyncedTimeEntry,
} from "./workspace/page-model";
import { useOnlineStatus } from "./workspace/use-online-status";
import { useWorkspaceCollections } from "./workspace/use-workspace-collections";
import { useGitHubAppBootstrap } from "./workspace/use-github-app-bootstrap";
import { CaptureInboxSection } from "./workspace/capture-inbox-section";
import { DashboardSection } from "./workspace/dashboard-section";
import { AuthSection } from "./workspace/auth-section";
import { PortabilitySection } from "./workspace/portability-section";
import { ProjectsSection } from "./workspace/projects-section";
import { CalendarSection, type CalendarEventFields } from "./workspace/calendar-section";
import { ReadinessSection } from "./workspace/readiness-section";
import { ReportsSection } from "./workspace/reports-section";
import { TasksSection } from "./workspace/tasks-section";
import { TimeEntriesSection } from "./workspace/time-entries-section";
import { JournalSection } from "./workspace/journal-section";

export default function GitHubWorkspacePage() {
  const adapterRef = useRef<GitHubContentsAdapter | null>(null);
  const restoreAdapterRef = useRef<GitHubContentsAdapter | null>(null);
  const [owner, setOwner] = useState(DEFAULT_OWNER);
  const [repository, setRepository] = useState(DEFAULT_REPOSITORY);
  const [token, setToken] = useState("");
  const [connection, setConnection] = useState<Connection | null>(null);
  const [connectionMethod, setConnectionMethod] = useState<ConnectionMethod | null>(null);
  const [authAvailability, setAuthAvailability] = useState<AuthAvailability>("checking");
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingCaptureId, setSavingCaptureId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const [checkingRestore, setCheckingRestore] = useState(false);
  const [checkingRestoreTarget, setCheckingRestoreTarget] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [confirmingRevokeAll, setConfirmingRevokeAll] = useState(false);
  const [revokingAll, setRevokingAll] = useState(false);
  const [capture, setCapture] = useState("");
  const [captureView, setCaptureView] = useState<"inbox" | "trash">("inbox");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskCategory, setTaskCategory] = useState<TaskCategory>("work");
  const [taskPriority, setTaskPriority] = useState<TaskPriority>("medium");
  const [taskProjectId, setTaskProjectId] = useState("");
  const [taskDueDateOverride, setTaskDueDate] = useState<string | null>(null);
  const [taskView, setTaskView] = useState<"open" | "done" | "cancelled" | "archived" | "trash">("open");
  const [savingTask, setSavingTask] = useState(false);
  const [savingTimeEntry, setSavingTimeEntry] = useState(false);
  const [savingTimeEntryId, setSavingTimeEntryId] = useState<string | null>(null);
  const [savingReportDraft, setSavingReportDraft] = useState(false);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectTargetDate, setProjectTargetDate] = useState("");
  const [projectView, setProjectView] = useState<"current" | "completed" | "cancelled" | "archived" | "trash">("current");
  const [savingProject, setSavingProject] = useState(false);
  const [savingProjectId, setSavingProjectId] = useState<string | null>(null);
  const [savingProjectPhaseProjectId, setSavingProjectPhaseProjectId] = useState<string | null>(null);
  const [savingMilestoneProjectId, setSavingMilestoneProjectId] = useState<string | null>(null);
  const [savingMilestoneId, setSavingMilestoneId] = useState<string | null>(null);
  const [savingProjectNoteProjectId, setSavingProjectNoteProjectId] = useState<string | null>(null);
  const [savingProjectNoteId, setSavingProjectNoteId] = useState<string | null>(null);
  const [savingProjectFileReferenceProjectId, setSavingProjectFileReferenceProjectId] = useState<string | null>(null);
  const [savingCalendarEvent, setSavingCalendarEvent] = useState(false);
  const [savingCalendarEventId, setSavingCalendarEventId] = useState<string | null>(null);
  const [savingJournalEntry, setSavingJournalEntry] = useState(false);
  const [savingJournalEntryId, setSavingJournalEntryId] = useState<string | null>(null);
  const [dashboardDirty, setDashboardDirty] = useState(false);
  const [editingDashboard, setEditingDashboard] = useState(false);
  const [savingDashboard, setSavingDashboard] = useState(false);
  const [savedCapture, setSavedCapture] = useState<SavedCapture | null>(null);
  const [exportResult, setExportResult] = useState<PortabilityResult | null>(null);
  const [restoreResult, setRestoreResult] = useState<PortabilityResult | null>(null);
  const [migrationDryRun, setMigrationDryRun] = useState<SchemaMigrationDryRun | null>(null);
  const [restorePackage, setRestorePackage] = useState<unknown | null>(null);
  const [restoreTargetOwner, setRestoreTargetOwner] = useState(DEFAULT_OWNER);
  const [restoreTargetRepository, setRestoreTargetRepository] = useState("personal-workspace-restore-test");
  const [restorePlan, setRestorePlan] = useState<PortableRestorePlan | null>(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const [restoreCommitSha, setRestoreCommitSha] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const setDashboardClean = useCallback(() => setDashboardDirty(false), []);
  const clearAdapters = useCallback(() => {
    adapterRef.current = null;
    restoreAdapterRef.current = null;
  }, []);
  const online = useOnlineStatus(clearAdapters);
  const {
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
    setJournalRevisionFiles,
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
  } = useWorkspaceCollections({ adapterRef, setErrorMessage, setDashboardClean });

  useGitHubAppBootstrap({
    adapterRef,
    setConnection,
    setConnectionMethod,
    setAuthAvailability,
    setConnecting,
    setErrorMessage,
    setStatusMessage,
    loadRecentCaptures,
    loadDashboardLayout,
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
  });

  const workspaceTimezone = connection?.timezone ?? "Asia/Shanghai";
  const [currentTaskDate, setCurrentTaskDate] = useState("");
  useEffect(() => {
    const updateCurrentDate = () => setCurrentTaskDate(localDateInTimezone(workspaceTimezone));
    updateCurrentDate();
    const intervalId = window.setInterval(updateCurrentDate, 60_000);
    return () => window.clearInterval(intervalId);
  }, [workspaceTimezone]);
  const taskDueDate = taskDueDateOverride ?? currentTaskDate;

  const readiness = useMemo(
    () => buildReadiness(connection, connectionMethod, authAvailability),
    [authAvailability, connection, connectionMethod],
  );

  const inboxCaptures = useMemo(() => {
    const byId = new Map(captureFiles.map((item) => [item.record.id, item]));
    return newestCaptures(captureFiles.map((item) => item.record), 20)
      .map((record) => byId.get(record.id))
      .filter((item): item is SyncedCapture => Boolean(item));
  }, [captureFiles]);

  const trashedCaptures = useMemo(() => {
    const byId = new Map(captureFiles.map((item) => [item.record.id, item]));
    return newestTrashedCaptures(captureFiles.map((item) => item.record), 20)
      .map((record) => byId.get(record.id))
      .filter((item): item is SyncedCapture => Boolean(item));
  }, [captureFiles]);

  const visibleCaptures = captureView === "inbox" ? inboxCaptures : trashedCaptures;
  const openTaskFiles = useMemo(() => {
    const byId = new Map(taskFiles.map((item) => [item.record.id, item]));
    return openTasks(taskFiles.map((item) => item.record))
      .map((record) => byId.get(record.id))
      .filter((item): item is SyncedTask => Boolean(item));
  }, [taskFiles]);
  const completedTaskFiles = useMemo(() => {
    const byId = new Map(taskFiles.map((item) => [item.record.id, item]));
    return completedTasks(taskFiles.map((item) => item.record))
      .map((record) => byId.get(record.id))
      .filter((item): item is SyncedTask => Boolean(item));
  }, [taskFiles]);
  const cancelledTaskFiles = useMemo(() => {
    const byId = new Map(taskFiles.map((item) => [item.record.id, item]));
    return cancelledTasks(taskFiles.map((item) => item.record))
      .map((record) => byId.get(record.id))
      .filter((item): item is SyncedTask => Boolean(item));
  }, [taskFiles]);
  const archivedTaskFiles = useMemo(() => {
    const byId = new Map(taskFiles.map((item) => [item.record.id, item]));
    return archivedTasks(taskFiles.map((item) => item.record))
      .map((record) => byId.get(record.id))
      .filter((item): item is SyncedTask => Boolean(item));
  }, [taskFiles]);
  const trashedTaskFiles = useMemo(() => {
    const byId = new Map(taskFiles.map((item) => [item.record.id, item]));
    return trashedTasks(taskFiles.map((item) => item.record))
      .map((record) => byId.get(record.id))
      .filter((item): item is SyncedTask => Boolean(item));
  }, [taskFiles]);
  const todayTaskFiles = useMemo(() => {
    if (!currentTaskDate) return [];
    const byId = new Map(taskFiles.map((item) => [item.record.id, item]));
    return tasksForToday(taskFiles.map((item) => item.record), currentTaskDate)
      .map((record) => byId.get(record.id))
      .filter((item): item is SyncedTask => Boolean(item));
  }, [currentTaskDate, taskFiles]);
  const visibleTaskFiles = {
    open: openTaskFiles,
    done: completedTaskFiles,
    cancelled: cancelledTaskFiles,
    archived: archivedTaskFiles,
    trash: trashedTaskFiles,
  }[taskView];
  const currentProjectFiles = useMemo(() => {
    const byId = new Map(projectFiles.map((item) => [item.record.id, item]));
    return currentProjects(projectFiles.map((item) => item.record))
      .map((record) => byId.get(record.id))
      .filter((item): item is SyncedProject => Boolean(item));
  }, [projectFiles]);
  const completedProjectFiles = useMemo(() => selectSyncedProjects(projectFiles, completedProjects), [projectFiles]);
  const cancelledProjectFiles = useMemo(() => selectSyncedProjects(projectFiles, cancelledProjects), [projectFiles]);
  const archivedProjectFiles = useMemo(() => selectSyncedProjects(projectFiles, archivedProjects), [projectFiles]);
  const trashedProjectFiles = useMemo(() => selectSyncedProjects(projectFiles, trashedProjects), [projectFiles]);
  const visibleProjectFiles = {
    current: currentProjectFiles,
    completed: completedProjectFiles,
    cancelled: cancelledProjectFiles,
    archived: archivedProjectFiles,
    trash: trashedProjectFiles,
  }[projectView];
  const displayedDashboardLayout = useMemo(
    () => dashboardLayout ?? createDefaultDashboardLayout("preview", "1970-01-01T00:00:00.000Z"),
    [dashboardLayout],
  );
  const visibleDashboardWidgets = useMemo(
    () => displayedDashboardLayout.widgets.filter((widget) => widget.enabled),
    [displayedDashboardLayout],
  );
  const hiddenDashboardWidgets = useMemo(
    () => displayedDashboardLayout.widgets.filter((widget) => !widget.enabled),
    [displayedDashboardLayout],
  );

  function applyDashboardLayout(next: DashboardLayout) {
    setDashboardLayout(next);
    setDashboardDirty(true);
    setStatusMessage("");
  }

  function changeDashboardWidget(
    widget: DashboardWidgetConfig,
    operation: "up" | "down" | "hide" | "show",
  ) {
    if (!dashboardLayout) return;
    if (operation === "up" || operation === "down") {
      applyDashboardLayout(moveDashboardWidget(dashboardLayout, widget.id, operation));
      return;
    }
    applyDashboardLayout(setDashboardWidgetEnabled(dashboardLayout, widget.id, operation === "show"));
  }

  function resizeDashboardWidget(widget: DashboardWidgetConfig, size: DashboardWidgetSize) {
    if (!dashboardLayout) return;
    applyDashboardLayout(setDashboardWidgetSize(dashboardLayout, widget.id, size));
  }

  function resetDashboardToDefault() {
    if (!dashboardLayout || !connection) return;
    const defaults = createDefaultDashboardLayout(connection.ownerId).widgets;
    applyDashboardLayout(updateDashboardWidgets(dashboardLayout, defaults));
  }

  async function saveDashboardLayout() {
    const adapter = adapterRef.current;
    if (!adapter || !dashboardLayout || !connection || savingDashboard || online === false) return;
    setSavingDashboard(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const result = await adapter.writeText({
        path: DASHBOARD_LAYOUT_PATH,
        text: serializeDashboardLayout(dashboardLayout),
        message: `dashboard: save layout v${dashboardLayout.version}`,
        expectedBlobSha: dashboardBlobSha ?? undefined,
      });
      setDashboardBlobSha(result.blobSha);
      setDashboardDirty(false);
      setEditingDashboard(false);
      setStatusMessage("Dashboard 布局已保存到 Private 数据仓库，可在其他设备刷新后读取。");
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setSavingDashboard(false);
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
      await Promise.all([
        loadRecentCaptures(opened.adapter),
        loadDashboardLayout(opened.adapter, opened.connection.ownerId),
        loadTasks(opened.adapter),
        loadTimeEntries(opened.adapter),
        loadProjects(opened.adapter),
        loadProjectPhases(opened.adapter),
        loadMilestones(opened.adapter),
        loadProjectNotes(opened.adapter),
        loadProjectFileReferences(opened.adapter),
        loadActivityEvents(opened.adapter),
        loadCalendarEvents(opened.adapter),
        loadReportDrafts(opened.adapter),
        loadJournalEntries(opened.adapter),
        loadJournalSegments(opened.adapter),
        loadJournalRevisions(opened.adapter),
        loadJournalImportCheckpoints(opened.adapter),
      ]);
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
    clearCollections();
    setTaskTitle("");
    setTaskProjectId("");
    setProjectName("");
    setProjectTargetDate("");
    setProjectView("current");
    setTaskView("open");
    setCaptureView("inbox");
    setDashboardDirty(false);
    setEditingDashboard(false);
    setSavedCapture(null);
    setExportResult(null);
    setRestoreResult(null);
    setMigrationDryRun(null);
    setRestorePackage(null);
    setRestorePlan(null);
    setRestoreConfirmation("");
    setRestoreCommitSha(null);
    restoreAdapterRef.current = null;
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
      setCaptureFiles((current) => [{ record, path: result.path, blobSha: result.blobSha }, ...current]);
      setStatusMessage("已保存到 Private 数据仓库，可在其他设备刷新后读取。");
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setSaving(false);
    }
  }

  async function updateCaptureLifecycle(item: SyncedCapture, operation: "trash" | "restore") {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingCaptureId || online === false) return;
    setSavingCaptureId(item.record.id);
    setErrorMessage("");
    setStatusMessage("");
    const timestamp = new Date().toISOString();
    const updated = setWorkspaceRecordDeleted(
      item.record,
      operation === "trash" ? timestamp : null,
      timestamp,
    );
    try {
      const result = await adapter.writeText({
        path: item.path,
        text: serializeRecord(updated),
        message: `capture: ${operation} ${item.record.id}`,
        expectedBlobSha: item.blobSha,
      });
      setCaptureFiles((current) => current.map((candidate) => candidate.record.id === item.record.id
        ? { record: updated, path: result.path, blobSha: result.blobSha }
        : candidate));
      setStatusMessage(operation === "trash"
        ? "Capture 已移到回收站；可随时恢复，Git 历史仍保留原版本。"
        : "Capture 已恢复到 Inbox。请在其他设备刷新后查看最新状态。");
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setSavingCaptureId(null);
    }
  }

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const adapter = adapterRef.current;
    const title = taskTitle.trim();
    if (!adapter || !connection || !title || savingTask || online === false) return;
    setSavingTask(true);
    setErrorMessage("");
    setStatusMessage("");
    const timestamp = new Date().toISOString();
    const timePart = timestamp.replaceAll(/\D/g, "").slice(0, 17);
    const id = `task_${timePart}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const data: TaskData = {
      title,
      category: taskCategory,
      project_id: taskProjectId || null,
      parent_task_id: null,
      status: "todo",
      priority: taskPriority,
      planned_start_at: null,
      planned_end_at: null,
      due_at: taskDueDate || null,
      due_timezone: connection.timezone,
      is_due_date_only: true,
      estimated_duration_minutes: null,
      actual_duration_minutes: null,
      tags: [],
      notes_markdown: "",
      completed_at: null,
      cancelled_at: null,
    };
    const record = createWorkspaceRecord({
      entityType: "task",
      id,
      ownerId: connection.ownerId,
      timestamp,
      data,
    });
    const path = recordPath("task", id);
    try {
      const result = await adapter.writeText({
        path,
        text: serializeRecord(record),
        message: `task: create ${id}`,
      });
      setTaskTitle("");
      setTaskFiles((current) => [{ record, path: result.path, blobSha: result.blobSha }, ...current]);
      setTaskView("open");
      setStatusMessage("任务已保存到 Private 数据仓库；今日或逾期任务会立即进入 Dashboard。");
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setSavingTask(false);
    }
  }

  async function saveCalendarEvent(fields: CalendarEventFields) {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingCalendarEvent || savingCalendarEventId || online === false) return false;
    if (fields.linkedTaskId && !taskFiles.some((item) => item.record.id === fields.linkedTaskId && item.record.deleted_at === null)) {
      setErrorMessage("关联 Task 已不在当前数据中，请刷新后重新选择；未写入 CalendarEvent。");
      return false;
    }
    setSavingCalendarEvent(true);
    setErrorMessage("");
    setStatusMessage("");
    const timestamp = new Date().toISOString();
    const timePart = timestamp.replaceAll(/\D/g, "").slice(0, 17);
    const id = `calendar_event_${timePart}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    try {
      const startAt = localDateTimeToIso(fields.localDate, fields.startTime, connection.timezone);
      const endAt = localDateTimeToIso(fields.localDate, fields.endTime, connection.timezone);
      const record = createWorkspaceRecord({
        entityType: "calendar_event",
        id,
        ownerId: connection.ownerId,
        timestamp,
        data: createCalendarEventData({
          title: fields.title,
          eventType: fields.eventType,
          startAt,
          endAt,
          timezone: connection.timezone,
          localDate: fields.localDate,
          linkedTaskId: fields.linkedTaskId,
          reminderOffsetsMinutes: fields.reminderOffsetsMinutes,
        }),
      });
      const result = await adapter.writeText({
        path: recordPath("calendar_event", id),
        text: serializeRecord(record),
        message: `calendar: create ${id}`,
      });
      setCalendarEventFiles((current) => [...current, { record, path: result.path, blobSha: result.blobSha }]);
      setStatusMessage(fields.linkedTaskId
        ? "时间块已保存；关联 Task 只作为引用，DDL、状态和耗时均未改写。"
        : "内部日程已保存到 Private 数据仓库。");
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error && error.message.startsWith("INVALID_CALENDAR")
        ? "日程日期、时间或时区无效，未写入任何数据。"
        : friendlyError(error));
      return false;
    } finally {
      setSavingCalendarEvent(false);
    }
  }

  async function saveCalendarEventEdit(item: SyncedCalendarEvent, fields: CalendarEventFields) {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingCalendarEvent || savingCalendarEventId || online === false) return false;
    if (fields.linkedTaskId && !taskFiles.some((candidate) => candidate.record.id === fields.linkedTaskId && candidate.record.deleted_at === null)) {
      setErrorMessage("关联 Task 已不在当前数据中，请刷新后重新选择；未改写 CalendarEvent。");
      return false;
    }
    setSavingCalendarEventId(item.record.id);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const updated = updateCalendarEventDetails(item.record, {
        title: fields.title,
        eventType: fields.eventType,
        startAt: localDateTimeToIso(fields.localDate, fields.startTime, connection.timezone),
        endAt: localDateTimeToIso(fields.localDate, fields.endTime, connection.timezone),
        timezone: connection.timezone,
        localDate: fields.localDate,
        linkedTaskId: fields.linkedTaskId,
        reminderOffsetsMinutes: fields.reminderOffsetsMinutes,
      });
      const result = await adapter.writeText({
        path: item.path,
        text: serializeRecord(updated),
        message: `calendar: edit ${item.record.id}`,
        expectedBlobSha: item.blobSha,
      });
      setCalendarEventFiles((current) => current.map((candidate) => candidate.record.id === item.record.id
        ? { record: updated, path: result.path, blobSha: result.blobSha }
        : candidate));
      setStatusMessage("日程修改已保存；关联 Task 未被改写，Git 历史和旧 blob SHA 冲突保护保持启用。");
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error && error.message.startsWith("INVALID_CALENDAR")
        ? "日程日期、时间或时区无效，未写入任何数据。"
        : friendlyError(error));
      return false;
    } finally {
      setSavingCalendarEventId(null);
    }
  }

  async function updateCalendarEventLifecycle(item: SyncedCalendarEvent, operation: "cancel" | "reopen") {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingCalendarEvent || savingCalendarEventId || online === false) return;
    setSavingCalendarEventId(item.record.id);
    setErrorMessage("");
    setStatusMessage("");
    const updated = setCalendarEventStatus(item.record, operation === "cancel" ? "cancelled" : "confirmed");
    try {
      const result = await adapter.writeText({
        path: item.path,
        text: serializeRecord(updated),
        message: `calendar: ${operation} ${item.record.id}`,
        expectedBlobSha: item.blobSha,
      });
      setCalendarEventFiles((current) => current.map((candidate) => candidate.record.id === item.record.id
        ? { record: updated, path: result.path, blobSha: result.blobSha }
        : candidate));
      setStatusMessage(operation === "cancel"
        ? "日程已取消；记录和 Git 历史仍保留，可从“已取消”视图恢复。"
        : "日程已恢复为已安排；关联 Task 的状态、DDL 和耗时均未改写。");
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setSavingCalendarEventId(null);
    }
  }

  async function updateCalendarEventDeletion(item: SyncedCalendarEvent, operation: "trash" | "restore") {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingCalendarEvent || savingCalendarEventId || online === false) return;
    setSavingCalendarEventId(item.record.id);
    setErrorMessage("");
    setStatusMessage("");
    const timestamp = new Date().toISOString();
    const updated = setWorkspaceRecordDeleted(item.record, operation === "trash" ? timestamp : null, timestamp);
    try {
      const result = await adapter.writeText({
        path: item.path,
        text: serializeRecord(updated),
        message: `calendar: ${operation} ${item.record.id}`,
        expectedBlobSha: item.blobSha,
      });
      setCalendarEventFiles((current) => current.map((candidate) => candidate.record.id === item.record.id
        ? { record: updated, path: result.path, blobSha: result.blobSha }
        : candidate));
      setStatusMessage(operation === "trash"
        ? "日程已移到回收站；原状态和 Git 历史均保留，可随时恢复。"
        : "日程已从回收站恢复到原状态；关联 Task 未被改写。");
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setSavingCalendarEventId(null);
    }
  }

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const adapter = adapterRef.current;
    if (!adapter || !connection || !projectName.trim() || savingProject || online === false) return;
    setSavingProject(true);
    setErrorMessage("");
    setStatusMessage("");
    const timestamp = new Date().toISOString();
    const timePart = timestamp.replaceAll(/\D/g, "").slice(0, 17);
    const id = `project_${timePart}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    try {
      const record = createWorkspaceRecord({
        entityType: "project",
        id,
        ownerId: connection.ownerId,
        timestamp,
        data: createProjectData(projectName, projectTargetDate || null),
      });
      const result = await adapter.writeText({
        path: recordPath("project", id),
        text: serializeRecord(record),
        message: `project: create ${id}`,
      });
      setProjectName("");
      setProjectTargetDate("");
      setProjectFiles((current) => [{ record, path: result.path, blobSha: result.blobSha }, ...current]);
      setProjectView("current");
      await appendProjectActivity({ projectId: id, eventType: "project.created", changeSummary: { name: record.data.name, status: record.data.status }, sourceRef: id, timestamp });
      setStatusMessage("项目已保存；进度将按未删除、未取消、未归档的关联任务事实计算。");
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setSavingProject(false);
    }
  }

  async function appendProjectActivity(input: {
    projectId: string;
    eventType: string;
    changeSummary: ActivityChangeSummary;
    sourceRef?: string | null;
    timestamp?: string;
  }) {
    const adapter = adapterRef.current;
    if (!adapter || !connection) {
      setErrorMessage("主操作已成功，但当前连接已失效，Activity Log 未写入；Git 历史仍保留主操作事实。");
      return false;
    }
    const timestamp = input.timestamp ?? new Date().toISOString();
    const timePart = timestamp.replaceAll(/\D/g, "").slice(0, 17);
    const id = `activity_${timePart}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    try {
      const record = createWorkspaceRecord({
        entityType: "activity_event",
        id,
        ownerId: connection.ownerId,
        timestamp,
        data: createActivityEventData({
          projectId: input.projectId,
          eventType: input.eventType,
          occurredAt: timestamp,
          actorId: connection.ownerId,
          changeSummary: input.changeSummary,
          sourceRef: input.sourceRef,
        }),
      });
      const result = await adapter.writeText({
        path: recordPath("activity_event", id),
        text: serializeRecord(record),
        message: `activity: ${input.eventType} ${input.projectId}`,
      });
      setActivityEventFiles((current) => [{ record, path: result.path, blobSha: result.blobSha }, ...current]);
      return true;
    } catch (error) {
      setErrorMessage(`主操作已成功，但 Activity Log 未写入：${friendlyError(error)} Git 历史仍保留主操作事实。`);
      return false;
    }
  }

  async function updateProjectLifecycle(
    item: SyncedProject,
    operation: "pause" | "resume" | "complete" | "reopen" | "cancel" | "archive",
  ) {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingProjectId || online === false) return;
    setSavingProjectId(item.record.id);
    setErrorMessage("");
    setStatusMessage("");
    const nextStatus = {
      pause: "on_hold",
      resume: "active",
      complete: "completed",
      reopen: "active",
      cancel: "cancelled",
      archive: "archived",
    } as const;
    const updated = setProjectStatus(item.record, nextStatus[operation]);
    try {
      const result = await adapter.writeText({
        path: item.path,
        text: serializeRecord(updated),
        message: `project: ${operation} ${item.record.id}`,
        expectedBlobSha: item.blobSha,
      });
      setProjectFiles((current) => current.map((candidate) => candidate.record.id === item.record.id
        ? { record: updated, path: result.path, blobSha: result.blobSha }
        : candidate));
      if (taskProjectId === item.record.id && !["active", "planned", "on_hold"].includes(updated.data.status)) setTaskProjectId("");
      await appendProjectActivity({ projectId: item.record.id, eventType: "project.status_changed", changeSummary: { from: item.record.data.status, to: updated.data.status }, sourceRef: item.record.id, timestamp: updated.updated_at });
      setStatusMessage({
        pause: "项目已暂停；关联任务保持原状态。",
        resume: "项目已恢复进行；关联任务关系保持不变。",
        complete: "项目已完成；完成时间和 Git 历史已保留。",
        reopen: "项目已重新打开；完成时间已清空，历史版本仍保留。",
        cancel: "项目已取消；关联任务没有被自动取消。",
        archive: "项目已归档；关联任务和 Git 历史保持不变。",
      }[operation]);
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setSavingProjectId(null);
    }
  }

  async function saveProjectEdit(item: SyncedProject, details: ProjectEditableFields) {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingProjectId || online === false) return false;
    setSavingProjectId(item.record.id);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const updated = updateProjectDetails(item.record, details);
      const result = await adapter.writeText({
        path: item.path,
        text: serializeRecord(updated),
        message: `project: edit ${item.record.id}`,
        expectedBlobSha: item.blobSha,
      });
      setProjectFiles((current) => current.map((candidate) => candidate.record.id === item.record.id
        ? { record: updated, path: result.path, blobSha: result.blobSha }
        : candidate));
      await appendProjectActivity({ projectId: item.record.id, eventType: "project.updated", changeSummary: { name: updated.data.name, start_date: updated.data.start_date, target_date: updated.data.target_date, progress_mode: updated.data.progress_mode }, sourceRef: item.record.id, timestamp: updated.updated_at });
      setStatusMessage("项目基本信息与进度口径已保存；生命周期和 Git 历史保持不变。");
      return true;
    } catch (error) {
      setErrorMessage(friendlyError(error));
      return false;
    } finally {
      setSavingProjectId(null);
    }
  }

  async function saveProjectPhase(project: SyncedProject, rawName: string) {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingProjectPhaseProjectId || online === false) return false;
    setSavingProjectPhaseProjectId(project.record.id);
    setErrorMessage("");
    setStatusMessage("");
    const timestamp = new Date().toISOString();
    const timePart = timestamp.replaceAll(/\D/g, "").slice(0, 17);
    const id = `phase_${timePart}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const projectPhases = projectPhaseFiles.filter((item) => item.record.deleted_at === null && item.record.data.project_id === project.record.id);
    const sortOrder = projectPhases.reduce((maximum, item) => Math.max(maximum, item.record.data.sort_order), 0) + 10;
    try {
      const record = createWorkspaceRecord({
        entityType: "project_phase",
        id,
        ownerId: connection.ownerId,
        timestamp,
        data: createProjectPhaseData({ projectId: project.record.id, name: rawName, sortOrder, timestamp }),
      });
      const result = await adapter.writeText({
        path: recordPath("project_phase", id),
        text: serializeRecord(record),
        message: `project phase: create ${id}`,
      });
      setProjectPhaseFiles((current) => [...current, { record, path: result.path, blobSha: result.blobSha }]);
      await appendProjectActivity({ projectId: project.record.id, eventType: "project_phase.created", changeSummary: { name: record.data.name, sort_order: record.data.sort_order }, sourceRef: id, timestamp });
      setStatusMessage("项目阶段已保存；选择“设为当前”后才会更新 Project 引用。");
      return true;
    } catch (error) {
      setErrorMessage(friendlyError(error));
      return false;
    } finally {
      setSavingProjectPhaseProjectId(null);
    }
  }

  async function setCurrentProjectPhase(project: SyncedProject, phase: SyncedProjectPhase) {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingProjectId || online === false || phase.record.data.project_id !== project.record.id) return;
    setSavingProjectId(project.record.id);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const updated = updateProjectCurrentPhase(project.record, phase.record.id);
      const result = await adapter.writeText({
        path: project.path,
        text: serializeRecord(updated),
        message: `project: set current phase ${project.record.id}`,
        expectedBlobSha: project.blobSha,
      });
      setProjectFiles((current) => current.map((candidate) => candidate.record.id === project.record.id
        ? { record: updated, path: result.path, blobSha: result.blobSha }
        : candidate));
      await appendProjectActivity({ projectId: project.record.id, eventType: "project.phase_changed", changeSummary: { from: project.record.data.current_phase_id, to: phase.record.id, phase_name: phase.record.data.name }, sourceRef: phase.record.id, timestamp: updated.updated_at });
      setStatusMessage(`当前阶段已切换为“${phase.record.data.name}”；阶段文件和 Project 引用均保留独立历史。`);
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setSavingProjectId(null);
    }
  }

  async function saveMilestone(project: SyncedProject, rawTitle: string, targetDate: string) {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingMilestoneProjectId || online === false) return false;
    setSavingMilestoneProjectId(project.record.id);
    setErrorMessage("");
    setStatusMessage("");
    const timestamp = new Date().toISOString();
    const timePart = timestamp.replaceAll(/\D/g, "").slice(0, 17);
    const id = `milestone_${timePart}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const projectMilestones = milestoneFiles.filter((item) => item.record.deleted_at === null && item.record.data.project_id === project.record.id);
    const sortOrder = projectMilestones.reduce((maximum, item) => Math.max(maximum, item.record.data.sort_order), 0) + 10;
    try {
      const record = createWorkspaceRecord({
        entityType: "milestone",
        id,
        ownerId: connection.ownerId,
        timestamp,
        data: createMilestoneData({ projectId: project.record.id, title: rawTitle, targetDate: targetDate || null, sortOrder }),
      });
      const result = await adapter.writeText({
        path: recordPath("milestone", id),
        text: serializeRecord(record),
        message: `milestone: create ${id}`,
      });
      setMilestoneFiles((current) => [...current, { record, path: result.path, blobSha: result.blobSha }]);
      await appendProjectActivity({ projectId: project.record.id, eventType: "milestone.created", changeSummary: { title: record.data.title, target_date: record.data.target_date, weight: record.data.weight }, sourceRef: id, timestamp });
      setStatusMessage("里程碑已保存；项目进度仍按关联任务事实计算。");
      return true;
    } catch (error) {
      setErrorMessage(friendlyError(error));
      return false;
    } finally {
      setSavingMilestoneProjectId(null);
    }
  }

  async function updateMilestoneLifecycle(item: SyncedMilestone, operation: "complete" | "reopen" | "cancel") {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingMilestoneId || online === false) return;
    setSavingMilestoneId(item.record.id);
    setErrorMessage("");
    setStatusMessage("");
    const nextStatus = { complete: "completed", reopen: "open", cancel: "cancelled" } as const;
    const updated = setMilestoneStatus(item.record, nextStatus[operation]);
    try {
      const result = await adapter.writeText({
        path: item.path,
        text: serializeRecord(updated),
        message: `milestone: ${operation} ${item.record.id}`,
        expectedBlobSha: item.blobSha,
      });
      setMilestoneFiles((current) => current.map((candidate) => candidate.record.id === item.record.id
        ? { record: updated, path: result.path, blobSha: result.blobSha }
        : candidate));
      await appendProjectActivity({ projectId: item.record.data.project_id, eventType: "milestone.status_changed", changeSummary: { title: item.record.data.title, from: item.record.data.status, to: updated.data.status }, sourceRef: item.record.id, timestamp: updated.updated_at });
      setStatusMessage({
        complete: "里程碑已完成；完成时间与 Git 历史已保留。",
        reopen: "里程碑已重新打开；完成时间已清空，历史版本仍保留。",
        cancel: "里程碑已取消；项目和关联任务没有被自动修改。",
      }[operation]);
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setSavingMilestoneId(null);
    }
  }

  async function saveProjectNote(project: SyncedProject, details: ProjectNoteEditableFields) {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingProjectNoteProjectId || online === false) return false;
    setSavingProjectNoteProjectId(project.record.id);
    setErrorMessage("");
    setStatusMessage("");
    const timestamp = new Date().toISOString();
    const timePart = timestamp.replaceAll(/\D/g, "").slice(0, 17);
    const id = `project_note_${timePart}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    try {
      const record = createWorkspaceRecord({
        entityType: "project_note",
        id,
        ownerId: connection.ownerId,
        timestamp,
        data: createProjectNoteData({
          projectId: project.record.id,
          title: details.title,
          bodyMarkdown: details.body_markdown,
          noteDate: details.note_date,
        }),
      });
      const result = await adapter.writeText({
        path: recordPath("project_note", id),
        text: serializeRecord(record),
        message: `project note: create ${id}`,
      });
      setProjectNoteFiles((current) => [{ record, path: result.path, blobSha: result.blobSha }, ...current]);
      await appendProjectActivity({ projectId: project.record.id, eventType: "project_note.created", changeSummary: { title: record.data.title, note_date: record.data.note_date }, sourceRef: id, timestamp });
      setStatusMessage("项目 Note 已保存为独立 Markdown 数据记录；项目本体没有被改写。");
      return true;
    } catch (error) {
      setErrorMessage(friendlyError(error));
      return false;
    } finally {
      setSavingProjectNoteProjectId(null);
    }
  }

  async function saveProjectNoteEdit(item: SyncedProjectNote, details: ProjectNoteEditableFields) {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingProjectNoteId || online === false) return false;
    setSavingProjectNoteId(item.record.id);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const updated = updateProjectNoteDetails(item.record, details);
      const result = await adapter.writeText({
        path: item.path,
        text: serializeRecord(updated),
        message: `project note: edit ${item.record.id}`,
        expectedBlobSha: item.blobSha,
      });
      setProjectNoteFiles((current) => current.map((candidate) => candidate.record.id === item.record.id
        ? { record: updated, path: result.path, blobSha: result.blobSha }
        : candidate));
      await appendProjectActivity({ projectId: item.record.data.project_id, eventType: "project_note.updated", changeSummary: { title: updated.data.title, note_date: updated.data.note_date }, sourceRef: item.record.id, timestamp: updated.updated_at });
      setStatusMessage("项目 Note 已更新；旧 blob SHA 冲突保护和 Git 历史均已保留。");
      return true;
    } catch (error) {
      setErrorMessage(friendlyError(error));
      return false;
    } finally {
      setSavingProjectNoteId(null);
    }
  }

  async function saveProjectFileReference(project: SyncedProject, fields: ProjectFileReferenceFields) {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingProjectFileReferenceProjectId || online === false) return false;
    setSavingProjectFileReferenceProjectId(project.record.id);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const timestamp = new Date().toISOString();
      const timePart = timestamp.replaceAll(/\D/g, "").slice(0, 17);
      const id = `project_file_${timePart}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
      const record = createWorkspaceRecord({
        entityType: "project_file_reference",
        id,
        ownerId: connection.ownerId,
        timestamp,
        data: createProjectFileReferenceData(project.record.id, fields),
      });
      const result = await adapter.writeText({
        path: recordPath("project_file_reference", id),
        text: serializeRecord(record),
        message: `project file: create ${id}`,
      });
      setProjectFileReferenceFiles((current) => [{ record, path: result.path, blobSha: result.blobSha }, ...current]);
      await appendProjectActivity({ projectId: project.record.id, eventType: "project_file_reference.created", changeSummary: { title: record.data.title }, sourceRef: id, timestamp });
      setStatusMessage("项目文件引用已保存为独立元数据；外部文件本体没有复制到仓库。");
      return true;
    } catch (error) {
      setErrorMessage(friendlyError(error));
      return false;
    } finally {
      setSavingProjectFileReferenceProjectId(null);
    }
  }

  async function updateProjectDeletion(item: SyncedProject, operation: "trash" | "restore") {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingProjectId || online === false) return;
    setSavingProjectId(item.record.id);
    setErrorMessage("");
    setStatusMessage("");
    const timestamp = new Date().toISOString();
    const updated = setWorkspaceRecordDeleted(item.record, operation === "trash" ? timestamp : null, timestamp);
    try {
      const result = await adapter.writeText({
        path: item.path,
        text: serializeRecord(updated),
        message: `project: ${operation} ${item.record.id}`,
        expectedBlobSha: item.blobSha,
      });
      setProjectFiles((current) => current.map((candidate) => candidate.record.id === item.record.id
        ? { record: updated, path: result.path, blobSha: result.blobSha }
        : candidate));
      if (operation === "trash" && taskProjectId === item.record.id) setTaskProjectId("");
      await appendProjectActivity({ projectId: item.record.id, eventType: operation === "trash" ? "project.trashed" : "project.restored", changeSummary: { deleted_at: updated.deleted_at }, sourceRef: item.record.id, timestamp: updated.updated_at });
      setStatusMessage(operation === "trash"
        ? "项目已移到回收站；关联任务只会暂时显示为项目不可用，不会被删除。"
        : "项目已从回收站恢复；关联任务关系会自动重新显示。");
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setSavingProjectId(null);
    }
  }

  async function updateTaskLifecycle(
    item: SyncedTask,
    operation: "complete" | "reopen" | "cancel" | "archive",
  ) {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingTaskId || online === false) return;
    setSavingTaskId(item.record.id);
    setErrorMessage("");
    setStatusMessage("");
    const nextStatus = {
      complete: "done",
      reopen: "todo",
      cancel: "cancelled",
      archive: "archived",
    } as const;
    const updated = setTaskStatus(item.record, nextStatus[operation]);
    try {
      const result = await adapter.writeText({
        path: item.path,
        text: serializeRecord(updated),
        message: `task: ${operation} ${item.record.id}`,
        expectedBlobSha: item.blobSha,
      });
      setTaskFiles((current) => current.map((candidate) => candidate.record.id === item.record.id
        ? { record: updated, path: result.path, blobSha: result.blobSha }
        : candidate));
      setStatusMessage({
        complete: "任务已完成；完成时间和 Git 历史已保留。",
        reopen: "任务已恢复为待办；请在其他设备刷新后查看最新状态。",
        cancel: "任务已取消；取消时间和 Git 历史已保留，可随时恢复。",
        archive: "任务已归档；Git 历史已保留，可随时恢复为待办。",
      }[operation]);
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setSavingTaskId(null);
    }
  }

  async function saveSubtask(parent: SyncedTask, rawTitle: string) {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingTaskId || online === false) return false;
    setSavingTaskId(parent.record.id);
    setErrorMessage("");
    setStatusMessage("");
    const timestamp = new Date().toISOString();
    const timePart = timestamp.replaceAll(/\D/g, "").slice(0, 17);
    const id = `task_${timePart}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    try {
      const data = createSubtaskData(parent.record, rawTitle);
      const record = createWorkspaceRecord({
        entityType: "task",
        id,
        ownerId: connection.ownerId,
        timestamp,
        data,
      });
      const result = await adapter.writeText({
        path: recordPath("task", id),
        text: serializeRecord(record),
        message: `task: create subtask ${id}`,
      });
      setTaskFiles((current) => [{ record, path: result.path, blobSha: result.blobSha }, ...current]);
      setTaskView("open");
      setStatusMessage("子任务已保存；它继承父任务的分类、项目、优先级和 DDL，可继续单独编辑。");
      return true;
    } catch (error) {
      setErrorMessage(friendlyError(error));
      return false;
    } finally {
      setSavingTaskId(null);
    }
  }

  async function saveTaskEdit(item: SyncedTask, details: TaskEditableFields) {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingTaskId || online === false) return false;
    setSavingTaskId(item.record.id);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const updated = updateTaskDetails(item.record, details);
      const result = await adapter.writeText({
        path: item.path,
        text: serializeRecord(updated),
        message: `task: edit ${item.record.id}`,
        expectedBlobSha: item.blobSha,
      });
      setTaskFiles((current) => current.map((candidate) => candidate.record.id === item.record.id
        ? { record: updated, path: result.path, blobSha: result.blobSha }
        : candidate));
      setStatusMessage("任务修改已保存；Git 历史和跨设备冲突保护保持启用。");
      return true;
    } catch (error) {
      setErrorMessage(friendlyError(error));
      return false;
    } finally {
      setSavingTaskId(null);
    }
  }

  async function updateTaskDeletion(item: SyncedTask, operation: "trash" | "restore") {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingTaskId || online === false) return;
    setSavingTaskId(item.record.id);
    setErrorMessage("");
    setStatusMessage("");
    const timestamp = new Date().toISOString();
    const updated = setWorkspaceRecordDeleted(
      item.record,
      operation === "trash" ? timestamp : null,
      timestamp,
    );
    try {
      const result = await adapter.writeText({
        path: item.path,
        text: serializeRecord(updated),
        message: `task: ${operation} ${item.record.id}`,
        expectedBlobSha: item.blobSha,
      });
      setTaskFiles((current) => current.map((candidate) => candidate.record.id === item.record.id
        ? { record: updated, path: result.path, blobSha: result.blobSha }
        : candidate));
      setStatusMessage(operation === "trash"
        ? "任务已移到回收站；原状态和 Git 历史均保留，可随时恢复。"
        : "任务已从回收站恢复到原状态；请在其他设备刷新后查看最新版本。");
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setSavingTaskId(null);
    }
  }

  async function saveReportDraft(report: DeterministicReport, audience: DeterministicReportAudience, markdown: string) {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingReportDraft || online === false) return false;
    setSavingReportDraft(true);
    setErrorMessage("");
    setStatusMessage("");
    const timestamp = new Date().toISOString();
    const timePart = timestamp.replaceAll(/\D/g, "").slice(0, 17);
    const id = `report_draft_${timePart}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    try {
      const record = createWorkspaceRecord({
        entityType: "report_draft",
        id,
        ownerId: connection.ownerId,
        timestamp,
        data: createReportDraftData(report, audience, markdown),
      });
      const result = await adapter.writeText({
        path: recordPath("report_draft", id),
        text: serializeRecord(record),
        message: `report: save draft ${id}`,
      });
      const saved: SyncedReportDraft = { record, path: result.path, blobSha: result.blobSha };
      setReportDraftFiles((current) => [saved, ...current]);
      setStatusMessage("ReportDraft 已保存为新的不可变事实快照；旧草稿没有被覆盖，也没有调用 AI 或自动发送。");
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error && error.message.startsWith("INVALID_REPORT_DRAFT")
        ? "报告草稿或事实快照无效，未写入任何数据。"
        : friendlyError(error));
      return false;
    } finally {
      setSavingReportDraft(false);
    }
  }

  async function saveTimeEntry(fields: { taskId: string; localDate: string; durationMinutes: number; notesMarkdown: string }) {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingTimeEntry || online === false) return false;
    const task = taskFiles.find((item) => item.record.id === fields.taskId && item.record.deleted_at === null);
    if (!task) { setErrorMessage("关联 Task 已不可用，请刷新后重新选择；未写入 Time Entry。"); return false; }
    setSavingTimeEntry(true); setErrorMessage(""); setStatusMessage("");
    const timestamp = new Date().toISOString();
    const id = `time_entry_${timestamp.replaceAll(/\D/g, "").slice(0, 17)}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    try {
      const record = createWorkspaceRecord({ entityType: "time_entry", id, ownerId: connection.ownerId, timestamp, data: createTimeEntryData({ taskId: task.record.id, projectId: task.record.data.project_id, localDate: fields.localDate, timezone: connection.timezone, durationMinutes: fields.durationMinutes, notesMarkdown: fields.notesMarkdown }) });
      const result = await adapter.writeText({ path: recordPath("time_entry", id), text: serializeRecord(record), message: `time: create ${id}` });
      setTimeEntryFiles((current) => [{ record, path: result.path, blobSha: result.blobSha }, ...current]);
      setStatusMessage("Time Entry 已保存；Task 的人工实际耗时未被改写，报告会单独汇总可追溯时长。");
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error && error.message.startsWith("INVALID_TIME_ENTRY") ? "日期、时长或关联无效，未写入 Time Entry。" : friendlyError(error));
      return false;
    } finally { setSavingTimeEntry(false); }
  }

  async function updateTimeEntryDeletion(item: SyncedTimeEntry, operation: "trash" | "restore") {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingTimeEntryId || online === false) return;
    setSavingTimeEntryId(item.record.id); setErrorMessage(""); setStatusMessage("");
    const timestamp = new Date().toISOString();
    const updated = setWorkspaceRecordDeleted(item.record, operation === "trash" ? timestamp : null, timestamp);
    try {
      const result = await adapter.writeText({ path: item.path, text: serializeRecord(updated), message: `time: ${operation} ${item.record.id}`, expectedBlobSha: item.blobSha });
      setTimeEntryFiles((current) => current.map((candidate) => candidate.record.id === item.record.id ? { record: updated, path: result.path, blobSha: result.blobSha } : candidate));
      setStatusMessage(operation === "trash" ? "Time Entry 已移到回收站；报告不再计入，可随时恢复。" : "Time Entry 已恢复；报告会重新计入该条事实。");
    } catch (error) { setErrorMessage(friendlyError(error)); }
    finally { setSavingTimeEntryId(null); }
  }

  async function saveJournalEntry(fields: { journalDate: string; title: string; bodyMarkdown: string; mood: string; weather: string }) {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingJournalEntry || online === false) return false;
    if (hasActiveDailyJournalDate(journalEntryFiles.map((item) => item.record), fields.journalDate)) {
      setErrorMessage("这一天已经有一篇未删除的 daily 日记；请编辑现有记录，未创建重复日记。");
      return false;
    }
    setSavingJournalEntry(true); setErrorMessage(""); setStatusMessage("");
    const timestamp = new Date().toISOString();
    const id = `journal_entry_${timestamp.replaceAll(/\D/g, "").slice(0, 17)}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    try {
      if (JOURNAL_REVISION_WRITES_ENABLED) {
        const revisionId = `journal_revision_${timestamp.replaceAll(/\D/g, "").slice(0, 17)}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
        const atomic = await createJournalEntryAtomically(adapter, {
          ownerId: connection.ownerId,
          journalEntryId: id,
          revisionId,
          journalDate: fields.journalDate,
          timezone: connection.timezone,
          title: fields.title,
          bodyMarkdown: fields.bodyMarkdown,
          mood: fields.mood,
          weather: fields.weather,
          timestamp,
        });
        setJournalEntryFiles((current) => [{ record: atomic.entry, path: atomic.entryFile.path, blobSha: atomic.entryFile.blobSha }, ...current]);
        setJournalRevisionFiles((current) => [
          ...atomic.revisions.map((record, index) => ({ record, path: atomic.revisionFiles[index]!.path, blobSha: atomic.revisionFiles[index]!.blobSha })),
          ...current,
        ]);
        setStatusMessage("日记与初始 Revision 已通过一个 Git commit 原子保存；没有连接、扫描或写入 Obsidian Vault。");
        return true;
      }
      const record = createWorkspaceRecord({ entityType: "journal_entry", id, ownerId: connection.ownerId, timestamp, data: createJournalEntryData({ journalDate: fields.journalDate, timezone: connection.timezone, title: fields.title, bodyMarkdown: fields.bodyMarkdown, mood: fields.mood, weather: fields.weather, timestamp }) });
      const result = await adapter.writeText({ path: recordPath("journal_entry", id), text: serializeRecord(record), message: `journal: create ${id}` });
      setJournalEntryFiles((current) => [{ record, path: result.path, blobSha: result.blobSha }, ...current]);
      setStatusMessage("日记已保存到 Private canonical JSON；没有连接、扫描或写入 Obsidian Vault。");
      return true;
    } catch (error) {
      setErrorMessage(friendlyJournalWriteError(error, "create"));
      return false;
    } finally { setSavingJournalEntry(false); }
  }

  async function saveJournalEntryEdit(item: SyncedJournalEntry, fields: { title: string; bodyMarkdown: string; mood: string; weather: string }) {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingJournalEntryId || online === false) return false;
    setSavingJournalEntryId(item.record.id); setErrorMessage(""); setStatusMessage("");
    const timestamp = new Date().toISOString();
    try {
      if (JOURNAL_REVISION_WRITES_ENABLED) {
        const atomic = await updateJournalEntryAtomically(adapter, {
          ownerId: connection.ownerId,
          journalEntryId: item.record.id,
          expectedJournalEntryBlobSha: item.blobSha,
          expectedCurrentRevisionId: item.record.data.current_revision_id,
          baselineRevisionId: `journal_revision_${timestamp.replaceAll(/\D/g, "").slice(0, 17)}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
          revisionId: `journal_revision_${timestamp.replaceAll(/\D/g, "").slice(0, 17)}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
          title: fields.title,
          bodyMarkdown: fields.bodyMarkdown,
          mood: fields.mood,
          weather: fields.weather,
          timestamp,
        });
        setJournalEntryFiles((current) => current.map((candidate) => candidate.record.id === item.record.id ? { record: atomic.entry, path: atomic.entryFile.path, blobSha: atomic.entryFile.blobSha } : candidate));
        setJournalRevisionFiles((current) => [
          ...atomic.revisions.map((record, index) => ({ record, path: atomic.revisionFiles[index]!.path, blobSha: atomic.revisionFiles[index]!.blobSha })),
          ...current,
        ]);
        setStatusMessage(atomic.revisions.length > 0
          ? `日记正文与 ${atomic.revisions.length} 个不可变 Revision 已通过一个 Git commit 原子保存。`
          : `日记元数据已保存为 v${atomic.entry.version}；正文 Revision 未发生变化。`);
        return true;
      }
      const updated = updateWorkspaceRecord(item.record, updateJournalEntryData(item.record, { title: fields.title, bodyMarkdown: fields.bodyMarkdown, mood: fields.mood, weather: fields.weather, timestamp }), timestamp);
      const result = await adapter.writeText({ path: item.path, text: serializeRecord(updated), message: `journal: update ${item.record.id}`, expectedBlobSha: item.blobSha });
      setJournalEntryFiles((current) => current.map((candidate) => candidate.record.id === item.record.id ? { record: updated, path: result.path, blobSha: result.blobSha } : candidate));
      setStatusMessage(`日记修订已保存为 v${updated.version}；日期与首次记录时间保持不变。`);
      return true;
    } catch (error) {
      setErrorMessage(friendlyJournalWriteError(error, "edit"));
      return false;
    } finally { setSavingJournalEntryId(null); }
  }

  async function updateJournalEntryDeletion(item: SyncedJournalEntry, operation: "trash" | "restore") {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingJournalEntryId || online === false) return;
    if (operation === "restore" && hasActiveDailyJournalDate(journalEntryFiles.map((candidate) => candidate.record), item.record.data.journal_date, item.record.id)) {
      setErrorMessage("同一天已有另一篇未删除的 daily 日记；为避免日期冲突，本次恢复已停止。");
      return;
    }
    setSavingJournalEntryId(item.record.id); setErrorMessage(""); setStatusMessage("");
    const timestamp = new Date().toISOString();
    const updated = setWorkspaceRecordDeleted(item.record, operation === "trash" ? timestamp : null, timestamp);
    try {
      const result = await adapter.writeText({ path: item.path, text: serializeRecord(updated), message: `journal: ${operation} ${item.record.id}`, expectedBlobSha: item.blobSha });
      setJournalEntryFiles((current) => current.map((candidate) => candidate.record.id === item.record.id ? { record: updated, path: result.path, blobSha: result.blobSha } : candidate));
      setStatusMessage(operation === "trash" ? "日记已移到可恢复回收站；Git 历史仍保留旧正文。" : "日记已恢复。没有覆盖同一天的其他记录。");
    } catch (error) { setErrorMessage(friendlyError(error)); }
    finally { setSavingJournalEntryId(null); }
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

  async function listTaskFiles(adapter: GitHubContentsAdapter) {
    try {
      return (await adapter.listDirectory("data/tasks"))
        .filter((item) => item.type === "file" && item.name.endsWith(".json"))
        .sort((left, right) => left.path.localeCompare(right.path));
    } catch (error) {
      if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return [];
      throw error;
    }
  }

  async function listTimeEntryFiles(adapter: GitHubContentsAdapter) {
    try { return (await adapter.listDirectory("data/time-entries")).filter((item) => item.type === "file" && item.name.endsWith(".json")).sort((left, right) => left.path.localeCompare(right.path)); }
    catch (error) { if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return []; throw error; }
  }

  async function listJournalEntryFiles(adapter: GitHubContentsAdapter) {
    try { return (await adapter.listDirectory("data/journal-entries")).filter((item) => item.type === "file" && item.name.endsWith(".json")).sort((left, right) => left.path.localeCompare(right.path)); }
    catch (error) { if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return []; throw error; }
  }

  async function listJournalSegmentFiles(adapter: GitHubContentsAdapter) {
    try { return (await adapter.listDirectory("data/journal-segments")).filter((item) => item.type === "file" && item.name.endsWith(".json")).sort((left, right) => left.path.localeCompare(right.path)); }
    catch (error) { if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return []; throw error; }
  }

  async function listJournalRevisionFiles(adapter: GitHubContentsAdapter) {
    try { return (await adapter.listDirectory("data/journal-revisions")).filter((item) => item.type === "file" && item.name.endsWith(".json")).sort((left, right) => left.path.localeCompare(right.path)); }
    catch (error) { if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return []; throw error; }
  }

  async function listJournalImportCheckpointFiles(adapter: GitHubContentsAdapter) {
    try { return (await adapter.listDirectory("data/journal-import-checkpoints")).filter((item) => item.type === "file" && item.name.endsWith(".json")).sort((left, right) => left.path.localeCompare(right.path)); }
    catch (error) { if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return []; throw error; }
  }

  async function listProjectFiles(adapter: GitHubContentsAdapter) {
    try {
      return (await adapter.listDirectory("data/projects"))
        .filter((item) => item.type === "file" && item.name.endsWith(".json"))
        .sort((left, right) => left.path.localeCompare(right.path));
    } catch (error) {
      if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return [];
      throw error;
    }
  }

  async function listProjectPhaseFiles(adapter: GitHubContentsAdapter) {
    try {
      return (await adapter.listDirectory("data/project-phases"))
        .filter((item) => item.type === "file" && item.name.endsWith(".json"))
        .sort((left, right) => left.path.localeCompare(right.path));
    } catch (error) {
      if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return [];
      throw error;
    }
  }

  async function listMilestoneFiles(adapter: GitHubContentsAdapter) {
    try {
      return (await adapter.listDirectory("data/milestones"))
        .filter((item) => item.type === "file" && item.name.endsWith(".json"))
        .sort((left, right) => left.path.localeCompare(right.path));
    } catch (error) {
      if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return [];
      throw error;
    }
  }

  async function listProjectNoteFiles(adapter: GitHubContentsAdapter) {
    try {
      return (await adapter.listDirectory("data/project-notes"))
        .filter((item) => item.type === "file" && item.name.endsWith(".json"))
        .sort((left, right) => left.path.localeCompare(right.path));
    } catch (error) {
      if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return [];
      throw error;
    }
  }

  async function listProjectFileReferenceFiles(adapter: GitHubContentsAdapter) {
    try {
      return (await adapter.listDirectory("data/project-file-references"))
        .filter((item) => item.type === "file" && item.name.endsWith(".json"))
        .sort((left, right) => left.path.localeCompare(right.path));
    } catch (error) {
      if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return [];
      throw error;
    }
  }

  async function listActivityEventFiles(adapter: GitHubContentsAdapter) {
    try {
      return (await adapter.listDirectory("data/activity-events"))
        .filter((item) => item.type === "file" && item.name.endsWith(".json"))
        .sort((left, right) => left.path.localeCompare(right.path));
    } catch (error) {
      if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return [];
      throw error;
    }
  }

  async function listCalendarEventFiles(adapter: GitHubContentsAdapter) {
    try {
      return (await adapter.listDirectory("data/calendar-events"))
        .filter((item) => item.type === "file" && item.name.endsWith(".json"))
        .sort((left, right) => left.path.localeCompare(right.path));
    } catch (error) {
      if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return [];
      throw error;
    }
  }

  async function listReportDraftFiles(adapter: GitHubContentsAdapter) {
    try {
      return (await adapter.listDirectory("data/report-drafts"))
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
      let dashboardLayoutFile = null;
      try {
        dashboardLayoutFile = await adapter.readText(DASHBOARD_LAYOUT_PATH);
      } catch (error) {
        if (!(error instanceof GitHubDataError) || error.code !== "GITHUB_NOT_FOUND") throw error;
      }
      const candidates = await listCaptureFiles(adapter);
      const captureFiles = [];
      const batchSize = 6;
      for (let index = 0; index < candidates.length; index += batchSize) {
        setExportProgress(`正在读取 Capture ${Math.min(index + batchSize, candidates.length)} / ${candidates.length}…`);
        captureFiles.push(...await Promise.all(
          candidates.slice(index, index + batchSize).map((item) => adapter.readText(item.path)),
        ));
      }
      const taskCandidates = await listTaskFiles(adapter);
      const taskFiles = [];
      for (let index = 0; index < taskCandidates.length; index += batchSize) {
        setExportProgress(`正在读取 Task ${Math.min(index + batchSize, taskCandidates.length)} / ${taskCandidates.length}…`);
        taskFiles.push(...await Promise.all(
          taskCandidates.slice(index, index + batchSize).map((item) => adapter.readText(item.path)),
        ));
      }
      const timeEntryCandidates = await listTimeEntryFiles(adapter);
      const timeEntryExportFiles = [];
      for (let index = 0; index < timeEntryCandidates.length; index += batchSize) {
        setExportProgress(`正在读取 TimeEntry ${Math.min(index + batchSize, timeEntryCandidates.length)} / ${timeEntryCandidates.length}…`);
        timeEntryExportFiles.push(...await Promise.all(timeEntryCandidates.slice(index, index + batchSize).map((item) => adapter.readText(item.path))));
      }
      const projectCandidates = await listProjectFiles(adapter);
      const projectFiles = [];
      for (let index = 0; index < projectCandidates.length; index += batchSize) {
        setExportProgress(`正在读取 Project ${Math.min(index + batchSize, projectCandidates.length)} / ${projectCandidates.length}…`);
        projectFiles.push(...await Promise.all(
          projectCandidates.slice(index, index + batchSize).map((item) => adapter.readText(item.path)),
        ));
      }
      const projectPhaseCandidates = await listProjectPhaseFiles(adapter);
      const projectPhaseFiles = [];
      for (let index = 0; index < projectPhaseCandidates.length; index += batchSize) {
        setExportProgress(`正在读取 ProjectPhase ${Math.min(index + batchSize, projectPhaseCandidates.length)} / ${projectPhaseCandidates.length}…`);
        projectPhaseFiles.push(...await Promise.all(
          projectPhaseCandidates.slice(index, index + batchSize).map((item) => adapter.readText(item.path)),
        ));
      }
      const milestoneCandidates = await listMilestoneFiles(adapter);
      const milestoneFiles = [];
      for (let index = 0; index < milestoneCandidates.length; index += batchSize) {
        setExportProgress(`正在读取 Milestone ${Math.min(index + batchSize, milestoneCandidates.length)} / ${milestoneCandidates.length}…`);
        milestoneFiles.push(...await Promise.all(
          milestoneCandidates.slice(index, index + batchSize).map((item) => adapter.readText(item.path)),
        ));
      }
      const projectNoteCandidates = await listProjectNoteFiles(adapter);
      const projectNoteFiles = [];
      for (let index = 0; index < projectNoteCandidates.length; index += batchSize) {
        setExportProgress(`正在读取 ProjectNote ${Math.min(index + batchSize, projectNoteCandidates.length)} / ${projectNoteCandidates.length}…`);
        projectNoteFiles.push(...await Promise.all(
          projectNoteCandidates.slice(index, index + batchSize).map((item) => adapter.readText(item.path)),
        ));
      }
      const activityEventCandidates = await listActivityEventFiles(adapter);
      const projectFileReferenceCandidates = await listProjectFileReferenceFiles(adapter);
      const projectFileReferenceExportFiles = [];
      for (let index = 0; index < projectFileReferenceCandidates.length; index += batchSize) {
        setExportProgress(`正在读取 ProjectFileReference ${Math.min(index + batchSize, projectFileReferenceCandidates.length)} / ${projectFileReferenceCandidates.length}…`);
        projectFileReferenceExportFiles.push(...await Promise.all(
          projectFileReferenceCandidates.slice(index, index + batchSize).map((item) => adapter.readText(item.path)),
        ));
      }
      const activityEventFiles = [];
      for (let index = 0; index < activityEventCandidates.length; index += batchSize) {
        setExportProgress(`正在读取 ActivityEvent ${Math.min(index + batchSize, activityEventCandidates.length)} / ${activityEventCandidates.length}…`);
        activityEventFiles.push(...await Promise.all(
          activityEventCandidates.slice(index, index + batchSize).map((item) => adapter.readText(item.path)),
        ));
      }
      const calendarEventCandidates = await listCalendarEventFiles(adapter);
      const calendarEventFiles = [];
      for (let index = 0; index < calendarEventCandidates.length; index += batchSize) {
        setExportProgress(`正在读取 CalendarEvent ${Math.min(index + batchSize, calendarEventCandidates.length)} / ${calendarEventCandidates.length}…`);
        calendarEventFiles.push(...await Promise.all(
          calendarEventCandidates.slice(index, index + batchSize).map((item) => adapter.readText(item.path)),
        ));
      }
      const reportDraftCandidates = await listReportDraftFiles(adapter);
      const reportDraftExportFiles = [];
      for (let index = 0; index < reportDraftCandidates.length; index += batchSize) {
        setExportProgress(`正在读取 ReportDraft ${Math.min(index + batchSize, reportDraftCandidates.length)} / ${reportDraftCandidates.length}…`);
        reportDraftExportFiles.push(...await Promise.all(
          reportDraftCandidates.slice(index, index + batchSize).map((item) => adapter.readText(item.path)),
        ));
      }
      const journalEntryCandidates = await listJournalEntryFiles(adapter);
      const journalEntryExportFiles = [];
      for (let index = 0; index < journalEntryCandidates.length; index += batchSize) {
        setExportProgress(`正在读取 JournalEntry ${Math.min(index + batchSize, journalEntryCandidates.length)} / ${journalEntryCandidates.length}…`);
        journalEntryExportFiles.push(...await Promise.all(journalEntryCandidates.slice(index, index + batchSize).map((item) => adapter.readText(item.path))));
      }
      const journalSegmentCandidates = await listJournalSegmentFiles(adapter);
      const journalSegmentExportFiles = [];
      for (let index = 0; index < journalSegmentCandidates.length; index += batchSize) {
        setExportProgress(`正在读取 JournalSegment ${Math.min(index + batchSize, journalSegmentCandidates.length)} / ${journalSegmentCandidates.length}…`);
        journalSegmentExportFiles.push(...await Promise.all(journalSegmentCandidates.slice(index, index + batchSize).map((item) => adapter.readText(item.path))));
      }
      const journalRevisionCandidates = await listJournalRevisionFiles(adapter);
      const journalRevisionExportFiles = [];
      for (let index = 0; index < journalRevisionCandidates.length; index += batchSize) {
        setExportProgress(`正在读取 JournalRevision ${Math.min(index + batchSize, journalRevisionCandidates.length)} / ${journalRevisionCandidates.length}…`);
        journalRevisionExportFiles.push(...await Promise.all(journalRevisionCandidates.slice(index, index + batchSize).map((item) => adapter.readText(item.path))));
      }
      const journalImportCheckpointCandidates = await listJournalImportCheckpointFiles(adapter);
      const journalImportCheckpointExportFiles = [];
      for (let index = 0; index < journalImportCheckpointCandidates.length; index += batchSize) {
        setExportProgress(`正在读取 JournalImportCheckpoint ${Math.min(index + batchSize, journalImportCheckpointCandidates.length)} / ${journalImportCheckpointCandidates.length}…`);
        journalImportCheckpointExportFiles.push(...await Promise.all(journalImportCheckpointCandidates.slice(index, index + batchSize).map((item) => adapter.readText(item.path))));
      }

      setExportProgress("正在生成 SHA-256 manifest…");
      const generatedAt = new Date().toISOString();
      const portableExport = await buildPortableWorkspaceExport({
        repository: connection.repository,
        branch: "main",
        workspaceFile,
        captureFiles,
        dashboardLayoutFile,
        taskFiles,
        timeEntryFiles: timeEntryExportFiles,
        projectFiles,
        projectPhaseFiles,
        milestoneFiles,
        projectNoteFiles,
        projectFileReferenceFiles: projectFileReferenceExportFiles,
        activityEventFiles,
        calendarEventFiles,
        reportDraftFiles: reportDraftExportFiles,
        journalEntryFiles: journalEntryExportFiles,
        journalSegmentFiles: journalSegmentExportFiles,
        journalRevisionFiles: journalRevisionExportFiles,
        journalImportCheckpointFiles: journalImportCheckpointExportFiles,
        generatedAt,
      });
      const inspection = await inspectPortableWorkspaceExport(portableExport);
      const migrationInspection = inspection.valid
        ? await dryRunPortableWorkspaceMigrations(portableExport)
        : null;
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
        dashboardLayouts: inspection.counts.dashboardLayouts,
        tasks: inspection.counts.tasks,
        timeEntries: inspection.counts.timeEntries,
        projects: inspection.counts.projects,
        projectPhases: inspection.counts.projectPhases,
        milestones: inspection.counts.milestones,
        projectNotes: inspection.counts.projectNotes,
        projectFileReferences: inspection.counts.projectFileReferences,
        activityEvents: inspection.counts.activityEvents,
        calendarEvents: inspection.counts.calendarEvents,
        reportDrafts: inspection.counts.reportDrafts,
        journalEntries: inspection.counts.journalEntries,
        journalSegments: inspection.counts.journalSegments,
        journalRevisions: inspection.counts.journalRevisions,
        journalImportCheckpoints: inspection.counts.journalImportCheckpoints,
        errors: inspection.errors,
        warnings: inspection.warnings,
      });
      setRestoreResult({
        fileName,
        valid: inspection.valid,
        files: inspection.counts.files,
        captures: inspection.counts.captures,
        dashboardLayouts: inspection.counts.dashboardLayouts,
        tasks: inspection.counts.tasks,
        timeEntries: inspection.counts.timeEntries,
        projects: inspection.counts.projects,
        projectPhases: inspection.counts.projectPhases,
        milestones: inspection.counts.milestones,
        projectNotes: inspection.counts.projectNotes,
        projectFileReferences: inspection.counts.projectFileReferences,
        activityEvents: inspection.counts.activityEvents,
        calendarEvents: inspection.counts.calendarEvents,
        reportDrafts: inspection.counts.reportDrafts,
        journalEntries: inspection.counts.journalEntries,
        journalSegments: inspection.counts.journalSegments,
        journalRevisions: inspection.counts.journalRevisions,
        journalImportCheckpoints: inspection.counts.journalImportCheckpoints,
        errors: inspection.errors,
        warnings: inspection.warnings,
      });
      setRestorePackage(inspection.valid ? portableExport : null);
      setMigrationDryRun(migrationInspection);
      resetRestoreTarget();
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
    setMigrationDryRun(null);
    setRestorePackage(null);
    setRestorePlan(null);
    setRestoreConfirmation("");
    setRestoreCommitSha(null);
    restoreAdapterRef.current = null;
    try {
      if (file.size > 50 * 1024 * 1024) {
        setRestoreResult({
          fileName: file.name,
          valid: false,
          files: 0,
          captures: 0,
          dashboardLayouts: 0,
          tasks: 0,
          timeEntries: 0,
          projects: 0,
          projectPhases: 0,
          milestones: 0,
          projectNotes: 0,
          projectFileReferences: 0,
          activityEvents: 0,
          calendarEvents: 0,
          reportDrafts: 0,
          journalEntries: 0,
          journalSegments: 0,
          journalRevisions: 0,
          journalImportCheckpoints: 0,
          errors: [{ code: "EXPORT_TOO_LARGE", message: "当前预检仅接受 50 MB 以内的 JSON 文件。" }],
          warnings: [],
        });
        return;
      }
      const parsed = JSON.parse(await file.text()) as unknown;
      const inspection = await inspectPortableWorkspaceExport(parsed);
      setRestoreResult({
        fileName: file.name,
        valid: inspection.valid,
        files: inspection.counts.files,
        captures: inspection.counts.captures,
        dashboardLayouts: inspection.counts.dashboardLayouts,
        tasks: inspection.counts.tasks,
        timeEntries: inspection.counts.timeEntries,
        projects: inspection.counts.projects,
        projectPhases: inspection.counts.projectPhases,
        milestones: inspection.counts.milestones,
        projectNotes: inspection.counts.projectNotes,
        projectFileReferences: inspection.counts.projectFileReferences,
        activityEvents: inspection.counts.activityEvents,
        calendarEvents: inspection.counts.calendarEvents,
        reportDrafts: inspection.counts.reportDrafts,
        journalEntries: inspection.counts.journalEntries,
        journalSegments: inspection.counts.journalSegments,
        journalRevisions: inspection.counts.journalRevisions,
        journalImportCheckpoints: inspection.counts.journalImportCheckpoints,
        errors: inspection.errors,
        warnings: inspection.warnings,
      });
      if (inspection.valid) {
        setRestorePackage(parsed);
        setMigrationDryRun(await dryRunPortableWorkspaceMigrations(parsed));
      }
    } catch {
      setRestoreResult({
        fileName: file.name,
        valid: false,
        files: 0,
        captures: 0,
        dashboardLayouts: 0,
        tasks: 0,
        timeEntries: 0,
        projects: 0,
        projectPhases: 0,
        milestones: 0,
        projectNotes: 0,
        projectFileReferences: 0,
        activityEvents: 0,
        calendarEvents: 0,
        reportDrafts: 0,
        journalEntries: 0,
        journalSegments: 0,
        journalRevisions: 0,
        journalImportCheckpoints: 0,
        errors: [{ code: "INVALID_JSON", message: "文件不是有效的 JSON，未执行任何恢复操作。" }],
        warnings: [],
      });
    } finally {
      setCheckingRestore(false);
    }
  }

  function resetRestoreTarget() {
    restoreAdapterRef.current = null;
    setRestorePlan(null);
    setRestoreConfirmation("");
    setRestoreCommitSha(null);
  }

  async function checkRestoreTarget() {
    const canonicalAdapter = adapterRef.current;
    const targetOwner = restoreTargetOwner.trim();
    const targetRepository = restoreTargetRepository.trim();
    if (
      !canonicalAdapter
      || !connection
      || !restorePackage
      || !restoreResult?.valid
      || !targetOwner
      || !targetRepository
      || checkingRestoreTarget
      || online === false
    ) return;

    setCheckingRestoreTarget(true);
    setErrorMessage("");
    setStatusMessage("");
    resetRestoreTarget();
    try {
      const verifier = canonicalAdapter.forRepository(targetOwner, targetRepository);
      const repositoryStatus = await verifier.verifyPrivateRepository();
      const targetAdapter = canonicalAdapter.forRepository(
        targetOwner,
        targetRepository,
        repositoryStatus.defaultBranch,
      );
      const [branch, rootEntries] = await Promise.all([
        targetAdapter.readBranchSnapshot(),
        targetAdapter.listDirectory(""),
      ]);
      const plan = await createPortableRestorePlan(restorePackage, {
        repository: repositoryStatus,
        branch,
        rootEntries,
      });
      setRestorePlan(plan);
      if (plan.ready) {
        restoreAdapterRef.current = targetAdapter;
        setStatusMessage("恢复目标检查通过。只有再次输入完整仓库名后，原子恢复按钮才会启用。");
      }
    } catch (error) {
      setErrorMessage(error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND"
        ? "找不到恢复目标，或目标尚未用 README 初始化默认分支，或 GitHub App 尚未获得该仓库权限。"
        : friendlyError(error));
    } finally {
      setCheckingRestoreTarget(false);
    }
  }

  async function executePortableRestore() {
    const targetAdapter = restoreAdapterRef.current;
    if (
      !targetAdapter
      || !restorePackage
      || !restorePlan?.ready
      || restoreConfirmation !== restorePlan.targetRepository
      || restoring
      || online === false
    ) return;

    setRestoring(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const repositoryStatus = await targetAdapter.verifyPrivateRepository();
      const [branch, rootEntries] = await Promise.all([
        targetAdapter.readBranchSnapshot(),
        targetAdapter.listDirectory(""),
      ]);
      const freshPlan = await createPortableRestorePlan(restorePackage, {
        repository: repositoryStatus,
        branch,
        rootEntries,
      });
      setRestorePlan(freshPlan);
      if (!freshPlan.ready) {
        restoreAdapterRef.current = null;
        setRestoreConfirmation("");
        setErrorMessage("恢复目标已不再满足安全条件，未写入任何文件。请检查诊断后重新开始。");
        return;
      }
      if (freshPlan.expectedHeadCommitSha !== restorePlan.expectedHeadCommitSha) {
        restoreAdapterRef.current = null;
        setRestoreConfirmation("");
        setErrorMessage("恢复目标在确认期间发生了变化，未写入任何文件。请重新检查目标。");
        return;
      }
      const result = await targetAdapter.writeAtomicFiles({
        files: freshPlan.files,
        message: `restore: import ${freshPlan.counts.files} workspace files`,
        expectedHeadCommitSha: freshPlan.expectedHeadCommitSha,
        baseTreeSha: freshPlan.baseTreeSha,
      });
      setRestoreCommitSha(result.commitSha);
      setRestoreConfirmation("");
      restoreAdapterRef.current = null;
      setStatusMessage(`恢复完成：${freshPlan.counts.files} 个文件已通过单个 Git commit 写入隔离仓库。`);
    } catch (error) {
      setErrorMessage(error instanceof GitHubDataError && error.code === "GITHUB_SYNC_CONFLICT"
        ? "恢复目标在写入期间发生了变化，GitHub 已拒绝提交；没有发生静默覆盖。"
        : friendlyError(error));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <main className="preview-shell">
      <AuthSection
        online={online}
        connection={connection}
        connectionMethod={connectionMethod}
        authAvailability={authAvailability}
        owner={owner}
        repository={repository}
        token={token}
        connecting={connecting}
        confirmingRevokeAll={confirmingRevokeAll}
        revokingAll={revokingAll}
        errorMessage={errorMessage}
        statusMessage={statusMessage}
        onOwnerChange={setOwner}
        onRepositoryChange={setRepository}
        onTokenChange={setToken}
        onConnect={connect}
        onDisconnect={disconnect}
        onConfirmingRevokeAllChange={setConfirmingRevokeAll}
        onRevokeAll={revokeAllSessions}
      />


      <DashboardSection
        connection={connection}
        online={online}
        dashboardLayout={dashboardLayout}
        dashboardBlobSha={dashboardBlobSha}
        dashboardDirty={dashboardDirty}
        editingDashboard={editingDashboard}
        loadingDashboard={loadingDashboard}
        savingDashboard={savingDashboard}
        visibleWidgets={visibleDashboardWidgets}
        hiddenWidgets={hiddenDashboardWidgets}
        capture={capture}
        savingCapture={saving}
        savedCapture={savedCapture}
        todayTasks={todayTaskFiles}
        currentProjects={currentProjectFiles}
        projectTasks={taskFiles}
        projectMilestones={milestoneFiles}
        calendarEvents={calendarEventFiles}
        journalEntries={journalEntryFiles}
        loadingTasks={loadingTasks}
        loadingProjects={loadingProjects}
        loadingMilestones={loadingMilestones}
        loadingCalendarEvents={loadingCalendarEvents}
        loadingJournalEntries={loadingJournalEntries}
        savingTaskId={savingTaskId}
        currentTaskDate={currentTaskDate}
        onToggleEditing={() => setEditingDashboard((current) => !current)}
        onRefresh={() => loadDashboardLayout(adapterRef.current, connection?.ownerId)}
        onSaveLayout={saveDashboardLayout}
        onWidgetChange={changeDashboardWidget}
        onWidgetResize={resizeDashboardWidget}
        onReset={resetDashboardToDefault}
        onCaptureChange={setCapture}
        onSaveCapture={saveCapture}
        onCompleteTask={(item) => updateTaskLifecycle(item, "complete")}
      />


      <CalendarSection
        key={connection?.timezone ?? "disconnected"}
        connection={connection}
        online={online}
        todayDate={currentTaskDate}
        eventFiles={calendarEventFiles}
        taskFiles={taskFiles}
        loading={loadingCalendarEvents}
        saving={savingCalendarEvent}
        savingEventId={savingCalendarEventId}
        onCreate={saveCalendarEvent}
        onEdit={saveCalendarEventEdit}
        onLifecycleChange={updateCalendarEventLifecycle}
        onDeletionChange={updateCalendarEventDeletion}
        onRefresh={() => loadCalendarEvents()}
      />


      <ProjectsSection
        connection={connection}
        online={online}
        projectName={projectName}
        projectTargetDate={projectTargetDate}
        projectFiles={projectFiles}
        projectPhaseFiles={projectPhaseFiles}
        milestoneFiles={milestoneFiles}
        projectNoteFiles={projectNoteFiles}
        projectFileReferenceFiles={projectFileReferenceFiles}
        activityEventFiles={activityEventFiles}
        currentProjectFiles={currentProjectFiles}
        completedProjectFiles={completedProjectFiles}
        cancelledProjectFiles={cancelledProjectFiles}
        archivedProjectFiles={archivedProjectFiles}
        trashedProjectFiles={trashedProjectFiles}
        visibleProjectFiles={visibleProjectFiles}
        projectView={projectView}
        taskFiles={taskFiles}
        loadingProjects={loadingProjects}
        loadingProjectPhases={loadingProjectPhases}
        loadingMilestones={loadingMilestones}
        loadingProjectNotes={loadingProjectNotes}
        loadingProjectFileReferences={loadingProjectFileReferences}
        loadingActivityEvents={loadingActivityEvents}
        savingProject={savingProject}
        savingProjectId={savingProjectId}
        savingProjectPhaseProjectId={savingProjectPhaseProjectId}
        savingMilestoneProjectId={savingMilestoneProjectId}
        savingMilestoneId={savingMilestoneId}
        savingProjectNoteProjectId={savingProjectNoteProjectId}
        savingProjectNoteId={savingProjectNoteId}
        savingProjectFileReferenceProjectId={savingProjectFileReferenceProjectId}
        currentDate={currentTaskDate}
        onProjectNameChange={setProjectName}
        onProjectTargetDateChange={setProjectTargetDate}
        onCreateProject={saveProject}
        onProjectViewChange={setProjectView}
        onLifecycleChange={updateProjectLifecycle}
        onDeletionChange={updateProjectDeletion}
        onEditProject={saveProjectEdit}
        onCreatePhase={saveProjectPhase}
        onSetCurrentPhase={setCurrentProjectPhase}
        onCreateMilestone={saveMilestone}
        onMilestoneLifecycle={updateMilestoneLifecycle}
        onCreateProjectNote={saveProjectNote}
        onEditProjectNote={saveProjectNoteEdit}
        onCreateProjectFileReference={saveProjectFileReference}
        onRefresh={() => Promise.all([loadProjects(), loadProjectPhases(), loadMilestones(), loadProjectNotes(), loadProjectFileReferences(), loadActivityEvents()])}
      />


      <TasksSection
        connection={connection}
        online={online}
        taskTitle={taskTitle}
        taskCategory={taskCategory}
        taskPriority={taskPriority}
        taskProjectId={taskProjectId}
        taskDueDate={taskDueDate}
        taskView={taskView}
        taskFiles={taskFiles}
        projectFiles={projectFiles}
        selectableProjectFiles={currentProjectFiles}
        openTaskFiles={openTaskFiles}
        completedTaskFiles={completedTaskFiles}
        cancelledTaskFiles={cancelledTaskFiles}
        archivedTaskFiles={archivedTaskFiles}
        trashedTaskFiles={trashedTaskFiles}
        visibleTaskFiles={visibleTaskFiles}
        currentTaskDate={currentTaskDate}
        loadingTasks={loadingTasks}
        savingTask={savingTask}
        savingTaskId={savingTaskId}
        onTaskTitleChange={setTaskTitle}
        onTaskCategoryChange={setTaskCategory}
        onTaskPriorityChange={setTaskPriority}
        onTaskProjectIdChange={setTaskProjectId}
        onTaskDueDateChange={setTaskDueDate}
        onTaskViewChange={setTaskView}
        onCreateTask={saveTask}
        onRefresh={() => loadTasks()}
        onLifecycleChange={updateTaskLifecycle}
        onDeletionChange={updateTaskDeletion}
        onEditTask={saveTaskEdit}
        onCreateSubtask={saveSubtask}
      />


      <TimeEntriesSection
        connection={connection}
        online={online}
        todayDate={currentTaskDate}
        taskFiles={taskFiles}
        projectFiles={projectFiles}
        timeEntryFiles={timeEntryFiles}
        loading={loadingTimeEntries}
        saving={savingTimeEntry}
        savingId={savingTimeEntryId}
        onCreate={saveTimeEntry}
        onDeletionChange={updateTimeEntryDeletion}
        onRefresh={() => loadTimeEntries()}
      />


      <JournalSection
        connection={connection}
        adapter={adapterRef.current}
        online={online}
        todayDate={currentTaskDate}
        journalEntryFiles={journalEntryFiles}
        loading={loadingJournalEntries}
        saving={savingJournalEntry}
        savingId={savingJournalEntryId}
        onCreate={saveJournalEntry}
        onEdit={saveJournalEntryEdit}
        onDeletionChange={updateJournalEntryDeletion}
        onRefresh={() => loadJournalEntries()}
      />


      <ReportsSection
        connection={connection}
        todayDate={currentTaskDate}
        taskFiles={taskFiles}
        projectFiles={projectFiles}
        milestoneFiles={milestoneFiles}
        calendarEventFiles={calendarEventFiles}
        activityEventFiles={activityEventFiles}
        timeEntryFiles={timeEntryFiles}
        reportDraftFiles={reportDraftFiles}
        loading={loadingTasks || loadingTimeEntries || loadingProjects || loadingMilestones || loadingCalendarEvents || loadingActivityEvents || loadingReportDrafts}
        savingDraft={savingReportDraft}
        onRefresh={() => void Promise.all([loadTasks(), loadTimeEntries(), loadProjects(), loadMilestones(), loadCalendarEvents(), loadActivityEvents(), loadReportDrafts()])}
        onSaveDraft={saveReportDraft}
      />


      <ReadinessSection readiness={readiness} connectionMethod={connectionMethod} />


      <CaptureInboxSection
        connection={connection}
        online={online}
        captureView={captureView}
        inboxCaptures={inboxCaptures}
        trashedCaptures={trashedCaptures}
        visibleCaptures={visibleCaptures}
        loadingCaptures={loadingCaptures}
        savingCaptureId={savingCaptureId}
        onViewChange={setCaptureView}
        onRefresh={() => loadRecentCaptures()}
        onLifecycleChange={updateCaptureLifecycle}
      />


      <PortabilitySection
        connection={connection}
        online={online}
        exporting={exporting}
        exportProgress={exportProgress}
        checkingRestore={checkingRestore}
        checkingRestoreTarget={checkingRestoreTarget}
        restoring={restoring}
        exportResult={exportResult}
        restoreResult={restoreResult}
        migrationDryRun={migrationDryRun}
        restoreTargetOwner={restoreTargetOwner}
        restoreTargetRepository={restoreTargetRepository}
        restorePlan={restorePlan}
        restoreConfirmation={restoreConfirmation}
        restoreCommitSha={restoreCommitSha}
        onExport={downloadPortableExport}
        onPreflight={preflightRestore}
        onTargetOwnerChange={setRestoreTargetOwner}
        onTargetRepositoryChange={setRestoreTargetRepository}
        onResetTarget={resetRestoreTarget}
        onCheckTarget={checkRestoreTarget}
        onConfirmationChange={setRestoreConfirmation}
        onRestore={executePortableRestore}
      />


      <footer className="page-footer">
        <span>Personal Workspace</span>
        <span>GitHub live sync · Phase 1C</span>
      </footer>
    </main>
  );
}

function selectSyncedProjects(
  projectFiles: SyncedProject[],
  select: (records: SyncedProject["record"][]) => SyncedProject["record"][],
) {
  const byId = new Map(projectFiles.map((item) => [item.record.id, item]));
  return select(projectFiles.map((item) => item.record))
    .map((record) => byId.get(record.id))
    .filter((item): item is SyncedProject => Boolean(item));
}
