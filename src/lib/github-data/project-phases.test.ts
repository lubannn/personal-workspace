import { describe, expect, it } from "vitest";

import { createProjectPhaseData, parseProjectPhaseRecord, phasesForProject } from "./project-phases";
import { createWorkspaceRecord, serializeRecord, setWorkspaceRecordDeleted } from "./protocol";

function phase(id: string, projectId: string, sortOrder: number) {
  return createWorkspaceRecord({
    entityType: "project_phase",
    id,
    ownerId: "github_lubannn",
    timestamp: "2026-08-29T01:00:00.000Z",
    data: createProjectPhaseData({ projectId, name: id, sortOrder, timestamp: "2026-08-29T01:00:00.000Z" }),
  });
}

describe("GitHub project phase records", () => {
  it("creates and round-trips a canonical active phase", () => {
    const record = phase("phase_build", "project_pwa", 10);
    expect(parseProjectPhaseRecord(serializeRecord(record))).toMatchObject({
      entity_type: "project_phase",
      data: { project_id: "project_pwa", name: "phase_build", sort_order: 10, status: "active" },
    });
  });

  it("orders visible phases per project and excludes deleted phases", () => {
    const later = phase("phase_later", "project_pwa", 20);
    const sooner = phase("phase_sooner", "project_pwa", 10);
    const deleted = setWorkspaceRecordDeleted(phase("phase_deleted", "project_pwa", 5), "2026-08-29T02:00:00.000Z", "2026-08-29T02:00:00.000Z");
    const other = phase("phase_other", "project_other", 1);
    expect(phasesForProject([later, deleted, other, sooner], "project_pwa").map((record) => record.id)).toEqual(["phase_sooner", "phase_later"]);
  });

  it("rejects invalid project references and sort order", () => {
    expect(() => createProjectPhaseData({ projectId: "bad id", name: "阶段", sortOrder: 0 })).toThrow("INVALID_PROJECT_PHASE_DETAILS");
    expect(() => createProjectPhaseData({ projectId: "project_pwa", name: "阶段", sortOrder: -1 })).toThrow("INVALID_PROJECT_PHASE_DETAILS");
  });
});
