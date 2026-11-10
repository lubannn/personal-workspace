/** Local, conservative classification only. The full input always remains one idea. */
export type IdeaCategory = "work" | "life" | "unclassified";
export type IdeaCategoryChoice = "auto" | IdeaCategory;
export const IDEA_CATEGORY_LABELS: Record<IdeaCategory, string> = {
  work: "工作", life: "生活", unclassified: "待分类",
};
export type IdeaClassification = {
  category: IdeaCategory;
  source: "automatic" | "manual";
  classifier_version: "local-rules-v1" | null;
};

const CATEGORIES: readonly string[] = ["work", "life", "unclassified"];
// Generic terms such as project, learning, tools, reading and planning are intentionally
// absent: they are common in both domains. English boundaries avoid substring matches.
// Ambiguous English verbs (work, running) require explicit domain context.
const WORK_CUES = /\b(?:at work|work(?:ing)? (?:meeting|project|colleagues?|clients?|office))\b|工作(?!台|日)|职场|公司|同事|客户|上班|加班|业务|办公|会议|开会|招聘|绩效|薪资|产品需求|产品迭代|商业计划|销售|营销|\b(?:office|colleagues?|coworkers?|clients?|customers?|business|meetings?|hiring|payroll|marketing)\b/i;
const LIFE_CUES = /\b(?:work(?:ing)? out|(?:go|going|went) (?:for a run|running)|running (?:shoes|route|race))\b|生活|家人|家庭|爸妈|父母|孩子|伴侣|朋友|周末|旅行|旅游|度假|跑步|健身|运动|骑行|做饭|食谱|买菜|家务|打扫|卧室|客厅|宠物|睡眠|睡觉|\b(?:life|family|parents?|kids?|children|friends?|weekends?|vacation|holiday|travel|fitness|cycling|cooking|recipes?|groceries|housework|bedroom|pets?|sleep)\b/i;

export function classifyIdea(text: string): { category: IdeaCategory; reason: string } {
  const work = WORK_CUES.test(text);
  const life = LIFE_CUES.test(text);
  if (work && life) return { category: "unclassified", reason: "同时包含工作和生活线索，保留整段待分类" };
  if (work) return { category: "work", reason: "包含明确的工作线索" };
  if (life) return { category: "life", reason: "包含明确的生活线索" };
  return { category: "unclassified", reason: "没有足够明确的工作或生活线索" };
}

export function createIdeaClassification(text: string, choice: IdeaCategoryChoice = "auto"): IdeaClassification {
  if (choice === "auto") return { category: classifyIdea(text).category, source: "automatic", classifier_version: "local-rules-v1" };
  if (!CATEGORIES.includes(choice)) throw new Error("INVALID_IDEA_CATEGORY");
  return { category: choice, source: "manual", classifier_version: null };
}

export function isIdeaClassification(value: unknown): value is IdeaClassification {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.category === "string" && CATEGORIES.includes(item.category)
    && ((item.source === "automatic" && item.classifier_version === "local-rules-v1")
      || (item.source === "manual" && item.classifier_version === null));
}

/** Derive missing historical metadata for display only; never mutate or backfill records. */
export function getIdeaClassification(data: { raw_text: string; idea_classification?: IdeaClassification }): IdeaClassification {
  return data.idea_classification ?? createIdeaClassification(data.raw_text);
}
