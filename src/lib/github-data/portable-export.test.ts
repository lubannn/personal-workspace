import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord } from "./protocol";
import { createDefaultDashboardLayout, serializeDashboardLayout } from "./dashboard-layout";
import { createActivityEventData } from "./activity-events";
import { createCalendarEventData, localDateTimeToIso } from "./calendar-events";
import { createProjectFileReferenceData } from "./project-file-references";
import { createTimeEntryData } from "./time-entries";
import { createJournalEntryData } from "./journal-entries";
import { createJournalSegmentData } from "./journal-segments";
import { createJournalRevisionData, sha256JournalRevisionBody } from "./journal-revisions";
import { renderJournalSegmentsMarkdown } from "./journal-segment-codec";
import {
  buildPortableWorkspaceExport,
  inspectPortableWorkspaceExport,
  sha256Text,
  serializePortableWorkspaceExport,
} from "./portable-export";

const workspaceText = `${JSON.stringify({
  schema_version: 1,
  workspace_id: "personal-workspace",
  owner_id: "github_lubannn",
  owner_login: "lubannn",
  locale: "zh-CN",
  timezone: "Asia/Shanghai",
}, null, 2)}\n`;

function storedFile(path: string, text: string, blobSha: string) {
  return { path, text, blobSha, sizeBytes: new TextEncoder().encode(text).byteLength };
}

