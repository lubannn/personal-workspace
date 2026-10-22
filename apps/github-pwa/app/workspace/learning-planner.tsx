"use client";

import { useState, type FormEvent } from "react";
import { generateLearningRoadmap, LEARNING_LEVELS, LEARNING_TEMPLATES, learningWeekStart, type LearningLevel, type LearningRoadmap } from "../../../../src/lib/github-data/learning-planner";

type GeneratorProps = {
  topic: string;
  goal: string;
  previous?: LearningRoadmap;
  todayDate: string;
  disabled: boolean;
  onGenerate: (topic: string, goal: string, roadmap: LearningRoadmap) => void;
  onCancel: () => void;
};
export function LearningPlannerForm({ topic: initialTopic, goal: initialGoal, previous, todayDate, disabled, onGenerate, onCancel }: GeneratorProps) {
  const [topic, setTopic] = useState(initialTopic);
  const [goal, setGoal] = useState(initialGoal);
  const [level, setLevel] = useState<LearningLevel>(previous?.level ?? "beginner");
  const [hours, setHours] = useState(String((previous?.weekly_minutes ?? 180) / 60));
  const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    try {
      const roadmap = generateLearningRoadmap({ topic, goal, level, weekly_hours: Number(hours), local_date: todayDate });
      onGenerate(topic.trim(), goal.trim(), roadmap);
    } catch { setError("请检查学习方向、目标和每周时间；时间应在 0.5–40 小时之间。日期尚未就绪时，请稍后重试。"); }
  }
  return <form className="learning-form learning-generator" id="learning-area-form" onSubmit={submit}>
    <header><h3>生成学习计划</h3><p>填写四项信息，生成可编辑的 4 周起步草稿。使用内置模板，无需 AI。</p></header>
    <div className="learning-plan-fields">
      <label>想学什么<input autoFocus required value={topic} maxLength={200} onChange={(event) => setTopic(event.target.value)} placeholder="例如：英语口语、Python、钢琴" disabled={disabled} /></label>
      <label>目前水平<select value={level} onChange={(event) => setLevel(event.target.value as LearningLevel)} disabled={disabled}>{Object.entries(LEARNING_LEVELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>希望达到的目标<textarea className="learning-short-input" required value={goal} maxLength={500} onChange={(event) => setGoal(event.target.value)} placeholder="例如：能用英语介绍自己的工作" disabled={disabled} /></label>
      <label>每周可投入时间（小时）<input required type="number" min="0.5" max="40" step="0.5" value={hours} onChange={(event) => setHours(event.target.value)} disabled={disabled} /><span>按本周总时间分配，可分多次完成。</span></label>
    </div>
    <p className="learning-planner-note">支持语言、编程与数据、乐器练习；其他方向使用通用模板。你填写的目标会保留，具体安排可在草稿中调整。</p>
    {previous ? <p className="learning-planner-note">重新生成将替换草稿中的阶段目标和周行动，资料与笔记会保留。取消可返回原稿。</p> : null}
    {error ? <p className="learning-field-error" role="alert">{error}</p> : null}
    <footer><button className="secondary-button" type="button" disabled={disabled} onClick={onCancel}>取消</button><button className="primary-button" type="submit" disabled={disabled || !topic.trim() || !goal.trim() || !hours || !todayDate}>生成草稿</button></footer>
  </form>;
}

export function LearningRoadmapEditor({ value, disabled, onChange }: { value: LearningRoadmap; disabled: boolean; onChange: (value: LearningRoadmap) => void }) {
  const total = value.actions.reduce((sum, action) => sum + action.minutes, 0);
  return <div className="learning-roadmap-editor">
    <div className="learning-roadmap-meta"><span>{LEARNING_TEMPLATES[value.template]}模板 · {LEARNING_LEVELS[value.level]}</span><span>每周 {value.weekly_minutes} 分钟 · {value.week_start} 当周起步</span></div>
    <h3>阶段目标 <small>4 周起步安排，可逐项修改</small></h3>
    <div className="learning-stage-editor">{value.stages.map((stage, index) => <fieldset key={index} disabled={disabled}><legend>第 {index + 1} 周</legend>
      <label>第 {index + 1} 周阶段名称<input required maxLength={100} value={stage.title} onChange={(event) => onChange({ ...value, stages: value.stages.map((entry, position) => position === index ? { ...entry, title: event.target.value } : entry) })} /></label>
      <label>第 {index + 1} 周阶段目标<textarea className="learning-short-input" required maxLength={500} value={stage.goal} onChange={(event) => onChange({ ...value, stages: value.stages.map((entry, position) => position === index ? { ...entry, goal: event.target.value } : entry) })} /></label>
    </fieldset>)}</div>
    <h3>周行动 <small>{value.week_start} 当周 · 共 {total} / {value.weekly_minutes} 分钟</small></h3>
    <p className="learning-planner-note">每项时间是这一周的总量，可分多次完成。总用时可少于每周预算。</p>
    <div className="learning-action-editor">{value.actions.map((action, index) => <div key={index}><label>行动 {index + 1}<textarea className="learning-short-input" required maxLength={500} disabled={disabled} value={action.title} onChange={(event) => onChange({ ...value, actions: value.actions.map((entry, position) => position === index ? { ...entry, title: event.target.value } : entry) })} /></label><label>用时 {index + 1}（分钟）<input required type="number" min="5" max="2400" step="1" disabled={disabled} value={action.minutes || ""} onChange={(event) => onChange({ ...value, actions: value.actions.map((entry, position) => position === index ? { ...entry, minutes: Number(event.target.value) } : entry) })} /></label></div>)}</div>
    {total > value.weekly_minutes ? <p className="learning-field-error" role="alert">行动总用时超过每周预算，请减少用时，或重新生成计划调整预算。</p> : null}
  </div>;
}

export function LearningRoadmapSummary({ value, goal, todayDate }: { value: LearningRoadmap; goal: string; todayDate: string }) {
  const thisWeek = todayDate ? learningWeekStart(todayDate) : "";
  return <div className="learning-roadmap-summary">
    <p className="learning-roadmap-goal"><span>希望达到</span>{goal || "暂未填写"}</p>
    <div className="learning-roadmap-columns">
      <div><h3>阶段目标 <small>4 周起步</small></h3><ol className="learning-stages">{value.stages.map((stage, index) => <li key={index}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>第 {index + 1} 周 · {stage.title}</strong><p>{stage.goal}</p></div></li>)}</ol></div>
      <div><h3>{value.week_start === thisWeek ? "本周行动" : "周行动"} <small>{value.week_start} 当周</small></h3><ol className="learning-week-actions">{value.actions.map((action, index) => <li key={index}><span>{action.title}</span><small>{action.minutes} 分钟</small></li>)}</ol><p className="learning-planner-note">合计 {value.actions.reduce((sum, action) => sum + action.minutes, 0)} / {value.weekly_minutes} 分钟，可分多次完成。</p>{thisWeek && value.week_start < thisWeek ? <p className="learning-planner-note">这是之前一周的安排，可编辑或重新生成本周草稿。</p> : null}</div>
    </div>
    <p className="learning-roadmap-source">{LEARNING_TEMPLATES[value.template]}模板起稿 · 内容可编辑</p>
  </div>;
}
