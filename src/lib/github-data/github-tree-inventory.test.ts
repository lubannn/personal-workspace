import { describe, expect, it, vi } from "vitest";
import { GitHubContentsAdapter } from "./github-contents";

describe("snapshot-pinned Git tree inventory", () => {
  it("lists more than 1,000 blobs and preserves the server User-Agent", async () => {
    const tree = Array.from({ length: 1002 }, (_, index) => ({ path: `data/sleep-sessions/sleep_${index}.json`, type: "blob", sha: index.toString(16).padStart(40, "0"), size: 2 }));
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ truncated: false, tree }));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "private-data", token: "synthetic", userAgent: "SyntheticWorker/1.0" }, fetcher);
    expect(await adapter.listTreeFiles("a".repeat(40))).toHaveLength(1002);
    expect(fetcher.mock.calls[0][0]).toBe(`https://api.github.com/repos/owner/private-data/git/trees/${"a".repeat(40)}?recursive=1`);
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("User-Agent")).toBe("SyntheticWorker/1.0");
    await adapter.forRepository("owner", "other-data").listTreeFiles("b".repeat(40));
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get("User-Agent")).toBe("SyntheticWorker/1.0");
  });
  it("fails closed on truncation and invalid blob metadata", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ truncated: true, tree: [] }));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "synthetic" }, fetcher);
    await expect(adapter.listTreeFiles("a".repeat(40))).rejects.toMatchObject({ code: "GITHUB_TREE_TRUNCATED" });
    fetcher.mockResolvedValueOnce(Response.json({ truncated: false, tree: [{ path: "data/a.json", type: "blob", sha: "bad", size: 2 }] }));
    await expect(adapter.listTreeFiles("a".repeat(40))).rejects.toMatchObject({ code: "GITHUB_INVALID_RESPONSE" });
    await expect(adapter.listTreeFiles("main")).rejects.toThrow("INVALID_GITHUB_TREE_SHA");
  });

  it("checks the write guard immediately before publishing the new Git ref", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ sha: "b".repeat(40) }));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "synthetic" }, fetcher);
    const guard = vi.fn(async () => { throw new Error("SYNC_DISCONNECTED"); });
    await expect(adapter.writeAtomicFiles({ files: [{ path: "data/test.json", text: "{}" }], message: "synthetic write", expectedHeadCommitSha: "a".repeat(40), baseTreeSha: "c".repeat(40), inlineContent: true, beforeRefUpdate: guard })).rejects.toThrow("SYNC_DISCONNECTED");
    expect(guard).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "POST"]);
    expect(fetcher.mock.calls.every(([url]) => !String(url).includes("/git/refs/"))).toBe(true);
  });
});
