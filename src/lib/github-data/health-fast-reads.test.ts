import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubContentsAdapter } from "./github-contents";
const names = ["sleep-sessions", "workouts", "health-staging-records", "coros-sync-index"];
const parents = names.map((name, i) => ({ name, path: `data/${name}`, type: "dir", sha: String(i + 1).repeat(40), size: 0 }));
const adapter = (fetcher: typeof fetch, repository = "private") => new GitHubContentsAdapter({ owner: "fake", repository, branch: "main", token: "synthetic-token" }, fetcher);
afterEach(() => vi.unstubAllGlobals());

describe("health inventory metadata caching", () => {
  it("includes the health-metrics directory when present and reuses its authenticated tree SHA", async () => {
    const metricParent = { name: "health-metrics", path: "data/health-metrics", type: "dir", sha: "e".repeat(40), size: 0 };
    const fetcher = vi.fn<typeof fetch>(async url => String(url).includes("/contents/data") ? Response.json([metricParent])
      : Response.json({ truncated: false, tree: [{ path: "synthetic.json", type: "blob", sha: "f".repeat(40), size: 2 }] }));
    const current = adapter(fetcher);
    expect(await current.listHealthArchive()).toMatchObject([{ path: "data/health-metrics/synthetic.json" }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await current.listHealthArchive(); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("reads all four complete directories in five requests, then uses one parent check, including across logins", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    const fetcher = vi.fn<typeof fetch>(async (url) => String(url).includes("/contents/data") ? Response.json(parents)
      : Response.json({ truncated: false, tree: Array.from({ length: 1100 }, (_, i) => ({ path: `${i}.json`, type: "blob", sha: i.toString(16).padStart(40, "0"), size: 2 })) }));
    const current = adapter(fetcher);
    expect(await current.listHealthArchive()).toHaveLength(4400);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(await current.listHealthArchive()).toHaveLength(4400);
    expect(await adapter(fetcher).listHealthArchive()).toHaveLength(4400);
    expect(fetcher).toHaveBeenCalledTimes(7);
    expect([...values.values()].join("")).not.toMatch(/synthetic-token|"text"/);
    await adapter(fetcher, "other").listHealthArchive();
    expect(fetcher).toHaveBeenCalledTimes(12); // caches are repository scoped
    fetcher.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    await expect(current.listHealthArchive()).rejects.toMatchObject({ status: 401 });
  });
  it("reads only changed directory trees and rejects truncation without cached fallback", async () => {
    let changed = false;
    const fetcher = vi.fn<typeof fetch>(async (url) => String(url).includes("/contents/data") ? Response.json([{ ...parents[0], sha: changed ? "f".repeat(40) : parents[0].sha }])
      : Response.json({ truncated: changed, tree: [] }));
    const current = adapter(fetcher);
    expect(await current.listHealthArchive()).toEqual([]);
    changed = true;
    await expect(current.listHealthArchive()).rejects.toMatchObject({ code: "GITHUB_TREE_TRUNCATED" });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("reads a large index directly through REST once, without a truncated GraphQL duplicate", async () => {
    const text = "a".repeat(150_000);
    const file = { path: "data/coros-sync-index/index.json", blobSha: "a".repeat(40), sizeBytes: text.length };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ sha: file.blobSha, size: text.length, encoding: "base64", content: Buffer.from(text).toString("base64") }));
    const current = adapter(fetcher);
    expect((await current.readBlobTexts([file]))[0].text).toBe(text);
    expect((await current.readBlobTexts([file]))[0].text).toBe(text);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain("/git/blobs/");
  });

});
