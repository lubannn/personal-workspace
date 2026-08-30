import { describe, expect, it } from "vitest";
import { createWorkspaceRecord, serializeRecord, setWorkspaceRecordDeleted } from "./protocol";
import { activeTimeEntries, createTimeEntryData, parseTimeEntryRecord, trashedTimeEntries } from "./time-entries";

describe("time entries", () => {
  it("creates a manual duration without inventing clock times", () => {
    const data = createTimeEntryData({ taskId: "task_1", projectId: "project_1", localDate: "2026-08-31", timezone: "Asia/Shanghai", durationMinutes: 75, notesMarkdown: "实现报告" });
    const record = createWorkspaceRecord({ entityType: "time_entry", id: "time_entry_1", ownerId: "owner_1", data, timestamp: "2026-08-31T03:00:00.000Z" });
    expect(parseTimeEntryRecord(serializeRecord(record))).toEqual(record);
    expect(record.data).toMatchObject({ started_at: null, ended_at: null, entry_method: "manual_duration", duration_minutes: 75 });
  });

  it("rejects invalid dates, timezones, duration and IDs", () => {
    const base = { taskId: "task_1", projectId: null, localDate: "2026-08-31", timezone: "Asia/Shanghai", durationMinutes: 30 };
    expect(() => createTimeEntryData({ ...base, durationMinutes: 0 })).toThrow("INVALID_TIME_ENTRY_DETAILS");
    expect(() => createTimeEntryData({ ...base, localDate: "2026-02-30" })).toThrow("INVALID_TIME_ENTRY_DETAILS");
    expect(() => createTimeEntryData({ ...base, timezone: "Mars/Olympus" })).toThrow("INVALID_TIME_ENTRY_DETAILS");
    expect(() => createTimeEntryData({ ...base, taskId: "bad/id" })).toThrow("INVALID_TIME_ENTRY_DETAILS");
  });

  it("sorts active and trashed entries deterministically", () => {
    const make = (id: string, date: string) => createWorkspaceRecord({ entityType: "time_entry" as const, id, ownerId: "owner_1", data: createTimeEntryData({ taskId: "task_1", projectId: null, localDate: date, timezone: "Asia/Shanghai", durationMinutes: 30 }), timestamp: `${date}T01:00:00.000Z` });
    const old = make("time_old", "2026-08-30");
    const recent = make("time_recent", "2026-08-31");
    const trashed = setWorkspaceRecordDeleted(make("time_trash", "2026-08-29"), "2026-08-31T04:00:00.000Z");
    expect(activeTimeEntries([old, recent, trashed]).map((record) => record.id)).toEqual(["time_recent", "time_old"]);
    expect(trashedTimeEntries([old, recent, trashed]).map((record) => record.id)).toEqual(["time_trash"]);
  });
});
