import { describe, expect, it } from "vitest";
import { GitHubContentsAdapter } from "./github-contents";
import { readNotices, writeNotice } from "./notice-sync";
import { createWorkspaceRecord, serializeRecord } from "./protocol";
import { createNoticeData, NOTICE_MAX_LENGTH, parseNoticeRecord } from "./notices";
import { buildPortableWorkspaceExport, inspectPortableWorkspaceExport } from "./portable-export";
import { createPortableRestorePlan } from "./portable-restore";
import { dryRunPortableWorkspaceMigrations } from "./schema-migrations";

function cloud() {
  const files = new Map<string, { text: string; sha: string }>();
  const requests: string[] = [];
  let revision = 0;
  let failure: "before" | "after" | null = null;
  let mismatch = false;
  const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  const fetcher: typeof fetch = async (url, init) => {
    const path = String(url).split("/contents/")[1]?.split("?")[0];
    requests.push(`${init?.method ?? "GET"} ${path}`);
    if (init?.method === "PUT") {
      if (failure === "before") { failure = null; throw new TypeError("synthetic network failure"); }
      const body = JSON.parse(String(init.body));
      const old = files.get(path);
      if ((old && old.sha !== body.sha) || (!old && body.sha)) return response({}, 409);
      const sha = `sha-${++revision}`;
      files.set(path, { text: Buffer.from(body.content, "base64").toString("utf8"), sha });
      if (failure === "after") { failure = null; throw new TypeError("synthetic lost response"); }
      return response({ content: { path, sha }, commit: { sha: `commit-${revision}` } });
    }
    if (path === "data/notices") {
      if (!files.size) return response({}, 404);
      return response([...files].map(([path, file]) => ({ type: "file", name: path.split("/").at(-1), path, sha: mismatch ? "stale-sha" : file.sha, size: Buffer.byteLength(file.text) })));
    }
    const file = files.get(path);
    return file ? response({ type: "file", path, sha: file.sha, size: Buffer.byteLength(file.text), encoding: "base64", content: Buffer.from(file.text).toString("base64") }) : response({}, 404);
  };
  const adapter = () => new GitHubContentsAdapter({ owner: "example", repository: "synthetic-data", branch: "main", token: "fake-token" }, fetcher);
  return { adapter, files, requests, fail: (mode: typeof failure) => { failure = mode; }, mismatch: () => { mismatch = true; } };
}

const body = "先完成最重要的一件事。\n  留出时间休息。\n<script>alert('test')</script>";
const ownerId = "test_owner";
const timestamp = "2026-10-08T01:00:00.000Z";

describe("notices and private Git persistence", () => {
  it("creates, edits, soft deletes and restores across new adapters without browsing writes", async () => {
    const remote = cloud(), adapter = remote.adapter();
    expect(await readNotices(adapter, ownerId)).toEqual([]);
    const created = await writeNotice(adapter, ownerId, { kind: "save", body, id: "notice_a", timestamp });
    const edited = await writeNotice(adapter, ownerId, { kind: "save", body: "更新\n多行内容", current: created, timestamp });
    expect(edited.record).toMatchObject({ version: 2, data: { body: "更新\n多行内容" } });
    const deleted = await writeNotice(adapter, ownerId, { kind: "delete", current: edited, timestamp });
    expect((await readNotices(remote.adapter(), ownerId))[0].record.deleted_at).toBe(timestamp);
    await writeNotice(adapter, ownerId, { kind: "restore", current: deleted, timestamp });
    const writesBeforeRead = remote.requests.filter(r => r.startsWith("PUT")).length;
    const [refreshed] = await readNotices(remote.adapter(), ownerId);
    expect(refreshed.record).toMatchObject({ version: 4, deleted_at: null, data: edited.record.data });
    expect(remote.requests.filter(r => r.startsWith("PUT"))).toHaveLength(writesBeforeRead);
    expect(remote.requests.every(r => r.includes("data/notices"))).toBe(true);
  });

  it("blocks stale edit/delete/restore instead of overwriting another device", async () => {
    const remote = cloud(), adapter = remote.adapter();
    const original = await writeNotice(adapter, ownerId, { kind: "save", body, id: "notice_a", timestamp });
    const edited = await writeNotice(remote.adapter(), ownerId, { kind: "save", body: "其他设备", current: original, timestamp });
    for (const input of [ { kind: "save" as const, body: "本机草稿", current: original }, { kind: "delete" as const, current: original } ]) {
      await expect(writeNotice(adapter, ownerId, input)).rejects.toMatchObject({ code: "GITHUB_SYNC_CONFLICT" });
    }
    const deleted = await writeNotice(adapter, ownerId, { kind: "delete", current: edited, timestamp });
    const restored = await writeNotice(remote.adapter(), ownerId, { kind: "restore", current: deleted, timestamp });
    await expect(writeNotice(adapter, ownerId, { kind: "restore", current: deleted })).rejects.toMatchObject({ code: "GITHUB_SYNC_CONFLICT" });
    expect((await readNotices(adapter, ownerId))[0]).toEqual(restored);
  });

  it("retains an exact submission identity for duplicate and failed create retries", async () => {
    const remote = cloud(), adapter = remote.adapter();
    const input = { kind: "save" as const, body, id: "notice_retry", timestamp };
    remote.fail("before");
    await expect(writeNotice(adapter, ownerId, input)).rejects.toThrow();
    expect(remote.files.size).toBe(0);
    const created = await writeNotice(adapter, ownerId, input);
    expect(await writeNotice(adapter, ownerId, input)).toEqual(created);
    expect(remote.files.size).toBe(1);
    expect(created.record.version).toBe(1);
  });

  it("acknowledges lost responses only when exact remote text matches", async () => {
    const remote = cloud(), adapter = remote.adapter();
    remote.fail("after");
    const created = await writeNotice(adapter, ownerId, { kind: "save", body, id: "notice_lost", timestamp });
    remote.fail("after");
    const edited = await writeNotice(adapter, ownerId, { kind: "save", body: "新内容", current: created, timestamp });
    expect(edited.record.version).toBe(2);
    expect(remote.files.size).toBe(1);
    await expect(writeNotice(adapter, ownerId, { kind: "save", body: "不同内容", id: "notice_lost", timestamp })).rejects.toMatchObject({ code: "GITHUB_SYNC_CONFLICT" });
  });

  it("fails corrupt/foreign/moved/version-mismatched snapshots and rejects bad writes", async () => {
    const remote = cloud(), adapter = remote.adapter();
    const current = await writeNotice(adapter, ownerId, { kind: "save", body, id: "notice_a" });
    await expect(readNotices(adapter, "another_owner")).rejects.toThrow();
    await expect(writeNotice(adapter, "another_owner", { kind: "delete", current })).rejects.toThrow();
    await expect(writeNotice(adapter, ownerId, { kind: "delete", current: { ...current, path: "data/notices/wrong.json" } })).rejects.toThrow();
    remote.mismatch();
    await expect(readNotices(adapter, ownerId)).rejects.toThrow("NOTICE_SNAPSHOT_CHANGED");
    remote.files.set(current.path, { text: "{}", sha: "bad-sha" });
    await expect(readNotices(adapter, ownerId)).rejects.toThrow();
    const requests = remote.requests.length;
    for (const invalid of ["", " \n ", "长".repeat(NOTICE_MAX_LENGTH + 1)]) await expect(writeNotice(adapter, ownerId, { kind: "save", body: invalid })).rejects.toThrow("INVALID_NOTICE");
    expect(remote.requests).toHaveLength(requests);
  });

  it("keeps plain text, line breaks, short/long content and rejects invalid schemas", () => {
    for (const content of ["短", body, "长".repeat(NOTICE_MAX_LENGTH)]) {
      const record = createWorkspaceRecord({ entityType: "notice", id: "notice_a", ownerId, data: createNoticeData(content), timestamp });
      expect(parseNoticeRecord(serializeRecord(record)).data.body).toBe(content);
      for (const override of [{ schema_version: 2 }, { version: 1.5 }, { deleted_at: undefined }, { created_at: "invalid" }, { entity_type: "capture" }, { data: { body: 1 } }]) expect(() => parseNoticeRecord(JSON.stringify({ ...record, ...override }))).toThrow();
    }
  });
});

