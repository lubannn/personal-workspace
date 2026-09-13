import type { GitHubStoredFile } from "./github-contents";
import { DASHBOARD_LAYOUT_PATH, parseDashboardLayout } from "./dashboard-layout";
import { recordPath } from "./protocol";
import { parseProjectRecord } from "./projects";
import { parseProjectPhaseRecord } from "./project-phases";
import { parseMilestoneRecord } from "./milestones";
import { parseProjectNoteRecord } from "./project-notes";
import { parseProjectFileReferenceRecord } from "./project-file-references";
import { parseActivityEventRecord } from "./activity-events";
import { parseCalendarEventRecord } from "./calendar-events";
import { parseReportDraftRecord } from "./report-drafts";
import { parseTaskRecord } from "./tasks";
import { parseTimeEntryRecord } from "./time-entries";
import { parseJournalEntryRecord } from "./journal-entries";
import { parseJournalSegmentRecord } from "./journal-segments";
import { parseJournalRevisionRecord, sha256JournalRevisionBody } from "./journal-revisions";
import { parseJournalImportCheckpointRecord } from "./journal-import-checkpoints";
import { parseObsidianDocumentRecord } from "./obsidian-documents";
import { parseSyncConflictRecord } from "./sync-conflicts";
import { parseLearningAreaRecord } from "./learning-areas";
import { parseHabitRecord } from "./habits";
import { parseHabitRuleRecord } from "./habit-rules";
import { parseHabitCheckInRecord } from "./habit-check-ins";
import { parseHealthStagingRecord } from "./health-staging-records";
import { parseHealthMetricRecord } from "./health-metrics";
import { parseSleepSessionRecord } from "./sleep-sessions";
import { renderJournalSegmentsMarkdown } from "./journal-segment-codec";
import { parseCaptureRecord, parseWorkspaceDescriptor, type WorkspaceDescriptor } from "./workspace";

export const PORTABLE_EXPORT_FORMAT = "personal-workspace-export" as const;
export const PORTABLE_EXPORT_VERSION = 1 as const;

export type PortableExportManifestFile = {
  path: string;
  blob_sha: string;
  size_bytes: number;
  sha256: string;
};

export type PortableExportFile = {
  path: string;
  content: string;
};

export type PortableWorkspaceExport = {
  format: typeof PORTABLE_EXPORT_FORMAT;
  export_version: typeof PORTABLE_EXPORT_VERSION;
  generated_at: string;
  source: {
    repository: string;
    branch: string;
  };
  manifest: {
    schema_version: 1;
    scope: {
      modules: Array<"workspace" | "captures" | "dashboard_layout" | "tasks" | "time_entries" | "projects" | "project_phases" | "milestones" | "project_notes" | "project_file_references" | "activity_events" | "calendar_events" | "report_drafts" | "journal_entries" | "journal_segments" | "journal_revisions" | "journal_import_checkpoints" | "obsidian_documents" | "sync_conflicts" | "learning_areas" | "habits" | "habit_rules" | "habit_check_ins" | "health_staging_records" | "health_metrics" | "sleep_sessions">;
      complete: true;
    };
    counts: {
      files: number;
      captures: number;
      dashboard_layouts: number;
      tasks: number;
      time_entries: number;
      projects: number;
      project_phases: number;
      milestones: number;
      project_notes: number;
      project_file_references: number;
      activity_events: number;
      calendar_events: number;
      report_drafts: number;
      journal_entries: number;
      journal_segments: number;
      journal_revisions: number;
      journal_import_checkpoints: number;
      obsidian_documents: number;
      sync_conflicts: number;
      learning_areas: number;
      habits: number;
      habit_rules: number;
      habit_check_ins: number;
      health_staging_records: number;
      health_metrics: number;
      sleep_sessions: number;
    };
    files: PortableExportManifestFile[];
  };
  files: PortableExportFile[];
};

export type ExportInspectionIssue = {
  code: string;
  message: string;
  path?: string;
};

