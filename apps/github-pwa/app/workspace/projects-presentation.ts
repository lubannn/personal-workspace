import { projectMilestoneProgress, projectTaskProgress } from "../../../../src/lib/github-data/projects";
import type { SyncedMilestone, SyncedProject, SyncedTask } from "./page-model";

export type ProjectSort = "target" | "updated" | "name";

export function projectProgress(project: SyncedProject, tasks: SyncedTask[], milestones: SyncedMilestone[]) {
  const mode = project.record.data.progress_mode;
  if (mode === "manual") return { completed: 0, total: 0, percent: project.record.data.manual_progress_percent ?? 0 };
  return mode === "milestones"
    ? projectMilestoneProgress(project.record.id, milestones.map((item) => item.record))
    : projectTaskProgress(project.record.id, tasks.map((item) => item.record));
}

export function projectNeedsAttention(project: SyncedProject, today: string) {
  const { target_date: target, status } = project.record.data;
  return project.record.deleted_at === null && (status === "active" || status === "planned" || status === "on_hold") && target !== null && target < today;
}

export function projectDueLabel(project: SyncedProject, today: string) {
  const target = project.record.data.target_date;
  if (!target) return "未设日期";
  const date = `${target.slice(0, 4) === today.slice(0, 4) ? "" : `${target.slice(0, 4)}/`}${target.slice(5).replace("-", "/")}`;
  if (projectNeedsAttention(project, today)) return `已逾期 · ${date}`;
  if (target === today && project.record.deleted_at === null && ["active", "planned", "on_hold"].includes(project.record.data.status)) return "今天到期";
  return date;
}

export function filterProjectList(items: SyncedProject[], query: string, sort: ProjectSort, attentionOnly: boolean, today: string) {
  const term = query.trim().toLocaleLowerCase();
  return items.filter((item) => (!attentionOnly || projectNeedsAttention(item, today))
    && (!term || `${item.record.data.name}\n${item.record.data.description_markdown}`.toLocaleLowerCase().includes(term)))
    .sort((left, right) => {
      if (sort === "updated") return right.record.updated_at.localeCompare(left.record.updated_at);
      if (sort === "name") return left.record.data.name.localeCompare(right.record.data.name, "zh-CN");
      return (left.record.data.target_date ?? "9999-12-31").localeCompare(right.record.data.target_date ?? "9999-12-31") || left.record.data.name.localeCompare(right.record.data.name, "zh-CN");
    });
}

export function projectTasks(projectId: string, tasks: SyncedTask[]) {
  const ranks = { in_progress: 0, blocked: 1, todo: 2, inbox: 3, done: 4, cancelled: 5, archived: 6 };
  return tasks.filter((item) => item.record.deleted_at === null && item.record.data.project_id === projectId && item.record.data.status !== "cancelled" && item.record.data.status !== "archived")
    .sort((left, right) => ranks[left.record.data.status] - ranks[right.record.data.status] || (left.record.data.due_at ?? "9999").localeCompare(right.record.data.due_at ?? "9999"));
}
