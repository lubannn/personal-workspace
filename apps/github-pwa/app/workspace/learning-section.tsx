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
import {
  activeLearningActivities,
  trashedLearningActivities,
  type LearningActivityFields,
} from "../../../../src/lib/github-data/learning-activities";
import { activeLearningResources, archivedLearningResources, completedLearningResources, trashedLearningResources, type LearningResourceFields, type LearningResourceStatus } from "../../../../src/lib/github-data/learning-resources";
import type { Connection, SyncedLearningActivity, SyncedLearningArea, SyncedLearningGoal, SyncedLearningResource } from "./page-model";

type Props = {
  connection: Connection | null;
  online: boolean | null;
  areaItems: SyncedLearningArea[];
  goalItems: SyncedLearningGoal[];
  activityItems: SyncedLearningActivity[];
  resourceItems: SyncedLearningResource[];
  loading: boolean;
  savingArea: boolean;
  savingAreaId: string | null;
  savingGoal: boolean;
  savingGoalId: string | null;
  savingActivity: boolean;
  savingActivityId: string | null;
  savingResource: boolean;
  savingResourceId: string | null;
  onCreateArea: (fields: LearningAreaFields) => Promise<boolean>;
  onEditArea: (item: SyncedLearningArea, fields: LearningAreaFields) => Promise<boolean>;
  onAreaStatusChange: (item: SyncedLearningArea, status: LearningAreaStatus) => void;
  onAreaDeletionChange: (item: SyncedLearningArea, operation: "trash" | "restore") => void;
  onCreateGoal: (fields: LearningGoalFields) => Promise<boolean>;
  onEditGoal: (item: SyncedLearningGoal, fields: Omit<LearningGoalFields, "learning_area_id">) => Promise<boolean>;
  onGoalStatusChange: (item: SyncedLearningGoal, status: LearningGoalStatus) => void;
  onGoalDeletionChange: (item: SyncedLearningGoal, operation: "trash" | "restore") => void;
  onCreateActivity: (fields: LearningActivityFields) => Promise<boolean>;
  onEditActivity: (item: SyncedLearningActivity, fields: Omit<LearningActivityFields, "learning_area_id" | "goal_id">) => Promise<boolean>;
  onActivityDeletionChange: (item: SyncedLearningActivity, operation: "trash" | "restore") => void;
  onCreateResource: (fields: LearningResourceFields) => Promise<boolean>;
  onEditResource: (item: SyncedLearningResource, fields: Omit<LearningResourceFields, "learning_area_id">) => Promise<boolean>;
  onResourceStatusChange: (item: SyncedLearningResource, status: LearningResourceStatus) => void;
  onResourceDeletionChange: (item: SyncedLearningResource, operation: "trash" | "restore") => void;
  onRefresh: () => void;
};

const EMPTY_AREA_FIELDS: LearningAreaFields = { name: "", description_markdown: "", area_type: "general", icon: null, color: null };
const EMPTY_GOAL_FIELDS: LearningGoalFields = { learning_area_id: "", title: "", description: "", target_date: null, success_criteria_markdown: "" };
function emptyActivityFields(): LearningActivityFields {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  return { learning_area_id: "", goal_id: null, activity_type: "study", title: "", occurred_at: local, duration_minutes: 30, quantity: null, unit: null, notes_markdown: "", linked_task_id: null, source_ref: null };
}

