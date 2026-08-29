import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord, setWorkspaceRecordDeleted } from "./protocol";
import { createProjectNoteData, parseProjectNoteRecord, projectNotesForProject, updateProjectNoteDetails } from "./project-notes";

function note(id: string, projectId = "project_pwa", noteDate = "2026-08-29") {
  return createWorkspaceRecord({
    entityType: "project_note",
    id,
    ownerId: "github_lubannn",
    timestamp: "2026-08-29T01:00:00.000Z",
    data: createProjectNoteData({ projectId, title: "阶段复盘", bodyMarkdown: "## 结论\n\n保持事实可追溯。", noteDate }),
  });
}

describe("GitHub project note records", () => {
  it("creates and round-trips canonical Markdown notes", () => {
    expect(parseProjectNoteRecord(serializeRecord(note("project_note_one")))).toMatchObject({
      entity_type: "project_note",
      data: { project_id: "project_pwa", title: "阶段复盘", note_date: "2026-08-29" },
    });
  });

  it("edits note facts with a versioned update", () => {
    expect(updateProjectNoteDetails(note("project_note_edit"), {
      title: "  验收记录  ",
      body_markdown: "- 类型检查通过\n- 构建通过",
      note_date: "2026-08-30",
    }, "2026-08-30T02:00:00.000Z")).toMatchObject({
      version: 2,
      data: { title: "验收记录", note_date: "2026-08-30" },
    });
  });

  it("orders visible project notes by note date and excludes deleted or unrelated notes", () => {
    const deleted = setWorkspaceRecordDeleted(note("project_note_deleted"), "2026-08-30T03:00:00.000Z", "2026-08-30T03:00:00.000Z");
    expect(projectNotesForProject([
      note("project_note_older", "project_pwa", "2026-08-01"),
      note("project_note_other", "project_other", "2026-09-01"),
      deleted,
      note("project_note_newer", "project_pwa", "2026-08-30"),
    ], "project_pwa").map((record) => record.id)).toEqual(["project_note_newer", "project_note_older"]);
  });

  it("rejects invalid dates and oversized bodies", () => {
    expect(() => createProjectNoteData({ projectId: "project_pwa", title: "记录", bodyMarkdown: "", noteDate: "2026-02-31" })).toThrow("INVALID_PROJECT_NOTE_DETAILS");
    expect(() => createProjectNoteData({ projectId: "project_pwa", title: "记录", bodyMarkdown: "x".repeat(100_001), noteDate: "2026-08-29" })).toThrow("INVALID_PROJECT_NOTE_DETAILS");
  });
});
