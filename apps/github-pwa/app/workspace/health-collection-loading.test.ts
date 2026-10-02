import { describe, expect, it, vi } from "vitest";
import { GitHubContentsAdapter, GitHubDataError, type GitHubDirectoryItem } from "../../../../src/lib/github-data/github-contents";
import { loadHealthDirectory } from "./health-collection-loading";

const item = (name: string): GitHubDirectoryItem => ({ name, path: `data/workouts/${name}`, type: "file", blobSha: name, sizeBytes: 10 });
function reader(count = 2) {
  return {
    listDirectory: vi.fn(async () => Array.from({ length: count }, (_, index) => item(`${index}.json`))),
    readBlobTexts: vi.fn(async (items: GitHubDirectoryItem[]) => items.map(({ path, blobSha }) => ({ path, blobSha, sizeBytes: 2, text: "{}" }))),
  };
}

describe("complete health collection reads", () => {
  it("rejects the collection when a record cannot be read, instead of returning a partial count", async () => {
    const adapter = reader();
    adapter.readBlobTexts.mockRejectedValueOnce(new Error("offline"));
    await expect(loadHealthDirectory(adapter, "data/workouts", JSON.parse, () => true)).rejects.toThrow("offline");
  });
  it("rejects invalid records without exposing their content", async () => {
    await expect(loadHealthDirectory(reader(), "data/workouts", () => { throw new Error("private content"); }, () => true)).rejects.toThrow("HEALTH_RECORD_INVALID");
  });
  it("accepts missing directories as empty but preserves access errors", async () => {
    const adapter = reader();
    adapter.listDirectory.mockRejectedValueOnce(new GitHubDataError("missing", 404, "GITHUB_NOT_FOUND"));
    await expect(loadHealthDirectory(adapter, "data/workouts", JSON.parse, () => true)).resolves.toEqual([]);
    adapter.listDirectory.mockRejectedValueOnce(new GitHubDataError("denied", 403, "GITHUB_FORBIDDEN"));
    await expect(loadHealthDirectory(adapter, "data/workouts", JSON.parse, () => true)).rejects.toThrow("denied");
  });
  it("stops before reading a potentially truncated directory", async () => {
    const adapter = reader(1000);
    await expect(loadHealthDirectory(adapter, "data/workouts", JSON.parse, () => true)).rejects.toThrow("HEALTH_DIRECTORY_LIMIT");
    expect(adapter.readBlobTexts).not.toHaveBeenCalled();
  });
  it("reads every historical record when Contents reaches 1,000 and a complete tree is available", async () => {
    const adapter = {
      ...reader(1000),
      readBranchSnapshot: vi.fn(async () => ({ branch: "main", headCommitSha: "a".repeat(40), rootTreeSha: "b".repeat(40) })),
      listTreeFiles: vi.fn(async () => [...Array.from({ length: 1003 }, (_, index) => item(`${index}.json`)), { ...item("unrelated.json"), path: "data/sleep-sessions/unrelated.json" }, { ...item("nested.json"), path: "data/workouts/nested/nested.json" }]),
    };
    const result = await loadHealthDirectory(adapter, "data/workouts", JSON.parse, () => true);
    expect(result).toHaveLength(1003);
    expect(adapter.listTreeFiles).toHaveBeenCalledWith("b".repeat(40));
    expect(result.at(-1)?.path).toBe("data/workouts/1002.json");
  });
  it("fails a full history refresh when the recursive tree is truncated", async () => {
    const adapter = {
      ...reader(1000),
      readBranchSnapshot: vi.fn(async () => ({ branch: "main", headCommitSha: "a".repeat(40), rootTreeSha: "b".repeat(40) })),
      listTreeFiles: vi.fn(async () => { throw new GitHubDataError("incomplete tree", 500, "GITHUB_TREE_TRUNCATED"); }),
    };
    await expect(loadHealthDirectory(adapter, "data/workouts", JSON.parse, () => true)).rejects.toThrow("incomplete tree");
    expect(adapter.readBlobTexts).not.toHaveBeenCalled();
  });
  it("discards the collection after disconnect or a newer refresh", async () => {
    const adapter = reader(12);
    const isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false);
    await expect(loadHealthDirectory(adapter, "data/workouts", JSON.parse, isCurrent)).rejects.toThrow("HEALTH_LOAD_CANCELLED");
    expect(adapter.readBlobTexts).toHaveBeenCalledTimes(1);
  });
  it("uses 15 requests for 225 records across four health directories, then only four for unchanged refreshes", async () => {
    const directories = ["data/health-staging-records", "data/health-metrics", "data/sleep-sessions", "data/workouts"];
    const counts = [101, 0, 2, 122];
    let sequence = 0;
    const listings = new Map(directories.map((directory, index) => [directory, Array.from({ length: counts[index] }, () => {
      sequence += 1;
      return { type: "file", name: `${sequence}.json`, path: `${directory}/${sequence}.json`, sha: sequence.toString(16).padStart(40, "0"), size: 2 };
    })]));
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith("/graphql")) {
        const { variables } = JSON.parse(String(init?.body)) as { variables: Record<string, string> };
        return Response.json({ data: { repository: Object.fromEntries(Object.entries(variables).filter(([key]) => key.startsWith("oid")).map(([key, oid]) => [`blob${key.slice(3)}`, { __typename: "Blob", oid, byteSize: 2, isTruncated: false, text: "{}" }])) } });
      }
      const directory = String(url).split("/contents/")[1];
      return Response.json(listings.get(directory));
    });
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    const load = () => Promise.all(directories.map((directory) => loadHealthDirectory(adapter, directory, JSON.parse, () => true)));
    expect((await load()).map((files) => files.length)).toEqual(counts);
    expect(fetcher).toHaveBeenCalledTimes(15);
    fetcher.mockClear();
    expect((await load()).map((files) => files.length)).toEqual(counts);
    expect(fetcher).toHaveBeenCalledTimes(4);
    const firstWorkout = listings.get("data/workouts")![0];
    firstWorkout.sha = "f".repeat(40);
    fetcher.mockClear();
    await load();
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
});
