import { describe, expect, it } from "vitest";

import { GitHubDataError } from "../../../../src/lib/github-data/github-contents";
import {
  buildReadiness,
  formatTaskDue,
  friendlyError,
  friendlyJournalWriteError,
  localDateInTimezone,
  targetRepositoryName,
  type Connection,
} from "./page-model";

const connection: Connection = {
  repository: "lubannn/personal-workspace-data",
  ownerId: "github_lubannn",
  ownerLogin: "lubannn",
  timezone: "Asia/Shanghai",
};

describe("formal PWA page behavior", () => {
  it("uses the verified full repository name without adding the owner twice", () => {
    expect(targetRepositoryName(connection)).toBe("lubannn/personal-workspace-data");
    expect(targetRepositoryName(null)).toBe("");
  });

  it("keeps GitHub App authorization and live sync readiness labels", () => {
    expect(buildReadiness(connection, "github-app", "configured")).toMatchObject([
      { label: "Static PWA", done: true },
      { label: "Private data repo", done: true },
      { label: "GitHub authorization", detail: "GitHub App 会话已授权", done: true },
      { label: "Real sync", detail: "Capture 与 Tasks 已启用", done: true },
    ]);
  });

  it("keeps disconnected GitHub App state waiting for login", () => {
    expect(buildReadiness(null, null, "configured")[2]).toEqual({
      label: "GitHub authorization",
      detail: "等待 GitHub 登录",
      done: false,
    });
  });

  it("formats overdue, today, future, and missing Task DDLs", () => {
    expect(formatTaskDue("2026-08-27", "2026-08-28")).toBe("已逾期 · 08/27");
    expect(formatTaskDue("2026-08-28", "2026-08-28")).toBe("今天");
    expect(formatTaskDue("2026-09-01", "2026-08-28")).toBe("09/01");
    expect(formatTaskDue(null, "2026-08-28")).toBe("无 DDL");
  });

  it("uses the workspace timezone for the default date", () => {
    expect(localDateInTimezone("Asia/Shanghai", new Date("2026-08-27T16:30:00.000Z"))).toBe("2026-08-28");
    expect(localDateInTimezone("America/Los_Angeles", new Date("2026-08-27T16:30:00.000Z"))).toBe("2026-08-27");
  });

  it("keeps cross-device conflicts explicit", () => {
    expect(friendlyError(new GitHubDataError("conflict", 409, "GITHUB_SYNC_CONFLICT")))
      .toBe("文件已在另一台设备更新，请刷新后重试。");
  });

  it("keeps the Private-repository safety failure visible", () => {
    expect(friendlyError(new GitHubDataError("public", 400, "GITHUB_REPOSITORY_NOT_PRIVATE")))
      .toBe("安全检查未通过：数据仓库必须保持 Private。");
  });

  it.each([
    ["GITHUB_TRANSPORT_ERROR", "读取超时或连接中断"],
    ["GITHUB_GRAPHQL_ERROR", "批量读取未完成"],
    ["GITHUB_INVALID_RESPONSE", "数据不完整或格式异常"],
    ["GITHUB_UNSUPPORTED_CONTENT", "数据不完整或格式异常"],
    ["GITHUB_TREE_TRUNCATED", "数据不完整或格式异常"],
  ])("identifies %s without hiding it behind a generic login failure or exposing response data", (code, message) => {
    const result = friendlyError(new GitHubDataError("private upstream response", 500, code));
    expect(result).toContain(message);
    expect(result).not.toContain("private upstream response");
    expect(result).not.toBe("连接 GitHub 时发生错误，请稍后重试。");
  });

  it("explains atomic Journal conflicts and history failures without claiming a save", () => {
    expect(friendlyJournalWriteError(new GitHubDataError("conflict", 409, "GITHUB_SYNC_CONFLICT"), "edit"))
      .toBe("文件已在另一台设备更新，请刷新后重试。");
    expect(friendlyJournalWriteError(new Error("JOURNAL_REVISION_HASH_MISMATCH"), "edit"))
      .toContain("一致性校验");
    expect(friendlyJournalWriteError(new Error("INVALID_JOURNAL_REVISION_DETAILS"), "edit"))
      .toBe("日记正文或元数据无效，未保存修订。");
  });
});
