import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord } from "./protocol";
import { newestCaptures, newestTrashedCaptures, parseCaptureRecord, parseWorkspaceDescriptor } from "./workspace";

describe("GitHub workspace helpers", () => {
  it("parses the data repository descriptor", () => {
    expect(parseWorkspaceDescriptor(JSON.stringify({
      schema_version: 1,
      workspace_id: "personal-workspace",
      owner_id: "github_lubannn",
      owner_login: "lubannn",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
    }))).toMatchObject({ owner_id: "github_lubannn", timezone: "Asia/Shanghai" });
  });

  it("validates and orders capture records", () => {
    const older = createWorkspaceRecord({
      entityType: "capture",
      id: "capture_old",
      ownerId: "github_lubannn",
      timestamp: "2026-08-24T08:00:00.000Z",
      data: { raw_text: "older", status: "inbox" as const },
    });
    const newer = createWorkspaceRecord({
      entityType: "capture",
      id: "capture_new",
      ownerId: "github_lubannn",
      timestamp: "2026-08-25T08:00:00.000Z",
      data: { raw_text: "newer", status: "inbox" as const },
    });
    expect(newestCaptures([
      parseCaptureRecord(serializeRecord(older)),
      parseCaptureRecord(serializeRecord(newer)),
    ], 1)[0]?.id).toBe("capture_new");
  });

  it("rejects non-capture records", () => {
    const task = createWorkspaceRecord({
      entityType: "task",
      id: "task_1",
      ownerId: "github_lubannn",
      data: { title: "not a capture" },
    });
    expect(() => parseCaptureRecord(serializeRecord(task))).toThrow("INVALID_CAPTURE_RECORD");
  });

  it("keeps deleted records out of the inbox and orders the recycle bin by deletion time", () => {
    const first = {
      ...createWorkspaceRecord({
        entityType: "capture",
        id: "capture_deleted_first",
        ownerId: "github_lubannn",
        data: { raw_text: "first", status: "inbox" as const },
        timestamp: "2026-08-27T01:00:00.000Z",
      }),
      deleted_at: "2026-08-27T03:00:00.000Z",
    };
    const second = { ...first, id: "capture_deleted_second", deleted_at: "2026-08-27T04:00:00.000Z" };

    expect(newestCaptures([first, second])).toEqual([]);
    expect(newestTrashedCaptures([first, second]).map((record) => record.id)).toEqual([
      "capture_deleted_second",
      "capture_deleted_first",
    ]);
  });
});
