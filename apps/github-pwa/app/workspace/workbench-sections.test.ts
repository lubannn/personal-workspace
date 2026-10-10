import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalendarSection } from "./calendar-section";
import { CaptureInboxSection } from "./capture-inbox-section";
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
});
