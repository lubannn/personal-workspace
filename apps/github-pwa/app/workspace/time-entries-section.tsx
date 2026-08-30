"use client";

import { useMemo, useState, type FormEvent } from "react";
import { activeTimeEntries, trashedTimeEntries } from "../../../../src/lib/github-data/time-entries";
import type { Connection, SyncedProject, SyncedTask, SyncedTimeEntry } from "./page-model";

type Props = {
  connection: Connection | null;
  online: boolean | null;
  todayDate: string;
  taskFiles: SyncedTask[];
  projectFiles: SyncedProject[];
  timeEntryFiles: SyncedTimeEntry[];
  loading: boolean;
  saving: boolean;
  savingId: string | null;
  onCreate: (fields: { taskId: string; localDate: string; durationMinutes: number; notesMarkdown: string }) => Promise<boolean>;
  onDeletionChange: (item: SyncedTimeEntry, operation: "trash" | "restore") => void;
  onRefresh: () => void;
};

export function TimeEntriesSection({ connection, online, todayDate, taskFiles, projectFiles, timeEntryFiles, loading, saving, savingId, onCreate, onDeletionChange, onRefresh }: Props) {
  const [view, setView] = useState<"active" | "trash">("active");
  const [taskId, setTaskId] = useState("");
  const [localDate, setLocalDate] = useState("");
  const [minutes, setMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const availableTasks = taskFiles.filter((item) => item.record.deleted_at === null && item.record.data.status !== "cancelled" && item.record.data.status !== "archived");
  const byId = useMemo(() => new Map(timeEntryFiles.map((item) => [item.record.id, item])), [timeEntryFiles]);
  const active = activeTimeEntries(timeEntryFiles.map((item) => item.record)).map((record) => byId.get(record.id)!);
  const trash = trashedTimeEntries(timeEntryFiles.map((item) => item.record)).map((record) => byId.get(record.id)!);
  const visible = view === "active" ? active : trash;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const durationMinutes = Number(minutes);
    if (!taskId || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) return;
    if (await onCreate({ taskId, localDate: localDate || todayDate, durationMinutes, notesMarkdown: notes })) {
      setMinutes(""); setNotes("");
    }
  }

  return <section className="time-entries-card" aria-labelledby="time-entries-title">
    <div className="card-heading">
      <div><p className="eyebrow">Phase 2 · Traceable time</p><h2 id="time-entries-title">时间投入</h2><p className="time-entries-subtitle">手工记录某天为 Task 投入的时长；不伪造开始/结束时间，也不改写 Task 的人工实际耗时。</p></div>
      <div className="time-entry-view-actions" aria-label="时间投入视图与同步">
        <button className="view-button" type="button" aria-pressed={view === "active"} onClick={() => setView("active")}>当前 {active.length}</button>
        <button className="view-button" type="button" aria-pressed={view === "trash"} onClick={() => setView("trash")}>回收站 {trash.length}</button>
        <button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || loading}>{loading ? "刷新中…" : "从 GitHub 刷新"}</button>
      </div>
    </div>
    <form className="time-entry-create-form" onSubmit={submit}>
      <label>Task<select value={taskId} onChange={(event) => setTaskId(event.target.value)} disabled={!connection || saving}><option value="">选择 Task</option>{availableTasks.map((item) => <option key={item.record.id} value={item.record.id}>{item.record.data.title}</option>)}</select></label>
      <label>日期<input type="date" value={localDate || todayDate} onChange={(event) => setLocalDate(event.target.value)} onInput={(event) => setLocalDate(event.currentTarget.value)} disabled={!connection || saving} /></label>
      <label>分钟<input type="number" min={1} max={1440} step={1} value={minutes} onChange={(event) => setMinutes(event.target.value)} placeholder="例如 45" disabled={!connection || saving} /></label>
      <label className="time-entry-notes">备注（可选）<input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={50000} placeholder="完成了什么？" disabled={!connection || saving} /></label>
      <button className="primary-button" type="submit" disabled={!connection || !taskId || !(localDate || todayDate) || !minutes || saving || online === false}>{saving ? "保存中…" : "记录时长"}</button>
    </form>
    {!connection ? <p className="empty-note">连接后显示 Private 仓库中的 Time Entry。</p> : loading && timeEntryFiles.length === 0 ? <p className="empty-note">正在读取时间投入…</p> : visible.length === 0 ? <p className="empty-note">{view === "active" ? "还没有时间投入记录。" : "Time Entry 回收站是空的。"}</p> : <ol className="time-entry-list">{visible.map((item) => <li key={item.record.id}><span><strong>{taskName(item.record.data.task_id, taskFiles)}</strong><small>{item.record.data.local_date} · {formatMinutes(item.record.data.duration_minutes)} · {projectName(item.record.data.project_id, projectFiles)}{item.record.data.notes_markdown ? ` · ${notePreview(item.record.data.notes_markdown)}` : ""}</small></span><code>v{item.record.version}</code><button className="text-button" type="button" onClick={() => onDeletionChange(item, view === "active" ? "trash" : "restore")} disabled={Boolean(savingId) || online === false}>{savingId === item.record.id ? "…" : view === "active" ? "移到回收站" : "恢复"}</button></li>)}</ol>}
  </section>;
}

function taskName(id: string, tasks: SyncedTask[]) { return tasks.find((item) => item.record.id === id)?.record.data.title ?? `Task ${id}`; }
function projectName(id: string | null, projects: SyncedProject[]) { return id ? projects.find((item) => item.record.id === id)?.record.data.name ?? `Project ${id}` : "无项目"; }
function formatMinutes(minutes: number) { return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ""}`; }
function notePreview(value: string) { const normalized = value.replace(/\s+/g, " ").trim(); return normalized.length > 120 ? `${normalized.slice(0, 120)}…` : normalized; }
