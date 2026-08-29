"use client";

import { useState, type FormEvent } from "react";

import { projectMilestoneProgress, projectTaskProgress, type ProjectEditableFields, type ProjectProgressMode } from "../../../../src/lib/github-data/projects";
import { phasesForProject } from "../../../../src/lib/github-data/project-phases";
import { milestonesForProject } from "../../../../src/lib/github-data/milestones";
import type { Connection, SyncedMilestone, SyncedProject, SyncedProjectPhase, SyncedTask } from "./page-model";

type Props = {
  connection: Connection | null;
  online: boolean | null;
  projectName: string;
  projectTargetDate: string;
  projectFiles: SyncedProject[];
  projectPhaseFiles: SyncedProjectPhase[];
  milestoneFiles: SyncedMilestone[];
  currentProjectFiles: SyncedProject[];
  completedProjectFiles: SyncedProject[];
  cancelledProjectFiles: SyncedProject[];
  archivedProjectFiles: SyncedProject[];
  trashedProjectFiles: SyncedProject[];
  visibleProjectFiles: SyncedProject[];
  projectView: "current" | "completed" | "cancelled" | "archived" | "trash";
  taskFiles: SyncedTask[];
  loadingProjects: boolean;
  loadingProjectPhases: boolean;
  loadingMilestones: boolean;
  savingProject: boolean;
  savingProjectId: string | null;
  savingProjectPhaseProjectId: string | null;
  savingMilestoneProjectId: string | null;
  savingMilestoneId: string | null;
  onProjectNameChange: (value: string) => void;
  onProjectTargetDateChange: (value: string) => void;
  onCreateProject: (event: FormEvent<HTMLFormElement>) => void;
  onProjectViewChange: (value: "current" | "completed" | "cancelled" | "archived" | "trash") => void;
  onLifecycleChange: (item: SyncedProject, operation: "pause" | "resume" | "complete" | "reopen" | "cancel" | "archive") => void;
  onDeletionChange: (item: SyncedProject, operation: "trash" | "restore") => void;
  onEditProject: (item: SyncedProject, details: ProjectEditableFields) => Promise<boolean>;
  onCreatePhase: (project: SyncedProject, name: string) => Promise<boolean>;
  onSetCurrentPhase: (project: SyncedProject, phase: SyncedProjectPhase) => void;
  onCreateMilestone: (project: SyncedProject, title: string, targetDate: string) => Promise<boolean>;
  onMilestoneLifecycle: (item: SyncedMilestone, operation: "complete" | "reopen" | "cancel") => void;
  onRefresh: () => void;
};

