import { describe, expect, it } from "vitest";

import {
  createDefaultDashboardLayout,
  moveDashboardWidget,
  parseDashboardLayout,
  serializeDashboardLayout,
  setDashboardWidgetEnabled,
  setDashboardWidgetSize,
} from "./dashboard-layout";

const timestamp = "2026-08-28T01:00:00.000Z";

describe("dashboard layout protocol", () => {
  it("creates the eight requested default widgets without shared settings objects", () => {
    const first = createDefaultDashboardLayout("github_lubannn", timestamp);
    const second = createDefaultDashboardLayout("github_lubannn", timestamp);
    expect(first.widgets).toHaveLength(8);
    expect(first.widgets.map((widget) => widget.widget_type)).toEqual([
      "today_schedule",
      "today_tasks",
      "quick_capture",
      "project_progress",
      "learning_today",
      "exercise_today",
      "recent_journal",
      "habit_heatmap",
    ]);
    first.widgets[0]!.settings.changed = true;
    expect(second.widgets[0]!.settings).toEqual({});
  });

  it("round trips unknown future widget types so plugin configuration is not lost", () => {
    const layout = createDefaultDashboardLayout("github_lubannn", timestamp);
    layout.widgets.push({
      id: "future-widget",
      widget_type: "future_plugin_widget",
      size: "compact",
      enabled: false,
      privacy_mode: "private",
      settings: { color: "ink" },
    });
    expect(parseDashboardLayout(serializeDashboardLayout(layout)).widgets.at(-1)).toMatchObject({
      widget_type: "future_plugin_widget",
      enabled: false,
      settings: { color: "ink" },
    });
  });

  it("increments the document version for visibility and size changes", () => {
    const initial = createDefaultDashboardLayout("github_lubannn", timestamp);
    const hidden = setDashboardWidgetEnabled(initial, "today-schedule", false, "2026-08-28T01:01:00.000Z");
    const resized = setDashboardWidgetSize(hidden, "today-tasks", "wide", "2026-08-28T01:02:00.000Z");
    expect(hidden.version).toBe(2);
    expect(hidden.widgets[0]!.enabled).toBe(false);
    expect(resized.version).toBe(3);
    expect(resized.widgets.find((widget) => widget.id === "today-tasks")?.size).toBe("wide");
  });

  it("moves among visible widgets while preserving hidden entries", () => {
    const initial = createDefaultDashboardLayout("github_lubannn", timestamp);
    const hidden = setDashboardWidgetEnabled(initial, "today-tasks", false, "2026-08-28T01:01:00.000Z");
    const moved = moveDashboardWidget(hidden, "quick-capture", "up", "2026-08-28T01:02:00.000Z");
    expect(moved.widgets.map((widget) => widget.id).slice(0, 3)).toEqual([
      "quick-capture",
      "today-tasks",
      "today-schedule",
    ]);
  });

  it("rejects duplicate widget IDs and invalid document versions", () => {
    const layout = createDefaultDashboardLayout("github_lubannn", timestamp);
    layout.widgets[1]!.id = layout.widgets[0]!.id;
    expect(() => parseDashboardLayout(JSON.stringify(layout))).toThrow("INVALID_DASHBOARD_WIDGET");
    layout.widgets[1]!.id = "today-tasks";
    layout.version = 0;
    expect(() => parseDashboardLayout(JSON.stringify(layout))).toThrow("INVALID_DASHBOARD_LAYOUT");
  });
});
