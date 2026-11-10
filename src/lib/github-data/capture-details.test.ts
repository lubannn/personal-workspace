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
    expect(updated).toMatchObject({ id: original.id, created_at: original.created_at, version: 2, data: { raw_text: "  想法：明天尝试  ", kind: "idea", status: "archived", noted_date: "2026-10-05", extension: { keep: true } } });
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

describe("idea category edits", () => {
  const ideaFields = { rawText: "  想法：改进客户会议\n保留完整的一段话。\n ", kind: "idea" as const, date: null, time: null, timezone: "Asia/Shanghai" };
  const ideaRecord = () => createWorkspaceRecord({ entityType: "capture", id: "idea_edit", ownerId: "test_owner", timestamp: now.toISOString(), data: createCaptureData(ideaFields) });
  it("keeps the exact whole raw text and rejects empty or oversized input", () => {
    expect(createCaptureData(ideaFields)).toMatchObject({ raw_text: ideaFields.rawText, idea_classification: { category: "work", source: "automatic" } });
    expect(() => createCaptureData({ ...ideaFields, rawText: " \n\t " })).toThrow("INVALID_CAPTURE_DETAILS");
    expect(() => createCaptureData({ ...ideaFields, rawText: " ".repeat(10_000) + "a" })).toThrow("INVALID_CAPTURE_DETAILS");
    expect(() => createCaptureData({ ...ideaFields, ideaCategory: "bad" as "auto" })).toThrow("INVALID_CAPTURE_DETAILS");
    expect(createCaptureData({ ...ideaFields, kind: "note", rawText: "  ordinary note  " })).toMatchObject({ raw_text: "ordinary note" });
    expect(createCaptureData({ ...ideaFields, kind: "note" })).not.toHaveProperty("idea_classification");
  });
  it("reclassifies edited automatic ideas and keeps unrelated metadata", () => {
    const original = ideaRecord();
    const updated = updateCaptureDetails(original, { ...ideaFields, rawText: "\n周末和家人旅行  " });
    expect(updated.data).toMatchObject({ raw_text: "\n周末和家人旅行  ", idea_classification: { category: "life", source: "automatic", classifier_version: "local-rules-v1" } });
    expect(original.data.idea_classification?.category).toBe("work");
    expect(updated.id).toBe(original.id);
    expect(updated.version).toBe(original.version + 1);
  });
  it("preserves manual choices on text edits until auto is explicitly selected", () => {
    for (const ideaCategory of ["life", "unclassified"] as const) {
      const manual = updateCaptureDetails(ideaRecord(), { ...ideaFields, ideaCategory });
      const edited = updateCaptureDetails(manual, { ...ideaFields, rawText: "公司客户需要新的会议流程" });
      expect(edited.data.idea_classification).toEqual({ category: ideaCategory, source: "manual", classifier_version: null });
      expect(updateCaptureDetails(edited, { ...ideaFields, ideaCategory: "auto" }).data.idea_classification?.category).toBe("work");
    }
  });
  it("removes classification when switching out of ideas without changing the original record", () => {
    const original = ideaRecord();
    const edited = updateCaptureDetails(original, { ...ideaFields, kind: "note" });
    expect(edited.data).not.toHaveProperty("idea_classification");
    expect(original.data).toHaveProperty("idea_classification");
  });
  it("only classifies a legacy idea when explicitly saved", () => {
    const legacy = ideaRecord();
    delete legacy.data.idea_classification;
    expect(parseCaptureRecord(serializeRecord(legacy)).data).not.toHaveProperty("idea_classification");
    expect(updateCaptureDetails(legacy, ideaFields).data.idea_classification?.category).toBe("work");
    expect(legacy.data).not.toHaveProperty("idea_classification");
  });
  it("exports, inspects, migrates and restores classified and legacy ideas verbatim", async () => {
    const automatic = ideaRecord();
    const manual = { ...updateCaptureDetails(automatic, { ...ideaFields, ideaCategory: "life" }), id: "idea_manual" };
    const legacy = { ...automatic, id: "idea_legacy", data: { raw_text: "  客户会议\n ", kind: "idea" as const, status: "inbox" as const } };
    const records = [automatic, manual, legacy];
    const file = (path: string, text: string) => ({ path, text, blobSha: "fixture-blob", sizeBytes: new TextEncoder().encode(text).length });
    const captureFiles = records.map((item) => file(recordPath("capture", item.id), serializeRecord(item)));
    const backup = await buildPortableWorkspaceExport({ repository: "test_owner/source", branch: "main", workspaceFile: file("workspace.json", JSON.stringify({ schema_version: 1, workspace_id: "test_workspace", owner_id: "test_owner", owner_login: "test_owner", locale: "zh-CN", timezone: "Asia/Shanghai" })), captureFiles });
    expect((await inspectPortableWorkspaceExport(backup)).valid).toBe(true);
    expect(await dryRunPortableWorkspaceMigrations(backup)).toMatchObject({ valid: true, counts: { migratable: 0, blocked: 0 } });
    const plan = await createPortableRestorePlan(backup, { repository: { fullName: "test_owner/restore", private: true, visibility: "private", defaultBranch: "main" }, branch: { branch: "main", headCommitSha: "head", rootTreeSha: "tree" }, rootEntries: [] });
    expect(plan.ready).toBe(true);
    for (const item of captureFiles) {
      const restored = plan.files.find((candidate) => candidate.path === item.path)?.text;
      expect(restored).toBe(item.text);
      expect(parseCaptureRecord(restored!).data).toEqual(parseCaptureRecord(item.text).data);
    }
  });
});
