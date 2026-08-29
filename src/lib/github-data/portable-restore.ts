import type {
  GitHubBranchSnapshot,
  GitHubDirectoryItem,
  GitHubRepositoryStatus,
} from "./github-contents";
import {
  inspectPortableWorkspaceExport,
  type ExportInspectionIssue,
  type PortableWorkspaceExport,
} from "./portable-export";

const CANONICAL_ROOT_NAMES = new Set([
  "workspace.json",
  "config",
  "data",
  "journal",
  "attachments",
  "imports",
  "indexes",
  "trash",
]);

export type PortableRestoreTarget = {
  repository: GitHubRepositoryStatus;
  branch: GitHubBranchSnapshot;
  rootEntries: GitHubDirectoryItem[];
};

export type PortableRestorePlan = {
  ready: boolean;
  sourceRepository: string | null;
  targetRepository: string;
  branch: string;
  expectedHeadCommitSha: string;
  baseTreeSha: string;
  counts: { files: number; captures: number; dashboardLayouts: number; tasks: number; projects: number; projectPhases: number; milestones: number; projectNotes: number; activityEvents: number };
  files: Array<{ path: string; text: string }>;
  errors: ExportInspectionIssue[];
  warnings: ExportInspectionIssue[];
};

function sameRepository(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

export async function createPortableRestorePlan(
  value: unknown,
  target: PortableRestoreTarget,
): Promise<PortableRestorePlan> {
  const inspection = await inspectPortableWorkspaceExport(value);
  const errors = [...inspection.errors];
  const warnings = [...inspection.warnings];
  const targetRepository = target.repository.fullName;

  if (!target.repository.private || target.repository.visibility !== "private") {
    errors.push({ code: "RESTORE_TARGET_NOT_PRIVATE", message: "恢复目标必须保持 Private。" });
  }
  if (target.branch.branch !== target.repository.defaultBranch) {
    errors.push({ code: "RESTORE_BRANCH_MISMATCH", message: "恢复分支必须是目标仓库当前默认分支。" });
  }
  if (inspection.repository && sameRepository(inspection.repository, targetRepository)) {
    errors.push({ code: "RESTORE_TARGET_IS_SOURCE", message: "不能把导出包恢复回来源仓库。" });
  }

  const targetOwner = targetRepository.split("/", 1)[0] ?? "";
  if (
    inspection.workspace
    && targetOwner.localeCompare(inspection.workspace.owner_login, undefined, { sensitivity: "accent" }) !== 0
  ) {
    errors.push({ code: "RESTORE_TARGET_OWNER_MISMATCH", message: "恢复目标 owner 与导出包 owner 不一致。" });
  }

  const blockedEntries = target.rootEntries.filter((entry) => CANONICAL_ROOT_NAMES.has(entry.name));
  for (const entry of blockedEntries) {
    errors.push({
      code: "RESTORE_TARGET_HAS_WORKSPACE_DATA",
      message: "目标仓库已经包含 Personal Workspace 数据，禁止覆盖。",
      path: entry.path,
    });
  }
  const preservedEntries = target.rootEntries.filter((entry) => !CANONICAL_ROOT_NAMES.has(entry.name));
  if (preservedEntries.length > 0) {
    warnings.push({
      code: "RESTORE_TARGET_NON_DATA_FILES_PRESERVED",
      message: `目标仓库的 ${preservedEntries.length} 个非业务根目录条目会保留。`,
    });
  }

  const exported = inspection.valid ? value as PortableWorkspaceExport : null;
  const files = exported
    ? [...exported.files]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => ({ path: file.path, text: file.content }))
    : [];

  return {
    ready: errors.length === 0,
    sourceRepository: inspection.repository,
    targetRepository,
    branch: target.branch.branch,
    expectedHeadCommitSha: target.branch.headCommitSha,
    baseTreeSha: target.branch.rootTreeSha,
    counts: inspection.counts,
    files,
    errors,
    warnings,
  };
}
