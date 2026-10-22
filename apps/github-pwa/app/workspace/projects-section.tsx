"use client";

import { useState, type FormEvent } from "react";
import { ArrowUpRight, CheckCircle2, ChevronRight, Circle, FolderKanban, MoreHorizontal, Plus, RefreshCw, Search, Target } from "lucide-react";

import styles from "../workbench.module.css";
import "./projects.css";
import { calendarEventsForProject } from "../../../../src/lib/github-data/calendar-projects";
import { formatCalendarTime } from "./calendar-presentation";
import { projectProgress, projectDueLabel, projectNeedsAttention, projectTasks, filterProjectList, type ProjectSort } from "./projects-presentation";

import { type ProjectEditableFields, type ProjectProgressMode } from "../../../../src/lib/github-data/projects";
import { phasesForProject } from "../../../../src/lib/github-data/project-phases";
import { milestonesForProject } from "../../../../src/lib/github-data/milestones";
import { projectNotesForProject, type ProjectNoteEditableFields } from "../../../../src/lib/github-data/project-notes";
import { projectFileReferences, type ProjectFileReferenceFields } from "../../../../src/lib/github-data/project-file-references";
import { activityEventsForProject } from "../../../../src/lib/github-data/activity-events";
import type { Connection, SyncedCalendarEvent, SyncedActivityEvent, SyncedMilestone, SyncedProject, SyncedProjectFileReference, SyncedProjectNote, SyncedProjectPhase, SyncedTask } from "./page-model";

type Props = {
  connection: Connection | null;
  online: boolean | null;
  projectName: string;
  projectTargetDate: string;
  projectFiles: SyncedProject[];
  projectPhaseFiles: SyncedProjectPhase[];
  milestoneFiles: SyncedMilestone[];
  projectNoteFiles: SyncedProjectNote[];
  projectFileReferenceFiles: SyncedProjectFileReference[];
  activityEventFiles: SyncedActivityEvent[];
  currentProjectFiles: SyncedProject[];
  completedProjectFiles: SyncedProject[];
  cancelledProjectFiles: SyncedProject[];
  archivedProjectFiles: SyncedProject[];
  trashedProjectFiles: SyncedProject[];
  visibleProjectFiles: SyncedProject[];
  projectView: "current" | "completed" | "cancelled" | "archived" | "trash";
  taskFiles: SyncedTask[];
  calendarEventFiles: SyncedCalendarEvent[];
  loadingCalendarEvents: boolean;
  focusRequest?: { projectId: string } | null;
  onOpenCalendar: (projectId: string, date?: string) => void;
  onOpenReport: (projectId: string) => void;
  loadingProjects: boolean;
  loadingTasks: boolean;
  onOpenTasks: (projectId: string) => void;
  loadingProjectPhases: boolean;
  loadingMilestones: boolean;
  loadingProjectNotes: boolean;
  loadingProjectFileReferences: boolean;
  loadingActivityEvents: boolean;
  savingProject: boolean;
  savingProjectId: string | null;
  savingProjectPhaseProjectId: string | null;
  savingMilestoneProjectId: string | null;
  savingMilestoneId: string | null;
  savingProjectNoteProjectId: string | null;
  savingProjectNoteId: string | null;
  savingProjectFileReferenceProjectId: string | null;
  currentDate: string;
  onProjectNameChange: (value: string) => void;
  onProjectTargetDateChange: (value: string) => void;
  onCreateProject: (event: FormEvent<HTMLFormElement>) => Promise<string | null>;
  onProjectViewChange: (value: "current" | "completed" | "cancelled" | "archived" | "trash") => void;
  onLifecycleChange: (item: SyncedProject, operation: "pause" | "resume" | "complete" | "reopen" | "cancel" | "archive") => void;
  onDeletionChange: (item: SyncedProject, operation: "trash" | "restore") => void;
  onEditProject: (item: SyncedProject, details: ProjectEditableFields) => Promise<boolean>;
  onCreatePhase: (project: SyncedProject, name: string) => Promise<boolean>;
  onSetCurrentPhase: (project: SyncedProject, phase: SyncedProjectPhase) => void;
  onCreateMilestone: (project: SyncedProject, title: string, targetDate: string) => Promise<boolean>;
  onMilestoneLifecycle: (item: SyncedMilestone, operation: "complete" | "reopen" | "cancel") => void;
  onCreateProjectNote: (project: SyncedProject, details: ProjectNoteEditableFields) => Promise<boolean>;
  onEditProjectNote: (item: SyncedProjectNote, details: ProjectNoteEditableFields) => Promise<boolean>;
  onCreateProjectFileReference: (project: SyncedProject, fields: ProjectFileReferenceFields) => Promise<boolean>;
  onRefresh: () => void;
};

