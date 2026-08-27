"use client";

import { type ChangeEvent, type FormEvent, useCallback, useMemo, useRef, useState } from "react";

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
} from "../../../src/lib/github-data/protocol";
import {
  newestCaptures,
  newestTrashedCaptures,
} from "../../../src/lib/github-data/workspace";
import {
  completedTasks,
  openTasks,
  setTaskStatus,
  tasksForToday,
  type TaskCategory,
  type TaskData,
  type TaskPriority,
} from "../../../src/lib/github-data/tasks";
import {
  DEFAULT_OWNER,
  DEFAULT_REPOSITORY,
  buildReadiness,
  friendlyError,
  localDateInTimezone,
  openPrivateRepository,
  readCookie,
  type AuthAvailability,
  type Connection,
  type ConnectionMethod,
  type PortabilityResult,
  type SavedCapture,
  type SyncedCapture,
  type SyncedTask,
} from "./workspace/page-model";
import { useOnlineStatus } from "./workspace/use-online-status";
import { useWorkspaceCollections } from "./workspace/use-workspace-collections";
import { useGitHubAppBootstrap } from "./workspace/use-github-app-bootstrap";
import { CaptureInboxSection } from "./workspace/capture-inbox-section";
import { DashboardSection } from "./workspace/dashboard-section";
import { AuthSection } from "./workspace/auth-section";
import { PortabilitySection } from "./workspace/portability-section";
import { ReadinessSection } from "./workspace/readiness-section";
import { TasksSection } from "./workspace/tasks-section";

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
  const [taskDueDate, setTaskDueDate] = useState(() => localDateInTimezone("Asia/Shanghai"));
  const [taskView, setTaskView] = useState<"open" | "done">("open");
  const [savingTask, setSavingTask] = useState(false);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
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
  });


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
  const currentTaskDate = localDateInTimezone(connection?.timezone ?? "Asia/Shanghai");
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
  const todayTaskFiles = useMemo(() => {
    const byId = new Map(taskFiles.map((item) => [item.record.id, item]));
    return tasksForToday(taskFiles.map((item) => item.record), currentTaskDate)
      .map((record) => byId.get(record.id))
      .filter((item): item is SyncedTask => Boolean(item));
  }, [currentTaskDate, taskFiles]);
  const visibleTaskFiles = taskView === "open" ? openTaskFiles : completedTaskFiles;
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
      project_id: null,
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

  async function updateTaskCompletion(item: SyncedTask, operation: "complete" | "reopen") {
    const adapter = adapterRef.current;
    if (!adapter || !connection || savingTaskId || online === false) return;
    setSavingTaskId(item.record.id);
    setErrorMessage("");
    setStatusMessage("");
    const updated = setTaskStatus(item.record, operation === "complete" ? "done" : "todo");
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
      setStatusMessage(operation === "complete"
        ? "任务已完成；完成时间和 Git 历史已保留。"
        : "任务已恢复为待办；请在其他设备刷新后查看最新状态。");
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setSavingTaskId(null);
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

      setExportProgress("正在生成 SHA-256 manifest…");
      const generatedAt = new Date().toISOString();
      const portableExport = await buildPortableWorkspaceExport({
        repository: connection.repository,
        branch: "main",
        workspaceFile,
        captureFiles,
        dashboardLayoutFile,
        taskFiles,
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
        loadingTasks={loadingTasks}
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
        onCompleteTask={(item) => updateTaskCompletion(item, "complete")}
      />


      <TasksSection
        connection={connection}
        online={online}
        taskTitle={taskTitle}
        taskCategory={taskCategory}
        taskPriority={taskPriority}
        taskDueDate={taskDueDate}
        taskView={taskView}
        taskFiles={taskFiles}
        openTaskFiles={openTaskFiles}
        completedTaskFiles={completedTaskFiles}
        visibleTaskFiles={visibleTaskFiles}
        currentTaskDate={currentTaskDate}
        loadingTasks={loadingTasks}
        savingTask={savingTask}
        savingTaskId={savingTaskId}
        onTaskTitleChange={setTaskTitle}
        onTaskCategoryChange={setTaskCategory}
        onTaskPriorityChange={setTaskPriority}
        onTaskDueDateChange={setTaskDueDate}
        onTaskViewChange={setTaskView}
        onCreateTask={saveTask}
        onRefresh={() => loadTasks()}
        onCompletionChange={updateTaskCompletion}
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
