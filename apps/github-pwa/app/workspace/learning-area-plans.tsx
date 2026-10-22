"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ArrowUpRight, BookOpen, ChevronDown, MoreHorizontal, Plus } from "lucide-react";

import {
  activeLearningAreas,
  archivedLearningAreas,
  isLearningResourceUrl,
  learningAreaPlan,
  trashedLearningAreas,
  type LearningAreaFields,
  type LearningAreaStatus,
  type LearningPlan,
} from "../../../../src/lib/github-data/learning-areas";
import type { Connection, SyncedLearningArea } from "./page-model";
import { validateLearningRoadmap, type LearningRoadmap } from "../../../../src/lib/github-data/learning-planner";
import { LearningPlannerForm, LearningRoadmapEditor, LearningRoadmapSummary } from "./learning-planner";

type Props = {
  connection: Connection | null;
  online: boolean | null;
  todayDate: string;
  items: SyncedLearningArea[];
  loading: boolean;
  saving: boolean;
  savingId: string | null;
  onCreate: (fields: LearningAreaFields) => Promise<boolean>;
  onEdit: (item: SyncedLearningArea, fields: LearningAreaFields) => Promise<boolean>;
  onStatusChange: (item: SyncedLearningArea, status: LearningAreaStatus) => void;
  onDeletionChange: (item: SyncedLearningArea, operation: "trash" | "restore") => void;
  onRefresh: () => void;
};

type View = "active" | "on_hold" | "archived" | "trash";
const EMPTY_PLAN: LearningPlan = { goal: "", next_step: "", resource_url: "" };
const EMPTY_FIELDS: LearningAreaFields = { name: "", description_markdown: "", area_type: "general", icon: null, color: null, learning_plan: EMPTY_PLAN };
const VIEWS: { value: View; label: string; empty: string; hint: string }[] = [
  { value: "active", label: "学习中", empty: "先选一个想学的方向", hint: "填写方向、水平、目标和每周时间，生成一份可以修改的起步计划。" },
  { value: "on_hold", label: "已暂停", empty: "还没有暂停的学习", hint: "暂时放下的方向会留在这里，想学时再继续。" },
  { value: "archived", label: "已归档", empty: "还没有归档的学习", hint: "告一段落后归档，资料与笔记仍会保留。" },
  { value: "trash", label: "回收站", empty: "回收站是空的", hint: "移到这里的学习方向可以恢复。" },
];