export type ExportInspection = {
  valid: boolean;
  generatedAt: string | null;
  repository: string | null;
  workspace: WorkspaceDescriptor | null;
  counts: {
    files: number;
    captures: number;
    dashboardLayouts: number;
    tasks: number;
    timeEntries: number;
    projects: number;
    projectPhases: number;
    milestones: number;
    projectNotes: number;
    projectFileReferences: number;
    activityEvents: number;
    calendarEvents: number;
    reportDrafts: number;
    journalEntries: number;
    journalSegments: number;
    journalRevisions: number;
    journalImportCheckpoints: number;
    obsidianDocuments: number;
    syncConflicts: number;
    learningAreas: number;
    habits: number;
    habitRules: number;
    habitCheckIns: number;
    healthStagingRecords: number;
    healthMetrics: number;
    sleepSessions: number;
  };
  errors: ExportInspectionIssue[];
  warnings: ExportInspectionIssue[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export async function sha256Text(value: string) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildPortableWorkspaceExport(input: {
  repository: string;
  branch: string;
  workspaceFile: GitHubStoredFile;
  captureFiles: GitHubStoredFile[];
  dashboardLayoutFile?: GitHubStoredFile | null;
  taskFiles?: GitHubStoredFile[];
  timeEntryFiles?: GitHubStoredFile[];
  projectFiles?: GitHubStoredFile[];
  projectPhaseFiles?: GitHubStoredFile[];
  milestoneFiles?: GitHubStoredFile[];
  projectNoteFiles?: GitHubStoredFile[];
  projectFileReferenceFiles?: GitHubStoredFile[];
  activityEventFiles?: GitHubStoredFile[];
  calendarEventFiles?: GitHubStoredFile[];
  reportDraftFiles?: GitHubStoredFile[];
  journalEntryFiles?: GitHubStoredFile[];
  journalSegmentFiles?: GitHubStoredFile[];
  journalRevisionFiles?: GitHubStoredFile[];
  journalImportCheckpointFiles?: GitHubStoredFile[];
  obsidianDocumentFiles?: GitHubStoredFile[];
  syncConflictFiles?: GitHubStoredFile[];
  learningAreaFiles?: GitHubStoredFile[];
  habitFiles?: GitHubStoredFile[];
  habitRuleFiles?: GitHubStoredFile[];
  habitCheckInFiles?: GitHubStoredFile[];
  healthStagingFiles?: GitHubStoredFile[];
  healthMetricFiles?: GitHubStoredFile[];
  sleepSessionFiles?: GitHubStoredFile[];
  generatedAt?: string;
}): Promise<PortableWorkspaceExport> {
  const dashboardLayoutFiles = input.dashboardLayoutFile ? [input.dashboardLayoutFile] : [];
  const taskFiles = input.taskFiles ?? [];
  const timeEntryFiles = input.timeEntryFiles ?? [];
  const projectFiles = input.projectFiles ?? [];
  const projectPhaseFiles = input.projectPhaseFiles ?? [];
  const milestoneFiles = input.milestoneFiles ?? [];
  const projectNoteFiles = input.projectNoteFiles ?? [];
  const projectFileReferenceFiles = input.projectFileReferenceFiles ?? [];
  const activityEventFiles = input.activityEventFiles ?? [];
  const calendarEventFiles = input.calendarEventFiles ?? [];
  const reportDraftFiles = input.reportDraftFiles ?? [];
  const journalEntryFiles = input.journalEntryFiles ?? [];
  const journalSegmentFiles = input.journalSegmentFiles ?? [];
  const journalRevisionFiles = input.journalRevisionFiles ?? [];
  const journalImportCheckpointFiles = input.journalImportCheckpointFiles ?? [];
  const obsidianDocumentFiles = input.obsidianDocumentFiles ?? [];
  const syncConflictFiles = input.syncConflictFiles ?? [];
  const learningAreaFiles = input.learningAreaFiles ?? [];
  const habitFiles = input.habitFiles ?? [];
  const habitRuleFiles = input.habitRuleFiles ?? [];
  const habitCheckInFiles = input.habitCheckInFiles ?? [];
  const healthStagingFiles = input.healthStagingFiles ?? [];
  const healthMetricFiles = input.healthMetricFiles ?? [];
  const sleepSessionFiles = input.sleepSessionFiles ?? [];
  const files = [input.workspaceFile, ...input.captureFiles, ...dashboardLayoutFiles, ...taskFiles, ...timeEntryFiles, ...projectFiles, ...projectPhaseFiles, ...milestoneFiles, ...projectNoteFiles, ...projectFileReferenceFiles, ...activityEventFiles, ...calendarEventFiles, ...reportDraftFiles, ...journalEntryFiles, ...journalSegmentFiles, ...journalRevisionFiles, ...journalImportCheckpointFiles, ...obsidianDocumentFiles, ...syncConflictFiles, ...learningAreaFiles, ...habitFiles, ...habitRuleFiles, ...habitCheckInFiles, ...healthStagingFiles, ...healthMetricFiles, ...sleepSessionFiles]
    .map((file) => ({ ...file }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const manifestFiles = await Promise.all(files.map(async (file) => ({
    path: file.path,
    blob_sha: file.blobSha,
    size_bytes: byteLength(file.text),
    sha256: await sha256Text(file.text),
  })));

  return {
    format: PORTABLE_EXPORT_FORMAT,
    export_version: PORTABLE_EXPORT_VERSION,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    source: { repository: input.repository, branch: input.branch },
    manifest: {
      schema_version: 1,
      scope: { modules: ["workspace", "captures", "dashboard_layout", "tasks", "time_entries", "projects", "project_phases", "milestones", "project_notes", "project_file_references", "activity_events", "calendar_events", "report_drafts", "journal_entries", "journal_segments", "journal_revisions", "journal_import_checkpoints", "obsidian_documents", "sync_conflicts", "learning_areas", "habits", "habit_rules", "habit_check_ins", "health_staging_records", "health_metrics", "sleep_sessions"], complete: true },
      counts: {
        files: files.length,
        captures: input.captureFiles.length,
        dashboard_layouts: dashboardLayoutFiles.length,
        tasks: taskFiles.length,
        time_entries: timeEntryFiles.length,
        projects: projectFiles.length,
        project_phases: projectPhaseFiles.length,
        milestones: milestoneFiles.length,
        project_notes: projectNoteFiles.length,
        project_file_references: projectFileReferenceFiles.length,
        activity_events: activityEventFiles.length,
        calendar_events: calendarEventFiles.length,
        report_drafts: reportDraftFiles.length,
        journal_entries: journalEntryFiles.length,
        journal_segments: journalSegmentFiles.length,
        journal_revisions: journalRevisionFiles.length,
        journal_import_checkpoints: journalImportCheckpointFiles.length,
        obsidian_documents: obsidianDocumentFiles.length,
        sync_conflicts: syncConflictFiles.length,
        learning_areas: learningAreaFiles.length,
        habits: habitFiles.length,
        habit_rules: habitRuleFiles.length,
        habit_check_ins: habitCheckInFiles.length,
        health_staging_records: healthStagingFiles.length,
        health_metrics: healthMetricFiles.length,
        sleep_sessions: sleepSessionFiles.length,
      },
      files: manifestFiles,
    },
    files: files.map((file) => ({ path: file.path, content: file.text })),
  };
}

function readManifestFile(value: unknown): PortableExportManifestFile | null {
  if (!isObject(value)) return null;
  if (
    typeof value.path !== "string"
    || typeof value.blob_sha !== "string"
    || !Number.isInteger(value.size_bytes)
    || Number(value.size_bytes) < 0
    || typeof value.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(value.sha256)
  ) return null;
  return value as PortableExportManifestFile;
}

function readPayloadFile(value: unknown): PortableExportFile | null {
  if (!isObject(value) || typeof value.path !== "string" || typeof value.content !== "string") return null;
  return value as PortableExportFile;
}

export async function inspectPortableWorkspaceExport(value: unknown): Promise<ExportInspection> {
  const errors: ExportInspectionIssue[] = [];
  const warnings: ExportInspectionIssue[] = [];
  const result: ExportInspection = {
    valid: false,
    generatedAt: null,
    repository: null,
    workspace: null,
    counts: { files: 0, captures: 0, dashboardLayouts: 0, tasks: 0, timeEntries: 0, projects: 0, projectPhases: 0, milestones: 0, projectNotes: 0, projectFileReferences: 0, activityEvents: 0, calendarEvents: 0, reportDrafts: 0, journalEntries: 0, journalSegments: 0, journalRevisions: 0, journalImportCheckpoints: 0, obsidianDocuments: 0, syncConflicts: 0, learningAreas: 0, habits: 0, habitRules: 0, habitCheckIns: 0, healthStagingRecords: 0, healthMetrics: 0, sleepSessions: 0 },
    errors,
    warnings,
  };

  if (!isObject(value)) {
    errors.push({ code: "INVALID_EXPORT_ROOT", message: "导出文件不是有效的 JSON 对象。" });
    return result;
  }
  if (value.format !== PORTABLE_EXPORT_FORMAT) {
    errors.push({ code: "INVALID_EXPORT_FORMAT", message: "文件不是 Personal Workspace 导出包。" });
  }
  if (value.export_version !== PORTABLE_EXPORT_VERSION) {
    errors.push({ code: "UNSUPPORTED_EXPORT_VERSION", message: "导出版本不受当前工作台支持。" });
  }
  if (typeof value.generated_at === "string" && !Number.isNaN(Date.parse(value.generated_at))) {
    result.generatedAt = value.generated_at;
  } else {
    errors.push({ code: "INVALID_GENERATED_AT", message: "导出时间无效。" });
  }

  if (isObject(value.source) && typeof value.source.repository === "string" && value.source.repository) {
    result.repository = value.source.repository;
  } else {
    errors.push({ code: "INVALID_SOURCE", message: "导出包缺少来源仓库信息。" });
  }

  if (!isObject(value.manifest)) {
    errors.push({ code: "INVALID_MANIFEST", message: "导出包缺少有效 manifest。" });
    return result;
  }
  const rawManifestFiles = Array.isArray(value.manifest.files) ? value.manifest.files : [];
  const manifestFiles = rawManifestFiles.map(readManifestFile);
  if (manifestFiles.some((file) => file === null)) {
    errors.push({ code: "INVALID_MANIFEST_FILE", message: "manifest 中存在无效文件条目。" });
  }

  const rawPayloadFiles = Array.isArray(value.files) ? value.files : [];
  const payloadFiles = rawPayloadFiles.map(readPayloadFile);
  if (payloadFiles.some((file) => file === null)) {
    errors.push({ code: "INVALID_PAYLOAD_FILE", message: "导出包中存在无效文件内容。" });
  }
  const validManifestFiles = manifestFiles.filter((file): file is PortableExportManifestFile => file !== null);
  const validPayloadFiles = payloadFiles.filter((file): file is PortableExportFile => file !== null);
  result.counts.files = validPayloadFiles.length;

  const manifestByPath = new Map<string, PortableExportManifestFile>();
  for (const file of validManifestFiles) {
    if (manifestByPath.has(file.path)) {
      errors.push({ code: "DUPLICATE_MANIFEST_PATH", message: "manifest 中存在重复路径。", path: file.path });
    } else {
      manifestByPath.set(file.path, file);
    }
  }
  const payloadByPath = new Map<string, PortableExportFile>();
  for (const file of validPayloadFiles) {
    if (payloadByPath.has(file.path)) {
      errors.push({ code: "DUPLICATE_PAYLOAD_PATH", message: "导出内容中存在重复路径。", path: file.path });
    } else {
      payloadByPath.set(file.path, file);
    }
  }

  for (const [path, file] of payloadByPath) {
    const manifestFile = manifestByPath.get(path);
    if (!manifestFile) {
      errors.push({ code: "FILE_NOT_IN_MANIFEST", message: "文件未登记在 manifest 中。", path });
      continue;
    }
    if (byteLength(file.content) !== manifestFile.size_bytes) {
      errors.push({ code: "FILE_SIZE_MISMATCH", message: "文件字节数与 manifest 不一致。", path });
    }
    if (await sha256Text(file.content) !== manifestFile.sha256) {
      errors.push({ code: "FILE_HASH_MISMATCH", message: "文件 SHA-256 与 manifest 不一致。", path });
    }
  }
  for (const path of manifestByPath.keys()) {
    if (!payloadByPath.has(path)) {
      errors.push({ code: "MANIFEST_FILE_MISSING", message: "manifest 指向的文件不存在。", path });
    }
  }

  const manifestCounts = isObject(value.manifest.counts) ? value.manifest.counts : null;
  if (!manifestCounts || manifestCounts.files !== validPayloadFiles.length) {
    errors.push({ code: "FILE_COUNT_MISMATCH", message: "文件总数与 manifest 不一致。" });
  }

  const workspaceFile = payloadByPath.get("workspace.json");
  if (!workspaceFile) {
    errors.push({ code: "WORKSPACE_FILE_MISSING", message: "导出包缺少 workspace.json。" });
  } else {
    try {
      result.workspace = parseWorkspaceDescriptor(workspaceFile.content);
    } catch {
      errors.push({ code: "INVALID_WORKSPACE_DESCRIPTOR", message: "workspace.json 无法通过结构校验。", path: "workspace.json" });
    }
  }

  const captureIds = new Set<string>();
  const captureFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/captures/"));
  result.counts.captures = captureFiles.length;
  for (const file of captureFiles) {
    try {
      const record = parseCaptureRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) {
        errors.push({ code: "OWNER_MISMATCH", message: "Capture 的 owner_id 与 workspace 不一致。", path: file.path });
      }
      if (recordPath("capture", record.id) !== file.path) {
        errors.push({ code: "CAPTURE_PATH_MISMATCH", message: "Capture 的 ID 与文件路径不一致。", path: file.path });
      }
      if (captureIds.has(record.id)) {
        errors.push({ code: "DUPLICATE_CAPTURE_ID", message: "导出包中存在重复 Capture ID。", path: file.path });
      }
      captureIds.add(record.id);
    } catch {
      errors.push({ code: "INVALID_CAPTURE_RECORD", message: "Capture 文件无法通过结构校验。", path: file.path });
    }
  }
  if (!manifestCounts || manifestCounts.captures !== captureFiles.length) {
    errors.push({ code: "CAPTURE_COUNT_MISMATCH", message: "Capture 数量与 manifest 不一致。" });
  }
  if (captureFiles.length === 0) {
    warnings.push({ code: "NO_CAPTURES", message: "导出包中没有 Capture；结构仍可用于恢复空工作台。" });
  }

  const dashboardLayoutFiles = validPayloadFiles.filter((file) => file.path === DASHBOARD_LAYOUT_PATH);
  result.counts.dashboardLayouts = dashboardLayoutFiles.length;
  if (dashboardLayoutFiles.length > 1) {
    errors.push({ code: "DASHBOARD_LAYOUT_COUNT_INVALID", message: "导出包中只能包含一个 Dashboard 布局文件。" });
  }
  for (const file of dashboardLayoutFiles) {
    try {
      const layout = parseDashboardLayout(file.content);
      if (result.workspace && layout.owner_id !== result.workspace.owner_id) {
        errors.push({ code: "OWNER_MISMATCH", message: "Dashboard 布局的 owner_id 与 workspace 不一致。", path: file.path });
      }
    } catch {
      errors.push({ code: "INVALID_DASHBOARD_LAYOUT", message: "Dashboard 布局无法通过结构校验。", path: file.path });
    }
  }
  const rawDashboardLayoutCount = manifestCounts?.dashboard_layouts;
  if (
    (rawDashboardLayoutCount !== undefined || dashboardLayoutFiles.length > 0)
    && rawDashboardLayoutCount !== dashboardLayoutFiles.length
  ) {
    errors.push({ code: "DASHBOARD_LAYOUT_COUNT_MISMATCH", message: "Dashboard 布局数量与 manifest 不一致。" });
  }

  const taskIds = new Set<string>();
  const taskFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/tasks/"));
  result.counts.tasks = taskFiles.length;
  for (const file of taskFiles) {
    try {
      const record = parseTaskRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) {
        errors.push({ code: "OWNER_MISMATCH", message: "Task 的 owner_id 与 workspace 不一致。", path: file.path });
      }
      if (recordPath("task", record.id) !== file.path) {
        errors.push({ code: "TASK_PATH_MISMATCH", message: "Task 的 ID 与文件路径不一致。", path: file.path });
      }
      if (taskIds.has(record.id)) {
        errors.push({ code: "DUPLICATE_TASK_ID", message: "导出包中存在重复 Task ID。", path: file.path });
      }
      taskIds.add(record.id);
    } catch {
      errors.push({ code: "INVALID_TASK_RECORD", message: "Task 文件无法通过结构校验。", path: file.path });
    }
  }
  const rawTaskCount = manifestCounts?.tasks;
  if ((rawTaskCount !== undefined || taskFiles.length > 0) && rawTaskCount !== taskFiles.length) {
    errors.push({ code: "TASK_COUNT_MISMATCH", message: "Task 数量与 manifest 不一致。" });
  }

  const projectIds = new Set<string>();
  const projectRecords = new Map<string, ReturnType<typeof parseProjectRecord>>();
  const projectFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/projects/"));
  result.counts.projects = projectFiles.length;
  for (const file of projectFiles) {
    try {
      const record = parseProjectRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) {
        errors.push({ code: "OWNER_MISMATCH", message: "Project 的 owner_id 与 workspace 不一致。", path: file.path });
      }
      if (recordPath("project", record.id) !== file.path) {
        errors.push({ code: "PROJECT_PATH_MISMATCH", message: "Project 的 ID 与文件路径不一致。", path: file.path });
      }
      if (projectIds.has(record.id)) {
        errors.push({ code: "DUPLICATE_PROJECT_ID", message: "导出包中存在重复 Project ID。", path: file.path });
      }
      projectIds.add(record.id);
      projectRecords.set(record.id, record);
    } catch {
      errors.push({ code: "INVALID_PROJECT_RECORD", message: "Project 文件无法通过结构校验。", path: file.path });
    }
  }
  const rawProjectCount = manifestCounts?.projects;
  if ((rawProjectCount !== undefined || projectFiles.length > 0) && rawProjectCount !== projectFiles.length) {
    errors.push({ code: "PROJECT_COUNT_MISMATCH", message: "Project 数量与 manifest 不一致。" });
  }

  const timeEntryIds = new Set<string>();
  const timeEntryFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/time-entries/"));
  result.counts.timeEntries = timeEntryFiles.length;
  for (const file of timeEntryFiles) {
    try {
      const record = parseTimeEntryRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) errors.push({ code: "OWNER_MISMATCH", message: "TimeEntry 的 owner_id 与 workspace 不一致。", path: file.path });
      if (recordPath("time_entry", record.id) !== file.path) errors.push({ code: "TIME_ENTRY_PATH_MISMATCH", message: "TimeEntry 的 ID 与文件路径不一致。", path: file.path });
      if (timeEntryIds.has(record.id)) errors.push({ code: "DUPLICATE_TIME_ENTRY_ID", message: "导出包中存在重复 TimeEntry ID。", path: file.path });
      timeEntryIds.add(record.id);
      if (!taskIds.has(record.data.task_id)) errors.push({ code: "TIME_ENTRY_TASK_MISSING", message: "TimeEntry 引用的 Task 不在导出包中。", path: file.path });
      if (record.data.project_id && !projectIds.has(record.data.project_id)) errors.push({ code: "TIME_ENTRY_PROJECT_MISSING", message: "TimeEntry 引用的 Project 不在导出包中。", path: file.path });
    } catch { errors.push({ code: "INVALID_TIME_ENTRY_RECORD", message: "TimeEntry 文件无法通过结构校验。", path: file.path }); }
  }
  const rawTimeEntryCount = manifestCounts?.time_entries;
  if ((rawTimeEntryCount !== undefined || timeEntryFiles.length > 0) && rawTimeEntryCount !== timeEntryFiles.length) errors.push({ code: "TIME_ENTRY_COUNT_MISMATCH", message: "TimeEntry 数量与 manifest 不一致。" });

  const projectPhaseIds = new Set<string>();
  const projectPhaseRecords = new Map<string, ReturnType<typeof parseProjectPhaseRecord>>();
  const projectPhaseFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/project-phases/"));
  result.counts.projectPhases = projectPhaseFiles.length;
  for (const file of projectPhaseFiles) {
    try {
      const record = parseProjectPhaseRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) {
        errors.push({ code: "OWNER_MISMATCH", message: "ProjectPhase 的 owner_id 与 workspace 不一致。", path: file.path });
      }
      if (recordPath("project_phase", record.id) !== file.path) {
        errors.push({ code: "PROJECT_PHASE_PATH_MISMATCH", message: "ProjectPhase 的 ID 与文件路径不一致。", path: file.path });
      }
      if (projectPhaseIds.has(record.id)) {
        errors.push({ code: "DUPLICATE_PROJECT_PHASE_ID", message: "导出包中存在重复 ProjectPhase ID。", path: file.path });
      }
      projectPhaseIds.add(record.id);
      projectPhaseRecords.set(record.id, record);
      if (!projectIds.has(record.data.project_id)) {
        errors.push({ code: "PROJECT_PHASE_PROJECT_MISSING", message: "ProjectPhase 引用的 Project 不在导出包中。", path: file.path });
      }
    } catch {
      errors.push({ code: "INVALID_PROJECT_PHASE_RECORD", message: "ProjectPhase 文件无法通过结构校验。", path: file.path });
    }
  }
  const rawProjectPhaseCount = manifestCounts?.project_phases;
  if ((rawProjectPhaseCount !== undefined || projectPhaseFiles.length > 0) && rawProjectPhaseCount !== projectPhaseFiles.length) {
    errors.push({ code: "PROJECT_PHASE_COUNT_MISMATCH", message: "ProjectPhase 数量与 manifest 不一致。" });
  }
  for (const project of projectRecords.values()) {
    if (!project.data.current_phase_id) continue;
    const phase = projectPhaseRecords.get(project.data.current_phase_id);
    if (!phase) {
      errors.push({ code: "CURRENT_PROJECT_PHASE_MISSING", message: "Project 当前阶段引用的文件不在导出包中。", path: recordPath("project", project.id) });
    } else if (phase.data.project_id !== project.id) {
      errors.push({ code: "CURRENT_PROJECT_PHASE_MISMATCH", message: "Project 当前阶段属于另一个 Project。", path: recordPath("project", project.id) });
    }
  }

  const milestoneIds = new Set<string>();
  const milestoneFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/milestones/"));
  result.counts.milestones = milestoneFiles.length;
  for (const file of milestoneFiles) {
    try {
      const record = parseMilestoneRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) {
        errors.push({ code: "OWNER_MISMATCH", message: "Milestone 的 owner_id 与 workspace 不一致。", path: file.path });
      }
      if (recordPath("milestone", record.id) !== file.path) {
        errors.push({ code: "MILESTONE_PATH_MISMATCH", message: "Milestone 的 ID 与文件路径不一致。", path: file.path });
      }
      if (milestoneIds.has(record.id)) {
        errors.push({ code: "DUPLICATE_MILESTONE_ID", message: "导出包中存在重复 Milestone ID。", path: file.path });
      }
      milestoneIds.add(record.id);
      if (!projectIds.has(record.data.project_id)) {
        errors.push({ code: "MILESTONE_PROJECT_MISSING", message: "Milestone 引用的 Project 不在导出包中。", path: file.path });
      }
    } catch {
      errors.push({ code: "INVALID_MILESTONE_RECORD", message: "Milestone 文件无法通过结构校验。", path: file.path });
    }
  }
  const rawMilestoneCount = manifestCounts?.milestones;
  if ((rawMilestoneCount !== undefined || milestoneFiles.length > 0) && rawMilestoneCount !== milestoneFiles.length) {
    errors.push({ code: "MILESTONE_COUNT_MISMATCH", message: "Milestone 数量与 manifest 不一致。" });
  }

  const projectNoteIds = new Set<string>();
  const projectNoteFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/project-notes/"));
  result.counts.projectNotes = projectNoteFiles.length;
  for (const file of projectNoteFiles) {
    try {
      const record = parseProjectNoteRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) {
        errors.push({ code: "OWNER_MISMATCH", message: "ProjectNote 的 owner_id 与 workspace 不一致。", path: file.path });
      }
      if (recordPath("project_note", record.id) !== file.path) {
        errors.push({ code: "PROJECT_NOTE_PATH_MISMATCH", message: "ProjectNote 的 ID 与文件路径不一致。", path: file.path });
      }
      if (projectNoteIds.has(record.id)) {
        errors.push({ code: "DUPLICATE_PROJECT_NOTE_ID", message: "导出包中存在重复 ProjectNote ID。", path: file.path });
      }
      projectNoteIds.add(record.id);
      if (!projectIds.has(record.data.project_id)) {
        errors.push({ code: "PROJECT_NOTE_PROJECT_MISSING", message: "ProjectNote 引用的 Project 不在导出包中。", path: file.path });
      }
    } catch {
      errors.push({ code: "INVALID_PROJECT_NOTE_RECORD", message: "ProjectNote 文件无法通过结构校验。", path: file.path });
    }
  }
  const rawProjectNoteCount = manifestCounts?.project_notes;
  if ((rawProjectNoteCount !== undefined || projectNoteFiles.length > 0) && rawProjectNoteCount !== projectNoteFiles.length) {
    errors.push({ code: "PROJECT_NOTE_COUNT_MISMATCH", message: "ProjectNote 数量与 manifest 不一致。" });
  }

  const projectFileReferenceIds = new Set<string>();
  const projectFileReferenceFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/project-file-references/"));
  result.counts.projectFileReferences = projectFileReferenceFiles.length;
  for (const file of projectFileReferenceFiles) {
    try {
      const record = parseProjectFileReferenceRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) {
        errors.push({ code: "OWNER_MISMATCH", message: "ProjectFileReference 的 owner_id 与 workspace 不一致。", path: file.path });
      }
      if (recordPath("project_file_reference", record.id) !== file.path) {
        errors.push({ code: "PROJECT_FILE_REFERENCE_PATH_MISMATCH", message: "ProjectFileReference 的 ID 与文件路径不一致。", path: file.path });
      }
      if (projectFileReferenceIds.has(record.id)) {
        errors.push({ code: "DUPLICATE_PROJECT_FILE_REFERENCE_ID", message: "导出包中存在重复 ProjectFileReference ID。", path: file.path });
      }
      projectFileReferenceIds.add(record.id);
      if (!projectIds.has(record.data.project_id)) {
        errors.push({ code: "PROJECT_FILE_REFERENCE_PROJECT_MISSING", message: "ProjectFileReference 引用的 Project 不在导出包中。", path: file.path });
      }
    } catch {
      errors.push({ code: "INVALID_PROJECT_FILE_REFERENCE_RECORD", message: "ProjectFileReference 文件无法通过结构校验。", path: file.path });
    }
  }
  const rawProjectFileReferenceCount = manifestCounts?.project_file_references;
  if ((rawProjectFileReferenceCount !== undefined || projectFileReferenceFiles.length > 0) && rawProjectFileReferenceCount !== projectFileReferenceFiles.length) {
    errors.push({ code: "PROJECT_FILE_REFERENCE_COUNT_MISMATCH", message: "ProjectFileReference 数量与 manifest 不一致。" });
  }

  const activityEventIds = new Set<string>();
  const activityEventFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/activity-events/"));
  result.counts.activityEvents = activityEventFiles.length;
  for (const file of activityEventFiles) {
    try {
      const record = parseActivityEventRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) {
        errors.push({ code: "OWNER_MISMATCH", message: "ActivityEvent 的 owner_id 与 workspace 不一致。", path: file.path });
      }
      if (recordPath("activity_event", record.id) !== file.path) {
        errors.push({ code: "ACTIVITY_EVENT_PATH_MISMATCH", message: "ActivityEvent 的 ID 与文件路径不一致。", path: file.path });
      }
      if (activityEventIds.has(record.id)) {
        errors.push({ code: "DUPLICATE_ACTIVITY_EVENT_ID", message: "导出包中存在重复 ActivityEvent ID。", path: file.path });
      }
      activityEventIds.add(record.id);
      if (!projectIds.has(record.data.entity_id)) {
        errors.push({ code: "ACTIVITY_EVENT_PROJECT_MISSING", message: "ActivityEvent 引用的 Project 不在导出包中。", path: file.path });
      }
    } catch {
      errors.push({ code: "INVALID_ACTIVITY_EVENT_RECORD", message: "ActivityEvent 文件无法通过结构校验。", path: file.path });
    }
  }
  const rawActivityEventCount = manifestCounts?.activity_events;
  if ((rawActivityEventCount !== undefined || activityEventFiles.length > 0) && rawActivityEventCount !== activityEventFiles.length) {
    errors.push({ code: "ACTIVITY_EVENT_COUNT_MISMATCH", message: "ActivityEvent 数量与 manifest 不一致。" });
  }

  const calendarEventIds = new Set<string>();
  const calendarEventFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/calendar-events/"));
  result.counts.calendarEvents = calendarEventFiles.length;
  for (const file of calendarEventFiles) {
    try {
      const record = parseCalendarEventRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) {
        errors.push({ code: "OWNER_MISMATCH", message: "CalendarEvent 的 owner_id 与 workspace 不一致。", path: file.path });
      }
      if (recordPath("calendar_event", record.id) !== file.path) {
        errors.push({ code: "CALENDAR_EVENT_PATH_MISMATCH", message: "CalendarEvent 的 ID 与文件路径不一致。", path: file.path });
      }
      if (calendarEventIds.has(record.id)) {
        errors.push({ code: "DUPLICATE_CALENDAR_EVENT_ID", message: "导出包中存在重复 CalendarEvent ID。", path: file.path });
      }
      calendarEventIds.add(record.id);
      if (record.data.linked_entity_type === "task" && record.data.linked_entity_id && !taskIds.has(record.data.linked_entity_id)) {
        errors.push({ code: "CALENDAR_EVENT_TASK_MISSING", message: "CalendarEvent 引用的 Task 不在导出包中。", path: file.path });
      }
    } catch {
      errors.push({ code: "INVALID_CALENDAR_EVENT_RECORD", message: "CalendarEvent 文件无法通过结构校验。", path: file.path });
    }
  }
  const rawCalendarEventCount = manifestCounts?.calendar_events;
  if ((rawCalendarEventCount !== undefined || calendarEventFiles.length > 0) && rawCalendarEventCount !== calendarEventFiles.length) {
    errors.push({ code: "CALENDAR_EVENT_COUNT_MISMATCH", message: "CalendarEvent 数量与 manifest 不一致。" });
  }

  const reportDraftIds = new Set<string>();
  const reportDraftFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/report-drafts/"));
  result.counts.reportDrafts = reportDraftFiles.length;
  for (const file of reportDraftFiles) {
    try {
      const record = parseReportDraftRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) {
        errors.push({ code: "OWNER_MISMATCH", message: "ReportDraft 的 owner_id 与 workspace 不一致。", path: file.path });
      }
      if (recordPath("report_draft", record.id) !== file.path) {
        errors.push({ code: "REPORT_DRAFT_PATH_MISMATCH", message: "ReportDraft 的 ID 与文件路径不一致。", path: file.path });
      }
      if (reportDraftIds.has(record.id)) {
        errors.push({ code: "DUPLICATE_REPORT_DRAFT_ID", message: "导出包中存在重复 ReportDraft ID。", path: file.path });
      }
      reportDraftIds.add(record.id);
    } catch {
      errors.push({ code: "INVALID_REPORT_DRAFT_RECORD", message: "ReportDraft 文件无法通过结构校验。", path: file.path });
    }
  }
  const rawReportDraftCount = manifestCounts?.report_drafts;
  if ((rawReportDraftCount !== undefined || reportDraftFiles.length > 0) && rawReportDraftCount !== reportDraftFiles.length) {
    errors.push({ code: "REPORT_DRAFT_COUNT_MISMATCH", message: "ReportDraft 数量与 manifest 不一致。" });
  }

  const journalEntryIds = new Set<string>();
  const journalEntryRecords = new Map<string, ReturnType<typeof parseJournalEntryRecord>>();
  const activeDailyDates = new Set<string>();
  const journalEntryFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/journal-entries/"));
  result.counts.journalEntries = journalEntryFiles.length;
  for (const file of journalEntryFiles) {
    try {
      const record = parseJournalEntryRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) errors.push({ code: "OWNER_MISMATCH", message: "JournalEntry 的 owner_id 与 workspace 不一致。", path: file.path });
      if (recordPath("journal_entry", record.id) !== file.path) errors.push({ code: "JOURNAL_ENTRY_PATH_MISMATCH", message: "JournalEntry 的 ID 与文件路径不一致。", path: file.path });
      if (journalEntryIds.has(record.id)) errors.push({ code: "DUPLICATE_JOURNAL_ENTRY_ID", message: "导出包中存在重复 JournalEntry ID。", path: file.path });
      journalEntryIds.add(record.id);
      journalEntryRecords.set(record.id, record);
      if (record.deleted_at === null) {
        const dateKey = `${record.data.entry_kind}:${record.data.journal_date}`;
        if (activeDailyDates.has(dateKey)) errors.push({ code: "DUPLICATE_ACTIVE_DAILY_JOURNAL", message: "同一日期存在多条未删除的 daily JournalEntry。", path: file.path });
        activeDailyDates.add(dateKey);
      }
    } catch { errors.push({ code: "INVALID_JOURNAL_ENTRY_RECORD", message: "JournalEntry 文件无法通过结构校验。", path: file.path }); }
  }
  const rawJournalEntryCount = manifestCounts?.journal_entries;
  if ((rawJournalEntryCount !== undefined || journalEntryFiles.length > 0) && rawJournalEntryCount !== journalEntryFiles.length) errors.push({ code: "JOURNAL_ENTRY_COUNT_MISMATCH", message: "JournalEntry 数量与 manifest 不一致。" });

  const journalSegmentIds = new Set<string>();
  const journalSegmentRecords = new Map<string, ReturnType<typeof parseJournalSegmentRecord>>();
  const journalSegmentOrders = new Set<string>();
  const journalSegmentFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/journal-segments/"));
  result.counts.journalSegments = journalSegmentFiles.length;
  for (const file of journalSegmentFiles) {
    try {
      const record = parseJournalSegmentRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) errors.push({ code: "OWNER_MISMATCH", message: "JournalSegment 的 owner_id 与 workspace 不一致。", path: file.path });
      if (recordPath("journal_segment", record.id) !== file.path) errors.push({ code: "JOURNAL_SEGMENT_PATH_MISMATCH", message: "JournalSegment 的 ID 与文件路径不一致。", path: file.path });
      if (journalSegmentIds.has(record.id)) errors.push({ code: "DUPLICATE_JOURNAL_SEGMENT_ID", message: "导出包中存在重复 JournalSegment ID。", path: file.path });
      journalSegmentIds.add(record.id);
      journalSegmentRecords.set(record.id, record);
      if (!journalEntryIds.has(record.data.journal_entry_id)) errors.push({ code: "JOURNAL_SEGMENT_ENTRY_MISSING", message: "JournalSegment 引用的 JournalEntry 不在导出包中。", path: file.path });
      const orderKey = `${record.data.journal_entry_id}:${record.data.sort_order}`;
      if (journalSegmentOrders.has(orderKey)) errors.push({ code: "DUPLICATE_JOURNAL_SEGMENT_ORDER", message: "同一 JournalEntry 存在重复 Segment sort_order。", path: file.path });
      journalSegmentOrders.add(orderKey);
    } catch { errors.push({ code: "INVALID_JOURNAL_SEGMENT_RECORD", message: "JournalSegment 文件无法通过结构校验。", path: file.path }); }
  }
  const rawJournalSegmentCount = manifestCounts?.journal_segments;
  if ((rawJournalSegmentCount !== undefined || journalSegmentFiles.length > 0) && rawJournalSegmentCount !== journalSegmentFiles.length) errors.push({ code: "JOURNAL_SEGMENT_COUNT_MISMATCH", message: "JournalSegment 数量与 manifest 不一致。" });

  const journalRevisionIds = new Set<string>();
  const journalRevisionRecords = new Map<string, ReturnType<typeof parseJournalRevisionRecord>>();
  const journalRevisionNumbers = new Set<string>();
  const referencedSegmentIds = new Set<string>();
  const journalRevisionFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/journal-revisions/"));
  result.counts.journalRevisions = journalRevisionFiles.length;
  for (const file of journalRevisionFiles) {
    try {
      const record = parseJournalRevisionRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) errors.push({ code: "OWNER_MISMATCH", message: "JournalRevision 的 owner_id 与 workspace 不一致。", path: file.path });
      if (recordPath("journal_revision", record.id) !== file.path) errors.push({ code: "JOURNAL_REVISION_PATH_MISMATCH", message: "JournalRevision 的 ID 与文件路径不一致。", path: file.path });
      if (journalRevisionIds.has(record.id)) errors.push({ code: "DUPLICATE_JOURNAL_REVISION_ID", message: "导出包中存在重复 JournalRevision ID。", path: file.path });
      journalRevisionIds.add(record.id);
      journalRevisionRecords.set(record.id, record);
      if (!journalEntryIds.has(record.data.journal_entry_id)) errors.push({ code: "JOURNAL_REVISION_ENTRY_MISSING", message: "JournalRevision 引用的 JournalEntry 不在导出包中。", path: file.path });
      const numberKey = `${record.data.journal_entry_id}:${record.data.revision_number}`;
      if (journalRevisionNumbers.has(numberKey)) errors.push({ code: "DUPLICATE_JOURNAL_REVISION_NUMBER", message: "同一 JournalEntry 存在重复 revision_number。", path: file.path });
      journalRevisionNumbers.add(numberKey);
      if (await sha256JournalRevisionBody(record.data.body_markdown) !== record.data.content_sha256) errors.push({ code: "JOURNAL_REVISION_HASH_MISMATCH", message: "JournalRevision 的物化正文哈希不一致。", path: file.path });
      if (record.data.content_mode === "segments") {
        const segments = record.data.segment_ids.map((id) => journalSegmentRecords.get(id));
        for (const [index, segment] of segments.entries()) {
          const id = record.data.segment_ids[index]!;
          referencedSegmentIds.add(id);
          if (!segment) errors.push({ code: "JOURNAL_REVISION_SEGMENT_MISSING", message: "JournalRevision 引用的 Segment 不在导出包中。", path: file.path });
          else if (segment.data.journal_entry_id !== record.data.journal_entry_id) errors.push({ code: "JOURNAL_REVISION_SEGMENT_ENTRY_MISMATCH", message: "JournalRevision 引用了其他 JournalEntry 的 Segment。", path: file.path });
        }
        if (segments.every((segment) => Boolean(segment))) {
          const present = segments.filter((segment): segment is ReturnType<typeof parseJournalSegmentRecord> => Boolean(segment));
          const ordered = [...present].sort((left, right) => left.data.sort_order - right.data.sort_order);
          if (ordered.some((segment, index) => segment.id !== record.data.segment_ids[index])) errors.push({ code: "JOURNAL_REVISION_SEGMENT_ORDER_MISMATCH", message: "JournalRevision 的 segment_ids 不是 canonical sort_order。", path: file.path });
          const snapshots = ordered.map((segment) => ({ id: segment.id, ...segment.data }));
          if (renderJournalSegmentsMarkdown(record.data.journal_entry_id, snapshots).trim() !== record.data.body_markdown) errors.push({ code: "JOURNAL_REVISION_MATERIALIZATION_MISMATCH", message: "JournalRevision 的物化正文与 Segment 渲染结果不一致。", path: file.path });
        }
      }
    } catch { errors.push({ code: "INVALID_JOURNAL_REVISION_RECORD", message: "JournalRevision 文件无法通过结构校验。", path: file.path }); }
  }
  const rawJournalRevisionCount = manifestCounts?.journal_revisions;
  if ((rawJournalRevisionCount !== undefined || journalRevisionFiles.length > 0) && rawJournalRevisionCount !== journalRevisionFiles.length) errors.push({ code: "JOURNAL_REVISION_COUNT_MISMATCH", message: "JournalRevision 数量与 manifest 不一致。" });

  for (const [id, segment] of journalSegmentRecords) {
    if (!referencedSegmentIds.has(id)) errors.push({ code: "JOURNAL_SEGMENT_ORPHANED", message: "JournalSegment 没有被任何 JournalRevision 引用。", path: recordPath("journal_segment", segment.id) });
  }
  for (const [id, entry] of journalEntryRecords) {
    const revisions = [...journalRevisionRecords.values()].filter((revision) => revision.data.journal_entry_id === id);
    if (entry.data.current_revision_id === null) {
      if (revisions.length > 0) errors.push({ code: "JOURNAL_ENTRY_CURRENT_REVISION_MISSING", message: "JournalEntry 已有 Revision，但没有 current_revision_id。", path: recordPath("journal_entry", entry.id) });
      continue;
    }
    const current = journalRevisionRecords.get(entry.data.current_revision_id);
    if (!current) errors.push({ code: "JOURNAL_ENTRY_CURRENT_REVISION_NOT_FOUND", message: "JournalEntry 的 current Revision 不在导出包中。", path: recordPath("journal_entry", entry.id) });
    else {
      if (current.data.journal_entry_id !== entry.id) errors.push({ code: "JOURNAL_ENTRY_CURRENT_REVISION_MISMATCH", message: "JournalEntry 指向了其他日记的 Revision。", path: recordPath("journal_entry", entry.id) });
      if (current.data.body_markdown !== entry.data.body_markdown) errors.push({ code: "JOURNAL_ENTRY_MATERIALIZATION_MISMATCH", message: "JournalEntry 当前正文与 Revision 物化正文不一致。", path: recordPath("journal_entry", entry.id) });
      const latestNumber = Math.max(...revisions.map((revision) => revision.data.revision_number));
      if (current.data.revision_number !== latestNumber) errors.push({ code: "JOURNAL_ENTRY_CURRENT_REVISION_NOT_LATEST", message: "JournalEntry 没有指向最高 revision_number。", path: recordPath("journal_entry", entry.id) });
    }
  }

  const journalImportCheckpointIds = new Set<string>();
  const journalImportCheckpointFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/journal-import-checkpoints/"));
  result.counts.journalImportCheckpoints = journalImportCheckpointFiles.length;
  for (const file of journalImportCheckpointFiles) {
    try {
      const record = parseJournalImportCheckpointRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) errors.push({ code: "OWNER_MISMATCH", message: "JournalImportCheckpoint 的 owner_id 与 workspace 不一致。", path: file.path });
      if (recordPath("journal_import_checkpoint", record.id) !== file.path) errors.push({ code: "JOURNAL_IMPORT_CHECKPOINT_PATH_MISMATCH", message: "JournalImportCheckpoint 的 ID 与文件路径不一致。", path: file.path });
      if (journalImportCheckpointIds.has(record.id)) errors.push({ code: "DUPLICATE_JOURNAL_IMPORT_CHECKPOINT_ID", message: "导出包中存在重复 JournalImportCheckpoint ID。", path: file.path });
      journalImportCheckpointIds.add(record.id);
      const expectedPaths = new Set<string>();
      for (const item of record.data.items) {
        const entry = journalEntryRecords.get(item.entry_id);
        const revision = journalRevisionRecords.get(item.revision_id);
        const segments = item.segment_ids.map((id) => journalSegmentRecords.get(id));
        expectedPaths.add(recordPath("journal_entry", item.entry_id));
        expectedPaths.add(recordPath("journal_revision", item.revision_id));
        item.segment_ids.forEach((id) => expectedPaths.add(recordPath("journal_segment", id)));
        if (!entry) errors.push({ code: "JOURNAL_IMPORT_CHECKPOINT_ENTRY_MISSING", message: "JournalImportCheckpoint 引用的 JournalEntry 不在导出包中。", path: file.path });
        if (!revision) errors.push({ code: "JOURNAL_IMPORT_CHECKPOINT_REVISION_MISSING", message: "JournalImportCheckpoint 引用的 JournalRevision 不在导出包中。", path: file.path });
        if (segments.some((segment) => !segment)) errors.push({ code: "JOURNAL_IMPORT_CHECKPOINT_SEGMENT_MISSING", message: "JournalImportCheckpoint 引用的 JournalSegment 不在导出包中。", path: file.path });
        if (entry && entry.data.journal_date !== item.date) errors.push({ code: "JOURNAL_IMPORT_CHECKPOINT_DATE_MISMATCH", message: "JournalImportCheckpoint 日期与 JournalEntry 不一致。", path: file.path });
        if (revision && (revision.data.journal_entry_id !== item.entry_id || revision.data.content_sha256 !== item.content_sha256)) errors.push({ code: "JOURNAL_IMPORT_CHECKPOINT_REVISION_MISMATCH", message: "JournalImportCheckpoint 与 JournalRevision 身份或正文哈希不一致。", path: file.path });
        if (segments.some((segment) => segment && (segment.data.journal_entry_id !== item.entry_id || segment.data.source_ref?.import_batch_id !== record.data.import_batch_id))) errors.push({ code: "JOURNAL_IMPORT_CHECKPOINT_SEGMENT_MISMATCH", message: "JournalImportCheckpoint 的 Segment 归属或来源批次不一致。", path: file.path });
      }
      const plannedPaths = new Set(record.data.planned_files.map((planned) => planned.path));
      if (plannedPaths.size !== expectedPaths.size || [...expectedPaths].some((path) => !plannedPaths.has(path))) errors.push({ code: "JOURNAL_IMPORT_CHECKPOINT_FILE_SET_MISMATCH", message: "JournalImportCheckpoint 的 planned_files 与引用实体集合不一致。", path: file.path });
    } catch {
      errors.push({ code: "INVALID_JOURNAL_IMPORT_CHECKPOINT_RECORD", message: "JournalImportCheckpoint 文件无法通过结构校验。", path: file.path });
    }
  }
  const rawJournalImportCheckpointCount = manifestCounts?.journal_import_checkpoints;
  if ((rawJournalImportCheckpointCount !== undefined || journalImportCheckpointFiles.length > 0) && rawJournalImportCheckpointCount !== journalImportCheckpointFiles.length) errors.push({ code: "JOURNAL_IMPORT_CHECKPOINT_COUNT_MISMATCH", message: "JournalImportCheckpoint 数量与 manifest 不一致。" });

  const obsidianDocumentIds = new Set<string>();
  const obsidianDocumentEntryKeys = new Set<string>();
  const obsidianDocumentPathKeys = new Set<string>();
  const obsidianDocumentRecords = new Map<string, ReturnType<typeof parseObsidianDocumentRecord>>();
  const obsidianDocumentFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/obsidian-documents/"));
  result.counts.obsidianDocuments = obsidianDocumentFiles.length;
  for (const file of obsidianDocumentFiles) {
    try {
      const record = parseObsidianDocumentRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) errors.push({ code: "OWNER_MISMATCH", message: "ObsidianDocument 的 owner_id 与 workspace 不一致。", path: file.path });
      if (recordPath("obsidian_document", record.id) !== file.path) errors.push({ code: "OBSIDIAN_DOCUMENT_PATH_MISMATCH", message: "ObsidianDocument 的 ID 与文件路径不一致。", path: file.path });
      if (obsidianDocumentIds.has(record.id)) errors.push({ code: "DUPLICATE_OBSIDIAN_DOCUMENT_ID", message: "导出包中存在重复 ObsidianDocument ID。", path: file.path });
      obsidianDocumentIds.add(record.id);
      obsidianDocumentRecords.set(record.id, record);
      const entryKey = `${record.data.vault_mapping_id}:${record.data.journal_entry_id}`;
      const pathKey = `${record.data.vault_mapping_id}:${record.data.relative_path}`;
      if (record.deleted_at === null && (obsidianDocumentEntryKeys.has(entryKey) || obsidianDocumentPathKeys.has(pathKey))) errors.push({ code: "DUPLICATE_ACTIVE_OBSIDIAN_DOCUMENT", message: "同一 Vault mapping 的 JournalEntry 或目标路径存在多个有效导出基线。", path: file.path });
      if (record.deleted_at === null) {
        obsidianDocumentEntryKeys.add(entryKey);
        obsidianDocumentPathKeys.add(pathKey);
      }
      const entry = journalEntryRecords.get(record.data.journal_entry_id);
      const revision = journalRevisionRecords.get(record.data.source_revision_id);
      if (!entry) errors.push({ code: "OBSIDIAN_DOCUMENT_ENTRY_MISSING", message: "ObsidianDocument 引用的 JournalEntry 不在导出包中。", path: file.path });
      if (!revision) errors.push({ code: "OBSIDIAN_DOCUMENT_REVISION_MISSING", message: "ObsidianDocument 引用的 JournalRevision 不在导出包中。", path: file.path });
      if (entry && !record.data.relative_path.endsWith(`/Journal/${entry.data.journal_date.slice(0, 4)}/${entry.data.journal_date}.md`)) errors.push({ code: "OBSIDIAN_DOCUMENT_DATE_PATH_MISMATCH", message: "ObsidianDocument 路径与 JournalEntry 日期不一致。", path: file.path });
      if (revision && (revision.data.journal_entry_id !== record.data.journal_entry_id || revision.data.content_sha256 !== record.data.source_content_sha256)) errors.push({ code: "OBSIDIAN_DOCUMENT_REVISION_MISMATCH", message: "ObsidianDocument 的 Revision 身份或正文哈希不一致。", path: file.path });
      if (entry && entry.version < record.data.source_record_version) errors.push({ code: "OBSIDIAN_DOCUMENT_SOURCE_VERSION_FROM_FUTURE", message: "ObsidianDocument 的来源 record version 高于 JournalEntry。", path: file.path });
    } catch {
      errors.push({ code: "INVALID_OBSIDIAN_DOCUMENT_RECORD", message: "ObsidianDocument 文件无法通过结构校验。", path: file.path });
    }
  }
  const rawObsidianDocumentCount = manifestCounts?.obsidian_documents;
  if ((rawObsidianDocumentCount !== undefined || obsidianDocumentFiles.length > 0) && rawObsidianDocumentCount !== obsidianDocumentFiles.length) errors.push({ code: "OBSIDIAN_DOCUMENT_COUNT_MISMATCH", message: "ObsidianDocument 数量与 manifest 不一致。" });

  const syncConflictIds = new Set<string>();
  const syncConflictFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/sync-conflicts/"));
  result.counts.syncConflicts = syncConflictFiles.length;
  for (const file of syncConflictFiles) {
    try {
      const record = parseSyncConflictRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) errors.push({ code: "OWNER_MISMATCH", message: "SyncConflict 的 owner_id 与 workspace 不一致。", path: file.path });
      if (recordPath("sync_conflict", record.id) !== file.path) errors.push({ code: "SYNC_CONFLICT_PATH_MISMATCH", message: "SyncConflict 的 ID 与文件路径不一致。", path: file.path });
      if (syncConflictIds.has(record.id)) errors.push({ code: "DUPLICATE_SYNC_CONFLICT_ID", message: "导出包中存在重复 SyncConflict ID。", path: file.path });
      syncConflictIds.add(record.id);
      const entry = journalEntryRecords.get(record.data.journal_entry_id);
      const revision = journalRevisionRecords.get(record.data.source_revision_id);
      if (!entry) errors.push({ code: "SYNC_CONFLICT_ENTRY_MISSING", message: "SyncConflict 引用的 JournalEntry 不在导出包中。", path: file.path });
      if (!revision) errors.push({ code: "SYNC_CONFLICT_REVISION_MISSING", message: "SyncConflict 引用的 JournalRevision 不在导出包中。", path: file.path });
      if (entry && !record.data.relative_path.endsWith(`/Journal/${entry.data.journal_date.slice(0, 4)}/${entry.data.journal_date}.md`)) errors.push({ code: "SYNC_CONFLICT_DATE_PATH_MISMATCH", message: "SyncConflict 路径与 JournalEntry 日期不一致。", path: file.path });
      if (revision && revision.data.journal_entry_id !== record.data.journal_entry_id) errors.push({ code: "SYNC_CONFLICT_REVISION_MISMATCH", message: "SyncConflict 的 JournalRevision 不属于目标 JournalEntry。", path: file.path });
      if (record.data.obsidian_document_id) {
        const document = obsidianDocumentRecords.get(record.data.obsidian_document_id);
        if (!document) errors.push({ code: "SYNC_CONFLICT_OBSIDIAN_DOCUMENT_MISSING", message: "SyncConflict 引用的 ObsidianDocument 不在导出包中。", path: file.path });
        else if (document.data.journal_entry_id !== record.data.journal_entry_id || document.data.vault_mapping_id !== record.data.vault_mapping_id || document.data.relative_path !== record.data.relative_path || document.data.document_sha256 !== record.data.baseline_document_sha256) errors.push({ code: "SYNC_CONFLICT_BASELINE_MISMATCH", message: "SyncConflict 与 ObsidianDocument 基线不一致。", path: file.path });
      }
    } catch {
      errors.push({ code: "INVALID_SYNC_CONFLICT_RECORD", message: "SyncConflict 文件无法通过结构校验。", path: file.path });
    }
  }
  const rawSyncConflictCount = manifestCounts?.sync_conflicts;
  if ((rawSyncConflictCount !== undefined || syncConflictFiles.length > 0) && rawSyncConflictCount !== syncConflictFiles.length) errors.push({ code: "SYNC_CONFLICT_COUNT_MISMATCH", message: "SyncConflict 数量与 manifest 不一致。" });

  const learningAreaIds = new Set<string>();
  const learningAreaFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/learning-areas/"));
  result.counts.learningAreas = learningAreaFiles.length;
  for (const file of learningAreaFiles) {
    try {
      const record = parseLearningAreaRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) errors.push({ code: "OWNER_MISMATCH", message: "LearningArea 的 owner_id 与 workspace 不一致。", path: file.path });
      if (recordPath("learning_area", record.id) !== file.path) errors.push({ code: "LEARNING_AREA_PATH_MISMATCH", message: "LearningArea 的 ID 与文件路径不一致。", path: file.path });
      if (learningAreaIds.has(record.id)) errors.push({ code: "DUPLICATE_LEARNING_AREA_ID", message: "导出包中存在重复 LearningArea ID。", path: file.path });
      learningAreaIds.add(record.id);
    } catch {
      errors.push({ code: "INVALID_LEARNING_AREA_RECORD", message: "LearningArea 文件无法通过结构校验。", path: file.path });
    }
  }
  const rawLearningAreaCount = manifestCounts?.learning_areas;
  if ((rawLearningAreaCount !== undefined || learningAreaFiles.length > 0) && rawLearningAreaCount !== learningAreaFiles.length) errors.push({ code: "LEARNING_AREA_COUNT_MISMATCH", message: "LearningArea 数量与 manifest 不一致。" });

  const habitIds = new Set<string>();
  const habitFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/habits/"));
  result.counts.habits = habitFiles.length;
  for (const file of habitFiles) {
    try {
      const record = parseHabitRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) errors.push({ code: "OWNER_MISMATCH", message: "Habit 的 owner_id 与 workspace 不一致。", path: file.path });
      if (recordPath("habit", record.id) !== file.path) errors.push({ code: "HABIT_PATH_MISMATCH", message: "Habit 的 ID 与文件路径不一致。", path: file.path });
      if (habitIds.has(record.id)) errors.push({ code: "DUPLICATE_HABIT_ID", message: "导出包中存在重复 Habit ID。", path: file.path });
      habitIds.add(record.id);
    } catch {
      errors.push({ code: "INVALID_HABIT_RECORD", message: "Habit 文件无法通过结构校验。", path: file.path });
    }
  }
  const rawHabitCount = manifestCounts?.habits;
  if ((rawHabitCount !== undefined || habitFiles.length > 0) && rawHabitCount !== habitFiles.length) errors.push({ code: "HABIT_COUNT_MISMATCH", message: "Habit 数量与 manifest 不一致。" });

  const habitRuleIds = new Set<string>();
  const habitRuleVersions = new Set<string>();
  const habitRuleFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/habit-rules/"));
  result.counts.habitRules = habitRuleFiles.length;
  for (const file of habitRuleFiles) {
    try {
      const record = parseHabitRuleRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) errors.push({ code: "OWNER_MISMATCH", message: "HabitRule 的 owner_id 与 workspace 不一致。", path: file.path });
      if (recordPath("habit_rule", record.id) !== file.path) errors.push({ code: "HABIT_RULE_PATH_MISMATCH", message: "HabitRule 的 ID 与文件路径不一致。", path: file.path });
      if (habitRuleIds.has(record.id)) errors.push({ code: "DUPLICATE_HABIT_RULE_ID", message: "导出包中存在重复 HabitRule ID。", path: file.path });
      habitRuleIds.add(record.id);
      if (!habitIds.has(record.data.habit_id)) errors.push({ code: "HABIT_RULE_HABIT_MISSING", message: "HabitRule 引用的 Habit 不在导出包中。", path: file.path });
      const versionKey = `${record.data.habit_id}:${record.data.rule_version}`;
      if (habitRuleVersions.has(versionKey)) errors.push({ code: "DUPLICATE_HABIT_RULE_VERSION", message: "同一 Habit 存在重复规则版本。", path: file.path });
      habitRuleVersions.add(versionKey);
    } catch {
      errors.push({ code: "INVALID_HABIT_RULE_RECORD", message: "HabitRule 文件无法通过结构校验。", path: file.path });
    }
  }
  const rawHabitRuleCount = manifestCounts?.habit_rules;
  if ((rawHabitRuleCount !== undefined || habitRuleFiles.length > 0) && rawHabitRuleCount !== habitRuleFiles.length) errors.push({ code: "HABIT_RULE_COUNT_MISMATCH", message: "HabitRule 数量与 manifest 不一致。" });

  const habitCheckInIds = new Set<string>();
  const habitCheckInDates = new Set<string>();
  const sleepEvidenceLinks: Array<{ evidenceId: string; path: string }> = [];
  const habitCheckInFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/habit-check-ins/"));
  result.counts.habitCheckIns = habitCheckInFiles.length;
  for (const file of habitCheckInFiles) {
    try {
      const record = parseHabitCheckInRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) errors.push({ code: "OWNER_MISMATCH", message: "HabitCheckIn 的 owner_id 与 workspace 不一致。", path: file.path });
      if (recordPath("habit_check_in", record.id) !== file.path) errors.push({ code: "HABIT_CHECK_IN_PATH_MISMATCH", message: "HabitCheckIn 的 ID 与文件路径不一致。", path: file.path });
      if (habitCheckInIds.has(record.id)) errors.push({ code: "DUPLICATE_HABIT_CHECK_IN_ID", message: "导出包中存在重复 HabitCheckIn ID。", path: file.path });
      habitCheckInIds.add(record.id);
      if (!habitIds.has(record.data.habit_id)) errors.push({ code: "HABIT_CHECK_IN_HABIT_MISSING", message: "HabitCheckIn 引用的 Habit 不在导出包中。", path: file.path });
      if (record.data.rule_id !== null && !habitRuleIds.has(record.data.rule_id)) errors.push({ code: "HABIT_CHECK_IN_RULE_MISSING", message: "HabitCheckIn 引用的规则版本不在导出包中。", path: file.path });
      if (record.data.evidence_type === "health_sleep_session" && record.data.evidence_id) sleepEvidenceLinks.push({ evidenceId: record.data.evidence_id, path: file.path });
      const dateKey = `${record.data.habit_id}:${record.data.local_date}`;
      if (habitCheckInDates.has(dateKey)) errors.push({ code: "DUPLICATE_HABIT_CHECK_IN_DATE", message: "同一 Habit 在同一天存在多个 check-in。", path: file.path });
      habitCheckInDates.add(dateKey);
    } catch {
      errors.push({ code: "INVALID_HABIT_CHECK_IN_RECORD", message: "HabitCheckIn 文件无法通过结构校验。", path: file.path });
    }
  }
  const rawHabitCheckInCount = manifestCounts?.habit_check_ins;
  if ((rawHabitCheckInCount !== undefined || habitCheckInFiles.length > 0) && rawHabitCheckInCount !== habitCheckInFiles.length) errors.push({ code: "HABIT_CHECK_IN_COUNT_MISMATCH", message: "HabitCheckIn 数量与 manifest 不一致。" });

  const healthStagingIds = new Set<string>();
  const confirmedHealthLinks = new Map<string, string>();
  const healthStagingFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/health-staging-records/"));
  result.counts.healthStagingRecords = healthStagingFiles.length;
  for (const file of healthStagingFiles) {
    try {
      const record = parseHealthStagingRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) errors.push({ code: "OWNER_MISMATCH", message: "HealthStagingRecord 的 owner_id 与 workspace 不一致。", path: file.path });
      if (recordPath("health_staging_record", record.id) !== file.path) errors.push({ code: "HEALTH_STAGING_PATH_MISMATCH", message: "HealthStagingRecord 的 ID 与文件路径不一致。", path: file.path });
      if (healthStagingIds.has(record.id)) errors.push({ code: "DUPLICATE_HEALTH_STAGING_ID", message: "导出包中存在重复 HealthStagingRecord ID。", path: file.path });
      healthStagingIds.add(record.id);
      if (record.data.status === "confirmed" && record.data.canonical_record_id) confirmedHealthLinks.set(record.data.canonical_record_id, record.id);
    } catch { errors.push({ code: "INVALID_HEALTH_STAGING_RECORD", message: "HealthStagingRecord 文件无法通过结构校验。", path: file.path }); }
  }
  const rawHealthStagingCount = manifestCounts?.health_staging_records;
  if ((rawHealthStagingCount !== undefined || healthStagingFiles.length > 0) && rawHealthStagingCount !== healthStagingFiles.length) errors.push({ code: "HEALTH_STAGING_COUNT_MISMATCH", message: "HealthStagingRecord 数量与 manifest 不一致。" });

  const healthMetricIds = new Set<string>();
  const healthMetricFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/health-metrics/"));
  result.counts.healthMetrics = healthMetricFiles.length;
  for (const file of healthMetricFiles) {
    try {
      const record = parseHealthMetricRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) errors.push({ code: "OWNER_MISMATCH", message: "HealthMetric 的 owner_id 与 workspace 不一致。", path: file.path });
      if (recordPath("health_metric", record.id) !== file.path) errors.push({ code: "HEALTH_METRIC_PATH_MISMATCH", message: "HealthMetric 的 ID 与文件路径不一致。", path: file.path });
      if (healthMetricIds.has(record.id)) errors.push({ code: "DUPLICATE_HEALTH_METRIC_ID", message: "导出包中存在重复 HealthMetric ID。", path: file.path });
      healthMetricIds.add(record.id);
      if (!healthStagingIds.has(record.data.staging_record_id) || confirmedHealthLinks.get(record.id) !== record.data.staging_record_id) errors.push({ code: "HEALTH_METRIC_STAGING_MISMATCH", message: "HealthMetric 缺少匹配的已确认暂存来源。", path: file.path });
    } catch { errors.push({ code: "INVALID_HEALTH_METRIC_RECORD", message: "HealthMetric 文件无法通过结构校验。", path: file.path }); }
  }
  const rawHealthMetricCount = manifestCounts?.health_metrics;
  if ((rawHealthMetricCount !== undefined || healthMetricFiles.length > 0) && rawHealthMetricCount !== healthMetricFiles.length) errors.push({ code: "HEALTH_METRIC_COUNT_MISMATCH", message: "HealthMetric 数量与 manifest 不一致。" });

  const sleepSessionIds = new Set<string>();
  const sleepSessionFiles = validPayloadFiles.filter((file) => file.path.startsWith("data/sleep-sessions/"));
  result.counts.sleepSessions = sleepSessionFiles.length;
  for (const file of sleepSessionFiles) {
    try {
      const record = parseSleepSessionRecord(file.content);
      if (result.workspace && record.owner_id !== result.workspace.owner_id) errors.push({ code: "OWNER_MISMATCH", message: "SleepSession 的 owner_id 与 workspace 不一致。", path: file.path });
      if (recordPath("sleep_session", record.id) !== file.path) errors.push({ code: "SLEEP_SESSION_PATH_MISMATCH", message: "SleepSession 的 ID 与文件路径不一致。", path: file.path });
      if (sleepSessionIds.has(record.id)) errors.push({ code: "DUPLICATE_SLEEP_SESSION_ID", message: "导出包中存在重复 SleepSession ID。", path: file.path });
      sleepSessionIds.add(record.id);
      if (!healthStagingIds.has(record.data.staging_record_id) || confirmedHealthLinks.get(record.id) !== record.data.staging_record_id) errors.push({ code: "SLEEP_SESSION_STAGING_MISMATCH", message: "SleepSession 缺少匹配的已确认暂存来源。", path: file.path });
    } catch { errors.push({ code: "INVALID_SLEEP_SESSION_RECORD", message: "SleepSession 文件无法通过结构校验。", path: file.path }); }
  }
  const rawSleepSessionCount = manifestCounts?.sleep_sessions;
  if ((rawSleepSessionCount !== undefined || sleepSessionFiles.length > 0) && rawSleepSessionCount !== sleepSessionFiles.length) errors.push({ code: "SLEEP_SESSION_COUNT_MISMATCH", message: "SleepSession 数量与 manifest 不一致。" });
  for (const link of sleepEvidenceLinks) {
    if (!sleepSessionIds.has(link.evidenceId)) errors.push({ code: "HABIT_CHECK_IN_SLEEP_EVIDENCE_MISSING", message: "HabitCheckIn 引用的正式睡眠证据不在导出包中。", path: link.path });
  }

  const supportedPaths = new Set(["workspace.json", DASHBOARD_LAYOUT_PATH]);
  const unexpectedFiles = validPayloadFiles.filter((file) => (
    !supportedPaths.has(file.path)
    && !file.path.startsWith("data/captures/")
    && !file.path.startsWith("data/tasks/")
    && !file.path.startsWith("data/time-entries/")
    && !file.path.startsWith("data/projects/")
    && !file.path.startsWith("data/project-phases/")
    && !file.path.startsWith("data/milestones/")
    && !file.path.startsWith("data/project-notes/")
    && !file.path.startsWith("data/project-file-references/")
    && !file.path.startsWith("data/activity-events/")
    && !file.path.startsWith("data/calendar-events/")
    && !file.path.startsWith("data/report-drafts/")
    && !file.path.startsWith("data/journal-entries/")
    && !file.path.startsWith("data/journal-segments/")
    && !file.path.startsWith("data/journal-revisions/")
    && !file.path.startsWith("data/journal-import-checkpoints/")
    && !file.path.startsWith("data/obsidian-documents/")
    && !file.path.startsWith("data/sync-conflicts/")
    && !file.path.startsWith("data/learning-areas/")
    && !file.path.startsWith("data/habits/")
    && !file.path.startsWith("data/habit-rules/")
    && !file.path.startsWith("data/habit-check-ins/")
    && !file.path.startsWith("data/health-staging-records/")
    && !file.path.startsWith("data/health-metrics/")
    && !file.path.startsWith("data/sleep-sessions/")
  ));
  for (const file of unexpectedFiles) {
    errors.push({ code: "UNEXPECTED_FILE", message: "当前版本不支持此导出路径。", path: file.path });
  }

  result.valid = errors.length === 0;
  return result;
}

export function serializePortableWorkspaceExport(value: PortableWorkspaceExport) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
