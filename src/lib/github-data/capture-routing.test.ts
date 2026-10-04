import { describe, expect, it, vi } from "vitest";
import { suggestCapture, type CaptureFields } from "./capture-details";
import { prepareCaptureSubmission, writeCaptureSubmission, captureScheduleWindow } from "./capture-routing";
import { parseTaskRecord } from "./tasks";
import { parseCalendarEventRecord, calendarEventsForDate } from "./calendar-events";
import { parseJournalEntryRecord } from "./journal-entries";
import { parseCaptureRecord } from "./workspace";
import { serializeRecord } from "./protocol";
import { GitHubConflictError, GitHubDataError } from "./github-contents";
import { buildDeterministicReport, renderDeterministicReportMarkdown, serializeDeterministicReportCsv } from "./deterministic-reports";

const now = new Date("2026-10-04T08:00:00Z");
const context = { ownerId: "test_owner", suffix: "synthetic_test", timestamp: now.toISOString(), today: "2026-10-04" };
function fields(text: string): CaptureFields { return { rawText: text, ...suggestCapture(text, now), timezone: "Asia/Shanghai" }; }

describe("explainable capture classification", () => {
  it.each([
    ["买牛奶", "todo"], ["记得给张三打电话", "todo"], ["明天买牛奶", "todo"],
    ["明天完成报告", "todo"], ["明天开会", "schedule"], ["明天十点开会", "schedule"],
    ["周五下午三点半看医生", "schedule"], ["周五之前提交报告", "deadline"], ["周五前交材料", "deadline"],
    ["明天10:00前交材料", "deadline"], ["明天十点 前交材料", "deadline"],
    ["能不能把首页做简单一点", "idea"], ["也许明天十点开个会", "idea"],
    ["不如明天提交报告", "idea"], ["有个想法，下周一试试看", "idea"],
    ["我想做一个读书工具", "idea"], ["日记：明天十点开会，今天很开心", "journal"],
    ["想法 把记录入口移到顶部", "idea"],
    ["今天跑步", "todo"], ["这个计划有三点建议", "idea"],
    ["日记：周五之前交报告", "journal"], ["待办：能不能做一个工具", "todo"],
    ["今天已经买了牛奶", "note"], ["昨天去过北京", "note"], ["以前去过北京", "note"],
    ["明天不用开会", "note"], ["取消明天十点开会", "note"], ["每周一九点站会", "note"],
    ["路边那棵树很好看", "note"], ["下周天气很好", "note"],
  ])("routes %s as %s with an explanation", (text, kind) => {
    expect(suggestCapture(text, now)).toMatchObject({ kind, reason: expect.any(String) });
  });
  it("parses Chinese time ranges and inherits afternoon for the second clock", () => {
    expect(suggestCapture("明天下午三点到四点开会", now)).toMatchObject({ time: "15:00", endTime: "16:00", warning: null });
    expect(suggestCapture("明天14:00-15:30开会", now)).toMatchObject({ time: "14:00", endTime: "15:30" });
    expect(suggestCapture("明天25:00-26:00开会", now).warning).toContain("时间无效");
  });
  it.each(["能不能把首页做简单一点", "想法：可以把页面做清晰一点", "这个计划有三点建议", "多一点想法"])("does not treat quantities in %s as clocks", (text) => {
    expect(suggestCapture(text, now)).toMatchObject({ time: null, endTime: null, date: null });
  });
});

