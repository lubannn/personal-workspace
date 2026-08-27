import type { GitHubStoredFile } from "./github-contents";
import { DASHBOARD_LAYOUT_PATH, parseDashboardLayout } from "./dashboard-layout";
import { recordPath } from "./protocol";
import { parseTaskRecord } from "./tasks";
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
      modules: Array<"workspace" | "captures" | "dashboard_layout" | "tasks">;
      complete: true;
    };
    counts: {
      files: number;
      captures: number;
      dashboard_layouts: number;
      tasks: number;
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
  generatedAt?: string;
}): Promise<PortableWorkspaceExport> {
  const dashboardLayoutFiles = input.dashboardLayoutFile ? [input.dashboardLayoutFile] : [];
  const taskFiles = input.taskFiles ?? [];
  const files = [input.workspaceFile, ...input.captureFiles, ...dashboardLayoutFiles, ...taskFiles]
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
      scope: { modules: ["workspace", "captures", "dashboard_layout", "tasks"], complete: true },
      counts: {
        files: files.length,
        captures: input.captureFiles.length,
        dashboard_layouts: dashboardLayoutFiles.length,
        tasks: taskFiles.length,
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
    counts: { files: 0, captures: 0, dashboardLayouts: 0, tasks: 0 },
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

  const supportedPaths = new Set(["workspace.json", DASHBOARD_LAYOUT_PATH]);
  const unexpectedFiles = validPayloadFiles.filter((file) => (
    !supportedPaths.has(file.path)
    && !file.path.startsWith("data/captures/")
    && !file.path.startsWith("data/tasks/")
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
