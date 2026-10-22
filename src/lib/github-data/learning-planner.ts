export const LEARNING_LEVELS = { beginner: "从零开始", basic: "有一点基础", practiced: "已有基础，想进阶" } as const;
export type LearningLevel = keyof typeof LEARNING_LEVELS;
export const LEARNING_TEMPLATES = { language: "语言学习", coding: "编程与数据", music: "乐器练习", general: "通用学习" } as const;
type TemplateId = keyof typeof LEARNING_TEMPLATES;
export type LearningRoadmap = {
  version: 1;
  source: "template";
  template: TemplateId;
  level: LearningLevel;
  weekly_minutes: number;
  week_start: string;
  stages: { title: string; goal: string }[];
  actions: { title: string; minutes: number }[];
};
export type LearningPlannerInput = { topic: string; level: LearningLevel; goal: string; weekly_hours: number; local_date: string };

type Route = { matches: RegExp; stages: [string, string][]; actions: Record<LearningLevel, [string, string, string]> };
const ROUTES: Record<TemplateId, Route> = {
  language: {
    matches: /英语|韩语|日语|法语|德语|西班牙语|语言|\b(english|korean|japanese|french|german|spanish)\b/iu,
    stages: [
      ["选好起点", "选一份难度合适的短材料，整理常见词句，了解自己卡在哪里。"],
      ["边学边练", "跟读或精读短材料，用自己的话复述，并整理不熟悉的表达。"],
      ["独立表达", "减少对照提示，独立完成一次短文阅读、口头表达或文字输出。"],
      ["检验与巩固", "对照你的目标做一次小测试，整理仍不熟悉的内容，安排下一轮练习。"],
    ],
    actions: {
      beginner: ["选一份入门短材料，学习其中的基础词句", "跟读材料并练习 3–5 个简单表达", "回顾本周词句，记下仍不理解的地方"],
      basic: ["读或听一段难度合适的材料，标出不熟悉的表达", "用自己的话复述材料，整理需要补齐的词句", "对照原文检查表达，记录下周要练的内容"],
      practiced: ["选一段与目标相关的材料，提炼结构与表达", "独立完成一段表达或短文，再对照材料修改", "整理表达上的差距，确定下一次专项练习"],
    },
  },
  coding: {
    matches: /编程|代码|数据分析|数据科学|可视化|\b(python|javascript|typescript|java|sql|programming|coding)\b/iu,
    stages: [
      ["搭好基础", "准备练习环境，跑通一个与目标相关的最小示例，记录关键概念。"],
      ["跟练与改写", "跟着示例完成练习，再修改输入或条件，理解结果为什么变化。"],
      ["做一个小成果", "围绕目标独立完成一个小功能或一次小分析，并检查结果。"],
      ["验证与整理", "用不同输入检查成果，整理代码、结论与仍需补齐的知识。"],
    ],
    actions: {
      beginner: ["准备练习环境，学习一个基础概念并跑通示例", "改写示例中的输入或条件，完成一个小练习", "检查结果，记录报错原因与本周收获"],
      basic: ["围绕目标找出一个薄弱概念，阅读并运行相关示例", "独立写一个小功能或完成一次小分析", "用不同输入验证结果，记录下一步要修正的地方"],
      practiced: ["选一个与目标相关的小问题，写下预期结果", "独立实现并比较两种解法或分析方式", "检查边界与结果，整理取舍和下一轮改进"],
    },
  },
  music: {
    matches: /钢琴|吉他|小提琴|乐器|架子鼓|\b(piano|guitar|violin|drums)\b/iu,
    stages: [
      ["找准起点", "选择难度合适的短乐段，确认节奏、指法或基本动作。"],
      ["分段练习", "把乐段拆小，放慢速度练习，记录反复出错的位置。"],
      ["连贯演奏", "尝试连接已练习的片段，保持节奏，录下一次演奏。"],
      ["回听与调整", "对照目标回听录音，选出需要继续练习的部分，安排下一轮。"],
    ],
    actions: {
      beginner: ["选一段入门材料，熟悉基本节奏与动作", "慢练一个短乐段，优先保持节奏稳定", "录下一次练习，记下最需要改进的一处"],
      basic: ["选一个与目标相关的短乐段，标出难点", "针对难点分段慢练，再尝试连接片段", "回听录音，记录节奏或衔接问题"],
      practiced: ["对照目标选一段演奏，确定一个技术或表达重点", "围绕该重点做专项练习，再放回完整乐段", "录音对比练习前后，确定下一轮调整"],
    },
  },
  general: {
    matches: /.*/u,
    stages: [
      ["确定起点", "围绕目标列出已会与不会的部分，选一份合适的入门材料。"],
      ["跟练示例", "跟着一个清晰示例学习，并记录关键步骤与疑问。"],
      ["独立尝试", "围绕目标完成一个小练习或小作品，记录遇到的问题。"],
      ["复盘与调整", "用一个小成果检验学习收获，明确距离目标还有哪些差距。"],
    ],
    actions: {
      beginner: ["选一份入门材料，梳理最基础的概念和步骤", "跟着示例完成一个小练习", "整理本周收获与疑问，决定下次先做什么"],
      basic: ["找出与目标相关的一处薄弱点，阅读一个示例", "不看示例完成一次小练习，再对照修正", "记录仍不熟悉的部分，安排下一轮练习"],
      practiced: ["围绕目标明确一个可验证的小成果", "独立完成该成果，尝试解决一个具体难点", "检查成果与目标的差距，确定下一轮改进"],
    },
  },
};

