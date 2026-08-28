"use client";

import { useState, type FormEvent } from "react";

import type { TaskCategory, TaskEditableFields, TaskPriority } from "../../../../src/lib/github-data/tasks";
import {
  TASK_CATEGORY_LABELS,
  TASK_PRIORITY_LABELS,
  formatTaskDue,
  type Connection,
  type SyncedTask,
} from "./page-model";

type Props = {
  connection: Connection | null;
  online: boolean | null;
  taskTitle: string;
  taskCategory: TaskCategory;
  taskPriority: TaskPriority;
  taskDueDate: string;
  taskView: "open" | "done" | "cancelled" | "archived" | "trash";
  taskFiles: SyncedTask[];
  openTaskFiles: SyncedTask[];
  completedTaskFiles: SyncedTask[];
  cancelledTaskFiles: SyncedTask[];
  archivedTaskFiles: SyncedTask[];
  trashedTaskFiles: SyncedTask[];
  visibleTaskFiles: SyncedTask[];
  currentTaskDate: string;
  loadingTasks: boolean;
  savingTask: boolean;
  savingTaskId: string | null;
  onTaskTitleChange: (value: string) => void;
  onTaskCategoryChange: (value: TaskCategory) => void;
  onTaskPriorityChange: (value: TaskPriority) => void;
  onTaskDueDateChange: (value: string) => void;
  onTaskViewChange: (value: "open" | "done" | "cancelled" | "archived" | "trash") => void;
  onCreateTask: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
  onLifecycleChange: (item: SyncedTask, operation: "complete" | "reopen" | "cancel" | "archive") => void;
  onDeletionChange: (item: SyncedTask, operation: "trash" | "restore") => void;
  onEditTask: (item: SyncedTask, details: TaskEditableFields) => Promise<boolean>;
  onCreateSubtask: (parent: SyncedTask, title: string) => Promise<boolean>;
};

