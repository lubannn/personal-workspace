"use client";

import { useMemo, useState, type FormEvent } from "react";

import {
  activeLearningAreas,
  archivedLearningAreas,
  trashedLearningAreas,
  type LearningAreaFields,
  type LearningAreaStatus,
} from "../../../../src/lib/github-data/learning-areas";
import {
  activeLearningGoals,
  archivedLearningGoals,
  completedLearningGoals,
  trashedLearningGoals,
  type LearningGoalFields,
  type LearningGoalStatus,
} from "../../../../src/lib/github-data/learning-goals";
import type { Connection, SyncedLearningArea, SyncedLearningGoal } from "./page-model";

type Props = {
  connection: Connection | null;
  online: boolean | null;
  areaItems: SyncedLearningArea[];
  goalItems: SyncedLearningGoal[];
  loading: boolean;
  savingArea: boolean;
  savingAreaId: string | null;
  savingGoal: boolean;
  savingGoalId: string | null;
  onCreateArea: (fields: LearningAreaFields) => Promise<boolean>;
  onEditArea: (item: SyncedLearningArea, fields: LearningAreaFields) => Promise<boolean>;
  onAreaStatusChange: (item: SyncedLearningArea, status: LearningAreaStatus) => void;
  onAreaDeletionChange: (item: SyncedLearningArea, operation: "trash" | "restore") => void;
  onCreateGoal: (fields: LearningGoalFields) => Promise<boolean>;
  onEditGoal: (item: SyncedLearningGoal, fields: Omit<LearningGoalFields, "learning_area_id">) => Promise<boolean>;
  onGoalStatusChange: (item: SyncedLearningGoal, status: LearningGoalStatus) => void;
  onGoalDeletionChange: (item: SyncedLearningGoal, operation: "trash" | "restore") => void;
  onRefresh: () => void;
};

const EMPTY_AREA_FIELDS: LearningAreaFields = { name: "", description_markdown: "", area_type: "general", icon: null, color: null };
const EMPTY_GOAL_FIELDS: LearningGoalFields = { learning_area_id: "", title: "", description: "", target_date: null, success_criteria_markdown: "" };

