import { createProjectData } from "../../../../src/lib/github-data/projects";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalendarSection } from "./calendar-section";
import { CaptureInboxSection, initialCaptureEditorFields } from "./capture-inbox-section";
import { createWorkspaceRecord } from "../../../../src/lib/github-data/protocol";
import { createCaptureData } from "../../../../src/lib/github-data/capture-details";
import { createCalendarEventData, setCalendarEventCompleted } from "../../../../src/lib/github-data/calendar-events";
import { createDefaultDashboardLayout } from "../../../../src/lib/github-data/dashboard-layout";
import { DashboardSection } from "./dashboard-section";
const connection = { repository: "example/preview", ownerId: "test_owner", ownerLogin: "example", timezone: "UTC" };
function calendar(overrides: Partial<ComponentProps<typeof CalendarSection>> = {}) {
  return renderToStaticMarkup(createElement(CalendarSection, {
    connection, online: true, todayDate: "2026-10-04", eventFiles: [], taskFiles: [], loading: false, saving: false, savingEventId: null,
    onCreate: async () => true, onEdit: async () => true, onLifecycleChange: () => undefined, onDeletionChange: () => undefined, onCompletionChange: () => undefined, onRefresh: () => undefined, ...overrides,
  }));
}
function capture(overrides: Partial<ComponentProps<typeof CaptureInboxSection>> = {}) {
  const item = { record: createWorkspaceRecord({ entityType: "capture", id: "capture_test", ownerId: "test_owner", data: createCaptureData({ rawText: "保留的随手记", kind: "note", date: null, time: null, timezone: "UTC" }) }), path: "data/captures/capture_test.json", blobSha: "example" };
  return renderToStaticMarkup(createElement(CaptureInboxSection, {
    connection, online: true, captureView: "inbox", inboxCaptures: [item], archivedCaptures: [], trashedCaptures: [], visibleCaptures: [item], loadingCaptures: false, savingCaptureId: null,
    onViewChange: () => undefined, onRefresh: () => undefined, onLifecycleChange: () => undefined, onEdit: async () => true, onOpenDestination: () => undefined, ...overrides,
  }));
}
describe("workbench controls", () => {
  it("opens a project calendar link on the right day and exposes project selectors and the return link", () => {
    const project = { record: createWorkspaceRecord({ entityType: "project", id: "project_synthetic", ownerId: "test_owner", data: createProjectData("合成关联项目", null) }), path: "synthetic", blobSha: "synthetic" };
    const event = { record: createWorkspaceRecord({ entityType: "calendar_event", id: "calendar_synthetic", ownerId: "test_owner", data: createCalendarEventData({ title: "合成关联日程", eventType: "event", startAt: "2026-10-22T01:00:00Z", endAt: "2026-10-22T02:00:00Z", timezone: "UTC", localDate: "2026-10-22", projectId: project.record.id }) }), path: "synthetic", blobSha: "synthetic" };
    const html = calendar({ projectFiles: [project], eventFiles: [event], navigation: { projectId: project.record.id, date: "2026-10-22" }, onOpenProject: () => {} });
    expect(html).toContain("2026年10月22日");
    expect(html).toContain("合成关联日程");
    expect(html).toContain("所属项目（可选）");
    expect(html).toContain('value="project_synthetic" selected=""');
    expect(html).toContain("项目 · 合成关联项目");
    expect(html).toContain("关联待办（可选）");
  });

  it("keeps completed schedules visible with the same accessible checkbox in both modules", () => {
    const item = {
      record: setCalendarEventCompleted(createWorkspaceRecord({ entityType: "calendar_event", id: "calendar_event_synthetic", ownerId: "test_owner", data: createCalendarEventData({
        title: "合成已完成日程", eventType: "event", startAt: "2026-10-04T09:00:00Z", endAt: "2026-10-04T10:00:00Z", timezone: "UTC", localDate: "2026-10-04",
      }) }), true),
      path: "data/calendar-events/calendar_event_synthetic.json", blobSha: "synthetic",
    };
    const layout = createDefaultDashboardLayout("test_owner");
    const dashboard = (busy = false) => renderToStaticMarkup(createElement(DashboardSection, {
      connection, online: true, dashboardLayout: layout, dashboardBlobSha: null, dashboardDirty: false, editingDashboard: false,
      loadingDashboard: false, savingDashboard: false, visibleWidgets: layout.widgets, hiddenWidgets: [], todayTasks: [], calendarEvents: [item],
      habits: [], habitCheckIns: [], loadingHabits: false, habitError: "", onRefreshHabits: () => {}, onOpenHabits: () => {},
    todayHealth: null, todayHealthDate: "", todayHealthError: "", loadingTodayHealth: false, onRefreshHealth: () => undefined, onOpenHealth: () => undefined,
      loadingTasks: false, loadingCalendarEvents: false, savingTaskId: null, savingCalendarEvent: false, savingCalendarEventId: busy ? item.record.id : null,
      currentTaskDate: "2026-10-04", onToggleEditing: () => undefined, onRefresh: () => undefined, onSaveLayout: () => undefined,
      onWidgetChange: () => undefined, onWidgetResize: () => undefined, onReset: () => undefined, onCompleteTask: () => undefined, onCalendarCompletionChange: () => undefined,
    }));
    for (const html of [dashboard(), calendar({ eventFiles: [item] })]) {
      expect(html).toContain('class="calendar-event-completed"');
      expect(html).toMatch(/type="checkbox"[^>]*aria-label="取消完成日程：合成已完成日程"[^>]*checked=""/);
      expect(html).toContain("已完成");
      expect(html).not.toMatch(/type="checkbox"[^>]*disabled/);
    }
    for (const html of [dashboard(true), calendar({ eventFiles: [item], savingEventId: item.record.id }), calendar({ eventFiles: [item], online: false })]) {
      expect(html).toMatch(/type="checkbox"[^>]*disabled/);
    }
  });

  it("offers explicit all-day creation and accessible local-date navigation", () => {
    const html = calendar();
    expect(html).toContain('aria-label="上一个日期范围"');
    expect(html).toContain('aria-label="下一个日期范围"');
    expect(html).toContain("2026年10月4日 · 星期日");
    expect(html).toContain('<option value="yes">全天</option>');
    expect(html).not.toContain("全天事件、永久删除");
  });
  it("disables creation while disconnected or offline", () => {
    for (const html of [calendar({ connection: null }), calendar({ online: false })]) {
      expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    }
  });
  it("keeps capture archive and trash actions accessible in a closed details control", () => {
    const html = capture();
    expect(html).toContain("保留的随手记");
    expect(html).toMatch(/<details class="row-more"><summary>更多<\/summary>[\s\S]*?归档[\s\S]*?移到回收站[\s\S]*?<\/details>/);
    expect(html).not.toContain('<details class="row-more" open=""');
  });
  it("keeps restore directly available in the capture trash view", () => {
    const html = capture({ captureView: "trash" });
    expect(html).toContain('class="restore-button"');
    expect(html).not.toContain('class="row-more"');
  });
  it("provides a direct idea composer above the ideas list without a destination selector", () => {
    const ideaComposer = { categoryChoice: "auto" as const, onCategoryChange: () => {}, text: "把笔记做成可检索的卡片", connected: true, online: true, saving: false, storageFailed: false, onChange: () => {}, onSave: async () => true, onClear: () => {} };
    const html = capture({ module: "ideas", ideaComposer, inboxCaptures: [], visibleCaptures: [] });
    expect(html).toContain('aria-label="新增想法"');
    expect(html).toContain("写下想法");
    expect(html).toContain("想法分类");
    expect(html).toContain("待分类：没有足够明确");
    expect(html).toContain("不向外部 AI 发送正文");
    expect(html).toContain('aria-label="按想法分类筛选"');
    expect(html).toMatch(/<button type="submit" class="primary-button">保存想法<\/button>/);
    expect(html).not.toContain("随手记保存位置");
    expect(html.indexOf('aria-label="新增想法"')).toBeLessThan(html.indexOf('aria-label="想法视图"'));
    expect(html).not.toContain("在随手记中写下");
    expect(capture()).not.toContain('aria-label="新增想法"');
    expect(capture({ module: "ideas", ideaComposer, loadingCaptures: true })).toMatch(/<button type="submit" class="primary-button" disabled=""/);
    for (const patch of [{ text: " " }, { connected: false }, { online: false }, { saving: true }]) {
      expect(capture({ module: "ideas", ideaComposer: { ...ideaComposer, ...patch } })).toMatch(/<button type="submit" class="primary-button" disabled=""/);
    }
  });
  it("opens idea category corrections without inferring dates or changing manual choices", () => {
    const record = createWorkspaceRecord({ entityType: "capture", id: "idea_edit", ownerId: "test_owner", timestamp: "2020-01-01T00:00:00Z", data: createCaptureData({ rawText: "明天 10 点给客户讨论方案", kind: "idea", date: null, time: null, timezone: "UTC", ideaCategory: "life" }) });
    expect(initialCaptureEditorFields(record, "UTC")).toMatchObject({ kind: "idea", date: null, time: null, endTime: null, ideaCategory: "life", rawText: record.data.raw_text });
    delete record.data.idea_classification;
    expect(initialCaptureEditorFields(record, "UTC")).toMatchObject({ date: null, time: null, ideaCategory: "auto" });
  });
  it("displays persisted and locally derived historical idea categories without writing", () => {
    const makeIdea = (id: string, text: string) => ({ record: createWorkspaceRecord({ entityType: "capture", id, ownerId: "test_owner", data: createCaptureData({ rawText: text, kind: "idea", date: null, time: null, timezone: "UTC" }) }), path: `data/captures/${id}.json`, blobSha: "synthetic" });
    const work = makeIdea("idea_work", "给客户准备产品方案");
    const life = makeIdea("idea_life", "为家人准备旅行计划");
    const legacy = makeIdea("idea_legacy", "公司旧想法");
    delete legacy.record.data.idea_classification;
    const html = capture({ module: "ideas", visibleCaptures: [work, life, legacy] });
    expect(html).toContain("自动 · 工作");
    expect(html).toContain("自动 · 生活");
    expect(html).toContain("本地推算 · 工作");
    expect(html).toContain('1 条历史想法已用本地规则判断分类');
    expect(html).toContain('工作 2</button>');
    expect(legacy.record.data.idea_classification).toBeUndefined();
    expect(capture()).not.toContain('aria-label="按想法分类筛选"');
  });

});
