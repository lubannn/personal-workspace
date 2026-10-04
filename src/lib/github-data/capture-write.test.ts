import { describe, expect, it, vi } from "vitest";
import { GitHubContentsAdapter, GitHubConflictError } from "./github-contents";
import { createWorkspaceRecord, setWorkspaceRecordDeleted } from "./protocol";
import type { CaptureRecord } from "./workspace";
import { writeCaptureChange } from "./capture-write";

const source: { record: CaptureRecord; path: string; blobSha: string } = {
  record: createWorkspaceRecord({ ownerId: "test_owner", entityType: "capture", id: "capture_test", timestamp: "2026-10-04T08:00:00.000Z", data: { raw_text: "测试随手记", status: "inbox" as const } }),
  path: "data/captures/capture_test.json", blobSha: "original_blob",
};
const updated = setWorkspaceRecordDeleted(source.record, "2026-10-04T09:00:00.000Z", "2026-10-04T09:00:00.000Z");
function fixture(optimistic = true) {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((done) => { resolve = done; }));
  const adapter = new GitHubContentsAdapter({ owner: "test_owner", repository: "test_data", token: "synthetic-token" }, fetcher);
  let current = [source];
  let connected = true;
  const pending = writeCaptureChange({ adapter, source, updated, operation: "trash", optimistic, isCurrent: () => connected, onChange: (update) => { current = update(current); } });
  return {
    fetcher, pending, current: () => current,
    replace: (next: typeof current) => { current = next; }, disconnect: () => { connected = false; },
    complete: (status = 200) => resolve(new Response(JSON.stringify(status === 200 ? { content: { path: source.path, sha: "new_blob" }, commit: { sha: "commit" } } : { message: "File changed" }), { status })),
  };
}

describe("responsive capture writes", () => {
  it("moves the item before the network returns, with exactly one conditional PUT and no reads", async () => {
    const test = fixture();
    expect(test.current()[0].record).toBe(updated);
    expect(test.current()[0].blobSha).toBe(source.blobSha);
    expect(test.fetcher).toHaveBeenCalledOnce();
    const [url, init] = test.fetcher.mock.calls[0];
    expect(String(url)).toContain(`/contents/${source.path}`);
    expect(init?.method).toBe("PUT");
    const body = JSON.parse(String(init?.body));
    expect(body.sha).toBe(source.blobSha);
    const saved = JSON.parse(Buffer.from(body.content, "base64").toString("utf8"));
    expect(saved.version).toBe(source.record.version + 1);
    expect(saved.deleted_at).toBe(updated.deleted_at);
    test.complete();
    await expect(test.pending).resolves.toBe(true);
    expect(test.current()[0].blobSha).toBe("new_blob");
    expect(test.fetcher).toHaveBeenCalledOnce();
  });
  it.each([409, 500])("restores the original item on HTTP %s without retrying or overwriting the server", async (status) => {
    const test = fixture();
    test.complete(status);
    await expect(test.pending).rejects.toBeInstanceOf(status === 409 ? GitHubConflictError : Error);
    expect(test.current()[0]).toBe(source);
    expect(test.fetcher).toHaveBeenCalledOnce();
  });
  it.each([200, 409])("does not overwrite a newer refreshed item after HTTP %s", async (status) => {
    const test = fixture();
    const newer = { ...source, blobSha: "other_device_blob" };
    test.replace([newer]);
    test.complete(status);
    await test.pending.catch(() => undefined);
    expect(test.current()[0]).toBe(newer);
  });
  it.each([200, 409])("does not affect a replacement connection after HTTP %s", async (status) => {
    const test = fixture();
    test.disconnect();
    const other = { ...source, blobSha: "other_account_blob" };
    test.replace([other]);
    test.complete(status);
    await test.pending.catch(() => undefined);
    expect(test.current()[0]).toBe(other);
  });
  it("updates an unchanged file even if a refresh replaced its object while editing", async () => {
    const test = fixture(false);
    test.replace([{ ...source }]);
    test.complete();
    await test.pending;
    expect(test.current()[0].record).toBe(updated);
    expect(test.current()[0].blobSha).toBe("new_blob");
  });
  it("keeps editing changes invisible until the write succeeds", async () => {
    const test = fixture(false);
    expect(test.current()[0]).toBe(source);
    test.complete();
    await test.pending;
    expect(test.current()[0].record).toBe(updated);
  });
});
