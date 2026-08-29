import { GitHubContentsAdapter, GitHubDataError } from "../../../../src/lib/github-data/github-contents";
import type { ExportInspectionIssue } from "../../../../src/lib/github-data/portable-export";
import { parseWorkspaceDescriptor, type CaptureRecord } from "../../../../src/lib/github-data/workspace";
import type { TaskCategory, TaskPriority, TaskRecord } from "../../../../src/lib/github-data/tasks";
import type { ProjectRecord } from "../../../../src/lib/github-data/projects";
import type { ProjectPhaseRecord } from "../../../../src/lib/github-data/project-phases";
import type { MilestoneRecord } from "../../../../src/lib/github-data/milestones";
import type { ProjectNoteRecord } from "../../../../src/lib/github-data/project-notes";
import type { ActivityEventRecord } from "../../../../src/lib/github-data/activity-events";
import type { CalendarEventRecord } from "../../../../src/lib/github-data/calendar-events";

export type Connection = {
  repository: string;
  ownerId: string;
  ownerLogin: string;
  timezone: string;
};

export type SavedCapture = {
  path: string;
  commitSha: string;
  text: string;
};

export type SyncedCapture = {
  record: CaptureRecord;
  path: string;
  blobSha: string;
};

export type SyncedTask = {
  record: TaskRecord;
  path: string;
  blobSha: string;
};

export type SyncedProject = {
  record: ProjectRecord;
  path: string;
  blobSha: string;
};

export type SyncedProjectPhase = {
  record: ProjectPhaseRecord;
  path: string;
  blobSha: string;
};

export type SyncedMilestone = {
  record: MilestoneRecord;
  path: string;
  blobSha: string;
};

export type SyncedProjectNote = {
  record: ProjectNoteRecord;
  path: string;
  blobSha: string;
};

export type SyncedActivityEvent = {
  record: ActivityEventRecord;
  path: string;
  blobSha: string;
};

export type SyncedCalendarEvent = {
  record: CalendarEventRecord;
  path: string;
  blobSha: string;
};

export type AuthAvailability = "checking" | "unavailable" | "configured";
export type ConnectionMethod = "github-app" | "personal-token";

export type PortabilityResult = {
  fileName: string;
  valid: boolean;
  files: number;
  captures: number;
  dashboardLayouts: number;
  tasks: number;
  projects: number;
  projectPhases: number;
  milestones: number;
  projectNotes: number;
  activityEvents: number;
  calendarEvents: number;
  errors: ExportInspectionIssue[];
  warnings: ExportInspectionIssue[];
};

export const DEFAULT_OWNER = "lubannn";
export const DEFAULT_REPOSITORY = "personal-workspace-data";

export function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const entry = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
}

export async function openPrivateRepository(rawToken: string, owner: string, repository: string) {
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

export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  work: "工作",
  life: "生活",
  life_goal: "人生",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  none: "无",
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};

export function friendlyError(error: unknown) {
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

export function formatCaptureTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function localDateInTimezone(timezone: string, value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

export function formatTaskDue(value: string | null, today: string) {
  if (!value) return "无 DDL";
  const date = value.slice(0, 10);
  if (date < today) return `已逾期 · ${date.slice(5).replace("-", "/")}`;
  if (date === today) return "今天";
  return date.slice(5).replace("-", "/");
}

export function buildReadiness(
  connection: Connection | null,
  connectionMethod: ConnectionMethod | null,
  authAvailability: AuthAvailability,
) {
  return [
    { label: "Static PWA", detail: "Mac 关机时仍可打开", done: true },
    { label: "Private data repo", detail: "可见性连接时强制检查", done: true },
    {
      label: "GitHub authorization",
      detail: connection
        ? connectionMethod === "github-app" ? "GitHub App 会话已授权" : "当前页面已授权"
        : authAvailability === "configured" ? "等待 GitHub 登录" : "等待最小权限令牌",
      done: Boolean(connection),
    },
    { label: "Real sync", detail: connection ? "Capture 与 Tasks 已启用" : "连接后写入真实文件", done: Boolean(connection) },
  ];
}
