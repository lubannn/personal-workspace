"use client";

import { useId } from "react";
import { classifyIdea, IDEA_CATEGORY_LABELS, type IdeaCategoryChoice } from "../../../../src/lib/github-data/idea-classification";

export function IdeaCategoryControl({ text, choice, disabled = false, onChange }: {
  text: string; choice: IdeaCategoryChoice; disabled?: boolean; onChange: (choice: IdeaCategoryChoice) => void;
}) {
  const id = useId();
  const suggestion = classifyIdea(text);
  const category = choice === "auto" ? suggestion.category : choice;
  return <div className="idea-category-control">
    <label htmlFor={`${id}-category`}>想法分类
      <select id={`${id}-category`} value={choice} disabled={disabled} onChange={(event) => onChange(event.target.value as IdeaCategoryChoice)} aria-describedby={`${id}-category-hint`}>
        <option value="auto">自动归类</option><option value="work">工作</option><option value="life">生活</option><option value="unclassified">暂不分类</option>
      </select>
    </label>
    <p id={`${id}-category-hint`} role="status">{!text.trim() ? "写下一整段内容，自动归为工作或生活。" : choice === "auto" ? `${category === "unclassified" ? "待分类" : `自动归为${IDEA_CATEGORY_LABELS[category]}`}：${suggestion.reason}` : `已手动选择${IDEA_CATEGORY_LABELS[category]}，修改正文不会改变此选择。`}</p>
    <small>仅用浏览器本地规则判断，不向外部 AI 发送正文；不确定时先保留待分类，随时可以改。</small>
  </div>;
}
