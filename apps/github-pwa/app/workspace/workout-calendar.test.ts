import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WorkoutRecordRow } from "./health-records";
import { buildWorkoutCalendarDays, formatWorkoutCalendarTime, healthCalendarMonths, workoutActivityColor } from "./workout-calendar";
import { SleepCalendarSection } from "./sleep-calendar-section";

function workout(id: string, patch: Partial<WorkoutRecordRow> = {}): WorkoutRecordRow {
  return { id, startAt: "2024-02-01T23:30:00Z", endAt: "2024-02-02T00:15:00Z", timezone: "Asia/Shanghai",
    source: { kind: "coros_mcp", label: "COROS" }, activity: "跑步", durationSeconds: 2700, distanceMetres: 5000, ...patch };
}

describe("paired sleep and workout calendars", () => {
  it("uses the workspace local start date, counts multiple workouts and excludes repeated IDs", () => {
    const run = workout("run");
    const ride = workout("ride", { activity: "骑行", startAt: "2024-02-02T06:00:00Z", durationSeconds: 5400 });
    const days = buildWorkoutCalendarDays([ride, run, run], "Asia/Shanghai");
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ date: "2024-02-02", tone: "mixed", totalSeconds: 8100 });
    expect(days[0].workouts.map(row => row.id)).toEqual(["run", "ride"]);
    expect(buildWorkoutCalendarDays([run], "UTC")[0].date).toBe("2024-02-01");
  });
  it("keeps each activity name's color stable across months and distinguishes current COROS projects", () => {
    const names = ["徒步", "室内跑步", "爬坡", "步行", "跳绳", "室内有氧", "羽毛球", "户外跑步", "户外骑行", "超慢跑", "室内骑行", "力量训练", "爬楼"];
    expect(new Set(names.map(name => workoutActivityColor(name).backgroundColor)).size).toBe(names.length);
    expect(workoutActivityColor("室内跑步")).not.toEqual(workoutActivityColor("户外跑步"));
    const first = workout("first", { activity: "羽毛球", startAt: "2024-02-02T00:00:00Z" });
    const next = workout("next", { activity: "羽毛球", startAt: "2024-03-02T00:00:00Z" });
    for (const row of [first, next]) {
      const html = renderToStaticMarkup(createElement(SleepCalendarSection, { rows: [], workouts: [row], timezone: "Asia/Shanghai" }));
      expect(html).toContain(`background-color:${workoutActivityColor("羽毛球").backgroundColor}`);
    }
    expect(workoutActivityColor("自定义新增项目")).toEqual(workoutActivityColor("自定义新增项目"));
  });
  it("includes workout-only months, empty intervening months, and empty datasets", () => {
    expect(healthCalendarMonths([{ date: "2024-02-02" }], [{ date: "2023-12-31" }])).toEqual(["2023-12", "2024-01", "2024-02"]);
    expect(healthCalendarMonths([], [{ date: "2024-02-02" }])).toEqual(["2024-02"]);
    expect(healthCalendarMonths([], [])).toEqual([]);
    expect([30, 2700, 5400, 3600].map(formatWorkoutCalendarTime)).toEqual(["30秒", "45分", "1时30分", "1时"]);
  });
  it("renders one month for each calendar without a workout table, and preserves multi-session details", () => {
    const rows = [workout("run"), workout("ride", { activity: "骑行" }), workout("walk", { activity: "步行" })];
    const html = renderToStaticMarkup(createElement(SleepCalendarSection, { rows: [], workouts: rows, timezone: "Asia/Shanghai" }));
    expect((html.match(/class="sleep-calendar-month(?: workout-calendar-month)?"/g) ?? [])).toHaveLength(2);
    expect(html).toContain("2024年2月睡眠月历");
    expect(html).toContain("2024年2月运动月历");
    expect(html).toContain("跑步"); expect(html).toContain("45分"); expect(html).toContain("+1次");
    expect(html).toContain("07:30开始"); expect(html).toContain("共2时15分");
    expect(html).toContain("2024-02-03，无运动记录");
    expect(html).not.toContain("<table");
    expect(html).toContain(`class="workout-calendar-entry" style="background-color:${workoutActivityColor("跑步").backgroundColor}`);
    expect(html).toContain(`class="workout-calendar-entry" style="background-color:${workoutActivityColor("骑行").backgroundColor}`);
  });
});
