import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord, setWorkspaceRecordDeleted } from "./protocol";
import { createDefaultDashboardLayout, serializeDashboardLayout } from "./dashboard-layout";
import { createActivityEventData } from "./activity-events";
import { createCalendarEventData, localDateTimeToIso } from "./calendar-events";
import { createProjectFileReferenceData } from "./project-file-references";
import { createTimeEntryData } from "./time-entries";
import { createJournalEntryData } from "./journal-entries";
import { createJournalSegmentData } from "./journal-segments";
import { createJournalRevisionData, sha256JournalRevisionBody } from "./journal-revisions";
import { createJournalImportCheckpointRecord } from "./journal-import-checkpoints";
import { createObsidianDocumentData } from "./obsidian-documents";
import { createSyncConflictRecord } from "./sync-conflicts";
import { createLearningAreaData } from "./learning-areas";
import { createLearningGoalData } from "./learning-goals";
import { createLearningActivityData } from "./learning-activities";
import { createLearningResourceData } from "./learning-resources";
import { createHabitData } from "./habits";
import { createHabitRuleData } from "./habit-rules";
import { createAutomaticHabitCheckInData } from "./habit-check-ins";
import { createSleepHabitRuleData } from "./sleep-habit-rules";
import { confirmHealthStaging, confirmWorkoutHealthStaging, createCorosWorkoutStagingData, createHealthStagingData, createSleepHealthStagingData } from "./health-staging-records";
import { createConfirmedHealthMetricData } from "./health-metrics";
import { createConfirmedSleepSessionData } from "./sleep-sessions";
import { createConfirmedWorkoutData } from "./workouts";
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
  const importBatchId = `legacy_import_${"a".repeat(32)}`;
  const journalSegmentData = createJournalSegmentData({ id: journalSegmentId, journalEntryId, localTime: "10:02", occurredAt: "2026-08-27T10:02:00+08:00", bodyMarkdown: "今天完成了迁移验收。", sortOrder: 0, sourceRef: { source_type: "legacy_word", import_batch_id: importBatchId, source_locator: "word/document.xml#p1" } });
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
    data: createJournalRevisionData({ journalEntryId, revisionNumber: 1, contentMode: "segments", bodyMarkdown: journalBody, segmentIds: [journalSegmentId], contentSha256: await sha256JournalRevisionBody(journalBody), createdAt: journalTimestamp, createdBy: "legacy_importer", changeReason: "legacy_import" }),
  }));
  const journalCheckpoint = createJournalImportCheckpointRecord({
    id: `journal_import_checkpoint_${"b".repeat(32)}`,
    ownerId: "github_lubannn",
    importBatchId,
    dryRunId: `legacy-journal:${"c".repeat(64)}:parser-v1:mapping-v1:${"d".repeat(64)}`,
    sourceSha256: "c".repeat(64),
    correctionSetSha256: "d".repeat(64),
    expectedParentCommitSha: "e".repeat(40),
    planSha256: "b".repeat(64),
    committedAt: journalTimestamp,
    items: [{ date: "2026-08-27", entry_id: journalEntryId, revision_id: journalRevisionId, segment_ids: [journalSegmentId], content_sha256: await sha256JournalRevisionBody(journalBody) }],
    plannedFiles: [
      { path: `data/journal-entries/${journalEntryId}.json`, sha256: "1".repeat(64) },
      { path: `data/journal-revisions/${journalRevisionId}.json`, sha256: "2".repeat(64) },
      { path: `data/journal-segments/${journalSegmentId}.json`, sha256: "3".repeat(64) },
    ],
  });
  const journalCheckpointText = serializeRecord(journalCheckpoint);
  const obsidianDocumentId = "obsidian_document_20260827020230000_abcd1234";
  const obsidianDocumentText = serializeRecord(createWorkspaceRecord({
    entityType: "obsidian_document",
    id: obsidianDocumentId,
    ownerId: "github_lubannn",
    timestamp: journalTimestamp,
    data: createObsidianDocumentData({
      vault_mapping_id: "onedrive_personal_vault",
      journal_entry_id: journalEntryId,
      relative_path: "Personal Workspace/Journal/2026/2026-08-27.md",
      source_revision_id: journalRevisionId,
      source_record_version: 1,
      source_content_sha256: await sha256JournalRevisionBody(journalBody),
      document_sha256: "9".repeat(64),
      exported_at: journalTimestamp,
    }),
  }));
  const syncConflict = createSyncConflictRecord({
    id: "sync_conflict_20260827020240000_abcd1234",
    ownerId: "github_lubannn",
    detectedAt: "2026-08-27T02:03:00.000Z",
    data: {
      conflict_kind: "obsidian_document_changed",
      vault_mapping_id: "onedrive_personal_vault",
      obsidian_document_id: obsidianDocumentId,
      journal_entry_id: journalEntryId,
      source_revision_id: journalRevisionId,
      relative_path: "Personal Workspace/Journal/2026/2026-08-27.md",
      baseline_document_sha256: "9".repeat(64),
      observed_document_sha256: "8".repeat(64),
      planned_document_sha256: "7".repeat(64),
    },
  });
  const syncConflictText = serializeRecord(syncConflict);
  const learningAreaId = "learning_area_20260827020400000_abcd1234";
  const learningAreaText = serializeRecord(createWorkspaceRecord({
    entityType: "learning_area",
    id: learningAreaId,
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T02:04:00.000Z",
    data: createLearningAreaData({ name: "数据分析", description_markdown: "长期能力边界", area_type: "professional", icon: "📊", color: "#5f7459" }),
  }));
  const learningGoalId = "learning_goal_20260827020430000_abcd1234";
  const learningGoalText = serializeRecord(createWorkspaceRecord({
    entityType: "learning_goal",
    id: learningGoalId,
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T02:04:30.000Z",
    data: createLearningGoalData({ learning_area_id: learningAreaId, title: "完成统计学基础", description: "形成可复用的分析能力", target_date: "2026-12-31", success_criteria_markdown: "- 完成课程\n- 独立分析" }),
  }));
  const learningActivityId = "learning_activity_20260827020440000_abcd1234";
  const learningActivityText = serializeRecord(createWorkspaceRecord({
    entityType: "learning_activity",
    id: learningActivityId,
    ownerId: "github_lubannn",
    timestamp: "2026-08-27T02:04:40.000Z",
    data: createLearningActivityData({
      learning_area_id: learningAreaId,
      goal_id: learningGoalId,
      activity_type: "course",
      title: "统计学课程第三讲",
      occurred_at: "2026-08-27T02:04:40.000Z",
      duration_minutes: 45,
      quantity: null,
      unit: null,
      notes_markdown: "完成课程并整理笔记。",
      linked_task_id: null,
      source_ref: "课程：统计学基础",
    }),
  }));
  const learningResourceId = "learning_resource_20260827020450000_abcd1234";
  const learningResourceText = serializeRecord(createWorkspaceRecord({ entityType: "learning_resource", id: learningResourceId, ownerId: "github_lubannn", timestamp: "2026-08-27T02:04:50.000Z", data: createLearningResourceData({ learning_area_id: learningAreaId, title: "统计学公开课", resource_type: "course", url: "https://example.com/statistics", notes_markdown: "资源元数据" }) }));
  const habitId = "habit_20260827020500000_abcd1234";
  const habitRuleId = "habit_rule_20260827020510000_abcd1234";
  const habitCheckInId = "habit_check_in_20260827020520000_abcd1234";
  const habitText = serializeRecord(createWorkspaceRecord({
    entityType: "habit", id: habitId, ownerId: "github_lubannn", timestamp: "2026-08-27T02:05:00.000Z",
    data: createHabitData({ name: "阅读", description_markdown: "每日阅读", schedule_json: { frequency: "daily", weekdays: [] }, timezone: "Asia/Shanghai", tracking_type: "duration", target_json: { value: 30, unit: "minutes" }, automation_mode: "rule_assisted", start_date: "2026-08-27", end_date: null }),
  }));
  const habitRuleText = serializeRecord(createWorkspaceRecord({
    entityType: "habit_rule", id: habitRuleId, ownerId: "github_lubannn", timestamp: "2026-08-27T02:05:10.000Z",
    data: createHabitRuleData({ habit_id: habitId, rule_type: "duration_threshold", rule_version: 1, config_json: { minimum_minutes: 30 }, active_from: "2026-08-27", active_to: null, enabled: true }),
  }));
  const habitCheckInText = serializeRecord(createWorkspaceRecord({
    entityType: "habit_check_in", id: habitCheckInId, ownerId: "github_lubannn", timestamp: "2026-08-27T02:05:20.000Z",
    data: createAutomaticHabitCheckInData({ habitId, localDate: "2026-08-27", timezone: "Asia/Shanghai", status: "completed", valueJson: { minutes: 35 }, evidenceType: "learning_activity", evidenceId: "learning_activity_fixture", ruleId: habitRuleId, ruleVersion: 1, evaluatedAt: "2026-08-27T02:05:15.000Z", confirmedAt: "2026-08-27T02:05:20.000Z" }),
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
    journalImportCheckpointFiles: [storedFile(`data/journal-import-checkpoints/${journalCheckpoint.id}.json`, journalCheckpointText, "journal-checkpoint-blob")],
    obsidianDocumentFiles: [storedFile(`data/obsidian-documents/${obsidianDocumentId}.json`, obsidianDocumentText, "obsidian-document-blob")],
    syncConflictFiles: [storedFile(`data/sync-conflicts/${syncConflict.id}.json`, syncConflictText, "sync-conflict-blob")],
    learningAreaFiles: [storedFile(`data/learning-areas/${learningAreaId}.json`, learningAreaText, "learning-area-blob")],
    learningGoalFiles: [storedFile(`data/learning-goals/${learningGoalId}.json`, learningGoalText, "learning-goal-blob")],
    learningActivityFiles: [storedFile(`data/learning-activities/${learningActivityId}.json`, learningActivityText, "learning-activity-blob")],
    learningResourceFiles: [storedFile(`data/learning-resources/${learningResourceId}.json`, learningResourceText, "learning-resource-blob")],
    habitFiles: [storedFile(`data/habits/${habitId}.json`, habitText, "habit-blob")],
    habitRuleFiles: [storedFile(`data/habit-rules/${habitRuleId}.json`, habitRuleText, "habit-rule-blob")],
    habitCheckInFiles: [storedFile(`data/habit-check-ins/${habitCheckInId}.json`, habitCheckInText, "habit-check-in-blob")],
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
    expect(exported.manifest.counts).toEqual({ files: 26, captures: 1, dashboard_layouts: 1, tasks: 1, time_entries: 1, projects: 1, project_phases: 1, milestones: 1, project_notes: 1, project_file_references: 1, activity_events: 1, calendar_events: 1, report_drafts: 1, journal_entries: 1, journal_segments: 1, journal_revisions: 1, journal_import_checkpoints: 1, obsidian_documents: 1, sync_conflicts: 1, learning_areas: 1, learning_goals: 1, learning_activities: 1, learning_resources: 1, habits: 1, habit_rules: 1, habit_check_ins: 1, health_staging_records: 0, health_metrics: 0, sleep_sessions: 0, workouts: 0 });
    expect(exported.manifest.files.map((file) => file.path)).toEqual([
      "config/dashboard-layout.json",
      "data/activity-events/activity_20260827015800000_abcd1234.json",
      "data/calendar-events/calendar_event_20260827015900000_abcd1234.json",
      "data/captures/capture_20260827010000000_abcd1234.json",
      "data/habit-check-ins/habit_check_in_20260827020520000_abcd1234.json",
      "data/habit-rules/habit_rule_20260827020510000_abcd1234.json",
      "data/habits/habit_20260827020500000_abcd1234.json",
      "data/journal-entries/journal_entry_20260827020200000_abcd1234.json",
      `data/journal-import-checkpoints/journal_import_checkpoint_${"b".repeat(32)}.json`,
      "data/journal-revisions/journal_revision_20260827020220000_abcd1234.json",
      "data/journal-segments/journal_segment_20260827020210000_abcd1234.json",
      "data/learning-activities/learning_activity_20260827020440000_abcd1234.json",
      "data/learning-areas/learning_area_20260827020400000_abcd1234.json",
      "data/learning-goals/learning_goal_20260827020430000_abcd1234.json",
      "data/learning-resources/learning_resource_20260827020450000_abcd1234.json",
      "data/milestones/milestone_20260827015500000_abcd1234.json",
      "data/obsidian-documents/obsidian_document_20260827020230000_abcd1234.json",
      "data/project-file-references/project_file_20260827015830000_abcd1234.json",
      "data/project-notes/project_note_20260827015700000_abcd1234.json",
      "data/project-phases/phase_20260827015000000_abcd1234.json",
      "data/projects/project_20260827014500000_abcd1234.json",
      "data/report-drafts/report_draft_20260827020000000_abcd1234.json",
      "data/sync-conflicts/sync_conflict_20260827020240000_abcd1234.json",
      "data/tasks/task_20260827013000000_abcd1234.json",
      "data/time-entries/time_entry_20260827020100000_abcd1234.json",
      "workspace.json",
    ]);
    expect(serializePortableWorkspaceExport(exported)).not.toContain("test-token");

    await expect(inspectPortableWorkspaceExport(exported)).resolves.toMatchObject({
      valid: true,
      repository: "lubannn/personal-workspace-data",
      counts: { files: 26, captures: 1, dashboardLayouts: 1, tasks: 1, timeEntries: 1, projects: 1, projectPhases: 1, milestones: 1, projectNotes: 1, projectFileReferences: 1, activityEvents: 1, calendarEvents: 1, reportDrafts: 1, journalEntries: 1, journalSegments: 1, journalRevisions: 1, journalImportCheckpoints: 1, obsidianDocuments: 1, syncConflicts: 1, learningAreas: 1, learningGoals: 1, learningActivities: 1, learningResources: 1, habits: 1, habitRules: 1, habitCheckIns: 1, healthStagingRecords: 0, healthMetrics: 0, sleepSessions: 0, workouts: 0 },
      errors: [],
      workspace: { owner_id: "github_lubannn" },
    });
  });

  it("rejects Learning children whose LearningArea is missing from the package", async () => {
    const exported = await sampleExport();
    const goalPath = "data/learning-goals/learning_goal_20260827020430000_abcd1234.json";
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/learning-areas/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/learning-areas/"));
    exported.manifest.counts.files -= 1;
    exported.manifest.counts.learning_areas = 0;
    const inspection = await inspectPortableWorkspaceExport(exported);
    expect(inspection.valid).toBe(false);
    expect(inspection.errors).toContainEqual(expect.objectContaining({ code: "LEARNING_GOAL_AREA_MISSING", path: goalPath }));
    expect(inspection.errors).toContainEqual(expect.objectContaining({ code: "LEARNING_RESOURCE_AREA_MISSING", path: "data/learning-resources/learning_resource_20260827020450000_abcd1234.json" }));
  });

  it("rejects a LearningActivity whose optional LearningGoal is missing", async () => {
    const exported = await sampleExport();
    const activityPath = "data/learning-activities/learning_activity_20260827020440000_abcd1234.json";
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/learning-goals/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/learning-goals/"));
    exported.manifest.counts.files -= 1;
    exported.manifest.counts.learning_goals = 0;
    const inspection = await inspectPortableWorkspaceExport(exported);
    expect(inspection.valid).toBe(false);
    expect(inspection.errors).toContainEqual(expect.objectContaining({ code: "LEARNING_ACTIVITY_GOAL_MISSING", path: activityPath }));
  });

  it("rejects a LearningActivity whose Goal belongs to another Area", async () => {
    const exported = await sampleExport();
    const secondArea = createWorkspaceRecord({
      entityType: "learning_area", id: "learning_area_other", ownerId: "github_lubannn", timestamp: "2026-08-27T02:04:50.000Z",
      data: createLearningAreaData({ name: "另一领域", description_markdown: "", area_type: "general", icon: null, color: null }),
    });
    const secondAreaPath = `data/learning-areas/${secondArea.id}.json`;
    const secondAreaContent = serializeRecord(secondArea);
    exported.files.push({ path: secondAreaPath, content: secondAreaContent });
    exported.manifest.files.push({ path: secondAreaPath, blob_sha: "second-area-blob", size_bytes: new TextEncoder().encode(secondAreaContent).byteLength, sha256: await sha256Text(secondAreaContent) });
    exported.manifest.counts.files += 1;
    exported.manifest.counts.learning_areas += 1;
    const activityFile = exported.files.find((file) => file.path.startsWith("data/learning-activities/"))!;
    const activity = JSON.parse(activityFile.content);
    activity.data.learning_area_id = secondArea.id;
    activityFile.content = `${JSON.stringify(activity, null, 2)}\n`;
    const activityManifest = exported.manifest.files.find((file) => file.path === activityFile.path)!;
    activityManifest.size_bytes = new TextEncoder().encode(activityFile.content).byteLength;
    activityManifest.sha256 = await sha256Text(activityFile.content);
    const inspection = await inspectPortableWorkspaceExport(exported);
    expect(inspection.valid).toBe(false);
    expect(inspection.errors.map((error) => error.code)).toContain("LEARNING_ACTIVITY_GOAL_AREA_MISMATCH");
  });

  it("keeps Learning children valid but warns when their area is soft-deleted", async () => {
    const timestamp = "2026-09-15T08:00:00.000Z";
    const area = setWorkspaceRecordDeleted(createWorkspaceRecord({
      entityType: "learning_area", id: "learning_area_deleted", ownerId: "github_lubannn", timestamp,
      data: createLearningAreaData({ name: "历史领域", description_markdown: "", area_type: "general", icon: null, color: null }),
    }), "2026-09-15T09:00:00.000Z", "2026-09-15T09:00:00.000Z");
    const goal = createWorkspaceRecord({
      entityType: "learning_goal", id: "learning_goal_retained", ownerId: "github_lubannn", timestamp,
      data: createLearningGoalData({ learning_area_id: area.id, title: "保留的目标", description: "", target_date: null, success_criteria_markdown: "" }),
    });
    const resource = createWorkspaceRecord({
      entityType: "learning_resource", id: "learning_resource_retained", ownerId: "github_lubannn", timestamp,
      data: createLearningResourceData({ learning_area_id: area.id, title: "保留的资源", resource_type: "article", url: "https://example.com/retained", notes_markdown: "" }),
    });
    const exported = await buildPortableWorkspaceExport({
      repository: "lubannn/personal-workspace-data", branch: "main", workspaceFile: storedFile("workspace.json", workspaceText, "workspace-blob"), captureFiles: [],
      learningAreaFiles: [storedFile(`data/learning-areas/${area.id}.json`, serializeRecord(area), "area-blob")],
      learningGoalFiles: [storedFile(`data/learning-goals/${goal.id}.json`, serializeRecord(goal), "goal-blob")],
      learningResourceFiles: [storedFile(`data/learning-resources/${resource.id}.json`, serializeRecord(resource), "resource-blob")],
    });
    await expect(inspectPortableWorkspaceExport(exported)).resolves.toMatchObject({
      valid: true,
      errors: [],
      warnings: expect.arrayContaining([
        expect.objectContaining({ code: "LEARNING_GOAL_AREA_READ_ONLY" }),
        expect.objectContaining({ code: "LEARNING_RESOURCE_AREA_READ_ONLY" }),
      ]),
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

  it("exports only health metrics with a matching confirmed staging source", async () => {
    const timestamp = "2026-09-13T01:00:00.000Z";
    const candidate = { metric_type: "resting_heart_rate", measured_at: timestamp, local_date: "2026-09-13", timezone: "Asia/Shanghai", value: 58, unit: "bpm", aggregation_period: "instant" as const };
    const pending = createWorkspaceRecord({ entityType: "health_staging_record", id: "health_staging_fixture", ownerId: "github_lubannn", timestamp, data: createHealthStagingData({ source_label: "手工录入", normalized_json: candidate }, timestamp) });
    const staging = confirmHealthStaging(pending, "health_metric_fixture", "2026-09-13T02:00:00.000Z");
    const metric = createWorkspaceRecord({ entityType: "health_metric", id: "health_metric_fixture", ownerId: "github_lubannn", timestamp: staging.updated_at, data: createConfirmedHealthMetricData(candidate, staging.id) });
    const exported = await buildPortableWorkspaceExport({
      repository: "lubannn/personal-workspace-data", branch: "main", workspaceFile: storedFile("workspace.json", workspaceText, "workspace-blob"), captureFiles: [],
      healthStagingFiles: [storedFile(`data/health-staging-records/${staging.id}.json`, serializeRecord(staging), "staging-blob")],
      healthMetricFiles: [storedFile(`data/health-metrics/${metric.id}.json`, serializeRecord(metric), "metric-blob")],
    });
    await expect(inspectPortableWorkspaceExport(exported)).resolves.toMatchObject({ valid: true, counts: { healthStagingRecords: 1, healthMetrics: 1 } });
  });

  it("exports sleep sessions only with a matching confirmed staging source", async () => {
    const timestamp = "2026-09-13T01:00:00.000Z";
    const pending = createWorkspaceRecord({ entityType: "health_staging_record", id: "health_staging_sleep", ownerId: "github_lubannn", timestamp, data: createSleepHealthStagingData({ source_label: "手工录入", normalized_json: { start_at: "2026-09-12T15:00:00.000Z", end_at: "2026-09-12T23:00:00.000Z", local_date: "2026-09-12", timezone: "Asia/Shanghai", session_type: "main_sleep" } }, timestamp) });
    const staging = confirmHealthStaging(pending, "sleep_session_fixture", "2026-09-13T02:00:00.000Z");
    if (staging.data.health_type !== "sleep_session") throw new Error("unexpected staging type");
    const session = createWorkspaceRecord({ entityType: "sleep_session", id: "sleep_session_fixture", ownerId: "github_lubannn", timestamp: staging.updated_at, data: createConfirmedSleepSessionData(staging.data.normalized_json, staging.id) });
    const exported = await buildPortableWorkspaceExport({
      repository: "lubannn/personal-workspace-data", branch: "main", workspaceFile: storedFile("workspace.json", workspaceText, "workspace-blob"), captureFiles: [],
      healthStagingFiles: [storedFile(`data/health-staging-records/${staging.id}.json`, serializeRecord(staging), "staging-blob")],
      sleepSessionFiles: [storedFile(`data/sleep-sessions/${session.id}.json`, serializeRecord(session), "sleep-blob")],
    });
    await expect(inspectPortableWorkspaceExport(exported)).resolves.toMatchObject({ valid: true, counts: { healthStagingRecords: 1, sleepSessions: 1 } });
  });

  it("exports and inspects a pending formal Workout staging record without requiring a canonical record", async () => {
    const timestamp = "2026-09-19T02:00:00.000Z";
    const staging = createWorkspaceRecord({
      entityType: "health_staging_record", id: `coros_workout_${"c".repeat(64)}`, ownerId: "github_lubannn", timestamp,
      data: createCorosWorkoutStagingData({
        source: { kind: "coros_file", label: "COROS TCX file", format: "tcx", source_sha256: "a".repeat(64), parser_version: "1", mapping_version: "1", batch_identity: "b".repeat(64) },
        import_key: "c".repeat(64),
        normalized_json: { activity_type: "ride", start_at: "2026-09-19T01:00:00.000Z", end_at: "2026-09-19T01:30:00.000Z", timezone: "Asia/Shanghai", duration_seconds: 1800, distance: 12000, distance_unit: "m", training_load: null, metrics_json: { elapsed_seconds: 1800, moving_seconds: 1750, calories: 320, average_heart_rate_bpm: 138, maximum_heart_rate_bpm: 166, average_cadence_rpm: 84, average_power_watts: 190, trackpoints: 2 } },
        diagnostics_json: [],
      }),
    });
    const exported = await buildPortableWorkspaceExport({
      repository: "lubannn/personal-workspace-data", branch: "main", workspaceFile: storedFile("workspace.json", workspaceText, "workspace-blob"), captureFiles: [],
      healthStagingFiles: [storedFile(`data/health-staging-records/${staging.id}.json`, serializeRecord(staging), "workout-staging-blob")],
    });
    await expect(inspectPortableWorkspaceExport(exported)).resolves.toMatchObject({ valid: true, counts: { healthStagingRecords: 1, healthMetrics: 0, sleepSessions: 0 } });
  });

  it("requires confirmed Workout and staging to be present together with matching provenance", async () => {
    const timestamp = "2026-09-19T02:00:00.000Z";
    const importKey = "c".repeat(64);
    const pending = createWorkspaceRecord({
      entityType: "health_staging_record", id: `coros_workout_${importKey}`, ownerId: "github_lubannn", timestamp,
      data: createCorosWorkoutStagingData({
        source: { kind: "coros_file", label: "COROS TCX file", format: "tcx", source_sha256: "a".repeat(64), parser_version: "1", mapping_version: "1", batch_identity: "b".repeat(64) },
        import_key: importKey,
        normalized_json: { activity_type: "ride", start_at: "2026-09-19T01:00:00.000Z", end_at: "2026-09-19T01:30:00.000Z", timezone: "Asia/Shanghai", duration_seconds: 1800, distance: 12000, distance_unit: "m", training_load: null, metrics_json: { elapsed_seconds: 1800, moving_seconds: 1750, calories: 320, average_heart_rate_bpm: 138, maximum_heart_rate_bpm: 166, average_cadence_rpm: 84, average_power_watts: 190, trackpoints: 2 } },
        diagnostics_json: [],
      }),
    });
    const reviewed = confirmWorkoutHealthStaging(pending, timestamp);
    const workout = createWorkspaceRecord({ entityType: "workout", id: `workout_${importKey}`, ownerId: pending.owner_id, timestamp, data: createConfirmedWorkoutData(pending, timestamp) });
    const stagingFile = storedFile(`data/health-staging-records/${reviewed.id}.json`, serializeRecord(reviewed), "staging-blob");
    const workoutFile = storedFile(`data/workouts/${workout.id}.json`, serializeRecord(workout), "workout-blob");
    const build = (stagingFiles = [stagingFile], workoutFiles = [workoutFile]) => buildPortableWorkspaceExport({
      repository: "lubannn/personal-workspace-data", branch: "main", workspaceFile: storedFile("workspace.json", workspaceText, "workspace-blob"), captureFiles: [],
      healthStagingFiles: stagingFiles, workoutFiles,
    });
    await expect(inspectPortableWorkspaceExport(await build())).resolves.toMatchObject({ valid: true, counts: { workouts: 1, healthStagingRecords: 1 } });
    await expect(inspectPortableWorkspaceExport(await build([stagingFile], []))).resolves.toMatchObject({ valid: false, errors: expect.arrayContaining([expect.objectContaining({ code: "WORKOUT_CANONICAL_MISSING" })]) });
    await expect(inspectPortableWorkspaceExport(await build([], [workoutFile]))).resolves.toMatchObject({ valid: false, errors: expect.arrayContaining([expect.objectContaining({ code: "WORKOUT_STAGING_MISMATCH" })]) });
    const mismatched = { ...workout, data: { ...workout.data, source_sha256: "f".repeat(64) } };
    await expect(inspectPortableWorkspaceExport(await build([stagingFile], [storedFile(workoutFile.path, JSON.stringify(mismatched), "mismatched-blob")]))).resolves.toMatchObject({ valid: false, errors: expect.arrayContaining([expect.objectContaining({ code: "WORKOUT_STAGING_MISMATCH" })]) });
  });

  it("rejects a sleep-assisted HabitCheckIn whose SleepSession evidence is missing", async () => {
    const timestamp = "2026-09-13T02:05:00.000Z";
    const habitId = "habit_sleep_fixture";
    const ruleId = "habit_rule_sleep_fixture";
    const checkInId = "habit_check_in_sleep_fixture";
    const habit = createWorkspaceRecord({
      entityType: "habit", id: habitId, ownerId: "github_lubannn", timestamp,
      data: createHabitData({ name: "按时入睡", description_markdown: "", schedule_json: { frequency: "daily", weekdays: [] }, timezone: "Asia/Shanghai", tracking_type: "boolean", target_json: { value: 1, unit: null }, automation_mode: "rule_assisted", start_date: "2026-09-13", end_date: null }),
    });
    const rule = createWorkspaceRecord({
      entityType: "habit_rule", id: ruleId, ownerId: "github_lubannn", timestamp,
      data: createSleepHabitRuleData({ habitId, timezone: "Asia/Shanghai", activeFrom: "2026-09-13", fields: { rule_type: "sleep_start_before", threshold_local_time: "23:30" } }),
    });
    const checkIn = createWorkspaceRecord({
      entityType: "habit_check_in", id: checkInId, ownerId: "github_lubannn", timestamp,
      data: createAutomaticHabitCheckInData({ habitId, localDate: "2026-09-13", timezone: "Asia/Shanghai", status: "completed", valueJson: { observed_local_time: "23:00" }, evidenceType: "health_sleep_session", evidenceId: "sleep_session_missing", ruleId, ruleVersion: 1, evaluatedAt: timestamp, confirmedAt: timestamp }),
    });
    const exported = await buildPortableWorkspaceExport({
      repository: "lubannn/personal-workspace-data", branch: "main", workspaceFile: storedFile("workspace.json", workspaceText, "workspace-blob"), captureFiles: [],
      habitFiles: [storedFile(`data/habits/${habit.id}.json`, serializeRecord(habit), "habit-blob")],
      habitRuleFiles: [storedFile(`data/habit-rules/${rule.id}.json`, serializeRecord(rule), "rule-blob")],
      habitCheckInFiles: [storedFile(`data/habit-check-ins/${checkIn.id}.json`, serializeRecord(checkIn), "check-in-blob")],
    });
    const inspection = await inspectPortableWorkspaceExport(exported);
    expect(inspection.valid).toBe(false);
    expect(inspection.errors.map((error) => error.code)).toContain("HABIT_CHECK_IN_SLEEP_EVIDENCE_MISSING");
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
    expect(inspection.errors.map((error) => error.code)).toContain("JOURNAL_IMPORT_CHECKPOINT_SEGMENT_MISSING");

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

  it("rejects Obsidian baselines and conflicts with cross-reference mismatches", async () => {
    const duplicateBaseline = await sampleExport();
    const originalDocument = duplicateBaseline.files.find((file) => file.path.startsWith("data/obsidian-documents/"))!;
    const duplicateDocument = JSON.parse(originalDocument.content);
    duplicateDocument.id = "obsidian_document_duplicate";
    duplicateDocument.data.journal_entry_id = "journal_entry_other";
    const duplicateText = `${JSON.stringify(duplicateDocument, null, 2)}\n`;
    const duplicatePath = "data/obsidian-documents/obsidian_document_duplicate.json";
    duplicateBaseline.files.push({ path: duplicatePath, content: duplicateText });
    duplicateBaseline.manifest.files.push({ path: duplicatePath, blob_sha: "duplicate-obsidian-blob", size_bytes: new TextEncoder().encode(duplicateText).byteLength, sha256: await sha256Text(duplicateText) });
    duplicateBaseline.manifest.counts.files += 1;
    duplicateBaseline.manifest.counts.obsidian_documents += 1;
    let inspection = await inspectPortableWorkspaceExport(duplicateBaseline);
    expect(inspection.errors.map((error) => error.code)).toContain("DUPLICATE_ACTIVE_OBSIDIAN_DOCUMENT");

    const mismatchedConflict = await sampleExport();
    const conflictFile = mismatchedConflict.files.find((file) => file.path.startsWith("data/sync-conflicts/"))!;
    const conflict = JSON.parse(conflictFile.content);
    conflict.data.journal_entry_id = "journal_entry_other";
    conflictFile.content = `${JSON.stringify(conflict, null, 2)}\n`;
    const conflictManifest = mismatchedConflict.manifest.files.find((file) => file.path === conflictFile.path)!;
    conflictManifest.size_bytes = new TextEncoder().encode(conflictFile.content).byteLength;
    conflictManifest.sha256 = await sha256Text(conflictFile.content);
    inspection = await inspectPortableWorkspaceExport(mismatchedConflict);
    expect(inspection.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      "SYNC_CONFLICT_ENTRY_MISSING",
      "SYNC_CONFLICT_REVISION_MISMATCH",
      "SYNC_CONFLICT_BASELINE_MISMATCH",
    ]));
  });

  it("continues to accept version 1 exports created before dashboard layouts existed", async () => {
    const exported = await sampleExport();
    exported.files = exported.files.filter((file) => file.path !== "config/dashboard-layout.json");
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/tasks/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/time-entries/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/journal-entries/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/journal-segments/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/journal-revisions/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/journal-import-checkpoints/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/obsidian-documents/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/sync-conflicts/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/projects/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/project-phases/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/milestones/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/project-notes/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/project-file-references/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/activity-events/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/calendar-events/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/report-drafts/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/learning-areas/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/learning-goals/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/learning-activities/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/learning-resources/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/habits/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/habit-rules/"));
    exported.files = exported.files.filter((file) => !file.path.startsWith("data/habit-check-ins/"));
    exported.manifest.files = exported.manifest.files.filter((file) => file.path !== "config/dashboard-layout.json");
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/tasks/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/time-entries/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/journal-entries/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/journal-segments/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/journal-revisions/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/journal-import-checkpoints/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/obsidian-documents/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/sync-conflicts/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/projects/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/project-phases/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/milestones/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/project-notes/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/project-file-references/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/activity-events/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/calendar-events/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/report-drafts/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/learning-areas/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/learning-goals/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/learning-activities/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/learning-resources/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/habits/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/habit-rules/"));
    exported.manifest.files = exported.manifest.files.filter((file) => !file.path.startsWith("data/habit-check-ins/"));
    exported.manifest.scope.modules = ["workspace", "captures"];
    exported.manifest.counts = { files: 2, captures: 1 } as typeof exported.manifest.counts;
    await expect(inspectPortableWorkspaceExport(exported)).resolves.toMatchObject({
      valid: true,
      counts: { files: 2, captures: 1, dashboardLayouts: 0, tasks: 0, timeEntries: 0, projects: 0, projectPhases: 0, milestones: 0, projectNotes: 0, projectFileReferences: 0, activityEvents: 0, calendarEvents: 0, reportDrafts: 0, journalEntries: 0, journalSegments: 0, journalRevisions: 0 },
    });
  });
});
