import { captureBody, createCaptureData, type CaptureFields, type CaptureKind } from "./capture-details";
import { createCalendarEventData, localDateTimeToIso, type CalendarEventRecord } from "./calendar-events";
import { canWriteJournalDate, createJournalEntryData, type JournalEntryRecord } from "./journal-entries";
import { createWorkspaceRecord, recordPath, serializeRecord } from "./protocol";
import { parseTaskRecord, type TaskData, type TaskRecord } from "./tasks";
import type { CaptureRecord } from "./workspace";
import type { GitHubContentsAdapter } from "./github-contents";
import { GitHubConflictError, GitHubDataError } from "./github-contents";

export const CAPTURE_DESTINATIONS: Record<CaptureKind, string> = { note: "概览", idea: "想法", todo: "待办", deadline: "待办", schedule: "日程", journal: "日记" };
export type CaptureSubmission = { record: CaptureRecord | TaskRecord | CalendarEventRecord | JournalEntryRecord; path: string; label: string; tab: "overview" | "tasks" | "calendar" | "journal" | "ideas" };

function nextDate(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}
export function captureScheduleWindow(date: string, time: string | null, endTime: string | null, timezone: string) {
  const startAt = localDateTimeToIso(date, time ?? "00:00", timezone);
  if (time && endTime === time) throw new Error("CAPTURE_RANGE_INVALID");
  const endAt = !time ? localDateTimeToIso(nextDate(date), "00:00", timezone)
    : endTime ? localDateTimeToIso(endTime < time ? nextDate(date) : date, endTime, timezone)
      : new Date(Date.parse(startAt) + 60 * 60_000).toISOString();
  return { startAt, endAt, allDay: !time, localEndDate: time ? instantDate(new Date(Date.parse(endAt) - 1).toISOString(), timezone) : date };
}
function instantDate(instant: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)!.value).join("-");
}

export function prepareCaptureSubmission(fields: CaptureFields, input: { ownerId: string; suffix: string; timestamp: string; today: string }): CaptureSubmission {
  // Validate before any network write; all destination records retain the full original content.
  const captureData = createCaptureData(fields);
  const body = captureBody(fields.rawText);
  if (!body) throw new Error("CAPTURE_BODY_REQUIRED");
  const title = body.split("\n")[0].slice(0, 300);
  const common = { ownerId: input.ownerId, timestamp: input.timestamp };
  let record: CaptureSubmission["record"];
  let tab: CaptureSubmission["tab"] = "overview";
  if (fields.kind === "todo" || fields.kind === "deadline") {
    if (fields.kind === "deadline" && !fields.date) throw new Error("CAPTURE_DATE_REQUIRED");
    const data: TaskData = {
      title, category: "life", project_id: null, parent_task_id: null, status: "todo", priority: "medium",
      planned_start_at: null, planned_end_at: null,
      due_at: fields.date && fields.time ? localDateTimeToIso(fields.date, fields.time, fields.timezone) : fields.date,
      due_timezone: fields.timezone, is_due_date_only: !fields.time,
      estimated_duration_minutes: null, actual_duration_minutes: null, tags: [],
      notes_markdown: fields.rawText.trim(), completed_at: null, cancelled_at: null,
    };
    record = parseTaskRecord(serializeRecord(createWorkspaceRecord({ ...common, entityType: "task", id: `task_${input.suffix}`, data })));
    tab = "tasks";
  } else if (fields.kind === "schedule") {
    if (!fields.date) throw new Error("CAPTURE_DATE_REQUIRED");
    const window = captureScheduleWindow(fields.date, fields.time, fields.endTime ?? null, fields.timezone);
    const data = createCalendarEventData({ title, eventType: "event", startAt: window.startAt, endAt: window.endAt, timezone: fields.timezone, localDate: fields.date });
    record = createWorkspaceRecord({ ...common, entityType: "calendar_event", id: `calendar_event_${input.suffix}`, data: { ...data, all_day: window.allDay, local_end_date: window.localEndDate, description_markdown: fields.rawText.trim() } });
    tab = "calendar";
  } else if (fields.kind === "journal") {
    const journalDate = fields.date ?? input.today;
    if (!canWriteJournalDate(journalDate, input.today)) throw new Error("JOURNAL_DATE_NOT_WRITABLE");
    record = createWorkspaceRecord({ ...common, entityType: "journal_entry", id: `journal_entry_${journalDate.replaceAll("-", "")}_${input.suffix}`, data: createJournalEntryData({ journalDate, timezone: fields.timezone, bodyMarkdown: body, timestamp: input.timestamp }) });
    tab = "journal";
  } else {
    record = createWorkspaceRecord({ ...common, entityType: "capture", id: `capture_${input.suffix}`, data: captureData });
    if (fields.kind === "idea") tab = "ideas";
  }
  return { record, path: recordPath(record.entity_type, record.id), label: CAPTURE_DESTINATIONS[fields.kind], tab };
}

export async function writeCaptureSubmission(adapter: Pick<GitHubContentsAdapter, "writeText" | "readText" | "readBranchSnapshot">, submission: CaptureSubmission, retry = false) {
  // One canonical record per capture: a successful write is never followed by a second conversion write.
  if (retry) {
    try {
      const existing = await adapter.readText(submission.path);
      if (existing.text !== serializeRecord(submission.record)) throw new GitHubConflictError("The destination record has changed; the draft is preserved.");
      const snapshot = await adapter.readBranchSnapshot();
      return { path: existing.path, blobSha: existing.blobSha, commitSha: snapshot.headCommitSha };
    } catch (error) {
      if (!(error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND")) throw error;
    }
  }
  return adapter.writeText({ path: submission.path, text: serializeRecord(submission.record), message: `capture: create ${submission.record.id}` });
}
