import type { CalendarEventRecord } from "./calendar-events";
import type { ProjectRecord } from "./projects";
import type { TaskRecord } from "./tasks";

/** Missing field is a legacy link through a task; null is an explicit unlink. */
export function calendarEventProjectId(event: CalendarEventRecord, tasks: readonly TaskRecord[]) {
  if (event.data.project_id !== undefined) return event.data.project_id;
  if (event.data.linked_entity_type !== "task" || !event.data.linked_entity_id) return null;
  return tasks.find((task) => task.id === event.data.linked_entity_id)?.data.project_id ?? null;
}

export function calendarEventsForProject(projectId: string, events: readonly CalendarEventRecord[], tasks: readonly TaskRecord[]) {
  return events.filter((event) => event.deleted_at === null && event.data.status === "confirmed" && calendarEventProjectId(event, tasks) === projectId)
    .sort((left, right) => left.data.start_at.localeCompare(right.data.start_at) || left.id.localeCompare(right.id));
}

/** Existing historical links can be retained, but new links require a live project. */
export function canLinkCalendarProject(projectId: string | null, projects: readonly ProjectRecord[], existingProjectId: string | null = null) {
  return projectId === null || projectId === existingProjectId || projects.some((project) => project.id === projectId && project.deleted_at === null && project.data.status !== "archived");
}
