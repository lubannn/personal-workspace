import { GITHUB_DATA_SCHEMA_VERSION } from "./protocol";
import { DASHBOARD_LAYOUT_SCHEMA_VERSION } from "./dashboard-layout";
import {
  PORTABLE_EXPORT_FORMAT,
  PORTABLE_EXPORT_VERSION,
  type ExportInspectionIssue,
  type PortableExportFile,
} from "./portable-export";

export const SCHEMA_MIGRATION_REGISTRY_VERSION = 1 as const;
export const WORKSPACE_SCHEMA_VERSION = 1 as const;

export type SchemaDocumentKind = "workspace" | "record" | "dashboard_layout";
export type SchemaMigrationStatus = "current" | "migratable" | "blocked";

export type SchemaMigrationStep = {
  id: string;
  kind: SchemaDocumentKind;
  fromVersion: number;
  toVersion: number;
  description: string;
};

export type SchemaMigrationPlan = {
  kind: SchemaDocumentKind;
  fromVersion: number | null;
  targetVersion: number;
  status: SchemaMigrationStatus;
  steps: SchemaMigrationStep[];
  issues: ExportInspectionIssue[];
};

export type SchemaMigrationDryRunFile = SchemaMigrationPlan & {
  path: string;
};

export type SchemaMigrationDryRun = {
  valid: boolean;
  registryVersion: typeof SCHEMA_MIGRATION_REGISTRY_VERSION;
  counts: {
    files: number;
    current: number;
    migratable: number;
    blocked: number;
    steps: number;
  };
  files: SchemaMigrationDryRunFile[];
  errors: ExportInspectionIssue[];
};

// Version 1 is the first canonical GitHub file schema. Future migrations are
// appended here; existing entries must never be rewritten after publication.
export const SCHEMA_MIGRATIONS: readonly SchemaMigrationStep[] = [];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function targetVersion(kind: SchemaDocumentKind) {
  if (kind === "workspace") return WORKSPACE_SCHEMA_VERSION;
  if (kind === "dashboard_layout") return DASHBOARD_LAYOUT_SCHEMA_VERSION;
  return GITHUB_DATA_SCHEMA_VERSION;
}

export function validateSchemaMigrationRegistry(
  registry: readonly SchemaMigrationStep[] = SCHEMA_MIGRATIONS,
): ExportInspectionIssue[] {
  const issues: ExportInspectionIssue[] = [];
  const ids = new Set<string>();
  const routes = new Set<string>();
  for (const step of registry) {
    if (!step.id || ids.has(step.id)) {
      issues.push({ code: "SCHEMA_MIGRATION_ID_DUPLICATE", message: "迁移 ID 必须存在且全局唯一。" });
    }
    ids.add(step.id);
    const route = `${step.kind}:${step.fromVersion}`;
    if (routes.has(route)) {
      issues.push({ code: "SCHEMA_MIGRATION_ROUTE_DUPLICATE", message: "同一文件类型和来源版本只能注册一个迁移步骤。" });
    }
    routes.add(route);
    if (
      !Number.isInteger(step.fromVersion)
      || !Number.isInteger(step.toVersion)
      || step.fromVersion < 1
      || step.toVersion <= step.fromVersion
    ) {
      issues.push({ code: "SCHEMA_MIGRATION_STEP_INVALID", message: "迁移步骤必须从正整数版本单向升级。" });
    }
  }
  return issues;
}

export function planSchemaMigration(
  value: unknown,
  kind: SchemaDocumentKind,
  registry: readonly SchemaMigrationStep[] = SCHEMA_MIGRATIONS,
): SchemaMigrationPlan {
  return planSchemaMigrationTo(value, kind, targetVersion(kind), registry);
}

