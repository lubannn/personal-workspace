import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createWorkspaceRecord } from "../../../../src/lib/github-data/protocol";
import { createProjectData } from "../../../../src/lib/github-data/projects";
import { ProjectsSection } from "./projects-section";

const project = { record: createWorkspaceRecord({ entityType: "project", id: "project_synthetic", ownerId: "test_owner", data: { ...createProjectData("合成项目", "2026-10-25"), description_markdown: "验收标准：完成合成目标。" } }), path: "synthetic", blobSha: "synthetic" };
function projects(overrides: Partial<ComponentProps<typeof ProjectsSection>> = {}) {
  return renderToStaticMarkup(createElement(ProjectsSection, {
    connection: { repository: "example/synthetic", ownerId: "test_owner", ownerLogin: "example", timezone: "UTC" }, online: true,
    projectName: "", projectTargetDate: "", projectFiles: [project], projectPhaseFiles: [], milestoneFiles: [], projectNoteFiles: [], projectFileReferenceFiles: [], activityEventFiles: [],
    currentProjectFiles: [project], completedProjectFiles: [], cancelledProjectFiles: [], archivedProjectFiles: [], trashedProjectFiles: [], visibleProjectFiles: [project], projectView: "current", taskFiles: [], calendarEventFiles: [], loadingCalendarEvents: false, onOpenCalendar: () => {}, onOpenReport: () => {},
    loadingProjects: false, loadingTasks: false, loadingProjectPhases: false, loadingMilestones: false, loadingProjectNotes: false, loadingProjectFileReferences: false, loadingActivityEvents: false,
    savingProject: false, savingProjectId: null, savingProjectPhaseProjectId: null, savingMilestoneProjectId: null, savingMilestoneId: null, savingProjectNoteProjectId: null, savingProjectNoteId: null, savingProjectFileReferenceProjectId: null,
    currentDate: "2026-10-22", onProjectNameChange: () => {}, onProjectTargetDateChange: () => {}, onCreateProject: async () => null, onProjectViewChange: () => {}, onLifecycleChange: () => {}, onDeletionChange: () => {},
    onEditProject: async () => true, onCreatePhase: async () => true, onSetCurrentPhase: () => {}, onCreateMilestone: async () => true, onMilestoneLifecycle: () => {}, onCreateProjectNote: async () => true, onEditProjectNote: async () => true, onCreateProjectFileReference: async () => true, onRefresh: () => {}, onOpenTasks: () => {}, ...overrides,
  }));
}
describe("project workspace", () => {
  it("defaults to a project overview with the real description and progress source, keeping creation and management behind controls", () => {
    const html = projects();
    expect(html).toContain("验收标准：完成合成目标。");
    expect(html).toContain('role="progressbar" aria-label="按关联任务" aria-valuenow="0"');
    expect(html).toContain('aria-label="搜索项目"');
    expect(html).toContain('aria-label="更多项目操作"');
    expect(html).not.toContain('id="project-create"');
    expect(html).not.toContain("Phase 2");
    expect(html).not.toContain('class="project-phase-manager"');
    expect(html).not.toContain('<details class="projects-more" open');
  });
  it("disables mutations and refresh offline without preventing project browsing", () => {
    const html = projects({ online: false });
    expect(html).toContain("当前离线，可查看已加载的项目");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>编辑项目/);
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*disabled=""/);
    expect(html).toMatch(/<button class="projects-directory-item selected"[^>]*aria-pressed="true"[^>]*>/);
  });
  it("keeps a restore action in trash while removing lifecycle mutations", () => {
    const html = projects({ projectView: "trash" });
    expect(html).toContain("恢复项目");
    expect(html).not.toContain("编辑项目");
    expect(html).not.toContain("移到回收站");
    expect(html).not.toContain("更多项目操作");
  });
  it("selects the requested project on first mount when opened from a calendar record", () => {
    const other = { ...project, record: { ...project.record, id: "project_other", data: { ...project.record.data, name: "另一个合成项目" } } };
    const html = projects({ projectFiles: [project, other], visibleProjectFiles: [project, other], currentProjectFiles: [project, other], focusRequest: { projectId: other.record.id } });
    expect(html).toContain('<h3>另一个合成项目</h3>');
    expect(html).toContain("日程 0");
    expect(html).toContain("查看项目报告");
  });
  it("does not invent projects or progress while disconnected or loading", () => {
    expect(projects({ connection: null })).toContain("连接数据仓库后，从一个项目开始");
    expect(projects({ loadingProjects: true, projectFiles: [], visibleProjectFiles: [] })).toContain("正在读取项目…");
    const loading = projects({ loadingTasks: true });
    expect(loading).toContain("正在读取进度依据…");
    expect(loading).not.toContain('aria-valuenow="0"');
  });
});