function stored(path: string, text: string) { return { path, text, blobSha: "a".repeat(40), sizeBytes: Buffer.byteLength(text) }; }
async function exportedNotices() {
  const remote = cloud(), adapter = remote.adapter();
  const active = await writeNotice(adapter, ownerId, { kind: "save", body, id: "notice_active", timestamp });
  const trash = await writeNotice(adapter, ownerId, { kind: "save", body: "可恢复的通告", id: "notice_trash", timestamp });
  const deleted = await writeNotice(adapter, ownerId, { kind: "delete", current: trash, timestamp });
  return buildPortableWorkspaceExport({ repository: "example/synthetic-data", branch: "main", generatedAt: timestamp,
    workspaceFile: stored("workspace.json", JSON.stringify({ schema_version: 1, workspace_id: "test_workspace", owner_id: ownerId, owner_login: "example", locale: "zh-CN", timezone: "Asia/Shanghai" })), captureFiles: [],
    noticeFiles: [stored(active.path, serializeRecord(active.record)), stored(deleted.path, serializeRecord(deleted.record))],
  });
}

describe("portable notice export and restore", () => {
  it("exports active and trashed notices, verifies checksums and plans guarded restore", async () => {
    const exported = await exportedNotices();
    expect(exported.manifest.counts.notices).toBe(2);
    expect(exported.manifest.scope.modules).toContain("notices");
    expect(await inspectPortableWorkspaceExport(exported)).toMatchObject({ valid: true, counts: { notices: 2 } });
    expect(await dryRunPortableWorkspaceMigrations(exported)).toMatchObject({ valid: true, counts: { current: 3, blocked: 0 } });
    const plan = await createPortableRestorePlan(exported, {
      repository: { fullName: "example/synthetic-restore", private: true, visibility: "private", defaultBranch: "main" },
      branch: { branch: "main", headCommitSha: "b".repeat(40), rootTreeSha: "c".repeat(40) }, rootEntries: [],
    });
    expect(plan).toMatchObject({ ready: true, counts: { notices: 2 }, expectedHeadCommitSha: "b".repeat(40) });
    expect(plan.files.filter(f => f.path.startsWith("data/notices/"))).toHaveLength(2);
    exported.files[1].content += " ";
    expect((await inspectPortableWorkspaceExport(exported)).errors.some(e => e.code === "FILE_HASH_MISMATCH")).toBe(true);
  });

  it("accepts older exports without notices and catches manifest count mismatches", async () => {
    const exported = await exportedNotices();
    exported.manifest.counts.notices = 1;
    expect((await inspectPortableWorkspaceExport(exported)).errors.map(e => e.code)).toContain("NOTICE_COUNT_MISMATCH");
    exported.files = exported.files.filter(f => !f.path.startsWith("data/notices/"));
    exported.manifest.files = exported.manifest.files.filter(f => !f.path.startsWith("data/notices/"));
    exported.manifest.counts.files = 1;
    delete exported.manifest.counts.notices;
    exported.manifest.scope.modules = exported.manifest.scope.modules.filter(m => m !== "notices");
    expect(await inspectPortableWorkspaceExport(exported)).toMatchObject({ valid: true, counts: { notices: 0 } });
  });
});
