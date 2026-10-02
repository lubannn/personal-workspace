import { describe, expect, it, vi } from "vitest";
import { GitHubDataError, type GitHubDirectoryItem } from "../../../../src/lib/github-data/github-contents";
import { loadHealthDirectory } from "./health-collection-loading";

const item = (name: string): GitHubDirectoryItem => ({ name, path: `data/workouts/${name}`, type: "file", blobSha: name, sizeBytes: 10 });
function reader(count = 2) {
  return {
    listDirectory: vi.fn(async () => Array.from({ length: count }, (_, index) => item(`${index}.json`))),
    readText: vi.fn(async (path: string) => ({ path, blobSha: "test", sizeBytes: 2, text: "{}" })),
  };
}

describe("complete health collection reads", () => {
  it("rejects the collection when a record cannot be read, instead of returning a partial count", async () => {
    const adapter = reader();
    adapter.readText.mockRejectedValueOnce(new Error("offline"));
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
    expect(adapter.readText).not.toHaveBeenCalled();
  });
  it("stops reading the next batch after disconnect or a newer refresh", async () => {
    const adapter = reader(12);
    const isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    await expect(loadHealthDirectory(adapter, "data/workouts", JSON.parse, isCurrent)).rejects.toThrow("HEALTH_LOAD_CANCELLED");
    expect(adapter.readText).toHaveBeenCalledTimes(6);
  });
});
