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
      modules: Array<"workspace" | "captures" | "dashboard_layout" | "tasks" | "time_entries" | "projects" | "project_phases" | "milestones" | "project_notes" | "project_file_references" | "activity_events" | "calendar_events" | "report_drafts">;
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
  const files = [input.workspaceFile, ...input.captureFiles, ...dashboardLayoutFiles, ...taskFiles, ...timeEntryFiles, ...projectFiles, ...projectPhaseFiles, ...milestoneFiles, ...projectNoteFiles, ...projectFileReferenceFiles, ...activityEventFiles, ...calendarEventFiles, ...reportDraftFiles]
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
      scope: { modules: ["workspace", "captures", "dashboard_layout", "tasks", "time_entries", "projects", "project_phases", "milestones", "project_notes", "project_file_references", "activity_events", "calendar_events", "report_drafts"], complete: true },
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
    counts: { files: 0, captures: 0, dashboardLayouts: 0, tasks: 0, timeEntries: 0, projects: 0, projectPhases: 0, milestones: 0, projectNotes: 0, projectFileReferences: 0, activityEvents: 0, calendarEvents: 0, reportDrafts: 0 },
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
