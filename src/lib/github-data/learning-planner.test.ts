import { describe, expect, it } from "vitest";
import { generateLearningRoadmap, learningWeekStart, validateLearningRoadmap, type LearningPlannerInput, type LearningRoadmap } from "./learning-planner";

const input: LearningPlannerInput = { topic: "英语口语", level: "beginner", goal: "能用英语介绍自己的工作", weekly_hours: 3, local_date: "2026-10-22" };

describe("learning plan templates", () => {
  it.each([
    ["英语口语", "language"], ["Korean", "language"], ["Python", "coding"], ["数据分析", "coding"],
    ["钢琴", "music"], ["guitar", "music"], ["摄影构图", "general"], ["任意自定义方向", "general"],
  ])("matches %s to an explicit template", (topic, template) => {
    const plan = generateLearningRoadmap({ ...input, topic });
    expect(plan.template).toBe(template);
    expect(plan.stages).toHaveLength(4);
    expect(plan.actions).toHaveLength(3);
    expect(plan).toMatchObject({ version: 1, source: "template", week_start: "2026-10-19" });
  });

  it("is deterministic and never mutates shared template data", () => {
    const first = generateLearningRoadmap(input);
    first.stages[0].goal = "用户修改";
    first.actions[0].title = "另一个行动";
    const second = generateLearningRoadmap(input);
    expect(second).toEqual(generateLearningRoadmap(input));
    expect(second.stages[0].goal).not.toBe("用户修改");
    expect(second.actions[0].title).not.toBe("另一个行动");
  });

  it("changes the starting point and weekly actions with the selected level", () => {
    const beginner = generateLearningRoadmap(input);
    const basic = generateLearningRoadmap({ ...input, level: "basic" });
    const advanced = generateLearningRoadmap({ ...input, level: "practiced" });
    expect(new Set([beginner.stages[0].title, basic.stages[0].title, advanced.stages[0].title]).size).toBe(3);
    expect(new Set([beginner.actions[0].title, basic.actions[0].title, advanced.actions[0].title]).size).toBe(3);
  });

  it("carries the requested goal into the application stage without promising completion", () => {
    expect(generateLearningRoadmap(input).stages[2].goal).toContain(input.goal);
    expect(generateLearningRoadmap({ ...input, goal: "读懂英文新闻" }).stages[2].goal).toContain("读懂英文新闻");
    expect(() => generateLearningRoadmap({ ...input, goal: "目".repeat(500) })).not.toThrow();
  });

  it.each([.5, 1, 1.5, 3, 7.5, 40])("allocates exactly the available %s hours without zero-minute actions", (hours) => {
    const plan = generateLearningRoadmap({ ...input, weekly_hours: hours });
    expect(plan.actions.reduce((sum, action) => sum + action.minutes, 0)).toBe(hours * 60);
    expect(plan.actions.every((action) => Number.isInteger(action.minutes) && action.minutes >= 5)).toBe(true);
    expect(() => validateLearningRoadmap(plan)).not.toThrow();
  });

  it.each(["2026-10-19", "2026-10-22", "2026-10-25"])("anchors %s to the same local calendar week", (date) => {
    expect(learningWeekStart(date)).toBe("2026-10-19");
  });
  it("handles year boundaries without using the host timezone", () => {
    expect(learningWeekStart("2026-01-01")).toBe("2025-12-29");
    expect(learningWeekStart("2026-10-26")).toBe("2026-10-26");
  });
  it.each(["", "2026-02-30", "2026-13-01", "2026-1-1", "not-a-date"])("rejects invalid local date %s", (date) => {
    expect(() => learningWeekStart(date)).toThrow("INVALID_LEARNING_PLAN_DATE");
  });
  it.each([
    { topic: " " }, { topic: "x".repeat(201) }, { goal: " " }, { goal: "x".repeat(501) },
    { weekly_hours: 0 }, { weekly_hours: .49 }, { weekly_hours: 41 }, { weekly_hours: NaN }, { weekly_hours: Infinity },
    { level: "unknown" }, { level: "toString" },
  ])("rejects invalid generation input %j", (change) => {
    expect(() => generateLearningRoadmap({ ...input, ...change } as LearningPlannerInput)).toThrow("INVALID_LEARNING_PLANNER_INPUT");
  });

  it("allows edited text and reduced action time but rejects invalid or over-budget drafts", () => {
    const plan = generateLearningRoadmap(input);
    const edited = structuredClone(plan);
    edited.stages[1].goal = "用户自定的第二周目标";
    edited.actions[0] = { title: "和同伴练习一次工作介绍", minutes: 10 };
    expect(() => validateLearningRoadmap(edited)).not.toThrow();
    const invalid: unknown[] = [
      null, [], { ...plan, version: 2 }, { ...plan, source: "ai" }, { ...plan, level: "toString" },
      { ...plan, week_start: "2026-10-22" }, { ...plan, extra: true },
      { ...plan, stages: [] }, { ...plan, stages: [{ title: "", goal: "" }, ...plan.stages.slice(1)] },
      { ...plan, actions: [] }, { ...plan, actions: [{ title: "行动", minutes: 2410 }] },
      { ...plan, actions: [{ title: "行动", minutes: 4 }] }, { ...plan, actions: [{ title: "行动", minutes: 10.5 }] },
      { ...plan, actions: [{ title: "行动", minutes: plan.weekly_minutes + 1 }] },
      { ...plan, actions: [{ title: " ", minutes: 10 }] },
    ];
    for (const value of invalid) expect(() => validateLearningRoadmap(value as LearningRoadmap)).toThrow("INVALID_LEARNING_ROADMAP");
  });
});
