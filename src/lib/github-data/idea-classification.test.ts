import { describe, expect, it } from "vitest";
import { classifyIdea, createIdeaClassification, getIdeaClassification, isIdeaClassification, type IdeaCategoryChoice } from "./idea-classification";

describe("conservative local idea classification", () => {
  it.each([
    ["可以把客户反馈整理成每周的产品需求清单", "work"],
    ["想法：公司会议可以提前发议程，让同事有时间准备", "work"],
    ["工作：把重复的业务报表自动化", "work"],
    ["想法：周末和家人去旅行，顺便记录沿途的食谱", "life"],
    ["生活：在客厅放一张更舒服的椅子", "life"],
    ["IDEA: Improve our customer onboarding meetings", "work"],
    ["Try a shorter work meeting", "work"],
    ["Maybe work out more", "life"],
    ["Try working out every morning", "life"],
    ["Try running a script", "unclassified"],
    ["Try a running script", "unclassified"],
    ["Could this work?", "unclassified"],
    ["Maybe go running more often", "life"],
    ["Plan a new running route", "life"],
    ["公司附近跑步", "unclassified"],
    ["Plan a family vacation with friends", "life"],
    ["给客户做运动记录工具", "unclassified"],
    ["先和同事讨论会议，再规划周末旅行", "unclassified"],
    ["A business idea for family travel", "unclassified"],
    ["想法：试试新工具，把流程简单一点", "unclassified"],
    ["学习编程，整理项目笔记", "unclassified"],
    ["我的工作台要更好用，三个工作日内想一想", "unclassified"],
    ["Explore a framework and a lifestyle brand", "unclassified"],
    ["", "unclassified"],
  ])("classifies the whole input conservatively: %s", (text, category) => {
    expect(classifyIdea(text)).toEqual({ category, reason: expect.any(String) });
  });
  it("stores automatic provenance and supports every explicit manual choice", () => {
    expect(createIdeaClassification("客户会议")).toEqual({ category: "work", source: "automatic", classifier_version: "local-rules-v1" });
    for (const choice of ["work", "life", "unclassified"] as const) {
      const metadata = createIdeaClassification("客户会议", choice);
      expect(metadata).toEqual({ category: choice, source: "manual", classifier_version: null });
      expect(isIdeaClassification(metadata)).toBe(true);
    }
    expect(() => createIdeaClassification("text", "other" as IdeaCategoryChoice)).toThrow("INVALID_IDEA_CATEGORY");
  });
  it.each([null, [], {}, { category: "work" },
    { category: "other", source: "manual", classifier_version: null },
    { category: "work", source: "robot", classifier_version: null },
    { category: "work", source: "automatic", classifier_version: null },
    { category: "work", source: "automatic", classifier_version: "remote-v1" },
    { category: "life", source: "manual", classifier_version: "local-rules-v1" },
    { category: "life", source: "manual" },
  ])("rejects malformed classification %j", (value) => {
    expect(isIdeaClassification(value)).toBe(false);
  });
});

describe("read-time historical idea classification", () => {
  it.each([
    ["  客户会议可以缩短一些\n ", "work"],
    ["和家人规划旅行", "life"],
    ["开完公司会议后去跑步", "unclassified"],
    ["试试新的方法", "unclassified"],
  ])("derives %s locally without changing legacy data", (raw_text, category) => {
    const data = Object.freeze({ raw_text });
    const before = JSON.stringify(data);
    expect(getIdeaClassification(data)).toEqual({ category, source: "automatic", classifier_version: "local-rules-v1" });
    expect(JSON.stringify(data)).toBe(before);
    expect(data).not.toHaveProperty("idea_classification");
    expect(getIdeaClassification(data)).toEqual(getIdeaClassification(data));
  });
  it("preserves every existing automatic or manual category, even when text suggests otherwise", () => {
    for (const category of ["work", "life", "unclassified"] as const) {
      for (const source of ["automatic", "manual"] as const) {
        const idea_classification = Object.freeze({ category, source, classifier_version: source === "automatic" ? "local-rules-v1" as const : null });
        const data = Object.freeze({ raw_text: "客户会议", idea_classification });
        const before = JSON.stringify(data);
        expect(getIdeaClassification(data)).toBe(idea_classification);
        expect(JSON.stringify(data)).toBe(before);
      }
    }
  });
});
