import { describe, expect, it } from "vitest";
import { createWorkspaceRecord, recordPath, serializeRecord, setWorkspaceRecordDeleted } from "./protocol";
import { createTravelVisitData, isTravelDate, parseTravelVisitRecord, TRAVEL_PROVINCES, visitedTravelProvinces } from "./travel-visits";
import { buildPortableWorkspaceExport, inspectPortableWorkspaceExport } from "./portable-export";
import { createPortableRestorePlan } from "./portable-restore";

const fields = { province_id: "330000", city: " 宁波 ", start_date: "2026-10-06", end_date: "2026-10-06", notes: "" };
function record(id = "travel_test", province = fields.province_id) { return createWorkspaceRecord({ entityType: "travel_visit", id, ownerId: "test_owner", data: createTravelVisitData({ ...fields, province_id: province }) }); }

describe("travel visits", () => {
  it("uses all 34 distinct explicit province identifiers", () => {
    expect(TRAVEL_PROVINCES).toHaveLength(34);
    expect(new Set(TRAVEL_PROVINCES.map(p => p.id)).size).toBe(34);
    expect(TRAVEL_PROVINCES.map(p => p.name)).toEqual(expect.arrayContaining(["北京", "香港", "澳门", "台湾", "新疆"]));
  });
  it("keeps a local date string and the shared version/owner/deletion envelope", () => {
    const current = record();
    expect(recordPath("travel_visit", current.id)).toBe("data/travel-visits/travel_test.json");
    expect(parseTravelVisitRecord(serializeRecord(current))).toEqual(current);
    expect(current).toMatchObject({ owner_id: "test_owner", version: 1, deleted_at: null, schema_version: 1, data: { city: "宁波", start_date: "2026-10-06", end_date: "2026-10-06", notes: "" } });
    for (const date of ["2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31"]) expect(isTravelDate(date)).toBe(true);
  });
  it.each(["", "2026-02-29", "1900-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "0000-01-01", "2026-10-06T00:00:00Z"])("rejects invalid or noncalendar date %s", date => {
    expect(() => createTravelVisitData({ ...fields, start_date: date })).toThrow();
  });
  it("rejects blank cities, unrecognized provinces and incompatible record data", () => {
    expect(() => createTravelVisitData({ ...fields, city: "  " })).toThrow();
    expect(() => createTravelVisitData({ ...fields, province_id: "宁波" })).toThrow();
    expect(() => parseTravelVisitRecord(serializeRecord({ ...record(), data: { ...record().data, travel_visit_version: 3 } }))).toThrow();
  });
  it("requires both valid range endpoints, allows same day, and rejects reversed ranges", () => {
    expect(createTravelVisitData(fields)).toMatchObject({ start_date: fields.start_date, end_date: fields.end_date });
    expect(createTravelVisitData({ ...fields, end_date: "2026-10-10" }).end_date).toBe("2026-10-10");
    for (const range of [{ start_date: "" }, { end_date: "" }, { end_date: "2026-10-05" }, { end_date: "2026-02-30" }]) {
      expect(() => createTravelVisitData({ ...fields, ...range })).toThrow("INVALID_TRAVEL_VISIT");
    }
  });
  it("accepts omitted/empty notes, preserves multiline plain text, and limits note size", () => {
    expect(createTravelVisitData({ ...fields, notes: undefined }).notes).toBe("");
    expect(createTravelVisitData({ ...fields, notes: "  \n  " }).notes).toBe("");
    expect(createTravelVisitData({ ...fields, notes: " 西湖\n提前预约 <提示> " }).notes).toBe("西湖\n提前预约 <提示>");
    expect(() => createTravelVisitData({ ...fields, notes: "x".repeat(2001) })).toThrow();
  });
  it.each([null, "2026-10-06T08:00:00.000Z"])("maps active/trashed legacy single dates without changing metadata (%s)", deletedAt => {
    const original = { ...createWorkspaceRecord({ entityType: "travel_visit", id: "travel_legacy", ownerId: "test_owner", data: { travel_visit_version: 1, province_id: "330000", city: "杭州", visited_on: "2024-02-29" } }), version: 7, deleted_at: deletedAt };
    const text = serializeRecord(original);
    const parsed = parseTravelVisitRecord(text);
    expect(parsed).toEqual({ ...original, data: { travel_visit_version: 2, province_id: "330000", city: "杭州", start_date: "2024-02-29", end_date: "2024-02-29", notes: "" } });
    expect(JSON.parse(text).data.visited_on).toBe("2024-02-29");
    expect(() => parseTravelVisitRecord(serializeRecord({ ...original, data: { ...original.data, visited_on: "2024-02-30" } }))).toThrow();
  });
  it("counts repeated visits once, removes only the last visit, and restores a deleted visit", () => {
    const a = record("travel_a"), b = record("travel_b");
    const c = record("travel_c", "320000"); // The same city text can belong to an explicitly different province.
    expect(visitedTravelProvinces([a, b, c]).size).toBe(2);
    const deletedA = setWorkspaceRecordDeleted(a, new Date().toISOString());
    expect(visitedTravelProvinces([deletedA, b, c]).size).toBe(2);
    const deletedB = setWorkspaceRecordDeleted(b, new Date().toISOString());
    expect([...visitedTravelProvinces([deletedA, deletedB, c])]).toEqual(["320000"]);
    expect(visitedTravelProvinces([setWorkspaceRecordDeleted(deletedA, null), deletedB, c]).size).toBe(2);
  });
  it("exports/restores active and trashed visits while accepting old backups without travel fields", async () => {
    const stored = (path: string, text: string) => ({ path, text, blobSha: "synthetic", sizeBytes: new TextEncoder().encode(text).byteLength });
    const workspace = stored("workspace.json", JSON.stringify({ schema_version: 1, workspace_id: "personal-workspace", owner_id: "test_owner", owner_login: "example", locale: "zh-CN", timezone: "Asia/Shanghai" }));
    const exported = await buildPortableWorkspaceExport({ repository: "example/data", branch: "main", workspaceFile: workspace, captureFiles: [], travelVisitFiles: [record(), setWorkspaceRecordDeleted(createWorkspaceRecord({ entityType: "travel_visit", id: "travel_deleted", ownerId: "test_owner", data: { travel_visit_version: 1, province_id: "330000", city: "旧城市", visited_on: "2024-02-29" } }), new Date().toISOString())].map(r => stored(recordPath("travel_visit", r.id), serializeRecord(r))) });
    await expect(inspectPortableWorkspaceExport(exported)).resolves.toMatchObject({ valid: true, counts: { travelVisits: 2 } });
    const plan = await createPortableRestorePlan(exported, {
      repository: { fullName: "example/restore", private: true, visibility: "private", defaultBranch: "main" },
      branch: { branch: "main", headCommitSha: "synthetic-head", rootTreeSha: "synthetic-tree" },
      rootEntries: [],
    });
    expect(plan.ready).toBe(true);
    expect(plan.files.map(file => file.path)).toContain("data/travel-visits/travel_deleted.json");
    const old = await buildPortableWorkspaceExport({ repository: "example/data", branch: "main", workspaceFile: workspace, captureFiles: [] });
    delete old.manifest.counts.travel_visits;
    old.manifest.scope.modules = old.manifest.scope.modules.filter(m => m !== "travel_visits");
    await expect(inspectPortableWorkspaceExport(old)).resolves.toMatchObject({ valid: true });
  });
});
