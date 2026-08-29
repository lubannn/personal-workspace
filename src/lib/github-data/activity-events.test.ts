import { describe, expect, it } from "vitest";

import { createActivityEventData, activityEventsForProject, parseActivityEventRecord } from "./activity-events";
import { createWorkspaceRecord, serializeRecord } from "./protocol";

function event(id: string, projectId = "project_pwa", occurredAt = "2026-08-29T03:00:00.000Z") {
  return createWorkspaceRecord({
    entityType: "activity_event",
    id,
    ownerId: "github_lubannn",
    timestamp: occurredAt,
    data: createActivityEventData({
      projectId,
      eventType: "project.updated",
      occurredAt,
      actorId: "github_lubannn",
      changeSummary: { name: "PWA 正式主页面", progress_mode: "milestones" },
      sourceRef: "project_pwa",
    }),
  });
}

describe("GitHub activity event records", () => {
  it("creates and round-trips immutable project activity", () => {
    expect(parseActivityEventRecord(serializeRecord(event("activity_one")))).toMatchObject({
      entity_type: "activity_event",
      version: 1,
      data: { entity_type: "project", entity_id: "project_pwa", event_type: "project.updated" },
    });
  });

  it("orders a project timeline newest first and excludes other projects", () => {
    expect(activityEventsForProject([
      event("activity_old", "project_pwa", "2026-08-29T01:00:00.000Z"),
      event("activity_other", "project_other", "2026-08-29T04:00:00.000Z"),
      event("activity_new", "project_pwa", "2026-08-29T03:00:00.000Z"),
    ], "project_pwa").map((record) => record.id)).toEqual(["activity_new", "activity_old"]);
  });

  it("rejects mutable or structurally unsafe activity records", () => {
    expect(() => parseActivityEventRecord(serializeRecord({ ...event("activity_mutated"), version: 2 }))).toThrow("INVALID_ACTIVITY_EVENT_RECORD");
    expect(() => createActivityEventData({
      projectId: "project_pwa",
      eventType: "project.updated",
      occurredAt: "invalid",
      actorId: "github_lubannn",
      changeSummary: { nested: {} as never },
    })).toThrow("INVALID_ACTIVITY_EVENT_DETAILS");
  });
});
