import { describe, expect, it } from "vitest";
import { captureMatches, createCaptureData, suggestCapture, updateCaptureDetails } from "./capture-details";
import { createWorkspaceRecord, recordPath, serializeRecord, setWorkspaceRecordDeleted } from "./protocol";
import { parseCaptureRecord } from "./workspace";
import { buildPortableWorkspaceExport, inspectPortableWorkspaceExport } from "./portable-export";
import { createPortableRestorePlan } from "./portable-restore";
import { dryRunPortableWorkspaceMigrations } from "./schema-migrations";

const now = new Date("2026-10-04T08:00:00Z"); // Sunday, in Shanghai.
const fields = { rawText: "明天 10 点开会", kind: "schedule" as const, date: "2026-10-05", time: "10:00", timezone: "Asia/Shanghai" };
function record() { return createWorkspaceRecord({ entityType: "capture", id: "capture_example", ownerId: "test_owner", timestamp: now.toISOString(), data: createCaptureData(fields) }); }

describe("capture suggestions", () => {
  it.each([
    ["明天 10 点开会", "schedule", "2026-10-05", "10:00"],
    ["下周一 下午3点半开会", "schedule", "2026-10-05", "15:30"],
    ["这周一复盘", "todo", "2026-09-28", null],
    ["周一复盘", "todo", "2026-10-05", null],
    ["下下周日复盘", "todo", "2026-10-18", null],
    ["DDL 10月10日前交材料", "deadline", "2026-10-10", null],
    ["两周内提交材料", "deadline", "2026-10-18", null],
    ["一个月以内提交报告", "deadline", "2026-11-04", null],
    ["三个工作日内提交报告", "deadline", "2026-10-07", null],
    ["2027-01-15 14:30 开会", "schedule", "2027-01-15", "14:30"],
    ["想法：明天试一下新工具", "idea", "2026-10-05", null],
    ["日记：今天完成了报告", "journal", "2026-10-04", null],
    ["待办：整理书桌", "todo", null, null],
    ["路上看到一棵树", "note", null, null],
    ["6月10日开会", "schedule", "2027-06-10", null],
  ])("recognizes %s", (text, kind, date, time) => {
    expect(suggestCapture(text, now)).toMatchObject({ kind, date, time });
  });
  it("uses the workspace date rather than the host timezone", () => {
    const midnight = new Date("2026-10-04T18:00:00Z");
    expect(suggestCapture("明天 10点开会", midnight, "Asia/Shanghai").date).toBe("2026-10-06");
    expect(suggestCapture("明天 10点开会", midnight, "America/Los_Angeles").date).toBe("2026-10-05");
  });
  it("clamps month deadlines and skips weekends for workdays", () => {
    expect(suggestCapture("一个月内完成", new Date("2026-01-31T08:00:00Z")).date).toBe("2026-02-28");
    expect(suggestCapture("两个工作日内完成", new Date("2026-10-02T08:00:00Z")).date).toBe("2026-10-06");
  });
  it("warns for invalid dates, invalid times and recurrence instead of inventing a valid value", () => {
    expect(suggestCapture("2026-02-30 开会", now)).toMatchObject({ date: null, warning: expect.any(String) });
    expect(suggestCapture("明天 25:00 开会", now)).toMatchObject({ time: null, warning: expect.any(String) });
    expect(suggestCapture("每周一 9点站会", now)).toMatchObject({ date: null, time: null, warning: expect.any(String) });
  });
});

describe("capture metadata compatibility and editing", () => {
  it("reads existing records without assigning new semantics", () => {
    const original = { ...record(), data: { raw_text: "明天开会", status: "inbox" as const } };
    expect(parseCaptureRecord(serializeRecord(original)).data).toEqual(original.data);
    expect(captureMatches(original, "明天", "note")).toBe(true);
  });
  it.each([{ kind: "unknown" }, { noted_date: "2026-02-30" }, { noted_time: "25:00" }, { noted_date: null }, { timezone: "invalid/zone" }])("rejects malformed optional fields %j", (invalid) => {
    const value = record();
    expect(() => parseCaptureRecord(serializeRecord({ ...value, data: { ...value.data, ...invalid } }))).toThrow("INVALID_CAPTURE_RECORD");
  });
  it("preserves original text, extension fields, identity, archive state and creation time while versioning edits", () => {
    const original = record();
    original.data.status = "archived";
    const extended = { ...original, data: { ...original.data, extension: { keep: true } } };
    const updated = updateCaptureDetails(extended, { ...fields, rawText: "  想法：明天尝试  ", kind: "idea" }, "2026-10-06T08:00:00Z");
    expect(updated).toMatchObject({ id: original.id, created_at: original.created_at, version: 2, data: { raw_text: "想法：明天尝试", kind: "idea", status: "archived", noted_date: "2026-10-05", extension: { keep: true } } });
    expect(() => updateCaptureDetails(setWorkspaceRecordDeleted(original, now.toISOString()), fields)).toThrow("CAPTURE_IN_TRASH");
    expect(() => createCaptureData({ ...fields, date: null })).toThrow("INVALID_CAPTURE_DETAILS");
  });
  it("searches content and both captured and noted dates, months and weekdays", () => {
    expect(captureMatches(record(), "开会 10月 周一", "schedule")).toBe(true);
    expect(captureMatches(record(), "2026-10-05 星期一")).toBe(true);
    expect(captureMatches(record(), "2026-10-04")).toBe(true);
    expect(captureMatches(record(), "开会", "idea")).toBe(false);
  });
  it("exports, inspects, migrates and restores metadata without rewriting old records", async () => {
    const capture = record();
    const text = serializeRecord(capture);
    const file = (path: string, text: string) => ({ path, text, blobSha: "fixture-blob", sizeBytes: new TextEncoder().encode(text).length });
    const backup = await buildPortableWorkspaceExport({ repository: "test_owner/source", branch: "main", workspaceFile: file("workspace.json", JSON.stringify({ schema_version: 1, workspace_id: "test_workspace", owner_id: "test_owner", owner_login: "test_owner", locale: "zh-CN", timezone: "Asia/Shanghai" })), captureFiles: [file(recordPath("capture", capture.id), text)] });
    expect((await inspectPortableWorkspaceExport(backup)).valid).toBe(true);
    expect(await dryRunPortableWorkspaceMigrations(backup)).toMatchObject({ valid: true, counts: { migratable: 0, blocked: 0 } });
    const plan = await createPortableRestorePlan(backup, { repository: { fullName: "test_owner/restore", private: true, visibility: "private", defaultBranch: "main" }, branch: { branch: "main", headCommitSha: "head", rootTreeSha: "tree" }, rootEntries: [] });
    expect(plan.ready).toBe(true);
    expect(plan.files.find((item) => item.path === recordPath("capture", capture.id))?.text).toBe(text);
  });
});
