import { describe, expect, it } from "vitest";
import { GitHubContentsAdapter } from "./github-contents";
import { readTravelVisits, writeTravelVisit } from "./travel-sync";
import { createWorkspaceRecord, serializeRecord } from "./protocol";
import { visitedTravelProvinces } from "./travel-visits";

function cloud() {
  const files = new Map<string, { text: string; sha: string }>();
  const requests: string[] = [];
  let revision = 0;
  const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  const fetcher: typeof fetch = async (url, init) => {
    const path = String(url).split("/contents/")[1]?.split("?")[0];
    requests.push(`${init?.method ?? "GET"} ${path}`);
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      const old = files.get(path);
      if ((old && old.sha !== body.sha) || (!old && body.sha)) return response({}, 409);
      const sha = `sha-${++revision}`;
      files.set(path, { text: Buffer.from(body.content, "base64").toString("utf8"), sha });
      return response({ content: { path, sha }, commit: { sha: `commit-${revision}` } });
    }
    if (path === "data/travel-visits") {
      if (!files.size) return response({}, 404);
      return response([...files].map(([path, file]) => ({ type: "file", name: path.split("/").at(-1), path, sha: file.sha, size: Buffer.byteLength(file.text) })));
    }
    const file = files.get(path);
    return file ? response({ type: "file", path, sha: file.sha, size: Buffer.byteLength(file.text), encoding: "base64", content: Buffer.from(file.text).toString("base64") }) : response({}, 404);
  };
  const adapter = () => new GitHubContentsAdapter({ owner: "example", repository: "synthetic-data", branch: "main", token: "fake-token" }, fetcher);
  return { adapter, files, requests };
}
const fields = { province_id: "330000", city: "同名城市", start_date: "2026-10-06", end_date: "2026-10-08", notes: "西湖\n提前预约" };
describe("travel cloud synchronization", () => {
  it("creates/edits/deletes/restores with SHA checks and persists through new adapters/devices", async () => {
    const remote = cloud();
    const device = remote.adapter();
    expect(await readTravelVisits(device, "test_owner")).toEqual([]);
    const a = await writeTravelVisit(device, "test_owner", { kind: "save", fields, id: "travel_a" });
    const b = await writeTravelVisit(device, "test_owner", { kind: "save", fields, id: "travel_b" });
    const c = await writeTravelVisit(device, "test_owner", { kind: "save", fields: { ...fields, province_id: "320000" }, id: "travel_c" });
    const edited = await writeTravelVisit(device, "test_owner", { kind: "save", current: a, fields: { ...fields, start_date: "2024-02-29", end_date: "2024-03-01", notes: "更新后的提示" } });
    expect(edited.record).toMatchObject({ version: 2, data: { start_date: "2024-02-29", end_date: "2024-03-01", notes: "更新后的提示" } });
    await expect(writeTravelVisit(remote.adapter(), "test_owner", { kind: "save", current: a, fields })).rejects.toMatchObject({ code: "GITHUB_SYNC_CONFLICT" });
    const deletedA = await writeTravelVisit(device, "test_owner", { kind: "delete", current: edited });
    expect(visitedTravelProvinces((await readTravelVisits(remote.adapter(), "test_owner")).map(f => f.record)).size).toBe(2);
    await writeTravelVisit(device, "test_owner", { kind: "delete", current: b });
    expect([...visitedTravelProvinces((await readTravelVisits(remote.adapter(), "test_owner")).map(f => f.record))]).toEqual([c.record.data.province_id]);
    await writeTravelVisit(device, "test_owner", { kind: "restore", current: deletedA });
    expect(visitedTravelProvinces((await readTravelVisits(remote.adapter(), "test_owner")).map(f => f.record)).size).toBe(2);
    expect(remote.requests.every(request => request.includes("data/travel-visits"))).toBe(true);
  });
  it("reads legacy dates without writes, edits ranges/notes, and preserves them across delete/restore and devices", async () => {
    const remote = cloud(), device = remote.adapter();
    const path = "data/travel-visits/travel_legacy.json";
    const text = serializeRecord(createWorkspaceRecord({ entityType: "travel_visit", id: "travel_legacy", ownerId: "test_owner", data: { travel_visit_version: 1, province_id: "330000", city: "旧城市", visited_on: "2024-02-29" } }));
    remote.files.set(path, { text, sha: "legacy-sha" });
    const [legacy] = await readTravelVisits(device, "test_owner");
    expect(legacy.record.data).toMatchObject({ start_date: "2024-02-29", end_date: "2024-02-29", notes: "" });
    expect(remote.files.get(path)?.text).toBe(text);
    expect(remote.requests.every(request => request.startsWith("GET"))).toBe(true);
    const edited = await writeTravelVisit(device, "test_owner", { kind: "save", current: legacy, fields: { ...fields, city: "旧城市" } });
    expect(JSON.parse(remote.files.get(path)!.text).data).not.toHaveProperty("visited_on");
    const removed = await writeTravelVisit(device, "test_owner", { kind: "delete", current: edited });
    const [reloadedTrash] = await readTravelVisits(remote.adapter(), "test_owner");
    expect(reloadedTrash.record.data).toEqual(edited.record.data);
    expect(reloadedTrash.record.deleted_at).not.toBeNull();
    await writeTravelVisit(device, "test_owner", { kind: "restore", current: removed });
    const [restored] = await readTravelVisits(remote.adapter(), "test_owner");
    expect(restored.record.data).toEqual(edited.record.data);
    expect(restored.record.deleted_at).toBeNull();
    await writeTravelVisit(device, "test_owner", { kind: "save", current: restored, fields: { ...fields, notes: "  " } });
    expect((await readTravelVisits(remote.adapter(), "test_owner"))[0].record.data.notes).toBe("");
  });
  it("rejects owner/path/schema mismatches and fails a corrupt snapshot without skipping it", async () => {
    const remote = cloud(), adapter = remote.adapter();
    const created = await writeTravelVisit(adapter, "test_owner", { kind: "save", fields, id: "travel_test" });
    await expect(readTravelVisits(adapter, "someone_else")).rejects.toThrow();
    await expect(writeTravelVisit(adapter, "someone_else", { kind: "delete", current: created })).rejects.toThrow();
    remote.files.set(created.path, { text: "{}", sha: "changed" });
    await expect(readTravelVisits(adapter, "test_owner")).rejects.toThrow();
  });
  it("rejects invalid form input before sending any write", async () => {
    const remote = cloud();
    await expect(writeTravelVisit(remote.adapter(), "test_owner", { kind: "save", fields: { ...fields, start_date: "2026-02-30" } })).rejects.toThrow();
    expect(remote.requests).toEqual([]);
  });
});
