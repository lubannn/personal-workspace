import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TodayExerciseWidget } from "./today-exercise-widget";
const snapshot = { months: [], loadedMonths: [], month: "", sleepSessions: [], workouts: [], staging: [], latestSleep: null, latestWorkout: null, latestReady: false, unverifiedWorkoutCount: 0 };
function render(overrides: Partial<ComponentProps<typeof TodayExerciseWidget>> = {}) {
  return renderToStaticMarkup(createElement(TodayExerciseWidget, { connected: true, online: true, today: "2026-10-10", timezone: "Asia/Shanghai", snapshot, loadedDate: "2026-10-10", loading: false, error: "", onRefresh: () => {}, onOpenHealth: () => {}, ...overrides }));
}
describe("today exercise data states", () => {
  it("shows missing records as missing and presents advice reasons with a health link", () => {
    const html = render();
    expect(html).toContain("今天尚未记录运动");expect(html).toContain("当天睡眠：尚未记录");
    expect(html).toContain("建议依据");expect(html).toContain("查看健康");
    expect(html).not.toContain("今天没有运动");
  });
  it("does not show old recommendations while disconnected, loading, failed or on a new local day", () => {
    for (const overrides of [{ connected: false }, { loading: true }, { error: "failed" }, { loadedDate: "2026-10-09" }]) {
      const html = render(overrides);expect(html).not.toContain("先从轻松活动开始");expect(html).not.toContain("建议依据");
    }
    expect(render({ error: "failed" })).toContain("重试");
    expect(render({ snapshot: null, online: false })).toContain("当前离线");
  });
  it("retains readable cached facts offline but disables refresh", () => {
    const html = render({ online: false });expect(html).toContain("建议依据");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>刷新数据/);
  });
});