describe("canonical destination creation", () => {
  it("creates a real task with a date-only deadline and retains the full original", () => {
    const submission = prepareCaptureSubmission(fields("明天买牛奶"), context);
    const task = parseTaskRecord(serializeRecord(submission.record));
    expect(submission).toMatchObject({ tab: "tasks", path: "data/tasks/task_synthetic_test.json" });
    expect(task.data).toMatchObject({ status: "todo", due_at: "2026-10-05", is_due_date_only: true, notes_markdown: "明天买牛奶" });
  });
  it("keeps precise deadlines in the workspace timezone", () => {
    const task = parseTaskRecord(serializeRecord(prepareCaptureSubmission(fields("明天十点前交材料"), context).record));
    expect(task.data).toMatchObject({ due_at: "2026-10-05T02:00:00.000Z", is_due_date_only: false });
  });
  it("creates timed, ranged and all-day calendar records without affecting another day", () => {
    const timed = parseCalendarEventRecord(serializeRecord(prepareCaptureSubmission(fields("明天十点开会"), context).record));
    expect(timed.data).toMatchObject({ start_at: "2026-10-05T02:00:00.000Z", end_at: "2026-10-05T03:00:00.000Z", all_day: false });
    const range = parseCalendarEventRecord(serializeRecord(prepareCaptureSubmission(fields("明天下午三点到四点开会"), context).record));
    expect(range.data).toMatchObject({ start_at: "2026-10-05T07:00:00.000Z", end_at: "2026-10-05T08:00:00.000Z" });
    const allDay = parseCalendarEventRecord(serializeRecord(prepareCaptureSubmission(fields("明天开会"), context).record));
    expect(allDay.data).toMatchObject({ all_day: true, local_start_date: "2026-10-05", local_end_date: "2026-10-05", end_at: "2026-10-05T16:00:00.000Z" });
    expect(calendarEventsForDate([allDay], "2026-10-06")).toEqual([]);
  });
  it("respects overnight ranges and DST when generating all-day spans", () => {
    expect(captureScheduleWindow("2026-10-05", "23:00", "01:00", "Asia/Shanghai")).toMatchObject({ endAt: "2026-10-05T17:00:00.000Z", localEndDate: "2026-10-06" });
    const dst = captureScheduleWindow("2026-03-08", null, null, "America/New_York");
    expect(Date.parse(dst.endAt) - Date.parse(dst.startAt)).toBe(23 * 60 * 60_000);
    expect(captureScheduleWindow("2026-10-05", "23:00", null, "Asia/Shanghai").localEndDate).toBe("2026-10-05");
  });
  it("retains all-day calendar facts in reports without inventing 24 hours of planned work", () => {
    const allDay = parseCalendarEventRecord(serializeRecord(prepareCaptureSubmission(fields("明天开会"), context).record));
    const report = buildDeterministicReport({ reportType: "weekly", anchorDate: "2026-10-05", timezone: "Asia/Shanghai", tasks: [], projects: [], milestones: [], calendarEvents: [allDay], activityEvents: [] });
    expect(report.calendarEvents).toHaveLength(1);
    expect(report.scheduledMinutes).toBe(0);
    expect(renderDeterministicReportMarkdown(report, "personal")).toContain("全天");
    expect(serializeDeterministicReportCsv(report)).not.toContain('"1440"');
  });
  it("writes journal content under today's date, removing only the explicit prefix", () => {
    const text = "日记：明天想交报告。\n今天完成了初稿。";
    const journal = parseJournalEntryRecord(serializeRecord(prepareCaptureSubmission(fields(text), context).record));
    expect(journal.data).toMatchObject({ journal_date: "2026-10-04", body_markdown: "明天想交报告。\n今天完成了初稿。" });
    expect(() => prepareCaptureSubmission({ ...fields(text), date: "2026-10-01" }, context)).toThrow("JOURNAL_DATE_NOT_WRITABLE");
  });
  it("keeps ideas in the idea collection and honors manual classification", () => {
    const submission = prepareCaptureSubmission({ ...fields("明天十点开会"), kind: "idea" }, context);
    expect(submission.tab).toBe("overview");
    expect(parseCaptureRecord(serializeRecord(submission.record)).data.kind).toBe("idea");
  });
  it("blocks empty bodies and missing schedule dates before a write can occur", () => {
    expect(() => prepareCaptureSubmission(fields("日记："), context)).toThrow("CAPTURE_BODY_REQUIRED");
    expect(() => prepareCaptureSubmission({ ...fields("日程：开会"), date: null }, context)).toThrow("CAPTURE_DATE_REQUIRED");
  });
});

describe("single-record submission and retry", () => {
  function adapter() { return { writeText: vi.fn().mockResolvedValue({ path: "path", blobSha: "blob", commitSha: "commit" }), readText: vi.fn(), readBranchSnapshot: vi.fn().mockResolvedValue({ headCommitSha: "head" }) }; }
  it.each(["明天买牛奶", "明天十点开会", "日记：今天完成了报告", "能不能做个工具"])("writes exactly one destination for %s", async (text) => {
    const writer = adapter();
    const submission = prepareCaptureSubmission(fields(text), context);
    await writeCaptureSubmission(writer, submission);
    expect(writer.writeText).toHaveBeenCalledExactlyOnceWith({ path: submission.path, text: serializeRecord(submission.record), message: `capture: create ${submission.record.id}` });
  });
  it("recognizes a previously successful write after a lost response without duplicating it", async () => {
    const writer = adapter();
    const submission = prepareCaptureSubmission(fields("明天买牛奶"), context);
    writer.readText.mockResolvedValue({ path: submission.path, text: serializeRecord(submission.record), blobSha: "existing" });
    expect(await writeCaptureSubmission(writer, submission, true)).toMatchObject({ blobSha: "existing" });
    expect(writer.writeText).not.toHaveBeenCalled();
  });
  it("retries the same path only if it was never written, and rejects changed records", async () => {
    const writer = adapter();
    const submission = prepareCaptureSubmission(fields("明天买牛奶"), context);
    writer.readText.mockRejectedValue(new GitHubDataError("not found", 404, "GITHUB_NOT_FOUND"));
    await writeCaptureSubmission(writer, submission, true);
    expect(writer.writeText).toHaveBeenCalledOnce();
    writer.readText.mockResolvedValue({ text: "changed" });
    await expect(writeCaptureSubmission(writer, submission, true)).rejects.toBeInstanceOf(GitHubConflictError);
    expect(writer.writeText).toHaveBeenCalledOnce();
  });
});