export function learningWeekStart(localDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(localDate)) throw new Error("INVALID_LEARNING_PLAN_DATE");
  const date = new Date(`${localDate}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== localDate) throw new Error("INVALID_LEARNING_PLAN_DATE");
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

export function generateLearningRoadmap(input: LearningPlannerInput): LearningRoadmap {
  if (!input.topic.trim() || input.topic.length > 200 || !input.goal.trim() || input.goal.length > 500
    || !Object.hasOwn(LEARNING_LEVELS, input.level)
    || !Number.isFinite(input.weekly_hours) || input.weekly_hours < .5 || input.weekly_hours > 40
    || !Number.isInteger(input.weekly_hours * 60)
  ) throw new Error("INVALID_LEARNING_PLANNER_INPUT");
  const template = (Object.keys(ROUTES) as TemplateId[]).find((key) => ROUTES[key].matches.test(input.topic.trim()))!;
  const route = ROUTES[template];
  const weeklyMinutes = input.weekly_hours * 60;
  const study = Math.round(weeklyMinutes * .3 / 5) * 5;
  const practice = Math.round(weeklyMinutes * .5 / 5) * 5;
  const minutes = [study, practice, weeklyMinutes - study - practice];
  const stages = route.stages.map(([title, goal]) => ({ title, goal }));
  stages[2].goal = `${stages[2].goal}本轮练习围绕「${input.goal.trim().slice(0, 120)}」展开。`;
  if (input.level === "basic") stages[0] = { title: "查漏补缺", goal: "对照已有基础与目标做一次小练习，找出需要优先补齐的部分。" };
  if (input.level === "practiced") stages[0] = { title: "明确进阶重点", goal: "围绕目标做一次现状检验，选一个具体难点作为本轮练习重点。" };
  const roadmap: LearningRoadmap = {
    version: 1, source: "template", template, level: input.level, weekly_minutes: weeklyMinutes,
    week_start: learningWeekStart(input.local_date), stages,
    actions: route.actions[input.level].map((title, index) => ({ title, minutes: minutes[index] })),
  };
  validateLearningRoadmap(roadmap);
  return roadmap;
}

export function validateLearningRoadmap(value: unknown): asserts value is LearningRoadmap {
  const fail = () => { throw new Error("INVALID_LEARNING_ROADMAP"); };
  if (!isObject(value) || Object.keys(value).sort().join(",") !== "actions,level,source,stages,template,version,week_start,weekly_minutes") return fail();
  if (value.version !== 1 || value.source !== "template" || typeof value.template !== "string" || !Object.hasOwn(LEARNING_TEMPLATES, value.template)
    || typeof value.level !== "string" || !Object.hasOwn(LEARNING_LEVELS, value.level)
    || !Number.isInteger(value.weekly_minutes) || (value.weekly_minutes as number) < 30 || (value.weekly_minutes as number) > 2400
    || typeof value.week_start !== "string"
  ) return fail();
  try { if (learningWeekStart(value.week_start) !== value.week_start) return fail(); } catch { return fail(); }
  if (!Array.isArray(value.stages) || value.stages.length !== 4 || value.stages.some((stage) => !isObject(stage)
    || Object.keys(stage).sort().join(",") !== "goal,title" || !textWithin(stage.title, 100) || !textWithin(stage.goal, 500))) return fail();
  if (!Array.isArray(value.actions) || value.actions.length < 1 || value.actions.length > 7 || value.actions.some((action) => !isObject(action)
    || Object.keys(action).sort().join(",") !== "minutes,title" || !textWithin(action.title, 500)
    || !Number.isInteger(action.minutes) || (action.minutes as number) < 5 || (action.minutes as number) > 2400)) return fail();
  if (value.actions.reduce((sum, action) => sum + action.minutes, 0) > (value.weekly_minutes as number)) return fail();
}
function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function textWithin(value: unknown, max: number) { return typeof value === "string" && Boolean(value.trim()) && value.length <= max; }
