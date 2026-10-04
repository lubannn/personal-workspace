import { updateDashboardWidgets, type DashboardLayout, type DashboardWidgetConfig } from "../../../../src/lib/github-data/dashboard-layout";

/** Keep legacy layouts readable while omitting retired cards from Today. */
export function isTodayDashboardWidget(widget: DashboardWidgetConfig) {
  return !["quick_capture", "project_progress", "recent_journal"].includes(widget.widget_type);
}

export function moveTodayDashboardWidget(current: DashboardLayout, widgetId: string, direction: "up" | "down") {
  const visible = current.widgets.filter((widget) => widget.enabled && isTodayDashboardWidget(widget));
  const index = visible.findIndex((widget) => widget.id === widgetId);
  const target = visible[index + (direction === "up" ? -1 : 1)];
  if (index < 0 || !target) return current;
  const widgets = [...current.widgets];
  const fromIndex = widgets.findIndex((widget) => widget.id === widgetId);
  const toIndex = widgets.findIndex((widget) => widget.id === target.id);
  [widgets[fromIndex], widgets[toIndex]] = [widgets[toIndex], widgets[fromIndex]];
  return updateDashboardWidgets(current, widgets);
}