async function sampleExport() {
  const capture = createWorkspaceRecord({
    entityType: "capture",
    id: "capture_20260827010000000_abcd1234",
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T01:00:00.000Z",
    data: { raw_text: "可迁移的数据", status: "inbox" as const },
  });
  const captureText = serializeRecord(capture);
  const taskText = serializeRecord(createWorkspaceRecord({
    entityType: "task",
    id: "task_20260827013000000_abcd1234",
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T01:30:00.000Z",
    data: {
      title: "测试开放任务",
      category: "work",
      project_id: null,
      parent_task_id: null,
      status: "todo",
      priority: "medium",
      planned_start_at: null,
      planned_end_at: null,
      due_at: "2026-08-27",
      due_timezone: "Asia/Shanghai",
      is_due_date_only: true,
      estimated_duration_minutes: null,
      actual_duration_minutes: null,
      tags: [],
      notes_markdown: "",
      completed_at: null,
      cancelled_at: null,
    },
  }));
  const dashboardText = serializeDashboardLayout(createDefaultDashboardLayout(
    "github_lubannn",
    "2026-08-27T01:30:00.000Z",
  ));
  const projectText = serializeRecord(createWorkspaceRecord({
    entityType: "project",
    id: "project_20260827014500000_abcd1234",
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T01:45:00.000Z",
    data: {
      name: "开放项目",
      description_markdown: "",
      status: "active",
      current_phase_id: null,
      start_date: null,
      target_date: "2026-09-30",
      completed_at: null,
      progress_mode: "tasks",
      manual_progress_percent: null,
      visibility_classification: "confidential",
    },
  }));
  const projectPhaseText = serializeRecord(createWorkspaceRecord({
    entityType: "project_phase",
    id: "phase_20260827015000000_abcd1234",
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T01:50:00.000Z",
    data: {
      project_id: "project_20260827014500000_abcd1234",
      name: "开发与验收",
      description: "",
      sort_order: 10,
      started_at: "2026-08-27T01:50:00.000Z",
      completed_at: null,
      status: "active",
    },
  }));
  const milestoneText = serializeRecord(createWorkspaceRecord({
    entityType: "milestone",
    id: "milestone_20260827015500000_abcd1234",
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T01:55:00.000Z",
    data: {
      project_id: "project_20260827014500000_abcd1234",
      title: "正式页面验收",
      description: "",
      target_date: "2026-09-15",
      status: "open",
      weight: 1,
      completed_at: null,
      sort_order: 10,
    },
  }));
  const projectNoteText = serializeRecord(createWorkspaceRecord({
    entityType: "project_note",
    id: "project_note_20260827015700000_abcd1234",
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T01:57:00.000Z",
    data: {
      project_id: "project_20260827014500000_abcd1234",
      title: "项目复盘",
      body_markdown: "## 结论\n\n保持事实可追溯。",
      note_date: "2026-08-27",
    },
  }));
  const activityEventText = serializeRecord(createWorkspaceRecord({
    entityType: "activity_event",
    id: "activity_20260827015800000_abcd1234",
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T01:58:00.000Z",
    data: createActivityEventData({
      projectId: "project_20260827014500000_abcd1234",
      eventType: "project.updated",
      occurredAt: "2026-08-27T01:58:00.000Z",
      actorId: "github_lubannn",
      changeSummary: { name: "开放项目" },
      sourceRef: "project_20260827014500000_abcd1234",
    }),
  }));
  const projectFileReferenceText = serializeRecord(createWorkspaceRecord({
    entityType: "project_file_reference",
    id: "project_file_20260827015830000_abcd1234",
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T01:58:30.000Z",
    data: createProjectFileReferenceData("project_20260827014500000_abcd1234", {
      title: "正式验收文档",
      source_url: "https://example.com/files/acceptance.pdf",
      original_filename: "acceptance.pdf",
      mime_type: "application/pdf",
      size_bytes: 4096,
      sha256: "a".repeat(64),
      purpose: "验收证据",
      sort_order: 10,
    }),
  }));
  const calendarEventText = serializeRecord(createWorkspaceRecord({
    entityType: "calendar_event",
    id: "calendar_event_20260827015900000_abcd1234",
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T01:59:00.000Z",
    data: createCalendarEventData({
      title: "验收时间块",
      eventType: "time_block",
      startAt: localDateTimeToIso("2026-08-27", "10:00", "Asia/Shanghai"),
      endAt: localDateTimeToIso("2026-08-27", "11:00", "Asia/Shanghai"),
      timezone: "Asia/Shanghai",
      localDate: "2026-08-27",
      linkedTaskId: "task_20260827013000000_abcd1234",
    }),
  }));
  const reportDraftText = serializeRecord(createWorkspaceRecord({
    entityType: "report_draft",
    id: "report_draft_20260827020000000_abcd1234",
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T02:00:00.000Z",
    data: {
      report_type: "weekly", audience: "personal", period_start: "2026-08-24", period_end: "2026-08-30", timezone: "Asia/Shanghai",
      scope_json: { basis: "workspace-local-calendar", source_entity_types: ["task", "project", "milestone", "calendar_event", "activity_event"] },
      facts_snapshot_json: { completed_task_count: 0, completed_milestone_count: 0, calendar_event_count: 0, activity_event_count: 0, project_snapshot_count: 0, actual_task_minutes: 0, scheduled_minutes: 0, sources: [] },
      content_markdown: "# 周报\n", generation_method: "deterministic", ai_run_id: null, status: "draft",
    },
  }));
  const timeEntryText = serializeRecord(createWorkspaceRecord({
    entityType: "time_entry",
    id: "time_entry_20260827020100000_abcd1234",
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T02:01:00.000Z",
    data: createTimeEntryData({
      taskId: "task_20260827013000000_abcd1234",
      projectId: null,
      localDate: "2026-08-27",
      timezone: "Asia/Shanghai",
      durationMinutes: 45,
      notesMarkdown: "完成迁移验收",
    }),
  }));
  const journalEntryId = "journal_entry_20260827020200000_abcd1234";
  const journalSegmentId = "journal_segment_20260827020210000_abcd1234";
  const journalRevisionId = "journal_revision_20260827020220000_abcd1234";
  const journalTimestamp = "2026-08-27T02:02:00.000Z";
  const journalSegmentData = createJournalSegmentData({ id: journalSegmentId, journalEntryId, localTime: "10:02", occurredAt: "2026-08-27T10:02:00+08:00", bodyMarkdown: "今天完成了迁移验收。", sortOrder: 0 });
  const journalBody = renderJournalSegmentsMarkdown(journalEntryId, [{ id: journalSegmentId, ...journalSegmentData }]).trim();
  const journalEntryText = serializeRecord(createWorkspaceRecord({
    entityType: "journal_entry",
    id: journalEntryId,
    ownerId: "github_lubannn",
    timestamp: journalTimestamp,
    data: { ...createJournalEntryData({ journalDate: "2026-08-27", timezone: "Asia/Shanghai", title: "迁移日记", bodyMarkdown: journalBody, timestamp: journalTimestamp }), current_revision_id: journalRevisionId },
  }));
  const journalSegmentText = serializeRecord(createWorkspaceRecord({ entityType: "journal_segment", id: journalSegmentId, ownerId: "github_lubannn", timestamp: journalTimestamp, data: journalSegmentData }));
  const journalRevisionText = serializeRecord(createWorkspaceRecord({
    entityType: "journal_revision",
    id: journalRevisionId,
    ownerId: "github_lubannn",
    timestamp: journalTimestamp,
    data: createJournalRevisionData({ journalEntryId, revisionNumber: 1, contentMode: "segments", bodyMarkdown: journalBody, segmentIds: [journalSegmentId], contentSha256: await sha256JournalRevisionBody(journalBody), createdAt: journalTimestamp, createdBy: "migration", changeReason: "schema_migration" }),
  }));
  return buildPortableWorkspaceExport({
    repository: "lubannn/personal-workspace-data",
    branch: "main",
    generatedAt: "2026-08-27T02:00:00.000Z",
    workspaceFile: storedFile("workspace.json", workspaceText, "workspace-blob"),
    captureFiles: [storedFile("data/captures/capture_20260827010000000_abcd1234.json", captureText, "capture-blob")],
    dashboardLayoutFile: storedFile("config/dashboard-layout.json", dashboardText, "dashboard-blob"),
    taskFiles: [storedFile("data/tasks/task_20260827013000000_abcd1234.json", taskText, "task-blob")],
    timeEntryFiles: [storedFile("data/time-entries/time_entry_20260827020100000_abcd1234.json", timeEntryText, "time-entry-blob")],
    journalEntryFiles: [storedFile("data/journal-entries/journal_entry_20260827020200000_abcd1234.json", journalEntryText, "journal-entry-blob")],
    journalSegmentFiles: [storedFile("data/journal-segments/journal_segment_20260827020210000_abcd1234.json", journalSegmentText, "journal-segment-blob")],
    journalRevisionFiles: [storedFile("data/journal-revisions/journal_revision_20260827020220000_abcd1234.json", journalRevisionText, "journal-revision-blob")],
    projectFiles: [storedFile("data/projects/project_20260827014500000_abcd1234.json", projectText, "project-blob")],
    projectPhaseFiles: [storedFile("data/project-phases/phase_20260827015000000_abcd1234.json", projectPhaseText, "phase-blob")],
    milestoneFiles: [storedFile("data/milestones/milestone_20260827015500000_abcd1234.json", milestoneText, "milestone-blob")],
    projectNoteFiles: [storedFile("data/project-notes/project_note_20260827015700000_abcd1234.json", projectNoteText, "project-note-blob")],
    projectFileReferenceFiles: [storedFile("data/project-file-references/project_file_20260827015830000_abcd1234.json", projectFileReferenceText, "project-file-reference-blob")],
    activityEventFiles: [storedFile("data/activity-events/activity_20260827015800000_abcd1234.json", activityEventText, "activity-event-blob")],
    calendarEventFiles: [storedFile("data/calendar-events/calendar_event_20260827015900000_abcd1234.json", calendarEventText, "calendar-event-blob")],
    reportDraftFiles: [storedFile("data/report-drafts/report_draft_20260827020000000_abcd1234.json", reportDraftText, "report-draft-blob")],
  });
}