export function LearningAreaPlans({ connection, online, todayDate, items, loading, saving, savingId, onCreate, onEdit, onStatusChange, onDeletionChange, onRefresh }: Props) {
  const [view, setView] = useState<View>("active");
  const [creating, setCreating] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [plannerReturnToForm, setPlannerReturnToForm] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [fields, setFields] = useState<LearningAreaFields>(EMPTY_FIELDS);
  const byId = useMemo(() => new Map(items.map((item) => [item.record.id, item])), [items]);
  const groups = useMemo(() => {
    const records = items.map((item) => item.record);
    const current = activeLearningAreas(records);
    const synced = (records: typeof current) => records.map((record) => byId.get(record.id)!);
    return {
      active: synced(current.filter((record) => record.data.status === "active")),
      on_hold: synced(current.filter((record) => record.data.status === "on_hold")),
      archived: synced(archivedLearningAreas(records)),
      trash: synced(trashedLearningAreas(records)),
    };
  }, [items, byId]);
  const visible = groups[view];
  const currentView = VIEWS.find((item) => item.value === view)!;
  const busy = saving || savingId !== null;
  const disabled = !connection || busy || loading || online === false;
  const draftDisabled = busy || loading;
  const formActive = creating || editingId !== null;
  const plan = fields.learning_plan ?? EMPTY_PLAN;
  const resourceValid = isLearningResourceUrl(plan.resource_url);
  let roadmapValid = true;
  if (plan.roadmap) { try { validateLearningRoadmap(plan.roadmap); } catch { roadmapValid = false; } }
  const valid = Boolean(fields.name.trim()) && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(fields.area_type.trim())
    && (fields.color === null || /^#[0-9a-fA-F]{6}$/u.test(fields.color)) && resourceValid && roadmapValid;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !valid || planning) return;
    const editing = editingId ? byId.get(editingId) : null;
    if (editingId && !editing) return;
    const saved = editing ? await onEdit(editing, fields) : await onCreate(fields);
    if (saved) resetForm();
  }

  function beginEdit(item: SyncedLearningArea) {
    setCreating(false);
    setPlanning(false);
    setGenerated(false);
    setMenuId(null);
    setEditingId(item.record.id);
    setFields({
      name: item.record.data.name,
      description_markdown: item.record.data.description_markdown,
      area_type: item.record.data.area_type,
      icon: item.record.data.icon,
      color: item.record.data.color,
      learning_plan: { ...learningAreaPlan(item.record.data) },
    });
  }

  function resetForm() { setCreating(false); setPlanning(false); setPlannerReturnToForm(false); setGenerated(false); setEditingId(null); setFields(EMPTY_FIELDS); }
  function switchView(next: View) { setView(next); setMenuId(null); setExpandedId(null); resetForm(); }
  function setField<Key extends keyof LearningAreaFields>(key: Key, value: LearningAreaFields[Key]) {
    setFields((current) => ({ ...current, [key]: value }));
  }
  function setPlanField(key: "goal" | "next_step" | "resource_url", value: string) {
    setFields((current) => ({ ...current, learning_plan: { ...(current.learning_plan ?? EMPTY_PLAN), [key]: value } }));
  }

  function applyRoadmap(topic: string, goal: string, roadmap: LearningRoadmap) {
    setFields((current) => ({ ...current, name: topic, learning_plan: { ...(current.learning_plan ?? EMPTY_PLAN), goal, next_step: roadmap.actions[0].title, roadmap } }));
    setPlanning(false);
    setGenerated(true);
  }

  function renderForm() {
    if (planning) return <LearningPlannerForm topic={fields.name} goal={plan.goal} previous={plan.roadmap} todayDate={todayDate} disabled={draftDisabled} onGenerate={applyRoadmap} onCancel={() => { if (plannerReturnToForm) setPlanning(false); else resetForm(); }} />;
    return <form className="learning-form" id="learning-area-form" onSubmit={submit}>
      {generated ? <div className="learning-draft-notice" role="status"><strong>计划草稿已生成，尚未保存</strong><span>阶段目标、行动和用时都可修改，确认后再保存。</span></div> : null}
      {(!connection || online === false) ? <p className="learning-planner-note">草稿仅保留在当前页面，连接数据仓库并联网后可保存。</p> : null}
      <div className="learning-plan-fields">
        <label className="learning-name-field">学习方向 <span>必填</span><input autoFocus required value={fields.name} maxLength={200} onChange={(event) => setField("name", event.target.value)} placeholder="例如：英语、钢琴、数据分析" disabled={draftDisabled} /></label>
        <label className={plan.roadmap ? "learning-name-field" : undefined}>{plan.roadmap ? "希望达到的目标" : "当前目标"} <span>想做到什么 · 可选</span><textarea className="learning-short-input" value={plan.goal} maxLength={500} onChange={(event) => setPlanField("goal", event.target.value)} placeholder="例如：能读懂一篇英文短文" disabled={draftDisabled} /></label>
        {!plan.roadmap ? <label>下一步 <span>下次先做什么 · 可选</span><textarea className="learning-short-input" value={plan.next_step} maxLength={500} onChange={(event) => setPlanField("next_step", event.target.value)} placeholder="例如：读完第一段，记下 3 个生词" disabled={draftDisabled} /></label> : null}
      </div>
      {plan.roadmap ? <LearningRoadmapEditor value={plan.roadmap} disabled={draftDisabled} onChange={(roadmap) => setFields((current) => ({ ...current, learning_plan: { ...(current.learning_plan ?? EMPTY_PLAN), roadmap, next_step: roadmap.actions[0].title } }))} /> : null}
      {!roadmapValid ? <p className="learning-field-error" role="alert">请填写所有阶段和行动，每项行动至少 5 分钟，总用时不超过每周预算。</p> : null}
      <button className="text-button learning-regenerate" type="button" disabled={draftDisabled || !todayDate} onClick={() => { setPlannerReturnToForm(true); setPlanning(true); }}>{plan.roadmap ? "重新生成草稿" : "用模板生成学习计划"}</button>
      <details className="learning-settings" open={Boolean(editingId && (plan.resource_url || fields.description_markdown)) || undefined}>
        <summary>资料与笔记 <span>可选</span></summary>
        <div className="learning-material-fields">
          <label>参考链接<input type="url" value={plan.resource_url} maxLength={2048} onChange={(event) => setPlanField("resource_url", event.target.value)} placeholder="https://… 课程、文章或在线文档" aria-invalid={!resourceValid} aria-describedby={!resourceValid ? "learning-resource-error" : undefined} disabled={draftDisabled} /></label>
          {!resourceValid ? <p className="learning-field-error" id="learning-resource-error">请输入完整的 http:// 或 https:// 链接，不包含账号和密码。</p> : null}
          <label>学习笔记 <span>也可以记录资料清单与心得，支持 Markdown</span><textarea value={fields.description_markdown} maxLength={50_000} onChange={(event) => setField("description_markdown", event.target.value)} placeholder="记下今天学到的、卡住的，或下次想回看的内容。" disabled={draftDisabled} /></label>
        </div>
      </details>
      <details className="learning-settings">
        <summary>外观与分类 <span>可选</span></summary>
        <div className="learning-settings-grid">
          <label>图标<input value={fields.icon ?? ""} maxLength={32} onChange={(event) => setField("icon", event.target.value || null)} placeholder="例如：📚" disabled={draftDisabled} /></label>
          <label>颜色<div className="learning-color-field"><span aria-hidden="true" style={{ backgroundColor: fields.color && /^#[0-9a-fA-F]{6}$/u.test(fields.color) ? fields.color : "var(--accent)" }} /><input value={fields.color ?? ""} maxLength={7} pattern="#[0-9a-fA-F]{6}" onChange={(event) => setField("color", event.target.value || null)} placeholder="#62715d" disabled={draftDisabled} /></div></label>
          <label>自定义分类<input required value={fields.area_type} maxLength={64} pattern="[a-z0-9][a-z0-9_-]*" onChange={(event) => setField("area_type", event.target.value)} aria-describedby="learning-type-hint" disabled={draftDisabled} /></label>
          <p id="learning-type-hint">保留默认分类即可。自定义时使用小写字母、数字、下划线或连字符。</p>
        </div>
      </details>
      <footer><button className="secondary-button" type="button" onClick={resetForm} disabled={busy}>取消</button><button className="primary-button" type="submit" disabled={disabled || !valid}>{busy ? "保存中…" : editingId ? "保存修改" : plan.roadmap ? "保存学习计划" : "添加学习方向"}</button></footer>
    </form>;
  }

  return <section className="learning-card" aria-labelledby="learning-title" aria-busy={loading || busy}>
    <div className="card-heading">
      <div><h2 id="learning-title">学习</h2><p className="learning-subtitle">把目标拆成阶段和本周行动，一步步学下去。</p></div>
      <div className="learning-header-actions">
        <button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || loading || busy || formActive || online === false}>{loading ? "刷新中…" : "刷新"}</button>
        {view === "active" ? <><button className="secondary-button" type="button" aria-expanded={creating && !planning} aria-controls={creating ? "learning-area-form" : undefined} onClick={() => { resetForm(); setCreating(!creating); setMenuId(null); }} disabled={draftDisabled || editingId !== null || planning}><Plus size={14} aria-hidden="true" />{creating ? "收起" : "手动添加"}</button><button className="primary-button" type="button" onClick={() => { resetForm(); setCreating(true); setPlanning(true); setMenuId(null); }} disabled={draftDisabled || formActive || !todayDate}>生成计划</button></> : null}
      </div>
    </div>
    <div className="learning-toolbar">
      <div className="learning-view-actions" aria-label="学习视图">{VIEWS.map((item) => <button key={item.value} className={`view-button ${view === item.value ? "active" : ""}`} type="button" aria-pressed={view === item.value} onClick={() => switchView(item.value)} disabled={busy || formActive}>{item.label} {groups[item.value].length}</button>)}</div>
      {online === false ? <span className="learning-offline-note" role="status">当前离线，可查看已加载的学习内容</span> : null}
    </div>
    {creating ? renderForm() : null}
    {!connection ? <div className="learning-empty"><BookOpen size={24} aria-hidden="true" /><strong>给想学的事留一个位置</strong><p>连接数据仓库后，记录学习方向、目标和下一步。</p></div>
      : loading && items.length === 0 ? <p className="empty-note" role="status">正在读取学习内容…</p>
      : visible.length === 0 ? creating ? null : <div className="learning-empty"><BookOpen size={24} aria-hidden="true" /><strong>{currentView.empty}</strong><p>{currentView.hint}</p>{view === "active" && !creating ? <button className="secondary-button" type="button" onClick={() => { setCreating(true); setPlanning(true); }} disabled={draftDisabled || !todayDate}>生成第一份计划</button> : null}</div>
      : <ol className="learning-list">{visible.map((item) => {
        const itemPlan = learningAreaPlan(item.record.data);
        const expanded = expandedId === item.record.id;
        const editable = view === "active" || view === "on_hold";
        return <li key={item.record.id} className={itemPlan.roadmap ? "learning-planned-item" : undefined}>
          {editingId === item.record.id ? <div className="learning-inline-edit"><h3>编辑 · {item.record.data.name}</h3>{renderForm()}</div> : <>
            <span className="learning-area-icon" aria-hidden="true" style={{ borderColor: item.record.data.color ?? undefined }}>{item.record.data.icon || <BookOpen size={18} />}</span>
            <div className="learning-area-content">
              <button className="learning-title-button" type="button" aria-expanded={expanded} aria-controls={expanded ? `learning-detail-${item.record.id}` : undefined} onClick={() => setExpandedId(expanded ? null : item.record.id)}>{item.record.data.name}<ChevronDown size={14} aria-hidden="true" /></button>
              {itemPlan.roadmap ? <LearningRoadmapSummary value={itemPlan.roadmap} goal={itemPlan.goal} todayDate={todayDate} /> : <div className="learning-plan-summary">
                <p><span>当前目标</span>{itemPlan.goal || <em>还没设定，慢慢想也可以</em>}</p>
                <p className="learning-next-step"><span>下一步</span>{itemPlan.next_step || (editable ? <button className="text-button" type="button" disabled={disabled || formActive} onClick={() => beginEdit(item)}>写下一个小行动</button> : <em>暂未记录</em>)}</p>
              </div>}
            </div>
            <button type="button" className="learning-icon-button" aria-label={`管理${item.record.data.name}`} aria-expanded={menuId === item.record.id} aria-controls={menuId === item.record.id ? `learning-menu-${item.record.id}` : undefined} title="管理学习" disabled={disabled || formActive} onClick={() => setMenuId(menuId === item.record.id ? null : item.record.id)}><MoreHorizontal size={18} aria-hidden="true" /></button>
            {expanded ? <div id={`learning-detail-${item.record.id}`} className="learning-detail">
              <div className="learning-resource"><h3>参考资料</h3>{itemPlan.resource_url.trim() && isLearningResourceUrl(itemPlan.resource_url) ? <a href={itemPlan.resource_url} target="_blank" rel="noopener noreferrer">{new URL(itemPlan.resource_url.trim()).hostname}<ArrowUpRight size={14} aria-hidden="true" /><span className="learning-sr-only">（在新标签页打开）</span></a> : <p>把常用的课程、文章或文档链接放在这里。</p>}</div>
              <div className="learning-notes"><h3>学习笔记</h3>{item.record.data.description_markdown ? <pre>{item.record.data.description_markdown}</pre> : <p>学到的、卡住的、想回看的，都可以记下来。</p>}</div>
              {editable ? <button className="text-button" type="button" disabled={disabled || formActive} onClick={() => beginEdit(item)}>编辑学习内容</button> : null}
            </div> : null}
            {menuId === item.record.id ? <div id={`learning-menu-${item.record.id}`} className="learning-manage-bar" aria-label={`管理${item.record.data.name}`}>
              <span>{item.record.data.name}</span><div className="learning-item-actions">
                {editable ? <><button className="text-button" type="button" onClick={() => beginEdit(item)} disabled={disabled}>编辑</button><button className="text-button" type="button" onClick={() => { onStatusChange(item, view === "on_hold" ? "active" : "on_hold"); setMenuId(null); }} disabled={disabled}>{view === "on_hold" ? "继续学习" : "暂停学习"}</button><button className="text-button" type="button" onClick={() => { onStatusChange(item, "archived"); setMenuId(null); }} disabled={disabled}>归档</button></> : view === "archived" ? <button className="text-button" type="button" onClick={() => { onStatusChange(item, "active"); setMenuId(null); }} disabled={disabled}>继续学习</button> : null}
                <button className={`text-button ${view !== "trash" ? "learning-destructive-button" : ""}`} type="button" onClick={() => { onDeletionChange(item, view === "trash" ? "restore" : "trash"); setMenuId(null); }} disabled={disabled}>{view === "trash" ? "恢复" : "移到回收站"}</button>
                <button className="text-button" type="button" onClick={() => setMenuId(null)}>收起</button>
              </div>
            </div> : null}
          </>}
        </li>;
      })}</ol>}
  </section>;
}
