import { describe, expect, it, vi } from "vitest";

import { GitHubConflictError, GitHubContentsAdapter, GitHubDataError } from "./github-contents";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

describe("GitHub contents adapter", () => {
  it("verifies private visibility and round-trips Unicode text", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        full_name: "owner/personal-workspace-data",
        private: true,
        visibility: "private",
        default_branch: "main",
      }))
      .mockResolvedValueOnce(jsonResponse({
        type: "file",
        path: "data/captures/one.json",
        sha: "blob-one",
        size: 18,
        encoding: "base64",
        content: btoa(unescape(encodeURIComponent("你好，GitHub。\n"))),
      }))
      .mockResolvedValueOnce(jsonResponse({
        content: { path: "data/captures/one.json", sha: "blob-two" },
        commit: { sha: "commit-two" },
      }));
    const adapter = new GitHubContentsAdapter(
      { owner: "owner", repository: "personal-workspace-data", branch: "main", token: "test-token" },
      fetcher,
    );

    await expect(adapter.verifyPrivateRepository()).resolves.toMatchObject({ private: true, fullName: "owner/personal-workspace-data" });
    await expect(adapter.readText("data/captures/one.json")).resolves.toMatchObject({ text: "你好，GitHub。\n", blobSha: "blob-one" });
    await expect(adapter.writeText({
      path: "data/captures/one.json",
      text: "更新",
      message: "capture: update one",
      expectedBlobSha: "blob-one",
    })).resolves.toMatchObject({ blobSha: "blob-two", commitSha: "commit-two" });

    const writeBody = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body)) as { sha: string; content: string };
    expect(writeBody.sha).toBe("blob-one");
    expect(decodeURIComponent(escape(atob(writeBody.content)))).toBe("更新");
  });

  it("rejects public repositories, traversal and concurrent updates", async () => {
    const publicFetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      full_name: "owner/public-data",
      private: false,
      visibility: "public",
      default_branch: "main",
    }));
    const publicAdapter = new GitHubContentsAdapter(
      { owner: "owner", repository: "public-data", token: "test-token" },
      publicFetcher,
    );
    await expect(publicAdapter.verifyPrivateRepository()).rejects.toMatchObject({
      code: "GITHUB_REPOSITORY_NOT_PRIVATE",
    } satisfies Partial<GitHubDataError>);
    await expect(publicAdapter.readText("../private.json")).rejects.toThrow("INVALID_GITHUB_PATH");

    const conflictFetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message: "sha does not match" }, 409));
    const conflictAdapter = new GitHubContentsAdapter(
      { owner: "owner", repository: "personal-workspace-data", token: "test-token" },
      conflictFetcher,
    );
    await expect(conflictAdapter.writeText({
      path: "data/captures/one.json",
      text: "stale",
      message: "capture: update one",
      expectedBlobSha: "old-blob",
    })).rejects.toBeInstanceOf(GitHubConflictError);
  });

  it("lists files in a data directory without caching the request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([
      { type: "file", name: "one.json", path: "data/captures/one.json", sha: "blob-one", size: 120 },
      { type: "dir", name: "archive", path: "data/captures/archive", sha: "tree-one", size: 0 },
    ]));
    const adapter = new GitHubContentsAdapter(
      { owner: "owner", repository: "personal-workspace-data", branch: "main", token: "test-token" },
      fetcher,
    );

    await expect(adapter.listDirectory("data/captures")).resolves.toEqual([
      { type: "file", name: "one.json", path: "data/captures/one.json", blobSha: "blob-one", sizeBytes: 120 },
      { type: "directory", name: "archive", path: "data/captures/archive", blobSha: "tree-one", sizeBytes: 0 },
    ]);
    expect(fetcher.mock.calls[0]?.[0]).toContain("data/captures?ref=main");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store" });
  });

  it("normalizes pasted tokens and reports browser network failures", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    const adapter = new GitHubContentsAdapter(
      { owner: "owner", repository: "personal-workspace-data", token: "  test-token  " },
      fetcher,
    );

    await expect(adapter.verifyPrivateRepository()).rejects.toMatchObject({
      status: 0,
      code: "GITHUB_NETWORK_ERROR",
    } satisfies Partial<GitHubDataError>);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer test-token",
    });
  });

  it("separates malformed requests and GitHub outages from permission errors", async () => {
    const badRequestAdapter = new GitHubContentsAdapter(
      { owner: "owner", repository: "personal-workspace-data", token: "test-token" },
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message: "Bad request" }, 400)),
    );
    const unavailableAdapter = new GitHubContentsAdapter(
      { owner: "owner", repository: "personal-workspace-data", token: "test-token" },
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message: "Unavailable" }, 503)),
    );

    await expect(badRequestAdapter.verifyPrivateRepository()).rejects.toMatchObject({ code: "GITHUB_BAD_REQUEST", status: 400 });
    await expect(unavailableAdapter.verifyPrivateRepository()).rejects.toMatchObject({ code: "GITHUB_UNAVAILABLE", status: 503 });
  });
});