export function ProjectsSection(props: Props) {
  const {
    connection, online, projectName, projectTargetDate, projectFiles, projectPhaseFiles, milestoneFiles, projectNoteFiles, projectFileReferenceFiles, activityEventFiles, currentProjectFiles,
    completedProjectFiles, cancelledProjectFiles, archivedProjectFiles, trashedProjectFiles,
    visibleProjectFiles, projectView, taskFiles, calendarEventFiles, loadingCalendarEvents, focusRequest = null, onOpenCalendar, onOpenReport, loadingProjects, loadingTasks, onOpenTasks, loadingProjectPhases, loadingMilestones, loadingProjectNotes, loadingProjectFileReferences, loadingActivityEvents, savingProject, savingProjectId, savingProjectPhaseProjectId,
    savingMilestoneProjectId, savingMilestoneId, savingProjectNoteProjectId, savingProjectNoteId, savingProjectFileReferenceProjectId, currentDate,
    onProjectNameChange, onProjectTargetDateChange, onCreateProject, onProjectViewChange,
    onLifecycleChange, onDeletionChange, onEditProject, onCreatePhase, onSetCurrentPhase, onCreateMilestone, onMilestoneLifecycle,
    onCreateProjectNote, onEditProjectNote, onCreateProjectFileReference, onRefresh,
  } = props;
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [panel, setPanel] = useState<"overview" | "tasks" | "calendar" | "phases" | "milestones" | "notes" | "files" | "activity">("overview");
  const [seenFocusRequest, setSeenFocusRequest] = useState<typeof focusRequest>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProjectSort>("target");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const filteredProjects = filterProjectList(visibleProjectFiles, query, sort, attentionOnly, currentDate);
  const selectedProject = filteredProjects.find((item) => item.record.id === selectedProjectId) ?? filteredProjects[0];
  const phaseProjectId = panel === "phases" ? selectedProject?.record.id : null;
  const milestoneProjectId = panel === "milestones" ? selectedProject?.record.id : null;
  const noteProjectId = panel === "notes" ? selectedProject?.record.id : null;
  const activityProjectId = panel === "activity" ? selectedProject?.record.id : null;
  const fileProjectId = panel === "files" ? selectedProject?.record.id : null;
  const readOnly = projectView === "archived" || projectView === "trash";
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editTargetDate, setEditTargetDate] = useState("");
  const [editProgressMode, setEditProgressMode] = useState<ProjectProgressMode>("tasks");
  const [phaseName, setPhaseName] = useState("");
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneTargetDate, setMilestoneTargetDate] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [noteDate, setNoteDate] = useState(currentDate);
  const [editingProjectNoteId, setEditingProjectNoteId] = useState<string | null>(null);
  const [editNoteTitle, setEditNoteTitle] = useState("");
  const [editNoteBody, setEditNoteBody] = useState("");
  const [editNoteDate, setEditNoteDate] = useState("");
  const [fileTitle, setFileTitle] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [filePurpose, setFilePurpose] = useState("");
  const projectOperationBusy = savingProject || savingProjectId !== null || savingProjectPhaseProjectId !== null || savingMilestoneProjectId !== null || savingMilestoneId !== null || savingProjectNoteProjectId !== null || savingProjectNoteId !== null || savingProjectFileReferenceProjectId !== null;
  const projectFormActive = editingProjectId !== null || editingProjectNoteId !== null
    || Boolean(phaseProjectId && phaseName.trim())
    || Boolean(milestoneProjectId && (milestoneTitle.trim() || milestoneTargetDate))
    || Boolean(noteProjectId && (noteTitle.trim() || noteBody.trim()))
    || Boolean(fileProjectId && (fileTitle.trim() || fileUrl.trim() || filePurpose.trim()));
  const projectBusy = projectOperationBusy || projectFormActive;
  if (focusRequest && focusRequest !== seenFocusRequest && !projectBusy) {
    setSeenFocusRequest(focusRequest);
    setSelectedProjectId(focusRequest.projectId);
    setQuery(""); setAttentionOnly(false); resetPanel();
  }
  const projectWriteDisabled = !connection || online === false || projectOperationBusy || loadingProjects || readOnly;
  const views = [
    { value: "current", label: "进行中", count: currentProjectFiles.length },
    { value: "completed", label: "已完成", count: completedProjectFiles.length },
    { value: "cancelled", label: "已取消", count: cancelledProjectFiles.length },
    { value: "archived", label: "已归档", count: archivedProjectFiles.length },
    { value: "trash", label: "回收站", count: trashedProjectFiles.length },
  ] as const;
  const attentionCount = currentProjectFiles.filter((item) => projectNeedsAttention(item, currentDate)).length;

  function resetPanel() {
    setPanel("overview");
    setEditingProjectId(null);
    setEditingProjectNoteId(null);
    setPhaseName(""); setMilestoneTitle(""); setMilestoneTargetDate("");
    setNoteTitle(""); setNoteBody(""); setNoteDate(currentDate);
    setFileTitle(""); setFileUrl(""); setFilePurpose("");
  }

  function switchView(value: Props["projectView"]) {
    resetPanel(); setSelectedProjectId(null); setAttentionOnly(false);
    onProjectViewChange(value);
  }

  function beginEdit(item: SyncedProject) {
    resetPanel();
    setEditingProjectId(item.record.id);
    setEditName(item.record.data.name);
    setEditDescription(item.record.data.description_markdown);
    setEditStartDate(item.record.data.start_date ?? "");
    setEditTargetDate(item.record.data.target_date ?? "");
    setEditProgressMode(item.record.data.progress_mode);
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connection || online === false || projectBusy || !projectName.trim()) return;
    const id = await onCreateProject(event);
    if (id) {
      resetPanel(); setSelectedProjectId(id); setQuery(""); setAttentionOnly(false); setCreating(false);
    }
  }

  async function submitProjectFileReference(event: FormEvent<HTMLFormElement>, item: SyncedProject) {
    event.preventDefault();
    if (!fileTitle.trim() || !fileUrl.trim() || projectWriteDisabled) return;
    const existing = projectFileReferences(item.record.id, projectFileReferenceFiles.map((file) => file.record));
    const saved = await onCreateProjectFileReference(item, {
      title: fileTitle,
      source_url: fileUrl,
      original_filename: null,
      mime_type: null,
      size_bytes: null,
      sha256: null,
      purpose: filePurpose,
      sort_order: existing.length * 10 + 10,
    });
    if (saved) {
      setFileTitle("");
      setFileUrl("");
      setFilePurpose("");
    }
  }

  function beginNoteEdit(item: SyncedProjectNote) {
    setEditingProjectNoteId(item.record.id);
    setEditNoteTitle(item.record.data.title);
    setEditNoteBody(item.record.data.body_markdown);
    setEditNoteDate(item.record.data.note_date);
  }

  async function submitPhase(event: FormEvent<HTMLFormElement>, item: SyncedProject) {
    event.preventDefault();
    if (!phaseName.trim() || projectWriteDisabled) return;
    const saved = await onCreatePhase(item, phaseName);
    if (saved) setPhaseName("");
  }

  async function submitMilestone(event: FormEvent<HTMLFormElement>, item: SyncedProject) {
    event.preventDefault();
    if (!milestoneTitle.trim() || projectWriteDisabled) return;
    const saved = await onCreateMilestone(item, milestoneTitle, milestoneTargetDate);
    if (saved) {
      setMilestoneTitle("");
      setMilestoneTargetDate("");
    }
  }

  async function submitProjectNote(event: FormEvent<HTMLFormElement>, item: SyncedProject) {
    event.preventDefault();
    if (!noteTitle.trim() || !noteDate || projectWriteDisabled) return;
    const saved = await onCreateProjectNote(item, { title: noteTitle, body_markdown: noteBody, note_date: noteDate });
    if (saved) {
      setNoteTitle("");
      setNoteBody("");
      setNoteDate(currentDate);
    }
  }

  async function submitProjectNoteEdit(event: FormEvent<HTMLFormElement>, item: SyncedProjectNote) {
    event.preventDefault();
    if (!editNoteTitle.trim() || !editNoteDate || projectWriteDisabled) return;
    const saved = await onEditProjectNote(item, { title: editNoteTitle, body_markdown: editNoteBody, note_date: editNoteDate });
    if (saved) setEditingProjectNoteId(null);
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>, item: SyncedProject) {
    event.preventDefault();
    if (!editName.trim() || projectWriteDisabled) return;
    const saved = await onEditProject(item, {
      name: editName,
      description_markdown: editDescription,
      start_date: editStartDate || null,
      target_date: editTargetDate || null,
      progress_mode: editProgressMode,
    });
    if (saved) setEditingProjectId(null);
  }

  return (
    <section className={`${styles.scope} projects-card projects-workspace`} aria-labelledby="projects-title">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Projects</p>
          <h2 id="projects-title">项目</h2>
          <p className="projects-subtitle">把想做的事，推进成看得见的成果。</p>
        </div>
        <div className="projects-header-actions">
          <button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || online === false || loadingProjects || projectBusy} aria-label="刷新项目"><RefreshCw size={14} className={loadingProjects ? "projects-spinning" : ""} />{loadingProjects ? "刷新中…" : "刷新"}</button>
          <button className="primary-button" type="button" onClick={() => setCreating(!creating)} aria-expanded={creating} aria-controls="project-create" disabled={!connection || online === false || loadingProjects || projectBusy}><Plus size={15} />新建项目</button>
        </div>
      </div>

      <div className="projects-summary" aria-label="项目概况">
        <div><span>正在推进</span><strong>{connection ? currentProjectFiles.filter((item) => item.record.data.status !== "on_hold").length : "—"}</strong><small>专注当下的目标</small></div>
        <div><span>需要关注</span><strong>{connection ? attentionCount : "—"}</strong><small>已过目标日期的项目</small></div>
        <div><span>暂时搁置</span><strong>{connection ? currentProjectFiles.filter((item) => item.record.data.status === "on_hold").length : "—"}</strong><small>准备好时再继续</small></div>
        <div><span>已经完成</span><strong>{connection ? completedProjectFiles.length : "—"}</strong><small>每一步都算数</small></div>
      </div>
      {online === false ? <p className="projects-inline-note" role="status">当前离线，可查看已加载的项目；联网后可继续编辑。</p> : null}
      {creating ? <form id="project-create" className="project-create-form" onSubmit={submitCreate}>
        <label>项目名称<input value={projectName} onChange={(event) => onProjectNameChange(event.target.value)} maxLength={300} autoFocus required placeholder="你想完成什么？" disabled={!connection || projectBusy || online === false} /></label>
        <label>目标日期 · 可选<input type="date" value={projectTargetDate} onChange={(event) => onProjectTargetDateChange(event.target.value)} disabled={!connection || projectBusy || online === false} /></label>
        <div className="projects-create-actions"><button className="primary-button" type="submit" disabled={!connection || !projectName.trim() || projectBusy || online === false}>{savingProject ? "保存中…" : "创建项目"}</button><button className="secondary-button" type="button" onClick={() => setCreating(false)} disabled={savingProject}>收起</button></div>
        <p>先写个名字就能开始，说明、阶段和里程碑可以慢慢补充。</p>
      </form> : null}

      <div className="projects-toolbar">
        <div className="project-view-actions" aria-label="项目状态">{views.map((view) => <button key={view.value} className={`view-button ${projectView === view.value ? "active" : ""}`} type="button" aria-pressed={projectView === view.value} onClick={() => switchView(view.value)} disabled={projectBusy}>{view.label}<span>{view.count}</span></button>)}</div>
        <div className="projects-search-controls">
          <label className="projects-search"><Search size={14} /><input type="search" aria-label="搜索项目" placeholder="搜索项目…" value={query} onChange={(event) => { setQuery(event.target.value); resetPanel(); }} disabled={projectBusy} /></label>
          <select aria-label="项目排序" value={sort} onChange={(event) => setSort(event.target.value as ProjectSort)} disabled={projectBusy}><option value="target">目标日期</option><option value="updated">最近更新</option><option value="name">项目名称</option></select>
        </div>
      </div>
      {projectView === "current" && attentionCount > 0 ? <button className={`projects-attention-filter ${attentionOnly ? "active" : ""}`} type="button" aria-pressed={attentionOnly} onClick={() => { setAttentionOnly(!attentionOnly); resetPanel(); }} disabled={projectBusy}>仅看需要关注的项目 · {attentionCount}</button> : null}

      {!connection ? <div className="projects-empty"><FolderKanban size={30} strokeWidth={1.4} /><strong>给重要的事，一个推进的空间</strong><p>连接数据仓库后，从一个项目开始。任务、里程碑和笔记都能在这里汇合。</p></div>
        : loadingProjects && projectFiles.length === 0 ? <div className="projects-empty" role="status"><RefreshCw size={24} className="projects-spinning" /><strong>正在读取项目…</strong></div>
          : filteredProjects.length === 0 ? <div className="projects-empty"><FolderKanban size={30} strokeWidth={1.4} /><strong>{query || attentionOnly ? "没有找到匹配的项目" : ({ current: "从一个想完成的目标开始", completed: "完成的项目会留在这里", cancelled: "还没有已取消的项目", archived: "让告一段落的项目安静留存", trash: "回收站是空的" })[projectView]}</strong><p>{query || attentionOnly ? "试试其他关键词，或清除筛选。" : projectView === "current" ? "不必一次想清所有细节，先写下你想做的事。" : "切换上方状态，继续查看你的项目。"}</p>{query || attentionOnly ? <button className="secondary-button" type="button" onClick={() => { setQuery(""); setAttentionOnly(false); }}>清除筛选</button> : projectView === "current" ? <button className="secondary-button" type="button" onClick={() => setCreating(true)} disabled={online === false}><Plus size={14} />创建第一个项目</button> : null}</div>
            : <div className="projects-browser">
              <aside className="projects-directory" aria-label="项目列表">
                <div className="projects-directory-heading"><span>{views.find((view) => view.value === projectView)?.label}</span><span>{filteredProjects.length} 个项目</span></div>
                <ul>{filteredProjects.map((item) => {
                  const progress = projectProgress(item, taskFiles, milestoneFiles);
                  const progressLoading = item.record.data.progress_mode === "tasks" ? loadingTasks : item.record.data.progress_mode === "milestones" ? loadingMilestones : false;
                  const selected = selectedProject?.record.id === item.record.id;
                  return <li key={item.record.id}><button className={`projects-directory-item ${selected ? "selected" : ""}`} type="button" aria-pressed={selected} aria-controls="project-detail" onClick={() => { resetPanel(); setSelectedProjectId(item.record.id); }} disabled={projectBusy}>
                    <span className="projects-directory-name"><FolderKanban size={16} /><strong>{item.record.data.name}</strong><ChevronRight size={14} /></span>
                    <span className="projects-directory-meta"><span className={`project-status status-${item.record.data.status}`}>{projectStatusLabel(item.record.data.status)}</span><span className={projectNeedsAttention(item, currentDate) ? "projects-overdue" : ""}>{projectDueLabel(item, currentDate)}</span></span>
                    <span className="projects-directory-progress"><span><i style={{ width: `${progress.percent}%` }} /></span><small>{progressLoading ? "…" : `${progress.percent}%`}</small></span>
                  </button></li>;
                })}</ul>
              </aside>
              <ul className="project-list projects-detail-list" id="project-detail">{(selectedProject ? [selectedProject] : []).map((item) => {
              const progress = projectProgress(item, taskFiles, milestoneFiles);
                  const progressLoading = item.record.data.progress_mode === "tasks" ? loadingTasks : item.record.data.progress_mode === "milestones" ? loadingMilestones : false;
              const progressSource = item.record.data.progress_mode === "milestones" ? "按里程碑权重" : item.record.data.progress_mode === "manual" ? "手动进度" : "按关联任务";
              const progressDetail = item.record.data.progress_mode === "manual" ? `${progress.percent}%` : `已完成 ${progress.completed} / ${progress.total}`;
              const relatedTasks = projectTasks(item.record.id, taskFiles);
              const linkedEvents = calendarEventsForProject(item.record.id, calendarEventFiles.map((event) => event.record), taskFiles.map((task) => task.record));
              const upcomingEvents = linkedEvents.filter((event) => event.data.local_end_date >= currentDate && !event.data.completed);
              const openTasks = relatedTasks.filter((task) => task.record.data.status !== "done");
              const phases = syncedPhasesForProject(projectPhaseFiles, item.record.id);
              const milestones = syncedMilestonesForProject(milestoneFiles, item.record.id);
              const projectNotes = syncedProjectNotesForProject(projectNoteFiles, item.record.id);
              const activities = syncedActivityEventsForProject(activityEventFiles, item.record.id);
              const currentPhase = phases.find((phase) => phase.record.id === item.record.data.current_phase_id);
              return <li key={item.record.id}>
                <div className="project-content">
                  <header className="projects-detail-header">
                    <div><span className={`project-status status-${item.record.data.status}`}>{projectStatusLabel(item.record.data.status)}</span><h3>{item.record.data.name}</h3><p>{formatProjectDates(item)}</p></div>
                    <div className="projects-detail-actions">
                      {projectView === "trash" ? <button className="secondary-button" type="button" onClick={() => onDeletionChange(item, "restore")} disabled={!connection || projectBusy || online === false}>恢复项目</button> : <>
                        {!readOnly ? <button className="secondary-button" type="button" onClick={() => beginEdit(item)} disabled={projectBusy || online === false}>编辑项目</button> : null}
                        <details className="projects-more"><summary aria-label="更多项目操作"><MoreHorizontal size={18} /></summary><div>
                          {projectView === "current" ? <>
                            <button className="text-button" type="button" onClick={() => onLifecycleChange(item, item.record.data.status === "on_hold" ? "resume" : "pause")} disabled={projectBusy || online === false}>{item.record.data.status === "on_hold" ? "恢复进行" : "暂停项目"}</button>
                            <button className="text-button" type="button" onClick={() => onLifecycleChange(item, "complete")} disabled={projectBusy || online === false}>完成项目</button>
                            <button className="text-button project-destructive-button" type="button" onClick={() => onLifecycleChange(item, "cancel")} disabled={projectBusy || online === false}>取消项目</button>
                          </> : <button className="text-button" type="button" onClick={() => onLifecycleChange(item, "reopen")} disabled={projectBusy || online === false}>重新打开</button>}
                          {!readOnly ? <button className="text-button" type="button" onClick={() => onLifecycleChange(item, "archive")} disabled={projectBusy || online === false}>归档项目</button> : null}
                          <button className="text-button project-destructive-button" type="button" onClick={() => onDeletionChange(item, "trash")} disabled={projectBusy || online === false}>移到回收站</button>
                        </div></details>
                      </>}
                    </div>
                  </header>
                  {editingProjectId === item.record.id ? <form className="project-edit-form" onSubmit={(event) => submitEdit(event, item)}>
                    <label className="project-edit-name">项目名称
                      <input value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={300} autoFocus disabled={savingProjectId === item.record.id} />
                    </label>
                    <label>开始日期
                      <input type="date" value={editStartDate} onChange={(event) => setEditStartDate(event.target.value)} onInput={(event) => setEditStartDate(event.currentTarget.value)} disabled={savingProjectId === item.record.id} />
                    </label>
                    <label>目标日期
                      <input type="date" value={editTargetDate} onChange={(event) => setEditTargetDate(event.target.value)} onInput={(event) => setEditTargetDate(event.currentTarget.value)} disabled={savingProjectId === item.record.id} />
                    </label>
                    <label>进度口径
                      <select value={editProgressMode} onChange={(event) => setEditProgressMode(event.target.value as ProjectProgressMode)} disabled={savingProjectId === item.record.id}>
                        <option value="tasks">关联任务</option>
                        <option value="milestones">里程碑权重</option>
                        {editProgressMode === "manual" ? <option value="manual" disabled>手动（暂不开放编辑）</option> : null}
                      </select>
                    </label>
                    <label className="project-edit-description">项目说明
                      <textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={50000} rows={5} placeholder="目标、边界、验收标准…" disabled={savingProjectId === item.record.id} />
                    </label>
                    <div className="project-edit-actions">
                      <button className="primary-button" type="submit" disabled={!editName.trim() || Boolean(savingProjectId) || online === false}>{savingProjectId === item.record.id ? "保存中…" : "保存修改"}</button>
                      <button className="secondary-button" type="button" onClick={() => setEditingProjectId(null)} disabled={savingProjectId === item.record.id}>放弃修改</button>
                    </div>
                  </form> : <>
                    <div className="projects-detail-nav" aria-label="项目内容">{([
                      ["overview", "概览"], ["tasks", `任务 ${relatedTasks.length}`], ["calendar", `日程 ${linkedEvents.length}`], ["phases", "阶段"], ["milestones", `里程碑 ${milestones.length}`], ["notes", `笔记 ${projectNotes.length}`], ["files", "资料"], ["activity", "动态"],
                    ] as const).map(([value, label]) => <button key={value} className={panel === value ? "active" : ""} type="button" aria-pressed={panel === value} onClick={() => { resetPanel(); setPanel(value); }} disabled={projectBusy}>{label}</button>)}</div>
                    {projectFormActive ? <p className="projects-inline-note">完成或收起当前编辑后，可切换项目和内容。</p> : null}
                    {panel === "overview" ? <div className="projects-overview">
                      <div className="projects-progress-section"><div><span>项目进度</span><strong>{progressLoading ? "读取中…" : `${progress.percent}%`}</strong></div><div className="project-progress" role="progressbar" aria-label={progressSource} aria-valuenow={progressLoading ? undefined : progress.percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress.percent}%` }} /></div><small>{progressLoading ? "正在读取进度依据…" : `${progressSource} · ${progressDetail}`}</small></div>
                      <div className="projects-facts"><div><span>当前阶段</span><strong>{loadingProjectPhases ? "读取中…" : currentPhase?.record.data.name ?? "尚未设置"}</strong></div><div><span>目标日期</span><strong className={projectNeedsAttention(item, currentDate) ? "projects-overdue" : ""}>{projectDueLabel(item, currentDate)}</strong></div></div>
                      <section className="projects-description"><h4>项目说明</h4>{item.record.data.description_markdown ? <p>{item.record.data.description_markdown}</p> : <p className="projects-placeholder">想达成什么？怎样才算完成？可以在「编辑项目」里慢慢补充。</p>}</section>
                      <section className="projects-next"><div className="projects-section-heading"><h4>下一步</h4><button className="text-button" type="button" onClick={() => setPanel("tasks")}>查看任务<ArrowUpRight size={13} /></button></div>{loadingTasks ? <p>正在读取关联任务…</p> : openTasks.length > 0 ? <ul>{openTasks.slice(0, 3).map((task) => <li key={task.record.id}><Circle size={14} /><span>{task.record.data.title}</span><small>{task.record.data.status === "blocked" ? "受阻" : task.record.data.status === "in_progress" ? "进行中" : "待办"}</small></li>)}</ul> : <p>{relatedTasks.length ? "关联任务已全部完成。" : "把项目拆成一个小行动，下一次就更容易开始。"}</p>}</section>
                      <section className="projects-milestone-preview"><div className="projects-section-heading"><h4><Target size={14} />里程碑</h4><button className="text-button" type="button" onClick={() => setPanel("milestones")}>查看<ArrowUpRight size={13} /></button></div>{loadingMilestones ? <p>正在读取里程碑…</p> : milestones.length ? <ul>{milestones.slice(0, 3).map((milestone) => <li key={milestone.record.id}>{milestone.record.data.status === "completed" ? <CheckCircle2 size={14} /> : <Target size={14} />}<span>{milestone.record.data.title}</span><small>{milestoneStatusLabel(milestone.record.data.status)}{milestone.record.data.target_date ? ` · ${milestone.record.data.target_date.slice(5).replace("-", "/")}` : ""}</small></li>)}</ul> : <p>用一个关键节点，标记值得期待的进展。</p>}</section>
                      <section className="projects-calendar-preview"><div className="projects-section-heading"><h4>接下来的日程</h4><button className="text-button" type="button" onClick={() => setPanel("calendar")}>查看日程<ArrowUpRight size={13} /></button></div>{loadingCalendarEvents ? <p>正在读取关联日程…</p> : upcomingEvents.length ? <ul>{upcomingEvents.slice(0, 3).map((event) => <li key={event.id}><span>{event.data.local_start_date.slice(5).replace("-", "/")}</span><button className="text-button" type="button" onClick={() => onOpenCalendar(item.record.id, event.data.local_start_date)}>{event.data.title}<ArrowUpRight size={12} /></button><small>{event.data.all_day ? "全天" : formatCalendarTime(event.data.start_at, event.data.end_at, event.data.timezone)}</small></li>)}</ul> : <p>还没有后续安排，可以在日程里为项目留一段时间。</p>}</section>
                      <div className="projects-report-entry"><span>把项目进展汇入周报与月报</span><button className="secondary-button" type="button" onClick={() => onOpenReport(item.record.id)}>查看项目报告<ArrowUpRight size={13} /></button></div>
                    </div> : null}
                    {panel === "tasks" ? <section className="projects-linked-tasks"><div className="projects-section-heading"><h4>关联任务</h4><button className="secondary-button" type="button" onClick={() => onOpenTasks(item.record.id)}>前往任务清单<ArrowUpRight size={13} /></button></div><p className="projects-inline-note">在任务清单中选择此项目，即可关联新任务。</p>{loadingTasks ? <p>正在读取关联任务…</p> : relatedTasks.length ? <ul>{relatedTasks.map((task) => <li key={task.record.id}>{task.record.data.status === "done" ? <CheckCircle2 size={15} /> : <Circle size={15} />}<span className={task.record.data.status === "done" ? "projects-task-done" : ""}>{task.record.data.title}</span><small>{({ inbox: "待整理", todo: "待办", in_progress: "进行中", blocked: "受阻", done: "已完成", cancelled: "已取消", archived: "已归档" })[task.record.data.status]}</small></li>)}</ul> : <div className="projects-empty projects-small-empty"><Circle size={24} /><strong>从一个小行动开始</strong><p>前往任务清单创建任务，项目会自动汇总完成进度。</p></div>}</section> : null}
                    {panel === "calendar" ? <section className="projects-linked-calendar"><div className="projects-section-heading"><h4>关联日程</h4><button className="secondary-button" type="button" onClick={() => onOpenCalendar(item.record.id)}>前往日程安排<ArrowUpRight size={13} /></button></div><p className="projects-inline-note">日程中选择此项目，安排和完成记录会汇集到这里，也可按项目生成报告。</p>{loadingCalendarEvents ? <p>正在读取关联日程…</p> : linkedEvents.length ? <ul>{linkedEvents.map((event) => <li key={event.id}><div><strong>{event.data.title}</strong><small>{event.data.local_start_date} · {event.data.all_day ? "全天" : formatCalendarTime(event.data.start_at, event.data.end_at, event.data.timezone)} · {event.data.completed ? "已完成" : "已安排"}</small></div><button className="text-button" type="button" onClick={() => onOpenCalendar(item.record.id, event.data.local_start_date)}>在日程中查看<ArrowUpRight size={13} /></button></li>)}</ul> : <div className="projects-empty projects-small-empty"><Target size={24} /><strong>为项目留出推进的时间</strong><p>在日程中选择所属项目，会议、行动和时间块都能关联回来。</p></div>}</section> : null}
                    {phaseProjectId === item.record.id ? <div className="project-phase-manager">
                      {!readOnly ? <form onSubmit={(event) => submitPhase(event, item)}>
                        <label>新阶段名称
                          <input value={phaseName} onChange={(event) => setPhaseName(event.target.value)} maxLength={300} autoFocus placeholder="例如：开发与验收" disabled={projectWriteDisabled} />
                        </label>
                        <button className="primary-button" type="submit" disabled={!phaseName.trim() || projectWriteDisabled}>{savingProjectPhaseProjectId === item.record.id ? "保存中…" : "创建阶段"}</button>
                        <button className="secondary-button" type="button" onClick={() => { resetPanel(); }} disabled={projectOperationBusy}>返回概览</button>
                      </form> : <p className="projects-inline-note">当前项目仅供查看；恢复后可继续编辑。</p>}
                      {loadingProjectPhases ? <small>正在读取阶段…</small>
                        : phases.length === 0 ? <small>还没有阶段；创建后可单独设为当前阶段。</small>
                          : <ul>{phases.map((phase) => <li key={phase.record.id}>
                            <span><strong>{phase.record.data.name}</strong><small>顺序 {phase.record.data.sort_order} · {phase.record.data.status}</small></span>
                            {item.record.data.current_phase_id === phase.record.id
                              ? <em>当前阶段</em>
                              : <button className="text-button" type="button" onClick={() => onSetCurrentPhase(item, phase)} disabled={projectWriteDisabled}>设为当前</button>}
                          </li>)}</ul>}
                    </div> : null}
                    {milestoneProjectId === item.record.id ? <div className="project-milestone-manager">
                      {!readOnly ? <form onSubmit={(event) => submitMilestone(event, item)}>
                        <label>里程碑标题
                          <input value={milestoneTitle} onChange={(event) => setMilestoneTitle(event.target.value)} maxLength={300} autoFocus placeholder="例如：完成正式页面验收" disabled={projectWriteDisabled} />
                        </label>
                        <label>目标日期
                          <input type="date" value={milestoneTargetDate} onChange={(event) => setMilestoneTargetDate(event.target.value)} onInput={(event) => setMilestoneTargetDate(event.currentTarget.value)} disabled={projectWriteDisabled} />
                        </label>
                        <button className="primary-button" type="submit" disabled={!milestoneTitle.trim() || projectWriteDisabled}>{savingMilestoneProjectId === item.record.id ? "保存中…" : "创建里程碑"}</button>
                        <button className="secondary-button" type="button" onClick={() => { resetPanel(); }} disabled={projectOperationBusy}>返回概览</button>
                      </form> : <p className="projects-inline-note">当前项目仅供查看；恢复后可继续编辑。</p>}
                      {loadingMilestones ? <small>正在读取里程碑…</small>
                        : milestones.length === 0 ? <small>还没有里程碑，可以先设一个关键节点。</small>
                          : <ul>{milestones.map((milestone) => <li key={milestone.record.id}>
                            <span><strong>{milestone.record.data.title}</strong><small>{milestoneStatusLabel(milestone.record.data.status)} · {milestone.record.data.target_date ? `目标 ${milestone.record.data.target_date}` : "未设目标日期"} · 权重 {milestone.record.data.weight}</small></span>
                            <span className="project-milestone-actions">
                              {milestone.record.data.status === "open" ? <>
                                <button className="text-button" type="button" onClick={() => onMilestoneLifecycle(milestone, "complete")} disabled={projectWriteDisabled}>完成</button>
                                <button className="text-button project-destructive-button" type="button" onClick={() => onMilestoneLifecycle(milestone, "cancel")} disabled={projectWriteDisabled}>取消</button>
                              </> : <button className="text-button" type="button" onClick={() => onMilestoneLifecycle(milestone, "reopen")} disabled={projectWriteDisabled}>重新打开</button>}
                            </span>
                          </li>)}</ul>}
                    </div> : null}
                    {noteProjectId === item.record.id ? <div className="project-note-manager">
                      {!readOnly ? <form onSubmit={(event) => submitProjectNote(event, item)}>
                        <label>笔记标题
                          <input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} maxLength={300} autoFocus placeholder="例如：本周验收记录" disabled={projectWriteDisabled} />
                        </label>
                        <label>记录日期
                          <input type="date" value={noteDate} onChange={(event) => setNoteDate(event.target.value)} onInput={(event) => setNoteDate(event.currentTarget.value)} disabled={projectWriteDisabled} />
                        </label>
                        <label className="project-note-body">正文
                          <textarea value={noteBody} onChange={(event) => setNoteBody(event.target.value)} maxLength={100000} rows={5} placeholder="事实、决策、问题和下一步…" disabled={projectWriteDisabled} />
                        </label>
                        <div className="project-note-form-actions">
                          <button className="primary-button" type="submit" disabled={!noteTitle.trim() || !noteDate || projectWriteDisabled}>{savingProjectNoteProjectId === item.record.id ? "保存中…" : "创建笔记"}</button>
                          <button className="secondary-button" type="button" onClick={() => { resetPanel(); }} disabled={projectOperationBusy}>返回概览</button>
                        </div>
                      </form> : <p className="projects-inline-note">当前项目仅供查看；恢复后可继续编辑。</p>}
                      {loadingProjectNotes ? <small>正在读取项目笔记…</small>
                        : projectNotes.length === 0 ? <small>还没有笔记，记下项目中的思考、决策和进展。</small>
                          : <ul>{projectNotes.map((note) => <li key={note.record.id}>
                            {editingProjectNoteId === note.record.id ? <form className="project-note-edit-form" onSubmit={(event) => submitProjectNoteEdit(event, note)}>
                              <label>笔记标题<input value={editNoteTitle} onChange={(event) => setEditNoteTitle(event.target.value)} maxLength={300} autoFocus disabled={savingProjectNoteId === note.record.id} /></label>
                              <label>记录日期<input type="date" value={editNoteDate} onChange={(event) => setEditNoteDate(event.target.value)} onInput={(event) => setEditNoteDate(event.currentTarget.value)} disabled={savingProjectNoteId === note.record.id} /></label>
                              <label className="project-note-body">正文<textarea value={editNoteBody} onChange={(event) => setEditNoteBody(event.target.value)} maxLength={100000} rows={5} disabled={savingProjectNoteId === note.record.id} /></label>
                              <div className="project-note-form-actions">
                                <button className="primary-button" type="submit" disabled={!editNoteTitle.trim() || !editNoteDate || projectWriteDisabled}>{savingProjectNoteId === note.record.id ? "保存中…" : "保存笔记"}</button>
                                <button className="secondary-button" type="button" onClick={() => setEditingProjectNoteId(null)} disabled={savingProjectNoteId === note.record.id}>放弃修改</button>
                              </div>
                            </form> : <>
                              <details><summary><strong>{note.record.data.title}</strong><small>{note.record.data.note_date} · v{note.record.version}</small></summary><pre>{note.record.data.body_markdown || "（空正文）"}</pre></details>
                              <button className="text-button" type="button" onClick={() => beginNoteEdit(note)} disabled={projectBusy || projectWriteDisabled}>编辑笔记</button>
                            </>}
                          </li>)}</ul>}
                    </div> : null}
                    {fileProjectId === item.record.id ? <div className="project-note-manager">
                      {!readOnly ? <form onSubmit={(event) => submitProjectFileReference(event, item)}>
                        <label>显示名称
                          <input value={fileTitle} onChange={(event) => setFileTitle(event.target.value)} maxLength={300} autoFocus placeholder="例如：需求文档" disabled={projectWriteDisabled} />
                        </label>
                        <label>HTTPS 文件地址
                          <input type="url" value={fileUrl} onChange={(event) => setFileUrl(event.target.value)} maxLength={2000} placeholder="https://…" disabled={projectWriteDisabled} />
                        </label>
                        <label>用途
                          <input value={filePurpose} onChange={(event) => setFilePurpose(event.target.value)} maxLength={500} placeholder="例如：需求基线或验收证据" disabled={projectWriteDisabled} />
                        </label>
                        <div className="project-note-form-actions">
                          <button className="primary-button" type="submit" disabled={!fileTitle.trim() || !fileUrl.trim() || projectWriteDisabled}>{savingProjectFileReferenceProjectId === item.record.id ? "保存中…" : "添加文件引用"}</button>
                          <button className="secondary-button" type="button" onClick={() => { resetPanel(); }} disabled={projectOperationBusy}>返回概览</button>
                        </div>
                      </form> : <p className="projects-inline-note">当前项目仅供查看；恢复后可继续编辑。</p>}
                      {loadingProjectFileReferences ? <small>正在读取文件引用…</small>
                        : projectFileReferences(item.record.id, projectFileReferenceFiles.map((file) => file.record)).length === 0 ? <small>还没有资料，添加文档或文件链接，方便下次找到。</small>
                          : <ul>{projectFileReferences(item.record.id, projectFileReferenceFiles.map((file) => file.record)).map((reference) => <li key={reference.id}>
                            <span><a href={reference.data.source_url} target="_blank" rel="noreferrer"><strong>{reference.data.title}</strong></a><small>{reference.data.purpose || "未填写用途"} · v{reference.version}</small></span>
                          </li>)}</ul>}
                    </div> : null}
                    {activityProjectId === item.record.id ? <div className="project-activity-manager">
                      <div><strong>项目动态</strong><button className="secondary-button" type="button" onClick={() => { resetPanel(); }}>返回概览</button></div>
                      {loadingActivityEvents ? <small>正在读取项目动态…</small>
                        : activities.length === 0 ? <small>还没有项目动态，之后的修改会记录在这里。</small>
                          : <ol>{activities.slice(0, 30).map((activity) => <li key={activity.record.id}>
                            <span><strong>{activityEventLabel(activity.record.data.event_type)}</strong><small>{formatActivityTime(activity.record.data.occurred_at)} · {activity.record.data.actor_type}</small></span>
                            <code>{formatActivitySummary(activity.record.data.change_summary_json)}</code>
                          </li>)}</ol>}
                    </div> : null}
                  </>}
                </div>
              </li>;
            })}</ul></div>}
    </section>
  );
}

function projectStatusLabel(status: SyncedProject["record"]["data"]["status"]) {
  return ({ planned: "计划中", active: "进行中", on_hold: "暂停", completed: "已完成", cancelled: "已取消", archived: "已归档" } as const)[status];
}

function milestoneStatusLabel(status: SyncedMilestone["record"]["data"]["status"]) {
  return ({ open: "待完成", completed: "已完成", cancelled: "已取消" } as const)[status];
}

function formatProjectDates(item: SyncedProject) {
  const start = item.record.data.start_date;
  const target = item.record.data.target_date;
  if (start && target) return `${start} → ${target}`;
  if (start) return `开始 ${start}`;
  if (target) return `目标 ${target}`;
  return "未设项目日期";
}

function syncedPhasesForProject(projectPhaseFiles: SyncedProjectPhase[], projectId: string) {
  const byId = new Map(projectPhaseFiles.map((item) => [item.record.id, item]));
  return phasesForProject(projectPhaseFiles.map((item) => item.record), projectId)
    .map((record) => byId.get(record.id))
    .filter((item): item is SyncedProjectPhase => Boolean(item));
}

function syncedMilestonesForProject(milestoneFiles: SyncedMilestone[], projectId: string) {
  const byId = new Map(milestoneFiles.map((item) => [item.record.id, item]));
  return milestonesForProject(milestoneFiles.map((item) => item.record), projectId)
    .map((record) => byId.get(record.id))
    .filter((item): item is SyncedMilestone => Boolean(item));
}

function syncedProjectNotesForProject(projectNoteFiles: SyncedProjectNote[], projectId: string) {
  const byId = new Map(projectNoteFiles.map((item) => [item.record.id, item]));
  return projectNotesForProject(projectNoteFiles.map((item) => item.record), projectId)
    .map((record) => byId.get(record.id))
    .filter((item): item is SyncedProjectNote => Boolean(item));
}

function syncedActivityEventsForProject(activityEventFiles: SyncedActivityEvent[], projectId: string) {
  const byId = new Map(activityEventFiles.map((item) => [item.record.id, item]));
  return activityEventsForProject(activityEventFiles.map((item) => item.record), projectId)
    .map((record) => byId.get(record.id))
    .filter((item): item is SyncedActivityEvent => Boolean(item));
}

function activityEventLabel(eventType: string) {
  return ({
    "project.created": "创建项目",
    "project.updated": "更新项目信息",
    "project.status_changed": "更新项目状态",
    "project.phase_changed": "切换当前阶段",
    "project.trashed": "移到回收站",
    "project.restored": "从回收站恢复",
    "project_phase.created": "创建项目阶段",
    "milestone.created": "创建里程碑",
    "milestone.status_changed": "更新里程碑状态",
    "project_note.created": "创建项目笔记",
    "project_note.updated": "更新项目笔记",
    "project_file_reference.created": "添加项目文件引用",
  } as Record<string, string>)[eventType] ?? eventType;
}

function formatActivityTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatActivitySummary(summary: SyncedActivityEvent["record"]["data"]["change_summary_json"]) {
  return Object.entries(summary).map(([key, value]) => `${key}: ${String(value ?? "—")}`).join(" · ");
}
