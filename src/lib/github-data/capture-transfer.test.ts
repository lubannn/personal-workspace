import { describe, expect, it, vi } from "vitest";
import { transferCapture } from "./capture-transfer";
import { suggestCapture, type CaptureFields } from "./capture-details";
import { createWorkspaceRecord, serializeRecord } from "./protocol";
import { parseCaptureRecord } from "./workspace";
import { GitHubConflictError, GitHubDataError } from "./github-contents";
import { buildPortableWorkspaceExport, inspectPortableWorkspaceExport } from "./portable-export";
import { createPortableRestorePlan } from "./portable-restore";
import { dryRunPortableWorkspaceMigrations } from "./schema-migrations";

const context = { ownerId: "test_owner", timestamp: "2026-10-04T08:00:00.000Z", today: "2026-10-04" };
const source = { record: createWorkspaceRecord({ ownerId: context.ownerId, entityType: "capture", id: "capture_old", timestamp: context.timestamp, data: { raw_text: "旧随手记", status: "inbox" as const } }), path: "data/captures/capture_old.json", blobSha: "source_blob" };
function fields(text: string): CaptureFields { return { rawText: text, ...suggestCapture(text, new Date(context.timestamp)), timezone: "Asia/Shanghai" }; }
function repository() {
  const files = new Map([[source.path, { text: serializeRecord(source.record), path: source.path, blobSha: source.blobSha }]]);
  let head = "head";
  const adapter = {
    readBranchSnapshot: vi.fn(async () => ({ branch: "main", headCommitSha: head, rootTreeSha: "tree" })),
    readText: vi.fn(async (path: string, _ref?: string) => { if (!_ref) throw new Error("Snapshot reference required"); const file = files.get(path); if (!file) throw new GitHubDataError("missing", 404, "GITHUB_NOT_FOUND"); return { ...file, sizeBytes: file.text.length }; }),
    writeAtomicFiles: vi.fn(async (input: { files: { path: string; text: string }[]; expectedHeadCommitSha: string }) => {
      if (input.expectedHeadCommitSha !== head) throw new GitHubConflictError("branch changed");
      head = "new_head";
      const written = input.files.map((file, index) => ({ ...file, blobSha: `new_blob_${index}` }));
      for (const file of written) files.set(file.path, file);
      return { commitSha: head, treeSha: "new_tree", files: written.map(({ path, blobSha }) => ({ path, blobSha })) };
    }),
  };
  return { adapter, files };
}

