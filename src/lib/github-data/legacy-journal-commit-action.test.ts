import { describe, expect, it } from "vitest";

import {
  buildLegacyJournalCommitActionConfirmation,
  legacyJournalCommitStatusFromReconciliation,
  runLegacyJournalCommitAttempt,
} from "./legacy-journal-commit-action";

describe("Legacy Journal production commit action", () => {
  it("builds an exact action-time confirmation with the irreversible Git boundary", () => {
    const message = buildLegacyJournalCommitActionConfirmation({
      repository: "lubannn/personal-workspace-data",
      dateRange: "2012-03-05..2012-03-06",
      expectedHeadCommitSha: "a".repeat(40),
      planSha256: "b".repeat(64),
      fileCount: 7,
      byteCount: 9_879,
    });

    expect(message).toContain("目标仓库：lubannn/personal-workspace-data");
    expect(message).toContain("日期范围：2012-03-05..2012-03-06");
    expect(message).toContain(`Expected HEAD：${"a".repeat(40)}`);
    expect(message).toContain(`Plan SHA-256：${"b".repeat(64)}`);
    expect(message).toContain("Payload：7 files / 9879 UTF-8 bytes");
    expect(message).toContain("软删除或 rollback 不能物理擦除历史");
    expect(message).toContain("结果未知时不会自动重试");
  });

  it("rejects incomplete confirmation facts", () => {
    const valid = {
      repository: "lubannn/personal-workspace-data",
      dateRange: "2012-03-05..2012-03-05",
      expectedHeadCommitSha: "a".repeat(40),
      planSha256: "b".repeat(64),
      fileCount: 4,
      byteCount: 5_502,
    };
    expect(() => buildLegacyJournalCommitActionConfirmation({ ...valid, repository: "personal-workspace-data" })).toThrow("INVALID_LEGACY_COMMIT_CONFIRMATION_REPOSITORY");
    expect(() => buildLegacyJournalCommitActionConfirmation({ ...valid, expectedHeadCommitSha: "stale" })).toThrow("INVALID_LEGACY_COMMIT_CONFIRMATION_HEAD");
    expect(() => buildLegacyJournalCommitActionConfirmation({ ...valid, fileCount: 0 })).toThrow("INVALID_LEGACY_COMMIT_CONFIRMATION_FILE_COUNT");
  });

  it("maps reconciliation to a terminal attempt state without a retry state", () => {
    const base = { observedHeadCommitSha: "a".repeat(40), checkpointPath: "data/journal-import-checkpoints/checkpoint.json", commitSha: null, blockers: [] };
    expect(legacyJournalCommitStatusFromReconciliation({ ...base, status: "committed" })).toBe("committed");
    expect(legacyJournalCommitStatusFromReconciliation({ ...base, status: "not_committed" })).toBe("not_committed");
    expect(legacyJournalCommitStatusFromReconciliation({ ...base, status: "conflict" })).toBe("conflict");
  });

  it("writes once and never reconciles after an acknowledged commit", async () => {
    let writes = 0;
    let reconciliations = 0;
    const outcome = await runLegacyJournalCommitAttempt({
      write: async () => { writes += 1; return { commitSha: "a".repeat(40) }; },
      reconcile: async () => { reconciliations += 1; throw new Error("must not run"); },
    });
    expect(outcome).toMatchObject({ status: "committed", writeResult: { commitSha: "a".repeat(40) }, reconciliation: null });
    expect(writes).toBe(1);
    expect(reconciliations).toBe(0);
  });

  it("reconciles once after an uncertain write and never retries the write", async () => {
    let writes = 0;
    let reconciliations = 0;
    const outcome = await runLegacyJournalCommitAttempt({
      write: async () => { writes += 1; throw new Error("unknown transport result"); },
      reconcile: async () => {
        reconciliations += 1;
        return { status: "not_committed" as const, observedHeadCommitSha: "a".repeat(40), checkpointPath: "data/journal-import-checkpoints/checkpoint.json", commitSha: null, blockers: [] };
      },
    });
    expect(outcome).toMatchObject({ status: "not_committed", writeResult: null, reconciliation: { status: "not_committed" } });
    expect(writes).toBe(1);
    expect(reconciliations).toBe(1);
  });

  it("keeps the result unknown when read-only reconciliation is unavailable", async () => {
    const outcome = await runLegacyJournalCommitAttempt({
      write: async () => { throw new Error("unknown transport result"); },
      reconcile: async () => { throw new Error("offline"); },
    });
    expect(outcome).toEqual({ status: "unknown", writeResult: null, reconciliation: null });
  });
});
