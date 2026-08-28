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
  taskView: "open" | "done";
  taskFiles: SyncedTask[];
  openTaskFiles: SyncedTask[];
  completedTaskFiles: SyncedTask[];
  visibleTaskFiles: SyncedTask[];
  currentTaskDate: string;
  loadingTasks: boolean;
  savingTask: boolean;
  savingTaskId: string | null;
  onTaskTitleChange: (value: string) => void;
  onTaskCategoryChange: (value: TaskCategory) => void;
  onTaskPriorityChange: (value: TaskPriority) => void;
  onTaskDueDateChange: (value: string) => void;
  onTaskViewChange: (value: "open" | "done") => void;
  onCreateTask: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
  onCompletionChange: (item: SyncedTask, operation: "complete" | "reopen") => void;
  onEditTask: (item: SyncedTask, details: TaskEditableFields) => Promise<boolean>;
};

export function TasksSection(props: Props) {
  const {
    connection, online, taskTitle, taskCategory, taskPriority, taskDueDate, taskView,
    taskFiles, openTaskFiles, completedTaskFiles, visibleTaskFiles, currentTaskDate,
    loadingTasks, savingTask, savingTaskId, onTaskTitleChange, onTaskCategoryChange,
    onTaskPriorityChange, onTaskDueDateChange, onTaskViewChange, onCreateTask,
    onRefresh, onCompletionChange, onEditTask,
  } = props;
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState<TaskCategory>("work");
  const [editPriority, setEditPriority] = useState<TaskPriority>("medium");
  const [editDueDate, setEditDueDate] = useState("");

  function beginEdit(item: SyncedTask) {
    setEditingTaskId(item.record.id);
    setEditTitle(item.record.data.title);
    setEditCategory(item.record.data.category);
    setEditPriority(item.record.data.priority);
    setEditDueDate(item.record.data.due_at?.slice(0, 10) ?? "");
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>, item: SyncedTask) {
    event.preventDefault();
    if (!editTitle.trim() || savingTaskId || online === false) return;
    const saved = await onEditTask(item, {
      title: editTitle,
      category: editCategory,
      priority: editPriority,
      due_at: editDueDate || null,
    });
    if (saved) setEditingTaskId(null);
  }

  return (
    <section className="tasks-card" aria-labelledby="tasks-title">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Phase 2 · Task foundation</p>
          <h2 id="tasks-title">任务清单</h2>
          <p className="tasks-subtitle">创建、今日聚合、完成与恢复均直接同步到 Private GitHub。</p>
        </div>
        <div className="task-view-actions" aria-label="任务视图与同步">
          <button className={`view-button ${taskView === "open" ? "active" : ""}`} type="button" aria-pressed={taskView === "open"} onClick={() => onTaskViewChange("open")} disabled={editingTaskId !== null || Boolean(savingTaskId)}>待办 {openTaskFiles.length}</button>
          <button className={`view-button ${taskView === "done" ? "active" : ""}`} type="button" aria-pressed={taskView === "done"} onClick={() => onTaskViewChange("done")} disabled={editingTaskId !== null || Boolean(savingTaskId)}>已完成 {completedTaskFiles.length}</button>
          <button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || loadingTasks || editingTaskId !== null || Boolean(savingTaskId)}>{loadingTasks ? "刷新中…" : "从 GitHub 刷新"}</button>
        </div>
      </div>

      <form className="task-create-form" onSubmit={onCreateTask}>
        <label className="task-title-field">任务标题
          <input value={taskTitle} onChange={(event) => onTaskTitleChange(event.target.value)} maxLength={300} placeholder={connection ? "今天要推进什么？" : "连接 Private 数据仓库后创建任务"} disabled={!connection || savingTask} />
        </label>
        <label>分类
          <select value={taskCategory} onChange={(event) => onTaskCategoryChange(event.target.value as TaskCategory)} disabled={!connection || savingTask}>
            {Object.entries(TASK_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>优先级
          <select value={taskPriority} onChange={(event) => onTaskPriorityChange(event.target.value as TaskPriority)} disabled={!connection || savingTask}>
            {Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>DDL
          <input type="date" value={taskDueDate} onChange={(event) => onTaskDueDateChange(event.target.value)} disabled={!connection || savingTask} />
        </label>
        <button className="primary-button" type="submit" disabled={!connection || !taskTitle.trim() || savingTask || online === false}>{savingTask ? "保存中…" : "创建任务"}</button>
      </form>

      {!connection ? <p className="empty-note">连接后显示 Private 仓库中的任务。</p>
        : loadingTasks && taskFiles.length === 0 ? <p className="empty-note">正在读取任务…</p>
          : visibleTaskFiles.length === 0 ? <p className="empty-note">{taskView === "open" ? "还没有待办任务，可以创建第一项。" : "还没有已完成任务。"}</p>
            : <ul className="task-list">{visibleTaskFiles.map((item) => (
              <li key={item.record.id} className={taskView === "done" ? "completed" : ""}>
                <button className="task-toggle" type="button" aria-label={taskView === "done" ? `恢复任务：${item.record.data.title}` : `完成任务：${item.record.data.title}`} onClick={() => onCompletionChange(item, taskView === "done" ? "reopen" : "complete")} disabled={editingTaskId !== null || Boolean(savingTaskId) || online === false}>
                  {savingTaskId === item.record.id ? "…" : taskView === "done" ? "✓" : "○"}
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
                      <div className="task-edit-actions">
                        <button className="primary-button" type="submit" disabled={!editTitle.trim() || Boolean(savingTaskId) || online === false}>{savingTaskId === item.record.id ? "保存中…" : "保存修改"}</button>
                        <button className="secondary-button" type="button" onClick={() => setEditingTaskId(null)} disabled={savingTaskId === item.record.id}>取消</button>
                      </div>
                    </form>
                  ) : <>
                    <strong>{item.record.data.title}</strong>
                    <span>{TASK_CATEGORY_LABELS[item.record.data.category]} · {TASK_PRIORITY_LABELS[item.record.data.priority]}优先级 · {formatTaskDue(item.record.data.due_at, currentTaskDate)}</span>
                  </>}
                </div>
                <div className="task-row-actions">
                  <code>v{item.record.version}</code>
                  {editingTaskId === item.record.id ? null : <button className="text-button" type="button" onClick={() => beginEdit(item)} disabled={editingTaskId !== null || Boolean(savingTaskId) || online === false}>编辑</button>}
                </div>
              </li>
            ))}</ul>}
    </section>
  );
}