describe("capture transfer to top-level modules", () => {
  it.each([["明天买牛奶", "task", "tasks"], ["明天十点开会", "calendar_event", "calendar"], ["日记：今天完成了报告。\n明天再整理。", "journal_entry", "journal"]])("moves %s into a real %s in one commit", async (text, entity, tab) => {
    const { adapter, files } = repository();
    const result = await transferCapture(adapter, source, fields(text), context);
    expect(result.destination).toMatchObject({ tab, record: { entity_type: entity } });
    expect(adapter.writeAtomicFiles).toHaveBeenCalledOnce();
    const write = adapter.writeAtomicFiles.mock.calls[0][0];
    expect(write).toMatchObject({ expectedHeadCommitSha: "head", baseTreeSha: "tree" });
    expect(write.files).toHaveLength(2);
    const archived = parseCaptureRecord(files.get(source.path)!.text);
    expect(archived).toMatchObject({ version: 2, data: { status: "archived", raw_text: text, routed_to: { path: result.destination.path, tab } } });
    expect(adapter.readText.mock.calls.every((call) => call[1] === "head")).toBe(true);
    if (entity === "journal_entry") expect(result.destination.record.data).toMatchObject({ journal_date: context.today, body_markdown: "今天完成了报告。\n明天再整理。" });
  });
  it("recovers a lost response without duplicating or overwriting an edited destination", async () => {
    const { adapter, files } = repository();
    const commit = adapter.writeAtomicFiles.getMockImplementation()!;
    adapter.writeAtomicFiles.mockImplementationOnce(async (input) => { await commit(input); throw new GitHubDataError("response lost", 503, "GITHUB_UNAVAILABLE"); });
    await expect(transferCapture(adapter, source, fields("明天买牛奶"), context)).rejects.toThrow("response lost");
    const link = parseCaptureRecord(files.get(source.path)!.text).data.routed_to!;
    const destination = files.get(link.path)!;
    const edited = JSON.parse(destination.text); edited.data.title = "在待办模块改过的标题";
    files.set(link.path, { ...destination, text: JSON.stringify(edited), blobSha: "edited_blob" });
    const retry = await transferCapture(adapter, source, fields("明天买牛奶"), { ...context, timestamp: "2026-10-04T09:00:00.000Z" });
    expect(adapter.writeAtomicFiles).toHaveBeenCalledOnce();
    expect(retry.destinationBlobSha).toBe("edited_blob");
    expect(retry.destination.record.data).toMatchObject({ title: "在待办模块改过的标题" });
    await expect(transferCapture(adapter, source, fields("明天买水果"), context)).rejects.toBeInstanceOf(GitHubConflictError);
  });
  it("rejects an existing destination instead of overwriting it", async () => {
    const previous = repository();
    const result = await transferCapture(previous.adapter, source, fields("明天买牛奶"), context);
    const next = repository();
    next.files.set(result.destination.path, previous.files.get(result.destination.path)!);
    await expect(transferCapture(next.adapter, source, fields("明天买牛奶"), context)).rejects.toBeInstanceOf(GitHubConflictError);
    expect(next.adapter.writeAtomicFiles).not.toHaveBeenCalled();
    expect(parseCaptureRecord(next.files.get(source.path)!.text).data.status).toBe("inbox");
  });
  it("blocks stale or unavailable sources and destination collisions without any write", async () => {
    const { adapter, files } = repository();
    files.set(source.path, { ...files.get(source.path)!, blobSha: "other_device" });
    await expect(transferCapture(adapter, source, fields("明天买牛奶"), context)).rejects.toBeInstanceOf(GitHubConflictError);
    expect(adapter.writeAtomicFiles).not.toHaveBeenCalled();
    const gone = JSON.parse(serializeRecord(source.record)); gone.deleted_at = context.timestamp;
    files.set(source.path, { path: source.path, text: JSON.stringify(gone), blobSha: source.blobSha });
    await expect(transferCapture(adapter, source, fields("明天买牛奶"), context)).rejects.toBeInstanceOf(GitHubConflictError);
    expect(adapter.writeAtomicFiles).not.toHaveBeenCalled();
  });
  it("does not leave the source archived when the atomic branch update fails", async () => {
    const { adapter, files } = repository();
    adapter.writeAtomicFiles.mockRejectedValueOnce(new GitHubConflictError("branch advanced"));
    await expect(transferCapture(adapter, source, fields("明天买牛奶"), context)).rejects.toBeInstanceOf(GitHubConflictError);
    expect(files.size).toBe(1);
    expect(parseCaptureRecord(files.get(source.path)!.text).data.status).toBe("inbox");
    await transferCapture(adapter, source, fields("明天买牛奶"), context);
    expect(files.size).toBe(2);
  });
  it("rejects non-module transfers, missing dates, and old journal dates", async () => {
    const { adapter } = repository();
    await expect(transferCapture(adapter, source, fields("想法：做个工具"), context)).rejects.toThrow("CAPTURE_DESTINATION_REQUIRED");
    await expect(transferCapture(adapter, source, { ...fields("日程：开会"), date: null }, context)).rejects.toThrow("CAPTURE_DATE_REQUIRED");
    await expect(transferCapture(adapter, source, { ...fields("日记：今天的事"), date: "2026-10-01" }, context)).rejects.toThrow("JOURNAL_DATE_NOT_WRITABLE");
    expect(adapter.writeAtomicFiles).not.toHaveBeenCalled();
  });
  it("validates and preserves the destination link through canonical serialization", async () => {
    const { adapter } = repository();
    const result = await transferCapture(adapter, source, fields("明天买牛奶"), context);
    expect(parseCaptureRecord(serializeRecord(result.source.record)).data.routed_to).toEqual(result.source.record.data.routed_to);
    for (const routed_to of [{ path: "data/tasks/../secret.json", tab: "tasks", label: "待办" }, { path: "data/tasks/task_one.json", tab: "journal", label: "日记" }, { path: "data/tasks/task_one.json", tab: "tasks", label: "待办", end_time: "25:00" }]) {
      expect(() => parseCaptureRecord(JSON.stringify({ ...source.record, data: { ...source.record.data, routed_to } }))).toThrow("INVALID_CAPTURE_RECORD");
    }
  });
  it("keeps the archive link through export, inspection, migration and restore", async () => {
    const { adapter } = repository();
    const result = await transferCapture(adapter, source, fields("明天买牛奶"), context);
    const text = serializeRecord(result.source.record);
    const file = (path: string, text: string) => ({ path, text, blobSha: "fixture_blob", sizeBytes: new TextEncoder().encode(text).length });
    const backup = await buildPortableWorkspaceExport({ repository: "test_owner/source", branch: "main", workspaceFile: file("workspace.json", JSON.stringify({ schema_version: 1, workspace_id: "test_workspace", owner_id: "test_owner", owner_login: "test_owner", locale: "zh-CN", timezone: "Asia/Shanghai" })), captureFiles: [file(source.path, text)], taskFiles: [file(result.destination.path, serializeRecord(result.destination.record))] });
    expect((await inspectPortableWorkspaceExport(backup)).valid).toBe(true);
    expect(await dryRunPortableWorkspaceMigrations(backup)).toMatchObject({ valid: true, counts: { migratable: 0, blocked: 0 } });
    const restore = await createPortableRestorePlan(backup, { repository: { fullName: "test_owner/restore", private: true, visibility: "private", defaultBranch: "main" }, branch: { branch: "main", headCommitSha: "head", rootTreeSha: "tree" }, rootEntries: [] });
    expect(restore.ready).toBe(true);
    expect(restore.files.find((file) => file.path === source.path)?.text).toBe(text);
  });
});
