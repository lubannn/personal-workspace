import type { LegacyJournalReconciliation } from "./legacy-journal-atomic-writer";

export type LegacyJournalCommitActionStatus =
  | "idle"
  | "writing"
  | "committed"
  | "not_committed"
  | "conflict"
  | "unknown";

export type LegacyJournalCommitAttemptOutcome<T> =
  | { status: "committed"; writeResult: T; reconciliation: null }
  | { status: "committed" | "not_committed" | "conflict"; writeResult: null; reconciliation: LegacyJournalReconciliation }
  | { status: "unknown"; writeResult: null; reconciliation: null };

export function buildLegacyJournalCommitActionConfirmation(input: {
  repository: string;
  dateRange: string;
  expectedHeadCommitSha: string;
  planSha256: string;
  fileCount: number;
  byteCount: number;
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(input.repository)) throw new Error("INVALID_LEGACY_COMMIT_CONFIRMATION_REPOSITORY");
  if (!/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/u.test(input.dateRange)) throw new Error("INVALID_LEGACY_COMMIT_CONFIRMATION_DATE_RANGE");
  if (!/^[a-f0-9]{40}$/u.test(input.expectedHeadCommitSha)) throw new Error("INVALID_LEGACY_COMMIT_CONFIRMATION_HEAD");
  if (!/^[a-f0-9]{64}$/u.test(input.planSha256)) throw new Error("INVALID_LEGACY_COMMIT_CONFIRMATION_PLAN_SHA");
  if (!Number.isSafeInteger(input.fileCount) || input.fileCount < 1) throw new Error("INVALID_LEGACY_COMMIT_CONFIRMATION_FILE_COUNT");
  if (!Number.isSafeInteger(input.byteCount) || input.byteCount < 1) throw new Error("INVALID_LEGACY_COMMIT_CONFIRMATION_BYTE_COUNT");
  return [
    "确认现在执行一次 Legacy Journal 原子 Commit？",
    "",
    `目标仓库：${input.repository}`,
    `日期范围：${input.dateRange}`,
    `Expected HEAD：${input.expectedHeadCommitSha}`,
    `Plan SHA-256：${input.planSha256}`,
    `Payload：${input.fileCount} files / ${input.byteCount} UTF-8 bytes`,
    "",
    "Git 历史会永久保留本批正文；软删除或 rollback 不能物理擦除历史。",
    "选择“确定”后只尝试一次；结果未知时不会自动重试。",
  ].join("\n");
}

export function legacyJournalCommitStatusFromReconciliation(
  reconciliation: LegacyJournalReconciliation,
): Exclude<LegacyJournalCommitActionStatus, "idle" | "writing" | "unknown"> {
  return reconciliation.status;
}

export async function runLegacyJournalCommitAttempt<T>(input: {
  write: () => Promise<T>;
  reconcile: () => Promise<LegacyJournalReconciliation>;
  onWriteUncertain?: () => void;
}): Promise<LegacyJournalCommitAttemptOutcome<T>> {
  try {
    return { status: "committed", writeResult: await input.write(), reconciliation: null };
  } catch {
    input.onWriteUncertain?.();
    try {
      const reconciliation = await input.reconcile();
      return { status: reconciliation.status, writeResult: null, reconciliation };
    } catch {
      return { status: "unknown", writeResult: null, reconciliation: null };
    }
  }
}
