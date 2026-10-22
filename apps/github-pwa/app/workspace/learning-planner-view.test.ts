import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { generateLearningRoadmap } from "../../../../src/lib/github-data/learning-planner";
import { LearningRoadmapSummary } from "./learning-planner";

const plan = generateLearningRoadmap({ topic: "英语", level: "basic", goal: "能介绍自己的工作", weekly_hours: 2.5, local_date: "2026-10-22" });

describe("saved weekly learning plans", () => {
  it("shows the saved budget and actions as current only within their calendar week", () => {
    const html = renderToStaticMarkup(createElement(LearningRoadmapSummary, { value: plan, goal: "能介绍自己的工作", todayDate: "2026-10-25" }));
    expect(html).toMatch(/<h3>本周行动/);
    expect(html).toContain("150");
    expect(html).toContain("2026-10-19");
    expect(html).toContain(plan.actions[0].title);
  });
  it("keeps past actions visible without relabeling them as this week's work", () => {
    const html = renderToStaticMarkup(createElement(LearningRoadmapSummary, { value: plan, goal: "能介绍自己的工作", todayDate: "2026-10-26" }));
    expect(html).not.toMatch(/<h3>本周行动/);
    expect(html).toContain("2026-10-19");
    expect(html).toContain("这是之前一周的安排");
    expect(html).toContain(plan.actions[0].title);
  });
});
