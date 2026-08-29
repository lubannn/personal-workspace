import { describe, expect, it } from "vitest";

import { createMilestoneData, milestonesForProject, parseMilestoneRecord, setMilestoneStatus } from "./milestones";
import { createWorkspaceRecord, serializeRecord, setWorkspaceRecordDeleted } from "./protocol";

function milestone(id: string, projectId = "project_pwa", sortOrder = 10) {
  return createWorkspaceRecord({
    entityType: "milestone",
    id,
    ownerId: "github_lubannn",
    timestamp: "2026-08-29T01:00:00.000Z",
    data: createMilestoneData({ projectId, title: id, targetDate: "2026-09-30", sortOrder }),
  });
}

describe("GitHub milestone records", () => {
  it("creates and round-trips an open milestone", () => {
    expect(parseMilestoneRecord(serializeRecord(milestone("milestone_release")))).toMatchObject({
      entity_type: "milestone",
      data: { project_id: "project_pwa", status: "open", weight: 1, completed_at: null },
    });
  });

  it("completes and reopens with versioned completion facts", () => {
    const completed = setMilestoneStatus(milestone("milestone_status"), "completed", "2026-08-29T02:00:00.000Z");
    expect(completed).toMatchObject({ version: 2, data: { status: "completed", completed_at: "2026-08-29T02:00:00.000Z" } });
    const reopened = setMilestoneStatus(completed, "open", "2026-08-29T03:00:00.000Z");
    expect(reopened).toMatchObject({ version: 3, data: { status: "open", completed_at: null } });
  });

  it("orders visible milestones per project and excludes deleted records", () => {
    const later = milestone("milestone_later", "project_pwa", 20);
    const sooner = milestone("milestone_sooner", "project_pwa", 10);
    const deleted = setWorkspaceRecordDeleted(milestone("milestone_deleted", "project_pwa", 5), "2026-08-29T02:00:00.000Z", "2026-08-29T02:00:00.000Z");
    const other = milestone("milestone_other", "project_other", 1);
    expect(milestonesForProject([later, deleted, other, sooner], "project_pwa").map((record) => record.id)).toEqual(["milestone_sooner", "milestone_later"]);
  });

  it("rejects invalid weights, dates, and completion facts", () => {
    const invalidWeight = milestone("milestone_weight");
    invalidWeight.data.weight = 0;
    expect(() => parseMilestoneRecord(serializeRecord(invalidWeight))).toThrow("INVALID_MILESTONE_RECORD");
    expect(() => createMilestoneData({ projectId: "project_pwa", title: "里程碑", targetDate: "2026-02-31", sortOrder: 0 })).toThrow("INVALID_MILESTONE_DETAILS");
  });
});