export function ProjectsSection(props: Props) {
  const {
    connection, online, projectName, projectTargetDate, projectFiles, projectPhaseFiles, milestoneFiles, currentProjectFiles,
    completedProjectFiles, cancelledProjectFiles, archivedProjectFiles, trashedProjectFiles,
    visibleProjectFiles, projectView, taskFiles, loadingProjects, loadingProjectPhases, loadingMilestones, savingProject, savingProjectId, savingProjectPhaseProjectId,
    savingMilestoneProjectId, savingMilestoneId,
    onProjectNameChange, onProjectTargetDateChange, onCreateProject, onProjectViewChange,
    onLifecycleChange, onDeletionChange, onEditProject, onCreatePhase, onSetCurrentPhase, onCreateMilestone, onMilestoneLifecycle, onRefresh,
  } = props;
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editTargetDate, setEditTargetDate] = useState("");
  const [editProgressMode, setEditProgressMode] = useState<ProjectProgressMode>("tasks");
  const [phaseProjectId, setPhaseProjectId] = useState<string | null>(null);
  const [phaseName, setPhaseName] = useState("");
  const [milestoneProjectId, setMilestoneProjectId] = useState<string | null>(null);
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneTargetDate, setMilestoneTargetDate] = useState("");
  const projectOperationBusy = savingProject || savingProjectId !== null || savingProjectPhaseProjectId !== null || savingMilestoneProjectId !== null || savingMilestoneId !== null;
  const projectFormActive = editingProjectId !== null || phaseProjectId !== null || milestoneProjectId !== null;
  const projectBusy = projectOperationBusy || projectFormActive;

  function beginEdit(item: SyncedProject) {
    setPhaseProjectId(null);
    setMilestoneProjectId(null);
    setEditingProjectId(item.record.id);
    setEditName(item.record.data.name);
    setEditDescription(item.record.data.description_markdown);
    setEditStartDate(item.record.data.start_date ?? "");
    setEditTargetDate(item.record.data.target_date ?? "");
    setEditProgressMode(item.record.data.progress_mode);
  }

  function beginPhaseManagement(item: SyncedProject) {
    setEditingProjectId(null);
    setMilestoneProjectId(null);
    setPhaseProjectId(item.record.id);
    setPhaseName("");
  }

  function beginMilestoneManagement(item: SyncedProject) {
    setEditingProjectId(null);
    setPhaseProjectId(null);
    setMilestoneProjectId(item.record.id);
    setMilestoneTitle("");
    setMilestoneTargetDate("");
  }

  async function submitPhase(event: FormEvent<HTMLFormElement>, item: SyncedProject) {
    event.preventDefault();
    if (!phaseName.trim() || savingProjectPhaseProjectId || online === false) return;
    const saved = await onCreatePhase(item, phaseName);
    if (saved) setPhaseName("");
  }

  async function submitMilestone(event: FormEvent<HTMLFormElement>, item: SyncedProject) {
    event.preventDefault();
    if (!milestoneTitle.trim() || savingMilestoneProjectId || online === false) return;
    const saved = await onCreateMilestone(item, milestoneTitle, milestoneTargetDate);
    if (saved) {
      setMilestoneTitle("");
      setMilestoneTargetDate("");
    }
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>, item: SyncedProject) {
    event.preventDefault();
    if (!editName.trim() || savingProjectId || online === false) return;
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
    <section className="projects-card" aria-labelledby="projects-title">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Phase 2 · Project foundation</p>
          <h2 id="projects-title">项目</h2>
          <p className="projects-subtitle">项目与任务关联都写入 Private GitHub；当前进度只按关联任务事实计算。</p>
        </div>
        <div className="project-view-actions" aria-label="项目视图与同步">
          <button className={`view-button ${projectView === "current" ? "active" : ""}`} type="button" aria-pressed={projectView === "current"} onClick={() => onProjectViewChange("current")} disabled={projectBusy}>进行中 {currentProjectFiles.length}</button>
          <button className={`view-button ${projectView === "completed" ? "active" : ""}`} type="button" aria-pressed={projectView === "completed"} onClick={() => onProjectViewChange("completed")} disabled={projectBusy}>已完成 {completedProjectFiles.length}</button>
          <button className={`view-button ${projectView === "cancelled" ? "active" : ""}`} type="button" aria-pressed={projectView === "cancelled"} onClick={() => onProjectViewChange("cancelled")} disabled={projectBusy}>已取消 {cancelledProjectFiles.length}</button>
          <button className={`view-button ${projectView === "archived" ? "active" : ""}`} type="button" aria-pressed={projectView === "archived"} onClick={() => onProjectViewChange("archived")} disabled={projectBusy}>已归档 {archivedProjectFiles.length}</button>
          <button className={`view-button ${projectView === "trash" ? "active" : ""}`} type="button" aria-pressed={projectView === "trash"} onClick={() => onProjectViewChange("trash")} disabled={projectBusy}>回收站 {trashedProjectFiles.length}</button>
          <button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || loadingProjects || projectBusy}>{loadingProjects ? "刷新中…" : "从 GitHub 刷新"}</button>
        </div>
      </div>

      <form className="project-create-form" onSubmit={onCreateProject}>
        <label>项目名称
          <input value={projectName} onChange={(event) => onProjectNameChange(event.target.value)} maxLength={300} placeholder={connection ? "例如：PWA 正式主页面" : "连接 Private 数据仓库后创建项目"} disabled={!connection || projectBusy} />
        </label>
        <label>目标日期
          <input type="date" value={projectTargetDate} onChange={(event) => onProjectTargetDateChange(event.target.value)} disabled={!connection || projectBusy} />
        </label>
        <button className="primary-button" type="submit" disabled={!connection || !projectName.trim() || projectBusy || online === false}>{savingProject ? "保存中…" : "创建项目"}</button>
      </form>

      {!connection ? <p className="empty-note">连接后显示 Private 仓库中的项目。</p>
        : loadingProjects && projectFiles.length === 0 ? <p className="empty-note">正在读取项目…</p>
          : visibleProjectFiles.length === 0 ? <p className="empty-note">{{
            current: "还没有进行中的项目，可以创建第一项。",
            completed: "还没有已完成项目。",
            cancelled: "还没有已取消项目。",
            archived: "还没有已归档项目。",
            trash: "项目回收站是空的。",
          }[projectView]}</p>
            : <ul className="project-list">{visibleProjectFiles.map((item) => {
              const progress = item.record.data.progress_mode === "milestones"
                ? projectMilestoneProgress(item.record.id, milestoneFiles.map((milestone) => milestone.record))
                : item.record.data.progress_mode === "manual"
                  ? { completed: 0, total: 0, percent: item.record.data.manual_progress_percent ?? 0 }
                  : projectTaskProgress(item.record.id, taskFiles.map((task) => task.record));
              const progressSource = item.record.data.progress_mode === "milestones" ? "里程碑权重" : item.record.data.progress_mode === "manual" ? "手动" : "任务事实";
              const progressDetail = item.record.data.progress_mode === "manual"
                ? `${progress.percent}%`
                : `已完成 ${progress.completed} / 共 ${progress.total} · ${progress.percent}%`;
              const phases = syncedPhasesForProject(projectPhaseFiles, item.record.id);
              const milestones = syncedMilestonesForProject(milestoneFiles, item.record.id);
              const currentPhase = phases.find((phase) => phase.record.id === item.record.data.current_phase_id);
              return <li key={item.record.id}>
                <div className="project-content">
                  {editingProjectId === item.record.id ? <form className="project-edit-form" onSubmit={(event) => submitEdit(event, item)}>
                    <label className="project-edit-name">项目名称
                      <input value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={300} autoFocus disabled={savingProjectId === item.record.id} />
                    </label>
                    <label>开始日期
                      <input type="date" value={editStartDate} onChange={(event) => setEditStartDate(event.target.value)} disabled={savingProjectId === item.record.id} />
                    </label>
                    <label>目标日期
                      <input type="date" value={editTargetDate} onChange={(event) => setEditTargetDate(event.target.value)} disabled={savingProjectId === item.record.id} />
                    </label>
                    <label>进度口径
                      <select value={editProgressMode} onChange={(event) => setEditProgressMode(event.target.value as ProjectProgressMode)} disabled={savingProjectId === item.record.id}>
                        <option value="tasks">关联任务</option>
                        <option value="milestones">里程碑权重</option>
                        {editProgressMode === "manual" ? <option value="manual" disabled>手动（暂不开放编辑）</option> : null}
                      </select>
                    </label>
                    <label className="project-edit-description">Markdown 说明
                      <textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} maxLength={50000} rows={5} placeholder="目标、边界、验收标准…" disabled={savingProjectId === item.record.id} />
                    </label>
                    <div className="project-edit-actions">
                      <button className="primary-button" type="submit" disabled={!editName.trim() || Boolean(savingProjectId) || online === false}>{savingProjectId === item.record.id ? "保存中…" : "保存修改"}</button>
                      <button className="secondary-button" type="button" onClick={() => setEditingProjectId(null)} disabled={savingProjectId === item.record.id}>放弃修改</button>
                    </div>
                  </form> : <>
                    <strong>{item.record.data.name}</strong>
                    <span>{formatProjectDates(item)} · {projectStatusLabel(item.record.data.status)} · 当前阶段：{currentPhase?.record.data.name ?? "未设置"}</span>
                    {item.record.data.description_markdown ? <span className="project-description-indicator">有项目说明</span> : null}
                    <div className="project-progress" aria-label={`${progressSource}进度 ${progress.percent}%`}>
                      <i style={{ width: `${progress.percent}%` }} />
                    </div>
                    <small>{progressSource} · {progressDetail}</small>
                    {phaseProjectId === item.record.id ? <div className="project-phase-manager">
                      <form onSubmit={(event) => submitPhase(event, item)}>
                        <label>新阶段名称
                          <input value={phaseName} onChange={(event) => setPhaseName(event.target.value)} maxLength={300} autoFocus placeholder="例如：开发与验收" disabled={savingProjectPhaseProjectId === item.record.id} />
                        </label>
                        <button className="primary-button" type="submit" disabled={!phaseName.trim() || projectOperationBusy || online === false}>{savingProjectPhaseProjectId === item.record.id ? "保存中…" : "创建阶段"}</button>
                        <button className="secondary-button" type="button" onClick={() => setPhaseProjectId(null)} disabled={projectOperationBusy}>完成管理</button>
                      </form>
                      {loadingProjectPhases ? <small>正在读取阶段…</small>
                        : phases.length === 0 ? <small>还没有阶段；创建后可单独设为当前阶段。</small>
                          : <ul>{phases.map((phase) => <li key={phase.record.id}>
                            <span><strong>{phase.record.data.name}</strong><small>顺序 {phase.record.data.sort_order} · {phase.record.data.status}</small></span>
                            {item.record.data.current_phase_id === phase.record.id
                              ? <em>当前阶段</em>
                              : <button className="text-button" type="button" onClick={() => onSetCurrentPhase(item, phase)} disabled={projectOperationBusy || online === false}>设为当前</button>}
                          </li>)}</ul>}
                    </div> : null}
                    {milestoneProjectId === item.record.id ? <div className="project-milestone-manager">
                      <form onSubmit={(event) => submitMilestone(event, item)}>
                        <label>里程碑标题
                          <input value={milestoneTitle} onChange={(event) => setMilestoneTitle(event.target.value)} maxLength={300} autoFocus placeholder="例如：完成正式页面验收" disabled={savingMilestoneProjectId === item.record.id} />
                        </label>
                        <label>目标日期
                          <input type="date" value={milestoneTargetDate} onChange={(event) => setMilestoneTargetDate(event.target.value)} disabled={savingMilestoneProjectId === item.record.id} />
                        </label>
                        <button className="primary-button" type="submit" disabled={!milestoneTitle.trim() || projectOperationBusy || online === false}>{savingMilestoneProjectId === item.record.id ? "保存中…" : "创建里程碑"}</button>
                        <button className="secondary-button" type="button" onClick={() => setMilestoneProjectId(null)} disabled={projectOperationBusy}>完成管理</button>
                      </form>
                      {loadingMilestones ? <small>正在读取里程碑…</small>
                        : milestones.length === 0 ? <small>还没有里程碑；当前项目进度仍按关联任务事实计算。</small>
                          : <ul>{milestones.map((milestone) => <li key={milestone.record.id}>
                            <span><strong>{milestone.record.data.title}</strong><small>{milestoneStatusLabel(milestone.record.data.status)} · {milestone.record.data.target_date ? `目标 ${milestone.record.data.target_date}` : "未设目标日期"} · 权重 {milestone.record.data.weight}</small></span>
                            <span className="project-milestone-actions">
                              {milestone.record.data.status === "open" ? <>
                                <button className="text-button" type="button" onClick={() => onMilestoneLifecycle(milestone, "complete")} disabled={projectOperationBusy || online === false}>完成</button>
                                <button className="text-button project-destructive-button" type="button" onClick={() => onMilestoneLifecycle(milestone, "cancel")} disabled={projectOperationBusy || online === false}>取消</button>
                              </> : <button className="text-button" type="button" onClick={() => onMilestoneLifecycle(milestone, "reopen")} disabled={projectOperationBusy || online === false}>重新打开</button>}
                            </span>
                          </li>)}</ul>}
                    </div> : null}
                  </>}
                </div>
                <div className="project-row-actions">
                  <code>v{item.record.version}</code>
                  {editingProjectId === item.record.id ? null : <div className="project-item-actions">
                    {projectView === "trash" ? <button className="text-button" type="button" onClick={() => onDeletionChange(item, "restore")} disabled={projectBusy || online === false}>{savingProjectId === item.record.id ? "恢复中…" : "恢复项目"}</button> : <>
                      {projectView !== "archived" ? <button className="text-button" type="button" onClick={() => beginEdit(item)} disabled={projectBusy || online === false}>编辑</button> : null}
                      {projectView === "current" ? <button className="text-button" type="button" onClick={() => beginPhaseManagement(item)} disabled={projectBusy || online === false}>管理阶段</button> : null}
                      {projectView === "current" ? <button className="text-button" type="button" onClick={() => beginMilestoneManagement(item)} disabled={projectBusy || online === false}>管理里程碑</button> : null}
                      {projectView === "current" ? <button className="text-button" type="button" onClick={() => onLifecycleChange(item, item.record.data.status === "on_hold" ? "resume" : "pause")} disabled={projectBusy || online === false}>{item.record.data.status === "on_hold" ? "恢复进行" : "暂停"}</button> : null}
                      {projectView === "current" ? <button className="text-button" type="button" onClick={() => onLifecycleChange(item, "complete")} disabled={projectBusy || online === false}>完成</button> : <button className="text-button" type="button" onClick={() => onLifecycleChange(item, "reopen")} disabled={projectBusy || online === false}>重新打开</button>}
                      {projectView === "current" ? <button className="text-button project-destructive-button" type="button" onClick={() => onLifecycleChange(item, "cancel")} disabled={projectBusy || online === false}>取消项目</button> : null}
                      {projectView !== "archived" ? <button className="text-button" type="button" onClick={() => onLifecycleChange(item, "archive")} disabled={projectBusy || online === false}>归档</button> : null}
                      <button className="text-button project-destructive-button" type="button" onClick={() => onDeletionChange(item, "trash")} disabled={projectBusy || online === false}>移到回收站</button>
                    </>}
                  </div>}
                </div>
              </li>;
            })}</ul>}
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
