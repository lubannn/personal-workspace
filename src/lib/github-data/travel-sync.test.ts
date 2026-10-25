import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GitHubContentsAdapter } from "./github-contents";
import { readTravelVisits, writeTravelVisit } from "./travel-sync";
import { createWorkspaceRecord, serializeRecord } from "./protocol";
import { createTravelVisitData, visitedTravelProvinces } from "./travel-visits";

const blobSha = (text: string) => createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0${text}`).digest("hex");
function cloud(graphQL = true) {
  const files = new Map<string, { text: string; sha: string }>();
  const requests: string[] = [];
  let revision = 0;
  let directoryStatus = 200;
  const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).endsWith("/graphql")) {
      requests.push("POST graphql");
      if (!graphQL) return response({}, 403);
      const { variables } = JSON.parse(String(init?.body)) as { variables: Record<string, string> };
      return response({ data: { repository: Object.fromEntries(Object.entries(variables).filter(([key]) => key.startsWith("oid")).map(([key, oid]) => {
        const file = [...files.values()].find(file => file.sha === oid);
        return [`blob${key.slice(3)}`, file ? { __typename: "Blob", oid, byteSize: Buffer.byteLength(file.text), isTruncated: false, text: file.text } : null];
      })) } });
    }
    if (String(url).includes("/git/blobs/")) {
      const oid = String(url).split("/git/blobs/")[1];
      requests.push(`GET blob/${oid}`);
      const file = [...files.values()].find(file => file.sha === oid);
      return file ? response({ sha: oid, size: Buffer.byteLength(file.text), encoding: "base64", content: Buffer.from(file.text).toString("base64") }) : response({}, 404);
    }
    const path = String(url).split("/contents/")[1]?.split("?")[0];
    requests.push(`${init?.method ?? "GET"} ${path}`);
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      const old = files.get(path);
      if ((old && old.sha !== body.sha) || (!old && body.sha)) return response({}, 409);
      const text = Buffer.from(body.content, "base64").toString("utf8");
      const sha = blobSha(text);
      revision++;
      files.set(path, { text, sha });
      return response({ content: { path, sha }, commit: { sha: `commit-${revision}` } });
    }
    if (path === "data/travel-visits") {
      if (directoryStatus !== 200) return response({}, directoryStatus);
      if (!files.size) return response({}, 404);
      return response([...files].map(([path, file]) => ({ type: "file", name: path.split("/").at(-1), path, sha: file.sha, size: Buffer.byteLength(file.text) })));
    }
    const file = files.get(path);
    return file ? response({ type: "file", path, sha: file.sha, size: Buffer.byteLength(file.text), encoding: "base64", content: Buffer.from(file.text).toString("base64") }) : response({}, 404);
  };
  const adapter = (transport = fetcher) => new GitHubContentsAdapter({ owner: "example", repository: "synthetic-data", branch: "main", token: "fake-token" }, transport);
  return { adapter, fetcher, files, requests, setDirectoryStatus: (status: number) => { directoryStatus = status; } };
}
const fields = { province_id: "330000", city: "同名城市", start_date: "2026-10-06", end_date: "2026-10-08", notes: "西湖\n提前预约" };
function seed(remote: ReturnType<typeof cloud>, count: number) {
  for (let i = 0; i < count; i++) {
    const id = `travel_${i}`, path = `data/travel-visits/${id}.json`;
    const text = serializeRecord(createWorkspaceRecord({ entityType: "travel_visit", id, ownerId: "test_owner", data: createTravelVisitData(fields) }));
    remote.files.set(path, { text, sha: blobSha(text) });
  }
}
describe("travel cloud synchronization", () => {
  it("keeps REST travel at six active reads, probes only once, and caches only verified bodies", async () => {
    const remote = cloud(false); seed(remote, 60);
    let active = 0, peak = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const adapter = remote.adapter(async (url, init) => {
      if (!String(url).includes("/git/blobs/")) return remote.fetcher(url, init);
      active++; peak = Math.max(peak, active);
      try { await gate; return await remote.fetcher(url, init); }
      finally { active--; }
    });
    const pending = readTravelVisits(adapter, "test_owner");
    await vi.waitFor(() => expect(active).toBe(6));
    expect(remote.requests).toEqual(["GET data/travel-visits", "POST graphql"]);
    release(); expect(await pending).toHaveLength(60);
    expect(peak).toBe(6);
    expect(remote.requests.filter(r => r === "POST graphql")).toHaveLength(1);
    expect(remote.requests.filter(r => r.startsWith("GET blob/"))).toHaveLength(60);
    remote.requests.length = 0;
    expect(await readTravelVisits(adapter, "test_owner")).toHaveLength(60);
    expect(remote.requests).toEqual(["GET data/travel-visits"]);
  });
  it.each([true, false])("cancels obsolete reads without queued requests or cache pollution, then retries (GraphQL: %s)", async graphQL => {
    const remote = cloud(graphQL); seed(remote, 60);
    const controller = new AbortController();
    const reason = new Error("Travel session cleared");
    let started = 0;
    const adapter = remote.adapter(async (url, init) => {
      const isBody = String(url).includes("/git/blobs/") || (graphQL && String(url).endsWith("/graphql"));
      if (isBody && !controller.signal.aborted) {
        started++;
        await new Promise<void>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(reason), { once: true }));
      }
      return remote.fetcher(url, init);
    });
    const pending = readTravelVisits(adapter, "test_owner", { signal: controller.signal });
    const rejected = expect(pending).rejects.toBe(reason);
    await vi.waitFor(() => expect(started).toBe(graphQL ? 1 : 6));
    controller.abort(reason); await rejected;
    expect(started).toBe(graphQL ? 1 : 6);
    remote.requests.length = 0;
    expect(await readTravelVisits(adapter, "test_owner")).toHaveLength(60);
    expect(remote.requests.filter(r => r === "POST graphql")).toHaveLength(graphQL ? 3 : 0);
    expect(remote.requests.filter(r => r.startsWith("GET blob/"))).toHaveLength(graphQL ? 0 : 60);
  });
  it("stops an obsolete directory response before any body reads", async () => {
    const remote = cloud(); seed(remote, 1);
    let current = true;
    const adapter = remote.adapter(async (url, init) => { const response = await remote.fetcher(url, init); current = false; return response; });
    await expect(readTravelVisits(adapter, "test_owner", { isCurrent: () => current })).rejects.toThrow("TRAVEL_LOAD_CANCELLED");
    expect(remote.requests).toEqual(["GET data/travel-visits"]);
  });
  it.each([true, false])("revalidates the directory and reuses only unchanged SHA bodies (GraphQL: %s)", async graphQL => {
    const remote = cloud(graphQL), adapter = remote.adapter();
    const stored = await writeTravelVisit(adapter, "test_owner", { kind: "save", fields, id: "travel_cached" });
    await readTravelVisits(adapter, "test_owner");
    remote.requests.length = 0;
    expect(await readTravelVisits(adapter, "test_owner")).toEqual([stored]);
    expect(remote.requests).toEqual(["GET data/travel-visits"]);
    // A different device can change or remove records; the old body is never a
    // substitute for the current, authenticated directory's set of file SHAs.
    const changed = await writeTravelVisit(remote.adapter(), "test_owner", { kind: "save", current: stored, fields: { ...fields, notes: "另一设备更新" } });
    remote.requests.length = 0;
    expect(await readTravelVisits(adapter, "test_owner")).toEqual([changed]);
    expect(remote.requests).toHaveLength(2);
    expect(remote.requests[1]).toBe(graphQL ? "POST graphql" : `GET blob/${changed.blobSha}`);
    remote.files.delete(stored.path);
    remote.requests.length = 0;
    expect(await readTravelVisits(adapter, "test_owner")).toEqual([]);
    expect(remote.requests).toEqual(["GET data/travel-visits"]);
  });
  it("batches cold bodies and keeps cache isolated to the authenticated adapter", async () => {
    const remote = cloud(), adapter = remote.adapter();
    seed(remote, 60);
    expect(await readTravelVisits(adapter, "test_owner")).toHaveLength(60);
    expect(remote.requests).toEqual(["GET data/travel-visits", "POST graphql", "POST graphql", "POST graphql"]);
    remote.requests.length = 0;
    await readTravelVisits(remote.adapter(), "test_owner");
    expect(remote.requests).toHaveLength(4);
    remote.requests.length = 0;
    await expect(readTravelVisits(adapter, "different_owner")).rejects.toThrow("TRAVEL_SNAPSHOT_CHANGED");
    expect(remote.requests).toEqual(["GET data/travel-visits"]);
  });
  it("requires remote authorization even with cached bodies and recovers after retry", async () => {
    const remote = cloud(), adapter = remote.adapter();
    const saved = await writeTravelVisit(adapter, "test_owner", { kind: "save", fields, id: "travel_auth" });
    await readTravelVisits(adapter, "test_owner");
    remote.setDirectoryStatus(401);
    remote.requests.length = 0;
    await expect(readTravelVisits(adapter, "test_owner")).rejects.toMatchObject({ code: "GITHUB_UNAUTHORIZED" });
    expect(remote.requests).toEqual(["GET data/travel-visits"]);
    remote.setDirectoryStatus(200);
    expect(await readTravelVisits(adapter, "test_owner")).toEqual([saved]);
  });
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
    expect(remote.requests.every(request => request.includes("data/travel-visits") || request === "POST graphql")).toBe(true);
  });
  it("reads legacy dates without writes, edits ranges/notes, and preserves them across delete/restore and devices", async () => {
    const remote = cloud(), device = remote.adapter();
    const path = "data/travel-visits/travel_legacy.json";
    const text = serializeRecord(createWorkspaceRecord({ entityType: "travel_visit", id: "travel_legacy", ownerId: "test_owner", data: { travel_visit_version: 1, province_id: "330000", city: "旧城市", visited_on: "2024-02-29" } }));
    remote.files.set(path, { text, sha: blobSha(text) });
    const [legacy] = await readTravelVisits(device, "test_owner");
    expect(legacy.record.data).toMatchObject({ start_date: "2024-02-29", end_date: "2024-02-29", notes: "" });
    expect(remote.files.get(path)?.text).toBe(text);
    expect(remote.requests.every(request => !request.startsWith("PUT"))).toBe(true);
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
    remote.files.set(created.path, { text: "{}", sha: blobSha("{}") });
    await expect(readTravelVisits(adapter, "test_owner")).rejects.toThrow();
  });
  it("rejects invalid form input before sending any write", async () => {
    const remote = cloud();
    await expect(writeTravelVisit(remote.adapter(), "test_owner", { kind: "save", fields: { ...fields, start_date: "2026-02-30" } })).rejects.toThrow();
    expect(remote.requests).toEqual([]);
  });
});
