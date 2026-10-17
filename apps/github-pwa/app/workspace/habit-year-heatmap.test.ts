import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HabitYearHeatmap } from "./habit-year-heatmap";
import { createWorkspaceRecord } from "../../../../src/lib/github-data/protocol";
import { createHabitData } from "../../../../src/lib/github-data/habits";
import type { HabitCheckInStatus } from "../../../../src/lib/github-data/habit-check-ins";

function render(options: { year?: string; paused?: boolean; end?: string; editable?: boolean } = {}) {
  const record = createWorkspaceRecord({ entityType: "habit", id: "habit_test", ownerId: "owner_test", timestamp: "2026-10-17T05:00:00Z",
    data: createHabitData({ name: "阅读", description_markdown: "", schedule_json: { frequency: "daily", weekdays: [] }, timezone: "Asia/Shanghai", tracking_type: "boolean", target_json: { value: 1, unit: null }, automation_mode: "manual", start_date: options.end ?? "2026-10-17", end_date: options.end ?? null }) });
  if (options.paused) record.data.status = "paused";
  const statuses = new Map<string, HabitCheckInStatus>([["2026-10-14", "completed"], ["2026-10-15", "missed"], ["2026-10-16", "skipped"], ["2026-10-18", "completed"]]);
  return renderToStaticMarkup(createElement(HabitYearHeatmap, { year: options.year ?? "2026", todayDate: "2026-10-17", habits: [{ record, path: "", blobSha: "" }], statuses: new Map([[record.id, statuses]]), editable: options.editable ?? true, disabled: false, onCheckIn: async () => true }));
}

describe("annual daily habit heatmap", () => {
  it("renders one cell per day, all months, and no aggregate totals", () => {
    const html = render();
    expect(html.match(/class="habit-day"/g)).toHaveLength(365);
    expect(html).toContain("2026-01-01"); expect(html).toContain("2026-12-31");
    expect(html).toContain("12月");
    expect(html).not.toContain("全年完成");
    expect(html).not.toContain("完成 1 天");
    expect(render({ year: "2024" }).match(/class="habit-day"/g)).toHaveLength(366);
  });
  it("shows saved daily statuses and distinguishes future days", () => {
    const html = render();
    expect(html).toContain('title="阅读 · 2026-10-14 · 已完成"');
    expect(html).toContain('title="阅读 · 2026-10-15 · 未完成"');
    expect(html).toContain('title="阅读 · 2026-10-16 · 已跳过"');
    expect(html).toContain('data-status="none" data-future="true" data-today="false" title="阅读 · 2026-10-18 · 未到日期"');
  });
  it("allows only the recent three days before the start date, preserving paused/end/archive restrictions", () => {
    const buttons = (html: string) => [...html.matchAll(/<button[^>]*>/g)].map(match => match[0]);
    expect(buttons(render())).toHaveLength(3);
    expect(buttons(render()).every(tag => !tag.includes('disabled=""'))).toBe(true);
    expect(buttons(render({ paused: true })).every(tag => tag.includes('disabled=""'))).toBe(true);
    expect(buttons(render({ end: "2026-10-16" }))[2]).toContain('disabled=""');
    expect(buttons(render({ editable: false }))).toHaveLength(0);
    expect(buttons(render({ year: "2025" }))).toHaveLength(0);
  });
});