function localDateTimeValue(instant: string) {
  const date = new Date(instant);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
const EMPTY_RESOURCE_FIELDS: LearningResourceFields = { learning_area_id: "", title: "", resource_type: "article", url: "", notes_markdown: "" };

export function LearningSection(props: Props) {
  const { connection, online, areaItems, goalItems, activityItems, resourceItems, loading, savingArea, savingAreaId, savingGoal, savingGoalId, savingActivity, savingActivityId, savingResource, savingResourceId, onCreateArea, onEditArea, onAreaStatusChange, onAreaDeletionChange, onCreateGoal, onEditGoal, onGoalStatusChange, onGoalDeletionChange, onCreateActivity, onEditActivity, onActivityDeletionChange, onCreateResource, onEditResource, onResourceStatusChange, onResourceDeletionChange, onRefresh } = props;
  const [areaView, setAreaView] = useState<"active" | "archived" | "trash">("active");
  const [goalView, setGoalView] = useState<"active" | "completed" | "archived" | "trash">("active");
  const [activityView, setActivityView] = useState<"active" | "trash">("active");
  const [resourceView, setResourceView] = useState<"active" | "completed" | "archived" | "trash">("active");
  const [editingAreaId, setEditingAreaId] = useState<string | null>(null);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);
  const [editingResourceId, setEditingResourceId] = useState<string | null>(null);
  const [areaFields, setAreaFields] = useState<LearningAreaFields>(EMPTY_AREA_FIELDS);
  const [goalFields, setGoalFields] = useState<LearningGoalFields>(EMPTY_GOAL_FIELDS);
  const [activityFields, setActivityFields] = useState<LearningActivityFields>(() => emptyActivityFields());
  const [resourceFields, setResourceFields] = useState<LearningResourceFields>(EMPTY_RESOURCE_FIELDS);

  const areaById = useMemo(() => new Map(areaItems.map((item) => [item.record.id, item])), [areaItems]);
  const goalById = useMemo(() => new Map(goalItems.map((item) => [item.record.id, item])), [goalItems]);
  const areaRecords = useMemo(() => areaItems.map((item) => item.record), [areaItems]);
  const goalRecords = useMemo(() => goalItems.map((item) => item.record), [goalItems]);
  const activityById = useMemo(() => new Map(activityItems.map((item) => [item.record.id, item])), [activityItems]);
  const activityRecords = useMemo(() => activityItems.map((item) => item.record), [activityItems]);
  const resourceById = useMemo(() => new Map(resourceItems.map((item) => [item.record.id, item])), [resourceItems]);
  const resourceRecords = useMemo(() => resourceItems.map((item) => item.record), [resourceItems]);
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
  const activeActivities = useMemo(() => activeLearningActivities(activityRecords).map((record) => activityById.get(record.id)!), [activityById, activityRecords]);
  const trashedActivities = useMemo(() => trashedLearningActivities(activityRecords).map((record) => activityById.get(record.id)!), [activityById, activityRecords]);
  const visibleActivities = activityView === "active" ? activeActivities : trashedActivities;
  const activeResources = useMemo(() => activeLearningResources(resourceRecords).map((record) => resourceById.get(record.id)!), [resourceById, resourceRecords]);
  const completedResources = useMemo(() => completedLearningResources(resourceRecords).map((record) => resourceById.get(record.id)!), [resourceById, resourceRecords]);
  const archivedResources = useMemo(() => archivedLearningResources(resourceRecords).map((record) => resourceById.get(record.id)!), [resourceById, resourceRecords]);
  const trashedResources = useMemo(() => trashedLearningResources(resourceRecords).map((record) => resourceById.get(record.id)!), [resourceById, resourceRecords]);
  const visibleResources = resourceView === "active" ? activeResources : resourceView === "completed" ? completedResources : resourceView === "archived" ? archivedResources : trashedResources;
  const selectableGoals = useMemo(() => goalItems.filter((item) => item.record.data.learning_area_id === activityFields.learning_area_id && item.record.deleted_at === null && item.record.data.status !== "archived"), [activityFields.learning_area_id, goalItems]);
  const busyArea = savingArea || savingAreaId !== null;
  const busyGoal = savingGoal || savingGoalId !== null;
  const busyActivity = savingActivity || savingActivityId !== null;
  const busyResource = savingResource || savingResourceId !== null;

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

  async function submitActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activityFields.learning_area_id || !activityFields.title.trim() || !activityFields.occurred_at || activityFields.duration_minutes < 1) return;
    const normalized = { ...activityFields, occurred_at: new Date(activityFields.occurred_at).toISOString() };
    const editing = editingActivityId ? activityById.get(editingActivityId) : null;
    const saved = editing
      ? await onEditActivity(editing, { activity_type: normalized.activity_type, title: normalized.title, occurred_at: normalized.occurred_at, duration_minutes: normalized.duration_minutes, quantity: normalized.quantity, unit: normalized.unit, notes_markdown: normalized.notes_markdown, linked_task_id: normalized.linked_task_id, source_ref: normalized.source_ref })
      : await onCreateActivity(normalized);
    if (saved) resetActivityForm();
  }

  async function submitResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resourceFields.learning_area_id || !resourceFields.title.trim() || !resourceFields.url.trim()) return;
    const editing = editingResourceId ? resourceById.get(editingResourceId) : null;
    const saved = editing ? await onEditResource(editing, { title: resourceFields.title, resource_type: resourceFields.resource_type, url: resourceFields.url, notes_markdown: resourceFields.notes_markdown }) : await onCreateResource(resourceFields);
    if (saved) resetResourceForm();
  }

  function beginAreaEdit(item: SyncedLearningArea) {
    setEditingAreaId(item.record.id);
    setAreaFields({ name: item.record.data.name, description_markdown: item.record.data.description_markdown, area_type: item.record.data.area_type, icon: item.record.data.icon, color: item.record.data.color });
  }

  function beginGoalEdit(item: SyncedLearningGoal) {
    setEditingGoalId(item.record.id);
    setGoalFields({ learning_area_id: item.record.data.learning_area_id, title: item.record.data.title, description: item.record.data.description, target_date: item.record.data.target_date, success_criteria_markdown: item.record.data.success_criteria_markdown });
  }

  function beginActivityEdit(item: SyncedLearningActivity) {
    setEditingActivityId(item.record.id);
    setActivityFields({ ...item.record.data, occurred_at: localDateTimeValue(item.record.data.occurred_at) });
  }
  function beginResourceEdit(item: SyncedLearningResource) { setEditingResourceId(item.record.id); setResourceFields({ learning_area_id: item.record.data.learning_area_id, title: item.record.data.title, resource_type: item.record.data.resource_type, url: item.record.data.url, notes_markdown: item.record.data.notes_markdown }); }

  function resetAreaForm() { setEditingAreaId(null); setAreaFields(EMPTY_AREA_FIELDS); }
  function resetGoalForm() { setEditingGoalId(null); setGoalFields(EMPTY_GOAL_FIELDS); }
  function resetActivityForm() { setEditingActivityId(null); setActivityFields(emptyActivityFields()); }
  function resetResourceForm() { setEditingResourceId(null); setResourceFields(EMPTY_RESOURCE_FIELDS); }
  function setAreaField<Key extends keyof LearningAreaFields>(key: Key, value: LearningAreaFields[Key]) { setAreaFields((current) => ({ ...current, [key]: value })); }
  function setGoalField<Key extends keyof LearningGoalFields>(key: Key, value: LearningGoalFields[Key]) { setGoalFields((current) => ({ ...current, [key]: value })); }
  function setActivityField<Key extends keyof LearningActivityFields>(key: Key, value: LearningActivityFields[Key]) { setActivityFields((current) => ({ ...current, [key]: value })); }
  function setResourceField<Key extends keyof LearningResourceFields>(key: Key, value: LearningResourceFields[Key]) { setResourceFields((current) => ({ ...current, [key]: value })); }
  function areaAvailability(item: SyncedLearningArea | undefined) {
    if (!item) return "引用领域缺失";
    if (item.record.deleted_at !== null) return "领域在回收站，Goal 只读";
    if (item.record.data.status === "archived") return "领域已归档，Goal 只读";
    if (item.record.data.status === "on_hold") return "领域已暂停，Goal 只读";
    return null;
  }
  function activityAvailability(item: SyncedLearningActivity) {
    const areaUnavailable = areaAvailability(areaById.get(item.record.data.learning_area_id));
    if (areaUnavailable) return areaUnavailable.replace("Goal", "Activity");
    if (item.record.data.goal_id === null) return null;
    const goal = goalById.get(item.record.data.goal_id);
    if (!goal || goal.record.data.learning_area_id !== item.record.data.learning_area_id) return "引用目标缺失或不属于该领域，Activity 只读";
    if (goal.record.deleted_at !== null) return "目标在回收站，Activity 只读";
    if (goal.record.data.status === "archived") return "目标已归档，Activity 只读";
    return null;
  }

  return <section className="learning-card" aria-labelledby="learning-title">
    <div className="card-heading">
      <div><p className="eyebrow">Phase 4 · Learning</p><h2 id="learning-title">学习领域、目标与活动</h2><p className="learning-subtitle">领域由你定义；目标和手工活动只引用有效父记录，不预设学科，也不自动生成内容。</p></div>
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

    <div className="learning-subsection-heading learning-goals-heading"><div><h3>学习活动</h3><p>手工记录时间、分钟、内容与来源；父记录不可用时历史活动保持只读。</p></div><div className="learning-view-actions">
      <button className="view-button" type="button" aria-pressed={activityView === "active"} onClick={() => setActivityView("active")}>活动 {activeActivities.length}</button>
      <button className="view-button" type="button" aria-pressed={activityView === "trash"} onClick={() => { setActivityView("trash"); resetActivityForm(); }}>回收站 {trashedActivities.length}</button>
    </div></div>
    {activityView === "active" ? <form className="learning-form learning-activity-form" onSubmit={submitActivity}>
      <label>学习领域<select value={activityFields.learning_area_id} onChange={(event) => setActivityFields((current) => ({ ...current, learning_area_id: event.target.value, goal_id: null }))} disabled={!connection || busyActivity || editingActivityId !== null}><option value="">选择可用领域</option>{manageableAreas.map((item) => <option key={item.record.id} value={item.record.id}>{item.record.data.name}</option>)}</select></label>
      <label>学习目标（可选）<select value={activityFields.goal_id ?? ""} onChange={(event) => setActivityField("goal_id", event.target.value || null)} disabled={!connection || busyActivity || !activityFields.learning_area_id || editingActivityId !== null}><option value="">不关联目标</option>{selectableGoals.map((item) => <option key={item.record.id} value={item.record.id}>{item.record.data.title}{item.record.data.status === "completed" ? "（已完成）" : ""}</option>)}</select></label>
      <label>活动类型<input value={activityFields.activity_type} maxLength={64} pattern="[a-z0-9][a-z0-9_-]*" onChange={(event) => setActivityField("activity_type", event.target.value)} placeholder="例如：course" disabled={!connection || busyActivity} /></label>
      <label>标题<input value={activityFields.title} maxLength={300} onChange={(event) => setActivityField("title", event.target.value)} placeholder="例如：统计学课程第三讲" disabled={!connection || busyActivity} /></label>
      <label>发生时间<input type="datetime-local" value={activityFields.occurred_at} onChange={(event) => setActivityField("occurred_at", event.target.value)} disabled={!connection || busyActivity} /></label>
      <label>学习分钟<input type="number" min={1} max={10_080} step={1} value={activityFields.duration_minutes} onChange={(event) => setActivityField("duration_minutes", Number(event.target.value))} disabled={!connection || busyActivity} /></label>
      <label>数量（可选）<input type="number" min="0.000001" step="any" value={activityFields.quantity ?? ""} onChange={(event) => setActivityField("quantity", event.target.value === "" ? null : Number(event.target.value))} placeholder="例如：20" disabled={!connection || busyActivity} /></label>
      <label>数量单位（与数量同时填写）<input value={activityFields.unit ?? ""} maxLength={64} onChange={(event) => setActivityField("unit", event.target.value || null)} placeholder="例如：pages" disabled={!connection || busyActivity} /></label>
      <label className="learning-description">来源（可选）<input value={activityFields.source_ref ?? ""} maxLength={2_000} onChange={(event) => setActivityField("source_ref", event.target.value || null)} placeholder="课程、书籍、文章或 URL" disabled={!connection || busyActivity} /></label>
      <label className="learning-description">笔记（支持 Markdown）<textarea value={activityFields.notes_markdown} maxLength={50_000} onChange={(event) => setActivityField("notes_markdown", event.target.value)} placeholder="学到了什么？下一步是什么？" disabled={!connection || busyActivity} /></label>
      <footer><span>v1 只手工记录，不上传外部正文；编辑不会改变 Area 或 Goal 引用。</span><div>{editingActivityId ? <button className="secondary-button" type="button" onClick={resetActivityForm} disabled={busyActivity}>取消编辑</button> : null}<button className="primary-button" type="submit" disabled={!connection || !activityFields.learning_area_id || !activityFields.title.trim() || !activityFields.occurred_at || activityFields.duration_minutes < 1 || (activityFields.quantity === null) !== (activityFields.unit === null) || busyActivity || online === false}>{busyActivity ? "保存中…" : editingActivityId ? "保存修改" : "记录活动"}</button></div></footer>
    </form> : null}
    {!connection ? <p className="empty-note">连接后显示 Private 仓库中的 LearningActivity。</p> : loading && activityItems.length === 0 ? <p className="empty-note">正在读取学习活动…</p> : visibleActivities.length === 0 ? <p className="empty-note">当前视图还没有学习活动。</p> : <ol className="learning-list learning-activity-list">{visibleActivities.map((item) => {
      const unavailable = activityAvailability(item);
      const area = areaById.get(item.record.data.learning_area_id);
      const goal = item.record.data.goal_id ? goalById.get(item.record.data.goal_id) : null;
      return <li key={item.record.id}>
        <div><span>◷</span><strong>{item.record.data.title}</strong><code>{item.record.data.activity_type}</code><p>{area?.record.data.name ?? item.record.data.learning_area_id}{goal ? ` · ${goal.record.data.title}` : ""}</p>{item.record.data.notes_markdown ? <p>{item.record.data.notes_markdown}</p> : null}{item.record.data.source_ref ? <p className="learning-goal-criteria">来源：{item.record.data.source_ref}</p> : null}<small>{new Date(item.record.data.occurred_at).toLocaleString("zh-CN")} · {item.record.data.duration_minutes} 分钟{item.record.data.quantity !== null ? ` · ${item.record.data.quantity} ${item.record.data.unit}` : ""} · v{item.record.version}{unavailable ? ` · ${unavailable}` : ""}</small></div>
        <div className="learning-item-actions">{activityView === "active" ? <button className="text-button" type="button" onClick={() => beginActivityEdit(item)} disabled={busyActivity || unavailable !== null}>编辑</button> : null}<button className="text-button" type="button" onClick={() => onActivityDeletionChange(item, activityView === "trash" ? "restore" : "trash")} disabled={busyActivity || unavailable !== null || online === false}>{savingActivityId === item.record.id ? "…" : activityView === "trash" ? "恢复" : "移到回收站"}</button></div>
      </li>;
    })}</ol>}

    <div className="learning-subsection-heading learning-goals-heading"><div><h3>学习资源</h3><p>只保存标题、类型、网页引用和笔记；不会抓取或上传外部正文。</p></div><div className="learning-view-actions">
      <button className="view-button" type="button" aria-pressed={resourceView === "active"} onClick={() => setResourceView("active")}>使用中 {activeResources.length}</button>
      <button className="view-button" type="button" aria-pressed={resourceView === "completed"} onClick={() => { setResourceView("completed"); resetResourceForm(); }}>已完成 {completedResources.length}</button>
      <button className="view-button" type="button" aria-pressed={resourceView === "archived"} onClick={() => { setResourceView("archived"); resetResourceForm(); }}>已归档 {archivedResources.length}</button>
      <button className="view-button" type="button" aria-pressed={resourceView === "trash"} onClick={() => { setResourceView("trash"); resetResourceForm(); }}>回收站 {trashedResources.length}</button>
    </div></div>
    {resourceView === "active" ? <form className="learning-form learning-goal-form" onSubmit={submitResource}>
      <label>学习领域<select value={resourceFields.learning_area_id} onChange={(event) => setResourceField("learning_area_id", event.target.value)} disabled={!connection || busyResource || editingResourceId !== null}><option value="">选择可用领域</option>{manageableAreas.map((item) => <option key={item.record.id} value={item.record.id}>{item.record.data.name}</option>)}</select></label>
      <label>资源标题<input value={resourceFields.title} maxLength={300} onChange={(event) => setResourceField("title", event.target.value)} placeholder="例如：统计学公开课" disabled={!connection || busyResource} /></label>
      <label>资源类型<input value={resourceFields.resource_type} maxLength={64} pattern="[a-z0-9][a-z0-9_-]*" onChange={(event) => setResourceField("resource_type", event.target.value)} placeholder="例如：course" disabled={!connection || busyResource} /></label>
      <label className="learning-description">网页地址<input type="url" value={resourceFields.url} maxLength={2_000} pattern="https?://.*" onChange={(event) => setResourceField("url", event.target.value)} placeholder="https://example.com/resource" disabled={!connection || busyResource} /></label>
      <label className="learning-description">笔记（支持 Markdown）<textarea value={resourceFields.notes_markdown} maxLength={50_000} onChange={(event) => setResourceField("notes_markdown", event.target.value)} placeholder="为什么保留这个资源？" disabled={!connection || busyResource} /></label>
      <footer><span>编辑不会改变 Area 引用；外部网页内容不进入 Workspace。</span><div>{editingResourceId ? <button className="secondary-button" type="button" onClick={resetResourceForm} disabled={busyResource}>取消编辑</button> : null}<button className="primary-button" type="submit" disabled={!connection || !resourceFields.learning_area_id || !resourceFields.title.trim() || !resourceFields.url.trim() || busyResource || online === false}>{busyResource ? "保存中…" : editingResourceId ? "保存修改" : "保存资源"}</button></div></footer>
    </form> : null}
    {!connection ? <p className="empty-note">连接后显示 Private 仓库中的 LearningResource。</p> : loading && resourceItems.length === 0 ? <p className="empty-note">正在读取学习资源…</p> : visibleResources.length === 0 ? <p className="empty-note">当前视图还没有学习资源。</p> : <ol className="learning-list">{visibleResources.map((item) => {
      const area = areaById.get(item.record.data.learning_area_id);
      const unavailable = areaAvailability(area);
      return <li key={item.record.id}>
        <div><span>↗</span><strong>{item.record.data.title}</strong><code>{item.record.data.resource_type}</code><p>{area?.record.data.name ?? item.record.data.learning_area_id}</p><a href={item.record.data.url} target="_blank" rel="noreferrer">打开资源</a>{item.record.data.notes_markdown ? <p>{item.record.data.notes_markdown}</p> : null}<small>{item.record.data.status === "completed" ? "已完成" : item.record.data.status === "archived" ? "已归档" : "使用中"} · v{item.record.version}{unavailable ? ` · ${unavailable.replace("Goal", "Resource")}` : ""}</small></div>
        <div className="learning-item-actions">{resourceView === "active" ? <><button className="text-button" type="button" onClick={() => beginResourceEdit(item)} disabled={busyResource || unavailable !== null}>编辑</button><button className="text-button" type="button" onClick={() => onResourceStatusChange(item, "completed")} disabled={busyResource || unavailable !== null || online === false}>完成</button><button className="text-button" type="button" onClick={() => onResourceStatusChange(item, "archived")} disabled={busyResource || unavailable !== null || online === false}>归档</button></> : resourceView === "completed" || resourceView === "archived" ? <button className="text-button" type="button" onClick={() => onResourceStatusChange(item, "active")} disabled={busyResource || unavailable !== null || online === false}>恢复使用</button> : null}<button className="text-button" type="button" onClick={() => onResourceDeletionChange(item, resourceView === "trash" ? "restore" : "trash")} disabled={busyResource || unavailable !== null || online === false}>{savingResourceId === item.record.id ? "…" : resourceView === "trash" ? "恢复" : "移到回收站"}</button></div>
      </li>;
    })}</ol>}
  </section>;
}
