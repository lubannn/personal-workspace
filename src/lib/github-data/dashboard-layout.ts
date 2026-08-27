export const DASHBOARD_LAYOUT_SCHEMA_VERSION = 1 as const;
export const DASHBOARD_LAYOUT_PATH = "config/dashboard-layout.json" as const;

export type DashboardWidgetSize = "compact" | "standard" | "wide";
export type DashboardPrivacyMode = "standard" | "private" | "restricted";

export type DashboardWidgetConfig = {
  id: string;
  widget_type: string;
  size: DashboardWidgetSize;
  enabled: boolean;
  privacy_mode: DashboardPrivacyMode;
  settings: Record<string, unknown>;
};

export type DashboardLayout = {
  schema_version: typeof DASHBOARD_LAYOUT_SCHEMA_VERSION;
  layout_id: string;
  owner_id: string;
  name: string;
  version: number;
  updated_at: string;
  widgets: DashboardWidgetConfig[];
};

export const DEFAULT_DASHBOARD_WIDGETS: readonly DashboardWidgetConfig[] = [
  { id: "today-schedule", widget_type: "today_schedule", size: "standard", enabled: true, privacy_mode: "private", settings: {} },
  { id: "today-tasks", widget_type: "today_tasks", size: "standard", enabled: true, privacy_mode: "private", settings: {} },
  { id: "quick-capture", widget_type: "quick_capture", size: "wide", enabled: true, privacy_mode: "private", settings: {} },
  { id: "project-progress", widget_type: "project_progress", size: "standard", enabled: true, privacy_mode: "private", settings: {} },
  { id: "learning-today", widget_type: "learning_today", size: "compact", enabled: true, privacy_mode: "standard", settings: {} },
  { id: "exercise-today", widget_type: "exercise_today", size: "compact", enabled: true, privacy_mode: "restricted", settings: {} },
  { id: "recent-journal", widget_type: "recent_journal", size: "standard", enabled: true, privacy_mode: "restricted", settings: {} },
  { id: "habit-heatmap", widget_type: "habit_heatmap", size: "standard", enabled: true, privacy_mode: "private", settings: {} },
];

const SIZES = new Set<DashboardWidgetSize>(["compact", "standard", "wide"]);
const PRIVACY_MODES = new Set<DashboardPrivacyMode>(["standard", "private", "restricted"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
}

function cloneWidget(widget: DashboardWidgetConfig): DashboardWidgetConfig {
  return { ...widget, settings: { ...widget.settings } };
}

export function createDefaultDashboardLayout(ownerId: string, timestamp = new Date().toISOString()): DashboardLayout {
  if (!isStableId(ownerId)) throw new Error("INVALID_DASHBOARD_OWNER");
  if (Number.isNaN(Date.parse(timestamp))) throw new Error("INVALID_DASHBOARD_UPDATED_AT");
  return {
    schema_version: DASHBOARD_LAYOUT_SCHEMA_VERSION,
    layout_id: "default",
    owner_id: ownerId,
    name: "Today",
    version: 1,
    updated_at: timestamp,
    widgets: DEFAULT_DASHBOARD_WIDGETS.map(cloneWidget),
  };
}

export function parseDashboardLayout(value: string): DashboardLayout {
  const parsed = JSON.parse(value) as Partial<DashboardLayout>;
  if (
    parsed.schema_version !== DASHBOARD_LAYOUT_SCHEMA_VERSION
    || !isStableId(parsed.layout_id)
    || !isStableId(parsed.owner_id)
    || typeof parsed.name !== "string"
    || !parsed.name.trim()
    || !Number.isInteger(parsed.version)
    || Number(parsed.version) < 1
    || typeof parsed.updated_at !== "string"
    || Number.isNaN(Date.parse(parsed.updated_at))
    || !Array.isArray(parsed.widgets)
  ) throw new Error("INVALID_DASHBOARD_LAYOUT");

  const ids = new Set<string>();
  const widgets: DashboardWidgetConfig[] = [];
  for (const candidate of parsed.widgets) {
    if (
      !isObject(candidate)
      || !isStableId(candidate.id)
      || typeof candidate.widget_type !== "string"
      || !candidate.widget_type.trim()
      || !SIZES.has(candidate.size as DashboardWidgetSize)
      || typeof candidate.enabled !== "boolean"
      || !PRIVACY_MODES.has(candidate.privacy_mode as DashboardPrivacyMode)
      || !isObject(candidate.settings)
      || ids.has(candidate.id)
    ) throw new Error("INVALID_DASHBOARD_WIDGET");
    ids.add(candidate.id);
    widgets.push({
      id: candidate.id,
      widget_type: candidate.widget_type,
      size: candidate.size as DashboardWidgetSize,
      enabled: candidate.enabled,
      privacy_mode: candidate.privacy_mode as DashboardPrivacyMode,
      settings: { ...candidate.settings },
    });
  }
  return { ...parsed, widgets } as DashboardLayout;
}

export function updateDashboardWidgets(
  current: DashboardLayout,
  widgets: DashboardWidgetConfig[],
  timestamp = new Date().toISOString(),
): DashboardLayout {
  if (Number.isNaN(Date.parse(timestamp))) throw new Error("INVALID_DASHBOARD_UPDATED_AT");
  return parseDashboardLayout(`${JSON.stringify({
    ...current,
    version: current.version + 1,
    updated_at: timestamp,
    widgets: widgets.map(cloneWidget),
  })}\n`);
}

export function setDashboardWidgetEnabled(
  current: DashboardLayout,
  widgetId: string,
  enabled: boolean,
  timestamp?: string,
) {
  if (!current.widgets.some((widget) => widget.id === widgetId)) throw new Error("DASHBOARD_WIDGET_NOT_FOUND");
  return updateDashboardWidgets(current, current.widgets.map((widget) => (
    widget.id === widgetId ? { ...widget, enabled } : widget
  )), timestamp);
}

export function setDashboardWidgetSize(
  current: DashboardLayout,
  widgetId: string,
  size: DashboardWidgetSize,
  timestamp?: string,
) {
  if (!SIZES.has(size)) throw new Error("INVALID_DASHBOARD_WIDGET_SIZE");
  if (!current.widgets.some((widget) => widget.id === widgetId)) throw new Error("DASHBOARD_WIDGET_NOT_FOUND");
  return updateDashboardWidgets(current, current.widgets.map((widget) => (
    widget.id === widgetId ? { ...widget, size } : widget
  )), timestamp);
}

export function moveDashboardWidget(
  current: DashboardLayout,
  widgetId: string,
  direction: "up" | "down",
  timestamp?: string,
) {
  const index = current.widgets.findIndex((widget) => widget.id === widgetId);
  if (index < 0) throw new Error("DASHBOARD_WIDGET_NOT_FOUND");
  const step = direction === "up" ? -1 : 1;
  let target = index + step;
  while (target >= 0 && target < current.widgets.length && !current.widgets[target]!.enabled) target += step;
  if (target < 0 || target >= current.widgets.length) return current;
  const widgets = current.widgets.map(cloneWidget);
  [widgets[index], widgets[target]] = [widgets[target]!, widgets[index]!];
  return updateDashboardWidgets(current, widgets, timestamp);
}

export function serializeDashboardLayout(layout: DashboardLayout) {
  return `${JSON.stringify(parseDashboardLayout(JSON.stringify(layout)), null, 2)}\n`;
}