export function LearningSection(props: Props) {
  const { connection, online, areaItems, goalItems, loading, savingArea, savingAreaId, savingGoal, savingGoalId, onCreateArea, onEditArea, onAreaStatusChange, onAreaDeletionChange, onCreateGoal, onEditGoal, onGoalStatusChange, onGoalDeletionChange, onRefresh } = props;
  const [areaView, setAreaView] = useState<"active" | "archived" | "trash">("active");
  const [goalView, setGoalView] = useState<"active" | "completed" | "archived" | "trash">("active");
  const [editingAreaId, setEditingAreaId] = useState<string | null>(null);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [areaFields, setAreaFields] = useState<LearningAreaFields>(EMPTY_AREA_FIELDS);
  const [goalFields, setGoalFields] = useState<LearningGoalFields>(EMPTY_GOAL_FIELDS);

  const areaById = useMemo(() => new Map(areaItems.map((item) => [item.record.id, item])), [areaItems]);
  const goalById = useMemo(() => new Map(goalItems.map((item) => [item.record.id, item])), [goalItems]);
  const areaRecords = useMemo(() => areaItems.map((item) => item.record), [areaItems]);
  const goalRecords = useMemo(() => goalItems.map((item) => item.record), [goalItems]);
  const activeAreas = useMemo(() => activeLearningAreas(areaRecords).map((record) => areaById.get(record.id)!), [areaById, areaRecords]);
  const archivedAreas = useMemo(() => archivedLearningAreas(areaRecords).map((record) => areaById.get(record.id)!), [areaById, areaRecords]);
  const trashedAreas = useMemo(() => trashedLearningAreas(areaRecords).map((record) => areaById.get(record.id)!), [areaById, areaRecords]);
  const manageableAreas = useMemo(() => activeAreas.filter((item) => item.record.data.status === "active"), [activeAreas]);
  const activeGoals = useMemo(() => activeLearningGoals(goalRecords).map((record) => goalById.get(record.id)!), [goalById, goalRecords]);
  const completedGoals = useMemo(() => completedLearningGoals(goalRecords).map((record) => goalById.get(record.id)!), [goalById, goalRecords]);
  const archivedGoals = useMemo(() => archivedLearningGoals(goalRecords).map((record) => goalById.get(record.id)!), [goalById, goalRecords]);
  const trashedGoals = useMemo(() => trashedLearningGoals(goalRecords).map((record) => goalById.get(record.id)!), [goalById, goalRecords]);
  const visibleAreas = areaView === "active" ? activeAreas : areaView === "archived" ? archivedAreas : trashedAreas;
  const visibleGoals = goalView === "active" ? activeGoals : goalView === "completed" ? completedGoals : goalView === "archived" ? archivedGoals : trashedGoals;
  const busyArea = savingArea || savingAreaId !== null;
  const busyGoal = savingGoal || savingGoalId !== null;

  async function submitArea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!areaFields.name.trim() || !areaFields.area_type.trim()) return;
    const editing = editingAreaId ? areaById.get(editingAreaId) : null;
    const saved = editing ? await onEditArea(editing, areaFields) : await onCreateArea(areaFields);
    if (saved) resetAreaForm();
  }

  async function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!goalFields.learning_area_id || !goalFields.title.trim()) return;
    const editing = editingGoalId ? goalById.get(editingGoalId) : null;
    const saved = editing
      ? await onEditGoal(editing, { title: goalFields.title, description: goalFields.description, target_date: goalFields.target_date, success_criteria_markdown: goalFields.success_criteria_markdown })
      : await onCreateGoal(goalFields);
    if (saved) resetGoalForm();
  }

  function beginAreaEdit(item: SyncedLearningArea) {
    setEditingAreaId(item.record.id);
    setAreaFields({ name: item.record.data.name, description_markdown: item.record.data.description_markdown, area_type: item.record.data.area_type, icon: item.record.data.icon, color: item.record.data.color });
  }

  function beginGoalEdit(item: SyncedLearningGoal) {
    setEditingGoalId(item.record.id);
    setGoalFields({ learning_area_id: item.record.data.learning_area_id, title: item.record.data.title, description: item.record.data.description, target_date: item.record.data.target_date, success_criteria_markdown: item.record.data.success_criteria_markdown });
  }

  function resetAreaForm() { setEditingAreaId(null); setAreaFields(EMPTY_AREA_FIELDS); }
  function resetGoalForm() { setEditingGoalId(null); setGoalFields(EMPTY_GOAL_FIELDS); }
  function setAreaField<Key extends keyof LearningAreaFields>(key: Key, value: LearningAreaFields[Key]) { setAreaFields((current) => ({ ...current, [key]: value })); }
  function setGoalField<Key extends keyof LearningGoalFields>(key: Key, value: LearningGoalFields[Key]) { setGoalFields((current) => ({ ...current, [key]: value })); }
  function areaAvailability(item: SyncedLearningArea | undefined) {
    if (!item) return "引用领域缺失";
    if (item.record.deleted_at !== null) return "领域在回收站，Goal 只读";
    if (item.record.data.status === "archived") return "领域已归档，Goal 只读";
    if (item.record.data.status === "on_hold") return "领域已暂停，Goal 只读";
    return null;
  }

  return <section className="learning-card" aria-labelledby="learning-title">
    <div className="card-heading">
      <div><p className="eyebrow">Phase 4 · Learning</p><h2 id="learning-title">学习领域与目标</h2><p className="learning-subtitle">领域由你定义；目标只引用有效领域，不预设学科，也不自动生成内容。</p></div>
      <button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || loading}>{loading ? "刷新中…" : "从 GitHub 刷新"}</button>
    </div>

    <div className="learning-subsection-heading"><h3>学习领域</h3><div className="learning-view-actions">
      <button className="view-button" type="button" aria-pressed={areaView === "active"} onClick={() => setAreaView("active")}>进行中 {activeAreas.length}</button>
      <button className="view-button" type="button" aria-pressed={areaView === "archived"} onClick={() => { setAreaView("archived"); resetAreaForm(); }}>已归档 {archivedAreas.length}</button>
      <button className="view-button" type="button" aria-pressed={areaView === "trash"} onClick={() => { setAreaView("trash"); resetAreaForm(); }}>回收站 {trashedAreas.length}</button>
    </div></div>
    {areaView === "active" ? <form className="learning-form" onSubmit={submitArea}>
      <label>名称<input value={areaFields.name} maxLength={200} onChange={(event) => setAreaField("name", event.target.value)} placeholder="例如：数据分析" disabled={!connection || busyArea} /></label>
      <label>类型标识<input value={areaFields.area_type} maxLength={64} pattern="[a-z0-9][a-z0-9_-]*" onChange={(event) => setAreaField("area_type", event.target.value)} placeholder="例如：professional" disabled={!connection || busyArea} /></label>
      <label>图标（可选）<input value={areaFields.icon ?? ""} maxLength={32} onChange={(event) => setAreaField("icon", event.target.value || null)} placeholder="📚" disabled={!connection || busyArea} /></label>
      <label>颜色（可选）<input value={areaFields.color ?? ""} pattern="#[0-9a-fA-F]{6}" onChange={(event) => setAreaField("color", event.target.value || null)} placeholder="#5f7459" disabled={!connection || busyArea} /></label>
      <label className="learning-description">说明（支持 Markdown）<textarea value={areaFields.description_markdown} maxLength={50_000} onChange={(event) => setAreaField("description_markdown", event.target.value)} placeholder="这个领域为什么重要？边界是什么？" disabled={!connection || busyArea} /></label>
      <footer><span>归档、暂停或删除领域不会级联删除 Goal；相关 Goal 会保留为只读。</span><div>{editingAreaId ? <button className="secondary-button" type="button" onClick={resetAreaForm} disabled={busyArea}>取消编辑</button> : null}<button className="primary-button" type="submit" disabled={!connection || !areaFields.name.trim() || !areaFields.area_type.trim() || busyArea || online === false}>{busyArea ? "保存中…" : editingAreaId ? "保存修改" : "创建领域"}</button></div></footer>
    </form> : null}
    {!connection ? <p className="empty-note">连接后显示 Private 仓库中的 LearningArea。</p> : loading && areaItems.length === 0 ? <p className="empty-note">正在读取学习领域…</p> : visibleAreas.length === 0 ? <p className="empty-note">当前视图还没有学习领域。</p> : <ol className="learning-list">{visibleAreas.map((item) => <li key={item.record.id}>
      <div><span>{item.record.data.icon || "◌"}</span><strong>{item.record.data.name}</strong><code>{item.record.data.area_type}</code>{item.record.data.description_markdown ? <p>{item.record.data.description_markdown}</p> : null}<small>{item.record.data.status === "on_hold" ? "已暂停" : item.record.data.status === "archived" ? "已归档" : "进行中"} · v{item.record.version}</small></div>
      <div className="learning-item-actions">{areaView === "active" ? <><button className="text-button" type="button" onClick={() => beginAreaEdit(item)} disabled={busyArea}>编辑</button><button className="text-button" type="button" onClick={() => onAreaStatusChange(item, item.record.data.status === "on_hold" ? "active" : "on_hold")} disabled={busyArea || online === false}>{item.record.data.status === "on_hold" ? "继续" : "暂停"}</button><button className="text-button" type="button" onClick={() => onAreaStatusChange(item, "archived")} disabled={busyArea || online === false}>归档</button></> : areaView === "archived" ? <button className="text-button" type="button" onClick={() => onAreaStatusChange(item, "active")} disabled={busyArea || online === false}>恢复进行</button> : null}<button className="text-button" type="button" onClick={() => onAreaDeletionChange(item, areaView === "trash" ? "restore" : "trash")} disabled={busyArea || online === false}>{savingAreaId === item.record.id ? "…" : areaView === "trash" ? "恢复" : "移到回收站"}</button></div>
    </li>)}</ol>}

    <div className="learning-subsection-heading learning-goals-heading"><div><h3>学习目标</h3><p>Area 不可用时 Goal 仍展示，但所有写入操作会停止。</p></div><div className="learning-view-actions">
      <button className="view-button" type="button" aria-pressed={goalView === "active"} onClick={() => setGoalView("active")}>进行中 {activeGoals.length}</button>
      <button className="view-button" type="button" aria-pressed={goalView === "completed"} onClick={() => { setGoalView("completed"); resetGoalForm(); }}>已完成 {completedGoals.length}</button>
      <button className="view-button" type="button" aria-pressed={goalView === "archived"} onClick={() => { setGoalView("archived"); resetGoalForm(); }}>已归档 {archivedGoals.length}</button>
      <button className="view-button" type="button" aria-pressed={goalView === "trash"} onClick={() => { setGoalView("trash"); resetGoalForm(); }}>回收站 {trashedGoals.length}</button>
    </div></div>
    {goalView === "active" ? <form className="learning-form learning-goal-form" onSubmit={submitGoal}>
      <label>学习领域<select value={goalFields.learning_area_id} onChange={(event) => setGoalField("learning_area_id", event.target.value)} disabled={!connection || busyGoal || editingGoalId !== null}><option value="">选择可用领域</option>{manageableAreas.map((item) => <option key={item.record.id} value={item.record.id}>{item.record.data.name}</option>)}</select></label>
      <label>目标名称<input value={goalFields.title} maxLength={300} onChange={(event) => setGoalField("title", event.target.value)} placeholder="例如：完成统计学基础" disabled={!connection || busyGoal} /></label>
      <label>目标日期（可选）<input type="date" value={goalFields.target_date ?? ""} onChange={(event) => setGoalField("target_date", event.target.value || null)} disabled={!connection || busyGoal} /></label>
      <label className="learning-description">说明<textarea value={goalFields.description} maxLength={50_000} onChange={(event) => setGoalField("description", event.target.value)} placeholder="目标范围与背景" disabled={!connection || busyGoal} /></label>
      <label className="learning-description">成功标准（支持 Markdown）<textarea value={goalFields.success_criteria_markdown} maxLength={50_000} onChange={(event) => setGoalField("success_criteria_markdown", event.target.value)} placeholder="怎样才算完成？" disabled={!connection || busyGoal} /></label>
      <footer><span>编辑不会悄悄把 Goal 移到另一个 Area；跨设备冲突会显式停止保存。</span><div>{editingGoalId ? <button className="secondary-button" type="button" onClick={resetGoalForm} disabled={busyGoal}>取消编辑</button> : null}<button className="primary-button" type="submit" disabled={!connection || !goalFields.learning_area_id || !goalFields.title.trim() || busyGoal || online === false}>{busyGoal ? "保存中…" : editingGoalId ? "保存修改" : "创建目标"}</button></div></footer>
    </form> : null}
    {!connection ? <p className="empty-note">连接后显示 Private 仓库中的 LearningGoal。</p> : loading && goalItems.length === 0 ? <p className="empty-note">正在读取学习目标…</p> : visibleGoals.length === 0 ? <p className="empty-note">当前视图还没有学习目标。</p> : <ol className="learning-list learning-goal-list">{visibleGoals.map((item) => {
      const area = areaById.get(item.record.data.learning_area_id);
      const unavailable = areaAvailability(area);
      const manageable = unavailable === null;
      return <li key={item.record.id}>
        <div><span>◎</span><strong>{item.record.data.title}</strong><code>{area?.record.data.name ?? item.record.data.learning_area_id}</code>{item.record.data.description ? <p>{item.record.data.description}</p> : null}{item.record.data.success_criteria_markdown ? <p className="learning-goal-criteria">成功标准：{item.record.data.success_criteria_markdown}</p> : null}<small>{item.record.data.target_date ? `目标 ${item.record.data.target_date} · ` : ""}{item.record.data.status === "completed" ? "已完成" : item.record.data.status === "archived" ? "已归档" : "进行中"} · v{item.record.version}{unavailable ? ` · ${unavailable}` : ""}</small></div>
        <div className="learning-item-actions">{goalView === "active" ? <><button className="text-button" type="button" onClick={() => beginGoalEdit(item)} disabled={busyGoal || !manageable}>编辑</button><button className="text-button" type="button" onClick={() => onGoalStatusChange(item, "completed")} disabled={busyGoal || !manageable || online === false}>完成</button><button className="text-button" type="button" onClick={() => onGoalStatusChange(item, "archived")} disabled={busyGoal || !manageable || online === false}>归档</button></> : goalView === "completed" || goalView === "archived" ? <button className="text-button" type="button" onClick={() => onGoalStatusChange(item, "active")} disabled={busyGoal || !manageable || online === false}>恢复进行</button> : null}<button className="text-button" type="button" onClick={() => onGoalDeletionChange(item, goalView === "trash" ? "restore" : "trash")} disabled={busyGoal || !manageable || online === false}>{savingGoalId === item.record.id ? "…" : goalView === "trash" ? "恢复" : "移到回收站"}</button></div>
      </li>;
    })}</ol>}
  </section>;
}