export function planSchemaMigrationTo(
  value: unknown,
  kind: SchemaDocumentKind,
  target: number,
  registry: readonly SchemaMigrationStep[] = SCHEMA_MIGRATIONS,
): SchemaMigrationPlan {
  const rawVersion = isObject(value) ? value.schema_version : null;
  const fromVersion = Number.isInteger(rawVersion) && Number(rawVersion) > 0 ? Number(rawVersion) : null;
  const issues: ExportInspectionIssue[] = [];
  const steps: SchemaMigrationStep[] = [];

  if (fromVersion === null) {
    issues.push({ code: "SCHEMA_VERSION_MISSING", message: "文件缺少有效的 schema_version。" });
    return { kind, fromVersion, targetVersion: target, status: "blocked", steps, issues };
  }
  if (fromVersion === target) {
    return { kind, fromVersion, targetVersion: target, status: "current", steps, issues };
  }
  if (fromVersion > target) {
    issues.push({ code: "SCHEMA_VERSION_FROM_FUTURE", message: "文件 schema 版本高于当前工作台，禁止降级。" });
    return { kind, fromVersion, targetVersion: target, status: "blocked", steps, issues };
  }

  let version = fromVersion;
  const visited = new Set<number>();
  while (version < target) {
    if (visited.has(version)) {
      issues.push({ code: "SCHEMA_MIGRATION_CYCLE", message: "迁移注册表存在循环，已停止 dry run。" });
      break;
    }
    visited.add(version);
    const candidates = registry.filter((step) => step.kind === kind && step.fromVersion === version);
    if (candidates.length !== 1) {
      issues.push({
        code: candidates.length === 0 ? "SCHEMA_MIGRATION_PATH_MISSING" : "SCHEMA_MIGRATION_PATH_AMBIGUOUS",
        message: candidates.length === 0 ? "没有从当前版本到目标版本的已注册迁移路径。" : "同一版本存在多个迁移分支，禁止自动选择。",
      });
      break;
    }
    const step = candidates[0]!;
    if (step.toVersion <= step.fromVersion || step.toVersion > target) {
      issues.push({ code: "SCHEMA_MIGRATION_STEP_INVALID", message: "迁移步骤版本范围无效。" });
      break;
    }
    steps.push(step);
    version = step.toVersion;
  }

  return {
    kind,
    fromVersion,
    targetVersion: target,
    status: issues.length === 0 && version === target ? "migratable" : "blocked",
    steps,
    issues,
  };
}

export async function dryRunPortableWorkspaceMigrations(value: unknown): Promise<SchemaMigrationDryRun> {
  const errors = [...validateSchemaMigrationRegistry()];
  const result: SchemaMigrationDryRun = {
    valid: false,
    registryVersion: SCHEMA_MIGRATION_REGISTRY_VERSION,
    counts: { files: 0, current: 0, migratable: 0, blocked: 0, steps: 0 },
    files: [],
    errors,
  };
  if (!isObject(value) || value.format !== PORTABLE_EXPORT_FORMAT || value.export_version !== PORTABLE_EXPORT_VERSION) {
    errors.push({ code: "SCHEMA_DRY_RUN_EXPORT_INVALID", message: "Schema dry run 只接受当前开放导出包格式。" });
    return result;
  }
  if (!Array.isArray(value.files)) {
    errors.push({ code: "SCHEMA_DRY_RUN_FILES_MISSING", message: "导出包缺少可规划的文件列表。" });
    return result;
  }

  const files: PortableExportFile[] = [];
  const paths = new Set<string>();
  for (const file of value.files) {
    if (!isObject(file) || typeof file.path !== "string" || typeof file.content !== "string") {
      errors.push({ code: "SCHEMA_DRY_RUN_FILE_INVALID", message: "导出包中存在无法规划的文件条目。" });
      continue;
    }
    if (paths.has(file.path)) {
      errors.push({ code: "SCHEMA_DRY_RUN_PATH_DUPLICATE", message: "Schema dry run 不接受重复文件路径。", path: file.path });
      continue;
    }
    paths.add(file.path);
    files.push({ path: file.path, content: file.content });
  }

  for (const file of files.sort((left, right) => left.path.localeCompare(right.path))) {
    const kind: SchemaDocumentKind = file.path === "workspace.json"
      ? "workspace"
      : file.path === "config/dashboard-layout.json" ? "dashboard_layout" : "record";
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.content);
    } catch {
      const issue = { code: "SCHEMA_DOCUMENT_INVALID_JSON", message: "文件不是有效 JSON。", path: file.path };
      errors.push(issue);
      result.files.push({
        path: file.path,
        kind,
        fromVersion: null,
        targetVersion: targetVersion(kind),
        status: "blocked",
        steps: [],
        issues: [issue],
      });
      continue;
    }
    const plan = planSchemaMigration(parsed, kind);
    const filePlan = {
      ...plan,
      path: file.path,
      issues: plan.issues.map((issue) => ({ ...issue, path: file.path })),
    };
    result.files.push(filePlan);
    errors.push(...filePlan.issues);
  }

  result.counts.files = result.files.length;
  result.counts.current = result.files.filter((file) => file.status === "current").length;
  result.counts.migratable = result.files.filter((file) => file.status === "migratable").length;
  result.counts.blocked = result.files.filter((file) => file.status === "blocked").length;
  result.counts.steps = result.files.reduce((total, file) => total + file.steps.length, 0);
  result.valid = errors.length === 0;
  return result;
}
