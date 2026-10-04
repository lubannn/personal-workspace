import { describe, expect, it } from "vitest";
import { createDefaultDashboardLayout } from "../../../../src/lib/github-data/dashboard-layout";
import { isTodayDashboardWidget, moveTodayDashboardWidget } from "./dashboard-presentation";

describe("Today layout with legacy saved cards", () => {
  it.each(["up", "down"] as const)("moves %s directly past retired cards without changing their saved settings", (direction) => {
    const layout = createDefaultDashboardLayout("test_owner", "2026-10-04T00:00:00Z");
    const index = layout.widgets.findIndex((widget) => widget.id === "project-progress");
    layout.widgets[index].settings = { legacy: "preserve" };
    const before = JSON.stringify(layout);
    const moved = moveTodayDashboardWidget(layout, direction === "up" ? "learning-today" : "today-tasks", direction);
    const displayed = moved.widgets.filter(isTodayDashboardWidget).map((widget) => widget.id);
    expect(displayed.slice(0, 3)).toEqual(["today-schedule", "learning-today", "today-tasks"]);
    expect(moved.version).toBe(layout.version + 1);
    for (const widget of layout.widgets) expect(moved.widgets.find((item) => item.id === widget.id)).toEqual(widget);
    expect(JSON.stringify(layout)).toBe(before);
  });
  it("does not create a revision when moving beyond the visible list", () => {
    const layout = createDefaultDashboardLayout("test_owner");
    expect(moveTodayDashboardWidget(layout, "today-schedule", "up")).toBe(layout);
    expect(moveTodayDashboardWidget(layout, "habit-heatmap", "down")).toBe(layout);
  });
});
