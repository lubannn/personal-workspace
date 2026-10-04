import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubContentsAdapter } from "./github-contents";

const response = (value: unknown, status = 200) => Response.json(value, { status });
const parent = { name: "journal-entries", path: "data/journal-entries", type: "dir", sha: "a".repeat(40), size: 0 };
const blob = (index: number, sizeBytes = 2) => ({ path: `data/journal-entries/${index}.json`, blobSha: index.toString(16).padStart(40, "0"), sizeBytes });
const adapter = (fetcher: typeof fetch) => new GitHubContentsAdapter({ owner: "fake", repository: "private", branch: "main", token: "synthetic-token" }, fetcher);
afterEach(() => vi.unstubAllGlobals());

describe("bounded journal UI reads", () => {
  it("reuses an unchanged verified directory in memory and across logins after a fresh parent check", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    const tree = { truncated: false, tree: [{ path: "0.json", type: "blob", sha: blob(0).blobSha, size: 2 }] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response([parent])).mockResolvedValueOnce(response(tree))
      .mockResolvedValueOnce(response([parent])).mockResolvedValueOnce(response([parent]));
    const current = adapter(fetcher);
    const first = await current.listJournalDirectory();
    expect(await current.listJournalDirectory()).toEqual(first);
    expect(await adapter(fetcher).listJournalDirectory()).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect([...values.keys()]).toEqual(["nexus-journal-directory-v1:fake/private:main"]);
    expect([...values.values()].join("")).not.toContain("synthetic-token");
    expect([...values.values()].join("")).not.toContain('"text"');
  });
  it("fetches changed trees and never uses cached metadata after permission loss", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response([parent])).mockResolvedValueOnce(response({ truncated: false, tree: [] }))
      .mockResolvedValueOnce(response([{ ...parent, sha: "b".repeat(40) }])).mockResolvedValueOnce(response({ truncated: false, tree: [{ path: "0.json", type: "blob", sha: blob(0).blobSha, size: 2 }] }))
      .mockResolvedValueOnce(response({}, 401));
    const current = adapter(fetcher);
    expect(await current.listJournalDirectory()).toHaveLength(0);
    expect(await current.listJournalDirectory()).toHaveLength(1);
    await expect(current.listJournalDirectory()).rejects.toMatchObject({ status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it("refetches corrupt, incomplete, mismatched, or unavailable optional caches", async () => {
    for (const cached of ["invalid json", JSON.stringify({ sha: parent.sha, count: 1, tree: { truncated: false, tree: [] } }), JSON.stringify({ sha: parent.sha, count: 0, tree: { truncated: true, tree: [] } }), JSON.stringify({ sha: "b".repeat(40), count: 0, tree: { truncated: false, tree: [] } }), JSON.stringify({ sha: parent.sha, count: 1, tree: { truncated: false, tree: [{ path: "../evil", type: "blob", sha: blob(0).blobSha, size: 2 }] } }), null]) {
      vi.stubGlobal("localStorage", { getItem: () => { if (cached === null) throw new Error("disabled"); return cached; }, setItem: () => { throw new Error("disabled"); } });
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response([parent])).mockResolvedValueOnce(response({ truncated: false, tree: [] }));
      await expect(adapter(fetcher).listJournalDirectory()).resolves.toEqual([]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
  it("reads over 1,000 journal files using two metadata requests without listing any bodies", async () => {
    const files = Array.from({ length: 2317 }, (_, i) => ({ path: `${i}.json`, type: "blob", sha: blob(i).blobSha, size: 2 }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response([parent])).mockResolvedValueOnce(response({ truncated: false, tree: files }));
    expect(await adapter(fetcher).listJournalDirectory()).toHaveLength(2317);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["https://api.github.com/repos/fake/private/contents/data?ref=main", `https://api.github.com/repos/fake/private/git/trees/${parent.sha}`]);
  });
  it("does not interpret a truncated journal tree as a complete catalog", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response([parent])).mockResolvedValueOnce(response({ truncated: true, tree: [] }));
    await expect(adapter(fetcher).listJournalDirectory()).rejects.toMatchObject({ code: "GITHUB_TREE_TRUNCATED" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("uses complete-tree fallback when the parent reaches the Contents API limit", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(Array(1000).fill(parent)))
      .mockResolvedValueOnce(response({ truncated: false, tree: [{ path: "data", type: "tree", sha: "b".repeat(40) }] }))
      .mockResolvedValueOnce(response({ truncated: false, tree: [{ path: "journal-entries", type: "tree", sha: parent.sha }] }))
      .mockResolvedValueOnce(response({ truncated: false, tree: [] }));
    await expect(adapter(fetcher).listJournalDirectory()).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("confirms ambiguous parent 404 through the existing root checks", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response({}, 404)).mockResolvedValueOnce(response({}, 404));
    await expect(adapter(fetcher).listJournalDirectory()).rejects.toMatchObject({ code: "GITHUB_INVALID_RESPONSE" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const absent = vi.fn<typeof fetch>().mockResolvedValueOnce(response([]));
    await expect(adapter(absent).listJournalDirectory()).rejects.toMatchObject({ code: "GITHUB_NOT_FOUND" });
    expect(absent).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed parents, duplicated names, non-directories, and substituted paths before a tree read", async () => {
    const overrides = [null, { name: ".." }, { name: "sub/path" }, { name: "a\\b" }, { name: "bad\u0000" }, { path: "other/journal-entries" }, { sha: "bad" }, { sha: [parent.sha] }, { size: -1 }, { size: 1.5 }, { type: "file" }, { type: "symlink" }, { type: "submodule" }];
    for (const body of [null, {}, [parent, parent], ...overrides.map((item) => [item === null ? null : { ...parent, ...item }])]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(body));
      await expect(adapter(fetcher).listJournalDirectory()).rejects.toMatchObject({ code: "GITHUB_INVALID_RESPONSE" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it.each([401, 403, 429, 502])("does not add fallback traffic for HTTP %s failures", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response({}, status));
    await expect(adapter(fetcher).listJournalDirectory()).rejects.toMatchObject({ status });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("fetches 30 small journal bodies in one bounded query while retaining the default for other collections", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const { variables } = JSON.parse(String(init?.body));
      return response({ data: { repository: Object.fromEntries(Object.entries(variables).filter(([key]) => key.startsWith("oid")).map(([key, oid]) => [`blob${key.slice(3)}`, { __typename: "Blob", oid, byteSize: 2, isTruncated: false, text: "{}" }])) } });
    });
    const files = Array.from({ length: 30 }, (_, i) => blob(i));
    const onBatch = vi.fn();
    expect(await adapter(fetcher).readBlobTexts(files, () => true, undefined, { maxBatchFiles: 40, onBatch })).toHaveLength(30);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onBatch).toHaveBeenCalledTimes(1);
    await adapter(fetcher).readBlobTexts(files);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("rejects oversized expanded batches and publishes verified REST chunks before a later error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({}));
    await expect(adapter(fetcher).readBlobTexts(Array.from({ length: 30 }, (_, i) => blob(i, 100_000)), () => true, undefined, { maxBatchFiles: 40 })).rejects.toThrow("GITHUB_BLOB_BATCH_TOO_LARGE");
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(response({}, 403)).mockImplementation(async (url) => {
      const sha = String(url).split("/").at(-1)!;
      if (sha === blob(4).blobSha) return response({}, 502);
      return response({ sha, size: 2, encoding: "base64", content: "e30=" });
    });
    const onBatch = vi.fn();
    await expect(adapter(fetcher).readBlobTexts(Array.from({ length: 5 }, (_, i) => blob(i)), () => true, undefined, { maxBatchFiles: 40, onBatch })).rejects.toMatchObject({ status: 502 });
    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onBatch.mock.calls[0][0]).toHaveLength(4);
  });
});
