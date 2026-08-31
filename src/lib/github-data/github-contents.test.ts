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
    await expect(adapter.readText("data/captures/one.json", "head-one")).resolves.toMatchObject({ text: "你好，GitHub。\n", blobSha: "blob-one" });
    await expect(adapter.writeText({
      path: "data/captures/one.json",
      text: "更新",
      message: "capture: update one",
      expectedBlobSha: "blob-one",
    })).resolves.toMatchObject({ blobSha: "blob-two", commitSha: "commit-two" });

    const writeBody = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body)) as { sha: string; content: string };
    expect(fetcher.mock.calls[1]?.[0]).toContain("?ref=head-one");
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

  it("lists an initialized repository root and reuses the in-memory credential for an isolated target", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([
        { type: "file", name: "README.md", path: "README.md", sha: "readme-blob", size: 10 },
      ]))
      .mockResolvedValueOnce(jsonResponse({
        full_name: "owner/personal-workspace-restore-test",
        private: true,
        visibility: "private",
        default_branch: "main",
      }));
    const canonical = new GitHubContentsAdapter(
      { owner: "owner", repository: "personal-workspace-data", branch: "main", token: "shared-token" },
      fetcher,
    );

    await expect(canonical.listDirectory("")).resolves.toEqual([
      { type: "file", name: "README.md", path: "README.md", blobSha: "readme-blob", sizeBytes: 10 },
    ]);
    await expect(canonical.forRepository("owner", "personal-workspace-restore-test").verifyPrivateRepository())
      .resolves.toMatchObject({ fullName: "owner/personal-workspace-restore-test", private: true });
    expect(fetcher.mock.calls[0]?.[0]).toContain("/contents?ref=main");
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: "Bearer shared-token" });
  });

  it("creates an atomic multi-file restore commit from an expected branch head", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        ref: "refs/heads/main",
        object: { sha: "head-one", type: "commit" },
      }))
      .mockResolvedValueOnce(jsonResponse({ sha: "head-one", tree: { sha: "tree-one" } }))
      .mockResolvedValueOnce(jsonResponse({ sha: "blob-workspace" }, 201))
      .mockResolvedValueOnce(jsonResponse({ sha: "blob-capture" }, 201))
      .mockResolvedValueOnce(jsonResponse({ sha: "tree-two" }, 201))
      .mockResolvedValueOnce(jsonResponse({ sha: "commit-two", tree: { sha: "tree-two" } }, 201))
      .mockResolvedValueOnce(jsonResponse({
        ref: "refs/heads/main",
        object: { sha: "commit-two", type: "commit" },
      }));
    const adapter = new GitHubContentsAdapter(
      { owner: "owner", repository: "personal-workspace-restore-test", branch: "main", token: "test-token" },
      fetcher,
    );
    const snapshot = await adapter.readBranchSnapshot();
    await expect(adapter.writeAtomicFiles({
      files: [
        { path: "workspace.json", text: "workspace" },
        { path: "data/captures/one.json", text: "capture" },
      ],
      message: "restore: import portable export",
      expectedHeadCommitSha: snapshot.headCommitSha,
      baseTreeSha: snapshot.rootTreeSha,
    })).resolves.toEqual({
      commitSha: "commit-two",
      treeSha: "tree-two",
      files: [
        { path: "workspace.json", blobSha: "blob-workspace" },
        { path: "data/captures/one.json", blobSha: "blob-capture" },
      ],
    });

    expect(snapshot).toEqual({ branch: "main", headCommitSha: "head-one", rootTreeSha: "tree-one" });
    const treeBody = JSON.parse(String(fetcher.mock.calls[4]?.[1]?.body)) as {
      base_tree: string;
      tree: Array<{ path: string; sha: string }>;
    };
    expect(treeBody).toMatchObject({
      base_tree: "tree-one",
      tree: [
        { path: "workspace.json", sha: "blob-workspace" },
        { path: "data/captures/one.json", sha: "blob-capture" },
      ],
    });
    const refBody = JSON.parse(String(fetcher.mock.calls[6]?.[1]?.body)) as { sha: string; force: boolean };
    expect(refBody).toEqual({ sha: "commit-two", force: false });
  });

  it("does not move the branch when an atomic write loses the head race", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ sha: "blob-revision" }, 201))
      .mockResolvedValueOnce(jsonResponse({ sha: "blob-entry" }, 201))
      .mockResolvedValueOnce(jsonResponse({ sha: "tree-two" }, 201))
      .mockResolvedValueOnce(jsonResponse({ sha: "commit-two", tree: { sha: "tree-two" } }, 201))
      .mockResolvedValueOnce(jsonResponse({ message: "Update is not a fast forward" }, 422));
    const adapter = new GitHubContentsAdapter(
      { owner: "owner", repository: "personal-workspace-data", branch: "main", token: "test-token" },
      fetcher,
    );

    await expect(adapter.writeAtomicFiles({
      files: [
        { path: "data/journal-revisions/revision_2.json", text: "revision" },
        { path: "data/journal-entries/journal_1.json", text: "entry" },
      ],
      message: "journal: update journal_1",
      expectedHeadCommitSha: "head-one",
      baseTreeSha: "tree-one",
    })).rejects.toBeInstanceOf(GitHubConflictError);

    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(fetcher.mock.calls[4]?.[0]).toContain("/git/refs/heads/main");
    expect(JSON.parse(String(fetcher.mock.calls[4]?.[1]?.body))).toEqual({ sha: "commit-two", force: false });
  });

  it("normalizes pasted tokens and classifies cross-origin browser failures", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    const adapter = new GitHubContentsAdapter(
      { owner: "owner", repository: "personal-workspace-data", token: "  test-token  " },
      fetcher,
    );

    await expect(adapter.verifyPrivateRepository()).rejects.toMatchObject({
      status: 0,
      code: "GITHUB_CROSS_ORIGIN_BLOCKED",
    } satisfies Partial<GitHubDataError>);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer test-token",
    });
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://api.github.com/rate_limit");
    expect(fetcher.mock.calls[1]?.[1]?.headers).not.toHaveProperty("Authorization");
  });

  it("separates authorization blocking from general cross-origin blocking", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse({ rate: {} }));
    const adapter = new GitHubContentsAdapter(
      { owner: "owner", repository: "personal-workspace-data", token: "test-token" },
      fetcher,
    );

    await expect(adapter.verifyPrivateRepository()).rejects.toMatchObject({
      status: 0,
      code: "GITHUB_AUTH_REQUEST_BLOCKED",
    } satisfies Partial<GitHubDataError>);
  });

  it("does not call a custom fetch transport with the adapter as its receiver", async () => {
    const observeReceiver = vi.fn<(value: unknown) => void>();
    const fetcher = (function (this: unknown) {
      observeReceiver(this);
      return Promise.resolve(jsonResponse({
        full_name: "owner/personal-workspace-data",
        private: true,
        visibility: "private",
        default_branch: "main",
      }));
    }) as typeof fetch;
    const adapter = new GitHubContentsAdapter(
      { owner: "owner", repository: "personal-workspace-data", token: "test-token" },
      fetcher,
    );

    await adapter.verifyPrivateRepository();
    expect(observeReceiver).toHaveBeenCalledWith(undefined);
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