describe("portable GitHub workspace export", () => {
  it("builds a deterministic manifest and passes restore preflight", async () => {
    const exported = await sampleExport();
    expect(exported.manifest.counts).toEqual({ files: 16, captures: 1, dashboard_layouts: 1, tasks: 1, time_entries: 1, projects: 1, project_phases: 1, milestones: 1, project_notes: 1, project_file_references: 1, activity_events: 1, calendar_events: 1, report_drafts: 1, journal_entries: 1, journal_segments: 1, journal_revisions: 1 });
    expect(exported.manifest.files.map((file) => file.path)).toEqual([
      "config/dashboard-layout.json",
      "data/activity-events/activity_20260827015800000_abcd1234.json",
      "data/calendar-events/calendar_event_20260827015900000_abcd1234.json",
      "data/captures/capture_20260827010000000_abcd1234.json",
      "data/journal-entries/journal_entry_20260827020200000_abcd1234.json",
      "data/journal-revisions/journal_revision_20260827020220000_abcd1234.json",
      "data/journal-segments/journal_segment_20260827020210000_abcd1234.json",
      "data/milestones/milestone_20260827015500000_abcd1234.json",
      "data/project-file-references/project_file_20260827015830000_abcd1234.json",
      "data/project-notes/project_note_20260827015700000_abcd1234.json",
      "data/project-phases/phase_20260827015000000_abcd1234.json",
      "data/projects/project_20260827014500000_abcd1234.json",
      "data/report-drafts/report_draft_20260827020000000_abcd1234.json",
      "data/tasks/task_20260827013000000_abcd1234.json",
      "data/time-entries/time_entry_20260827020100000_abcd1234.json",
      "workspace.json",
    ]);
    expect(serializePortableWorkspaceExport(exported)).not.toContain("test-token");

    await expect(inspectPortableWorkspaceExport(exported)).resolves.toMatchObject({
      valid: true,
      repository: "lubannn/personal-workspace-data",
      counts: { files: 16, captures: 1, dashboardLayouts: 1, tasks: 1, timeEntries: 1, projects: 1, projectPhases: 1, milestones: 1, projectNotes: 1, projectFileReferences: 1, activityEvents: 1, calendarEvents: 1, reportDrafts: 1, journalEntries: 1, journalSegments: 1, journalRevisions: 1 },
      errors: [],
      workspace: { owner_id: "github_lubannn" },
    });
  });

  it("detects modified content by size and SHA-256", async () => {
    const exported = await sampleExport();
    exported.files[0]!.content += "tampered";
    const inspection = await inspectPortableWorkspaceExport(exported);
    expect(inspection.valid).toBe(false);
    expect(inspection.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      "FILE_SIZE_MISMATCH",
      "FILE_HASH_MISMATCH",
    ]));
  });

  it("rejects owner and path mismatches even when hashes are rebuilt", async () => {
    const exported = await sampleExport();
    const capture = createWorkspaceRecord({
      entityType: "capture",
      id: "capture_different",
      ownerId: "another_owner",
      data: { raw_text: "错误所有者", status: "inbox" as const },
      timestamp: "2026-08-27T03:00:00.000Z",
    });
    const rebuilt = await buildPortableWorkspaceExport({
      repository: exported.source.repository,
      branch: exported.source.branch,
      generatedAt: exported.generated_at,
      workspaceFile: storedFile("workspace.json", workspaceText, "workspace-blob"),
      captureFiles: [storedFile("data/captures/wrong_path.json", serializeRecord(capture), "capture-blob")],
    });
    const inspection = await inspectPortableWorkspaceExport(rebuilt);
    expect(inspection.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      "OWNER_MISMATCH",
      "CAPTURE_PATH_MISMATCH",
    ]));
  });

  it("rejects unsupported versions and missing workspace descriptors", async () => {
    const exported = await sampleExport() as unknown as Record<string, unknown>;
    exported.export_version = 99;
    const files = exported.files as Array<{ path: string }>;
    exported.files = files.filter((file) => file.path !== "workspace.json");
    const inspection = await inspectPortableWorkspaceExport(exported);
    expect(inspection.valid).toBe(false);
    expect(inspection.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      "UNSUPPORTED_EXPORT_VERSION",
      "WORKSPACE_FILE_MISSING",
    ]));
  });

  it("rejects project phases whose parent project is missing", async () => {
    const exported = await sampleExport();
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/projects/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/projects/"));
    exported.manifest.counts.files -= 1;
    exported.manifest.counts.projects = 0;
    const inspection = await inspectPortableWorkspaceExport(exported);
    expect(inspection.errors.map((error) => error.code)).toContain("PROJECT_PHASE_PROJECT_MISSING");
    expect(inspection.errors.map((error) => error.code)).toContain("MILESTONE_PROJECT_MISSING");
    expect(inspection.errors.map((error) => error.code)).toContain("PROJECT_NOTE_PROJECT_MISSING");
    expect(inspection.errors.map((error) => error.code)).toContain("PROJECT_FILE_REFERENCE_PROJECT_MISSING");
    expect(inspection.errors.map((error) => error.code)).toContain("ACTIVITY_EVENT_PROJECT_MISSING");
  });

  it("rejects Calendar events whose linked Task is missing", async () => {
    const exported = await sampleExport();
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/tasks/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/tasks/"));
    exported.manifest.counts.files -= 1;
    exported.manifest.counts.tasks = 0;
    const inspection = await inspectPortableWorkspaceExport(exported);
    expect(inspection.errors.map((error) => error.code)).toContain("CALENDAR_EVENT_TASK_MISSING");
    expect(inspection.errors.map((error) => error.code)).toContain("TIME_ENTRY_TASK_MISSING");
  });

  it("rejects two active daily Journal entries for the same local date", async () => {
    const exported = await sampleExport();
    const original = exported.files.find((file) => file.path.startsWith("data/journal-entries/"))!;
    const duplicate = JSON.parse(original.content);
    duplicate.id = "journal_entry_duplicate";
    const content = `${JSON.stringify(duplicate, null, 2)}\n`;
    const path = "data/journal-entries/journal_entry_duplicate.json";
    exported.files.push({ path, content });
    exported.manifest.files.push({ path, blob_sha: "duplicate-journal-blob", size_bytes: new TextEncoder().encode(content).byteLength, sha256: await sha256Text(content) });
    exported.manifest.counts.files += 1;
    exported.manifest.counts.journal_entries += 1;
    const inspection = await inspectPortableWorkspaceExport(exported);
    expect(inspection.errors.map((error) => error.code)).toContain("DUPLICATE_ACTIVE_DAILY_JOURNAL");
  });

  it("validates Journal revision hashes, current pointers and Segment references", async () => {
    const exported = await sampleExport();
    const revisionFile = exported.files.find((file) => file.path.startsWith("data/journal-revisions/"))!;
    const revision = JSON.parse(revisionFile.content);
    revision.data.content_sha256 = "f".repeat(64);
    revisionFile.content = `${JSON.stringify(revision, null, 2)}\n`;
    const revisionManifest = exported.manifest.files.find((file) => file.path === revisionFile.path)!;
    revisionManifest.size_bytes = new TextEncoder().encode(revisionFile.content).byteLength;
    revisionManifest.sha256 = await sha256Text(revisionFile.content);
    let inspection = await inspectPortableWorkspaceExport(exported);
    expect(inspection.errors.map((error) => error.code)).toContain("JOURNAL_REVISION_HASH_MISMATCH");

    const withoutSegment = await sampleExport();
    withoutSegment.files = withoutSegment.files.filter((file) => !file.path.startsWith("data/journal-segments/"));
    withoutSegment.manifest.files = withoutSegment.manifest.files.filter((file) => !file.path.startsWith("data/journal-segments/"));
    withoutSegment.manifest.counts.files -= 1;
    withoutSegment.manifest.counts.journal_segments = 0;
    inspection = await inspectPortableWorkspaceExport(withoutSegment);
    expect(inspection.errors.map((error) => error.code)).toContain("JOURNAL_REVISION_SEGMENT_MISSING");

    const missingCurrent = await sampleExport();
    const entryFile = missingCurrent.files.find((file) => file.path.startsWith("data/journal-entries/"))!;
    const entry = JSON.parse(entryFile.content);
    entry.data.current_revision_id = "revision_missing";
    entryFile.content = `${JSON.stringify(entry, null, 2)}\n`;
    const entryManifest = missingCurrent.manifest.files.find((file) => file.path === entryFile.path)!;
    entryManifest.size_bytes = new TextEncoder().encode(entryFile.content).byteLength;
    entryManifest.sha256 = await sha256Text(entryFile.content);
    inspection = await inspectPortableWorkspaceExport(missingCurrent);
    expect(inspection.errors.map((error) => error.code)).toContain("JOURNAL_ENTRY_CURRENT_REVISION_NOT_FOUND");
  });

  it("continues to accept version 1 exports created before dashboard layouts existed", async () => {
    const exported = await sampleExport();
    exported.files = exported.files.filter((file) => file.path !== "config/dashboard-layout.json");
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/tasks/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/time-entries/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/journal-entries/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/journal-segments/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/journal-revisions/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/projects/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/project-phases/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/milestones/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/project-notes/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/project-file-references/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/activity-events/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/calendar-events/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/report-drafts/"));
    exported.manifest.files = exported.manifest.files.filter((file) => file.path !== "config/dashboard-layout.json");
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/tasks/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/time-entries/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/journal-entries/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/journal-segments/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/journal-revisions/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/projects/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/project-phases/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/milestones/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/project-notes/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/project-file-references/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/activity-events/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/calendar-events/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/report-drafts/"));
    exported.manifest.scope.modules = ["workspace", "captures"];
    exported.manifest.counts = { files: 2, captures: 1 } as typeof exported.manifest.counts;
    await expect(inspectPortableWorkspaceExport(exported)).resolves.toMatchObject({
      valid: true,
      counts: { files: 2, captures: 1, dashboardLayouts: 0, tasks: 0, timeEntries: 0, projects: 0, projectPhases: 0, milestones: 0, projectNotes: 0, projectFileReferences: 0, activityEvents: 0, calendarEvents: 0, reportDrafts: 0, journalEntries: 0, journalSegments: 0, journalRevisions: 0 },
    });
  });
});