export function TasksSection(props: Props) {
  const {
    connection, online, taskTitle, taskCategory, taskPriority, taskDueDate, taskView,
    taskFiles, openTaskFiles, completedTaskFiles, cancelledTaskFiles, archivedTaskFiles, trashedTaskFiles,
    visibleTaskFiles, currentTaskDate,
    loadingTasks, savingTask, savingTaskId, onTaskTitleChange, onTaskCategoryChange,
    onTaskPriorityChange, onTaskDueDateChange, onTaskViewChange, onCreateTask,
    onRefresh, onLifecycleChange, onDeletionChange, onEditTask, onCreateSubtask,
  } = props;
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState<TaskCategory>("work");
  const [editPriority, setEditPriority] = useState<TaskPriority>("medium");
  const [editDueDate, setEditDueDate] = useState("");
  const [editEstimatedMinutes, setEditEstimatedMinutes] = useState("");
  const [editActualMinutes, setEditActualMinutes] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [subtaskParentId, setSubtaskParentId] = useState<string | null>(null);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const taskFormActive = editingTaskId !== null || subtaskParentId !== null;

  function beginEdit(item: SyncedTask) {
    setSubtaskParentId(null);
    setEditingTaskId(item.record.id);
    setEditTitle(item.record.data.title);
    setEditCategory(item.record.data.category);
    setEditPriority(item.record.data.priority);
    setEditDueDate(item.record.data.due_at?.slice(0, 10) ?? "");
    setEditEstimatedMinutes(item.record.data.estimated_duration_minutes?.toString() ?? "");
    setEditActualMinutes(item.record.data.actual_duration_minutes?.toString() ?? "");
    setEditTags(item.record.data.tags.join(", "));
    setEditNotes(item.record.data.notes_markdown);
  }

  function beginSubtask(item: SyncedTask) {
    setEditingTaskId(null);
    setSubtaskParentId(item.record.id);
    setSubtaskTitle("");
  }

  async function submitSubtask(event: FormEvent<HTMLFormElement>, item: SyncedTask) {
    event.preventDefault();
    if (!subtaskTitle.trim() || savingTaskId || online === false) return;
    const saved = await onCreateSubtask(item, subtaskTitle);
    if (saved) {
      setSubtaskParentId(null);
      setSubtaskTitle("");
    }
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>, item: SyncedTask) {
    event.preventDefault();
    if (!editTitle.trim() || savingTaskId || online === false) return;
    const saved = await onEditTask(item, {
      title: editTitle,
      category: editCategory,
      priority: editPriority,
      due_at: editDueDate || null,
      estimated_duration_minutes: parseDuration(editEstimatedMinutes),
      actual_duration_minutes: parseDuration(editActualMinutes),
      tags: editTags.split(/[,，]/),
      notes_markdown: editNotes,
    });
    if (saved) setEditingTaskId(null);
  }

  return (
    <section className="tasks-card" aria-labelledby="tasks-title">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Phase 2 · Task foundation</p>
          <h2 id="tasks-title">任务清单</h2>
          <p className="tasks-subtitle">创建、编辑、完成、取消、归档与恢复均直接同步到 Private GitHub。</p>
        </div>
        <div className="task-view-actions" aria-label="任务视图与同步">
          <button className={`view-button ${taskView === "open" ? "active" : ""}`} type="button" aria-pressed={taskView === "open"} onClick={() => onTaskViewChange("open")} disabled={taskFormActive || Boolean(savingTaskId)}>待办 {openTaskFiles.length}</button>
          <button className={`view-button ${taskView === "done" ? "active" : ""}`} type="button" aria-pressed={taskView === "done"} onClick={() => onTaskViewChange("done")} disabled={taskFormActive || Boolean(savingTaskId)}>已完成 {completedTaskFiles.length}</button>
          <button className={`view-button ${taskView === "cancelled" ? "active" : ""}`} type="button" aria-pressed={taskView === "cancelled"} onClick={() => onTaskViewChange("cancelled")} disabled={taskFormActive || Boolean(savingTaskId)}>已取消 {cancelledTaskFiles.length}</button>
          <button className={`view-button ${taskView === "archived" ? "active" : ""}`} type="button" aria-pressed={taskView === "archived"} onClick={() => onTaskViewChange("archived")} disabled={taskFormActive || Boolean(savingTaskId)}>已归档 {archivedTaskFiles.length}</button>
          <button className={`view-button ${taskView === "trash" ? "active" : ""}`} type="button" aria-pressed={taskView === "trash"} onClick={() => onTaskViewChange("trash")} disabled={taskFormActive || Boolean(savingTaskId)}>回收站 {trashedTaskFiles.length}</button>
          <button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || loadingTasks || taskFormActive || Boolean(savingTaskId)}>{loadingTasks ? "刷新中…" : "从 GitHub 刷新"}</button>
        </div>
      </div>

      <form className="task-create-form" onSubmit={onCreateTask}>
        <label className="task-title-field">任务标题
          <input value={taskTitle} onChange={(event) => onTaskTitleChange(event.target.value)} maxLength={300} placeholder={connection ? "今天要推进什么？" : "连接 Private 数据仓库后创建任务"} disabled={!connection || savingTask || taskFormActive} />
        </label>
        <label>分类
          <select value={taskCategory} onChange={(event) => onTaskCategoryChange(event.target.value as TaskCategory)} disabled={!connection || savingTask || taskFormActive}>
            {Object.entries(TASK_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>优先级
          <select value={taskPriority} onChange={(event) => onTaskPriorityChange(event.target.value as TaskPriority)} disabled={!connection || savingTask || taskFormActive}>
            {Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>DDL
          <input type="date" value={taskDueDate} onChange={(event) => onTaskDueDateChange(event.target.value)} disabled={!connection || savingTask || taskFormActive} />
        </label>
        <button className="primary-button" type="submit" disabled={!connection || !taskTitle.trim() || savingTask || taskFormActive || online === false}>{savingTask ? "保存中…" : "创建任务"}</button>
      </form>

      {!connection ? <p className="empty-note">连接后显示 Private 仓库中的任务。</p>
        : loadingTasks && taskFiles.length === 0 ? <p className="empty-note">正在读取任务…</p>
          : visibleTaskFiles.length === 0 ? <p className="empty-note">{{
            open: "还没有待办任务，可以创建第一项。",
            done: "还没有已完成任务。",
            cancelled: "还没有已取消任务。",
            archived: "还没有已归档任务。",
            trash: "任务回收站是空的。",
          }[taskView]}</p>
            : <ul className="task-list">{visibleTaskFiles.map((item) => (
              <li key={item.record.id} className={`${taskView === "done" ? "completed" : taskView}${item.record.data.parent_task_id ? " subtask" : ""}`}>
                <button className="task-toggle" type="button" aria-label={taskView === "open" ? `完成任务：${item.record.data.title}` : taskView === "trash" ? `从回收站恢复任务：${item.record.data.title}` : `恢复任务：${item.record.data.title}`} onClick={() => taskView === "trash" ? onDeletionChange(item, "restore") : onLifecycleChange(item, taskView === "open" ? "complete" : "reopen")} disabled={taskFormActive || Boolean(savingTaskId) || online === false}>
                  {savingTaskId === item.record.id ? "…" : taskView === "open" ? "○" : taskView === "done" ? "✓" : "↶"}
                </button>
                <div className="task-content">
                  {editingTaskId === item.record.id ? (
                    <form className="task-edit-form" onSubmit={(event) => submitEdit(event, item)}>
                      <label className="task-edit-title">任务标题
                        <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} maxLength={300} autoFocus disabled={savingTaskId === item.record.id} />
                      </label>
                      <label>分类
                        <select value={editCategory} onChange={(event) => setEditCategory(event.target.value as TaskCategory)} disabled={savingTaskId === item.record.id}>
                          {Object.entries(TASK_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </label>
                      <label>优先级
                        <select value={editPriority} onChange={(event) => setEditPriority(event.target.value as TaskPriority)} disabled={savingTaskId === item.record.id}>
                          {Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </label>
                      <label>DDL
                        <input type="date" value={editDueDate} onChange={(event) => setEditDueDate(event.target.value)} disabled={savingTaskId === item.record.id} />
                      </label>
                      <label className="task-edit-tags">标签（逗号分隔）
                        <input value={editTags} onChange={(event) => setEditTags(event.target.value)} maxLength={1020} placeholder="周报, 等待反馈" disabled={savingTaskId === item.record.id} />
                      </label>
                      <label>预计耗时（分钟）
                        <input type="number" min={0} max={525600} step={1} value={editEstimatedMinutes} onChange={(event) => setEditEstimatedMinutes(event.target.value)} placeholder="例如 45" disabled={savingTaskId === item.record.id} />
                      </label>
                      <label>实际耗时（人工）
                        <input type="number" min={0} max={525600} step={1} value={editActualMinutes} onChange={(event) => setEditActualMinutes(event.target.value)} placeholder="例如 50" disabled={savingTaskId === item.record.id} />
                      </label>
                      <label className="task-edit-notes">Markdown 备注
                        <textarea value={editNotes} onChange={(event) => setEditNotes(event.target.value)} maxLength={50000} rows={5} placeholder="补充上下文、检查清单或结果…" disabled={savingTaskId === item.record.id} />
                      </label>
                      <div className="task-edit-actions">
                        <button className="primary-button" type="submit" disabled={!editTitle.trim() || Boolean(savingTaskId) || online === false}>{savingTaskId === item.record.id ? "保存中…" : "保存修改"}</button>
                        <button className="secondary-button" type="button" onClick={() => setEditingTaskId(null)} disabled={savingTaskId === item.record.id}>放弃修改</button>
                      </div>
                    </form>
                  ) : <>
                    <strong>{item.record.data.title}</strong>
                    {item.record.data.parent_task_id ? <span className="task-parent-label">↳ {parentTitle(item, taskFiles)}</span> : null}
                    <span>{TASK_CATEGORY_LABELS[item.record.data.category]} · {TASK_PRIORITY_LABELS[item.record.data.priority]}优先级 · {formatTaskDue(item.record.data.due_at, currentTaskDate)}</span>
                    {hasTaskDetails(item) ? <span className="task-detail-summary">{formatTaskDetails(item)}</span> : null}
                    {subtaskParentId === item.record.id ? <form className="task-subtask-form" onSubmit={(event) => submitSubtask(event, item)}>
                      <label>子任务标题
                        <input value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} maxLength={300} autoFocus placeholder="下一步是什么？" disabled={savingTaskId === item.record.id} />
                      </label>
                      <div>
                        <button className="primary-button" type="submit" disabled={!subtaskTitle.trim() || Boolean(savingTaskId) || online === false}>{savingTaskId === item.record.id ? "保存中…" : "创建子任务"}</button>
                        <button className="secondary-button" type="button" onClick={() => setSubtaskParentId(null)} disabled={savingTaskId === item.record.id}>放弃创建</button>
                      </div>
                      <small>继承父任务的分类、项目、优先级和 DDL；创建后可单独编辑。</small>
                    </form> : null}
                  </>}
                </div>
                <div className="task-row-actions">
                  <code>v{item.record.version}</code>
                  {editingTaskId === item.record.id ? null : <div className="task-item-actions">
                    {taskView === "archived" || taskView === "trash" ? null : <button className="text-button" type="button" onClick={() => beginEdit(item)} disabled={taskFormActive || Boolean(savingTaskId) || online === false}>编辑</button>}
                    {taskView === "open" && item.record.data.parent_task_id === null ? <button className="text-button" type="button" onClick={() => beginSubtask(item)} disabled={taskFormActive || Boolean(savingTaskId) || online === false}>添加子任务</button> : null}
                    {taskView === "open" ? <button className="text-button task-destructive-button" type="button" onClick={() => onLifecycleChange(item, "cancel")} disabled={taskFormActive || Boolean(savingTaskId) || online === false}>取消任务</button> : null}
                    {taskView !== "archived" && taskView !== "trash" ? <button className="text-button" type="button" onClick={() => onLifecycleChange(item, "archive")} disabled={taskFormActive || Boolean(savingTaskId) || online === false}>归档</button> : null}
                    {taskView !== "trash" ? <button className="text-button task-destructive-button" type="button" onClick={() => onDeletionChange(item, "trash")} disabled={taskFormActive || Boolean(savingTaskId) || online === false}>移到回收站</button> : null}
                  </div>}
                </div>
              </li>
            ))}</ul>}
    </section>
  );
}

function parseDuration(value: string) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function hasTaskDetails(item: SyncedTask) {
  return item.record.data.tags.length > 0
    || item.record.data.estimated_duration_minutes !== null
    || item.record.data.actual_duration_minutes !== null
    || Boolean(item.record.data.notes_markdown);
}

function formatTaskDetails(item: SyncedTask) {
  const { tags, estimated_duration_minutes: estimated, actual_duration_minutes: actual, notes_markdown: notes } = item.record.data;
  return [
    ...tags.map((tag) => `#${tag}`),
    estimated === null ? null : `预计 ${estimated} 分钟`,
    actual === null ? null : `实际 ${actual} 分钟`,
    notes ? "有备注" : null,
  ].filter(Boolean).join(" · ");
}

function parentTitle(item: SyncedTask, taskFiles: SyncedTask[]) {
  return taskFiles.find((candidate) => candidate.record.id === item.record.data.parent_task_id)?.record.data.title ?? "父任务不可用";
}
