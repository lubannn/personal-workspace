import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { GitHubConflictError, GitHubContentsAdapter, GitHubDataError } from "./github-contents";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

const listedBlob = (index: number, sizeBytes = 2) => ({ path: `data/workouts/${index}.json`, blobSha: index.toString(16).padStart(40, "0"), sizeBytes });
function blobQueryResponse(init?: RequestInit) {
  const { variables } = JSON.parse(String(init?.body)) as { variables: Record<string, string> };
  return { data: { repository: Object.fromEntries(Object.entries(variables).filter(([key]) => key.startsWith("oid")).map(([key, oid]) => [
    `blob${key.slice(3)}`, { __typename: "Blob", oid, byteSize: 2, isTruncated: false, text: "{}" },
  ])) } };
}

function journalDirectoryResponse(entries = [{ name: "one.json", type: "blob", oid: "a".repeat(40), size: 2 }]) {
  return { data: { repository: { object: { __typename: "Tree", oid: "b".repeat(40), entries } } } };
}

function journalRestTreeResponse(url: string) {
  if (url.endsWith("/main")) return jsonResponse({ truncated: false, tree: [{ path: "data", type: "tree", sha: "c".repeat(40) }] });
  if (url.endsWith("/" + "c".repeat(40))) return jsonResponse({ truncated: false, tree: [{ path: "journal-entries", type: "tree", sha: "d".repeat(40) }] });
  return jsonResponse({ truncated: false, tree: [{ path: "one.json", type: "blob", sha: "a".repeat(40), size: 2 }] });
}

describe("GitHub contents adapter", () => {
  it.each(["batch", "single", "REST fallback"])("propagates caller cancellation of a %s read without diagnosis or retries", async (mode) => {
    const controller = new AbortController();
    const reason = new Error("Obsolete month");
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new TypeError("transport canceled")), { once: true });
    }));
    if (mode === "REST fallback") fetcher.mockResolvedValueOnce(jsonResponse({}, 403));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    const file = listedBlob(1);
    const pending = mode === "single" ? adapter.readBlobText(file.path, file.blobSha, controller.signal) : adapter.readBlobTexts([file], () => true, controller.signal);
    const rejected = expect(pending).rejects.toBe(reason);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(mode === "REST fallback" ? 2 : 1));
    controller.abort(reason);
    await rejected;
    expect(fetcher.mock.lastCall?.[1]?.signal?.aborted).toBe(true);
    await expect(adapter.readBlobTexts([file], () => true, controller.signal)).rejects.toBe(reason);
    expect(fetcher).toHaveBeenCalledTimes(mode === "REST fallback" ? 2 : 1);
    if (mode !== "REST fallback") {
      fetcher.mockImplementationOnce(async (_, init) => jsonResponse(blobQueryResponse(init)));
      await expect(adapter.readBlobTexts([file])).resolves.toHaveLength(1);
      expect(fetcher.mock.lastCall?.[0]).toBe("https://api.github.com/graphql");
    }
  });

  it("restarts a canceled month probe for waiting health and replacement-month callers", async () => {
    const controller = new AbortController();
    const reason = new Error("Old month canceled");
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }))
      .mockImplementation(async (_, init) => jsonResponse(blobQueryResponse(init)));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    const oldMonth = adapter.readBlobTexts([listedBlob(1)], () => true, controller.signal);
    const rejected = expect(oldMonth).rejects.toBe(reason);
    const health = adapter.readBlobTexts([listedBlob(2)]);
    const replacementMonth = adapter.readBlobTexts([listedBlob(3)], () => true, new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(1);
    controller.abort(reason);
    await rejected;
    await expect(health).resolves.toMatchObject([{ blobSha: listedBlob(2).blobSha }]);
    await expect(replacementMonth).resolves.toMatchObject([{ blobSha: listedBlob(3).blobSha }]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.every(([url]) => String(url).endsWith("/graphql"))).toBe(true);
    await adapter.readBlobTexts([listedBlob(2), listedBlob(3)]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("cancels a month waiting on the shared probe without aborting the health request", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = vi.fn<typeof fetch>(async (_, init) => {
      await gate;
      return jsonResponse(blobQueryResponse(init));
    });
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    const health = adapter.readBlobTexts([listedBlob(1)]);
    const controller = new AbortController();
    const month = adapter.readBlobTexts([listedBlob(2)], () => true, controller.signal);
    const rejected = expect(month).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
    release();
    await expect(health).resolves.toHaveLength(1);
    await expect(adapter.readBlobTexts([listedBlob(2)])).resolves.toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("removes canceled months from the shared request-slot queue without consuming health slots", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_, init) => jsonResponse(blobQueryResponse(init)));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    await adapter.readBlobTexts([listedBlob(999)]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    fetcher.mockImplementation(async (_, init) => { await gate; return jsonResponse(blobQueryResponse(init)); });
    const health = adapter.readBlobTexts(Array.from({ length: 100 }, (_, index) => listedBlob(index)));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(5));
    const controller = new AbortController();
    const month = adapter.readBlobTexts([listedBlob(200)], () => true, controller.signal);
    const rejected = expect(month).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(5);
    release();
    await expect(health).resolves.toHaveLength(100);
    await expect(adapter.readBlobTexts([listedBlob(200)])).resolves.toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it.each([
    ["unauthorized HTTP", () => jsonResponse({}, 401), "GITHUB_UNAUTHORIZED"],
    ["unauthorized GraphQL", () => jsonResponse({ errors: [{ type: "UNAUTHENTICATED" }] }), "GITHUB_UNAUTHORIZED"],
    ["HTTP rate limit", () => jsonResponse({}, 429), "GITHUB_RATE_LIMITED"],
    ["secondary rate limit body", () => jsonResponse({ message: "You have exceeded a secondary rate limit." }, 403), "GITHUB_RATE_LIMITED"],
    ["GraphQL rate limit", () => jsonResponse({ errors: [{ type: "RATE_LIMITED" }] }), "GITHUB_RATE_LIMITED"],
    ["GraphQL extension rate limit", () => jsonResponse({ errors: [{ extensions: { code: "RATE_LIMITED" } }] }), "GITHUB_RATE_LIMITED"],
  ] as const)("does not fall back or disable GraphQL for %s", async (_name, response, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response()).mockImplementation(async (_, init) => jsonResponse(blobQueryResponse(init)));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    await expect(adapter.readBlobTexts([listedBlob(1)])).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(adapter.readBlobTexts([listedBlob(1)])).resolves.toHaveLength(1);
    expect(fetcher.mock.calls[1][0]).toBe("https://api.github.com/graphql");
  });

  it("reads 225 immutable blobs with nine read-only queries and reuses unchanged SHAs", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_, init) => jsonResponse(blobQueryResponse(init)));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    const files = Array.from({ length: 225 }, (_, index) => listedBlob(index));
    expect(await adapter.readBlobTexts(files)).toHaveLength(225);
    expect(fetcher).toHaveBeenCalledTimes(9);
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe("https://api.github.com/graphql");
      expect(init).toMatchObject({ method: "POST", cache: "no-store" });
      expect(JSON.parse(String(init?.body)).query).toMatch(/^query ReadWorkspaceBlobs/);
      expect(JSON.parse(String(init?.body)).query).not.toContain("mutation");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    await adapter.readBlobTexts(files);
    expect(fetcher).toHaveBeenCalledTimes(9);
    await adapter.readBlobTexts([{ ...files[0], blobSha: "a".repeat(40) }, ...files.slice(1)]);
    expect(fetcher).toHaveBeenCalledTimes(10);
    expect(Object.keys(JSON.parse(String(fetcher.mock.lastCall?.[1]?.body)).variables)).toEqual(["owner", "repository", "oid0"]);
  });

  it("isolates private body caches between adapter instances and repository targets", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_, init) => jsonResponse(blobQueryResponse(init)));
    const config = { owner: "owner", repository: "data", token: "test-token" };
    const adapter = new GitHubContentsAdapter(config, fetcher);
    const file = listedBlob(1);
    await adapter.readBlobTexts([file]);
    expect(await adapter.readBlobTexts([{ ...file, path: "data/sleep-sessions/copy.json" }])).toMatchObject([{ path: "data/sleep-sessions/copy.json" }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await adapter.forRepository("owner", "other-data").readBlobTexts([file]);
    await new GitHubContentsAdapter({ ...config, token: "another-token" }, fetcher).readBlobTexts([file]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("runs multiple GraphQL batches concurrently after one probe, capped at four across collections", async () => {
    let releaseProbe!: () => void;
    const probeGate = new Promise<void>((resolve) => { releaseProbe = resolve; });
    let active = 0;
    let maxActive = 0;
    let probePending = true;
    const fetcher = vi.fn<typeof fetch>(async (_, init) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (probePending) {
        await probeGate;
        probePending = false;
      } else {
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
      }
      active -= 1;
      return jsonResponse(blobQueryResponse(init));
    });
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    const first = adapter.readBlobTexts(Array.from({ length: 150 }, (_, index) => listedBlob(index)));
    const second = adapter.readBlobTexts(Array.from({ length: 150 }, (_, index) => listedBlob(index + 150)));
    // Both collections and all their chunk workers must share the first probe.
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
    releaseProbe();
    expect((await Promise.all([first, second])).flat()).toHaveLength(300);
    expect(fetcher).toHaveBeenCalledTimes(12);
    expect(maxActive).toBe(4);
  });

  it("stops queued query batches after a concurrent batch fails", async () => {
    let calls = 0;
    const fetcher = vi.fn<typeof fetch>(async (_, init) => {
      calls += 1;
      if (calls === 2) return jsonResponse({ errors: [{ type: "INTERNAL" }] });
      if (calls > 2) await new Promise<void>((resolve) => setTimeout(resolve, 1));
      return jsonResponse(blobQueryResponse(init));
    });
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    await expect(adapter.readBlobTexts(Array.from({ length: 1000 }, (_, index) => listedBlob(index)))).rejects.toMatchObject({ code: "GITHUB_GRAPHQL_ERROR" });
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    // One capability probe plus at most four in-flight queries; the remaining
    // 35 batches must not launch and no REST retries should be added.
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(5);
    expect(fetcher.mock.calls.every(([url]) => String(url).endsWith("/graphql"))).toBe(true);
  });

  it("falls back once when GraphQL is unavailable and bounds REST concurrency across collections", async () => {
    let active = 0;
    let maxActive = 0;
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("/graphql")) return jsonResponse({}, 403);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return jsonResponse({ sha: String(url).split("/").at(-1), size: 2, encoding: "base64", content: btoa("{}") });
    });
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    const first = Array.from({ length: 25 }, (_, index) => listedBlob(index));
    const second = Array.from({ length: 25 }, (_, index) => listedBlob(index + 25));
    const result = await Promise.all([adapter.readBlobTexts(first), adapter.readBlobTexts(second)]);
    expect(result.flat()).toHaveLength(50);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/graphql"))).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(51);
    expect(maxActive).toBeLessThanOrEqual(4);
    await adapter.readBlobTexts([...first, ...second]);
    expect(fetcher).toHaveBeenCalledTimes(51);
  });

  it("rejects partial GraphQL errors without caching partial results or starting REST retries", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(async (_, init) => jsonResponse({ ...blobQueryResponse(init), errors: [{ type: "INTERNAL", message: "private response details" }] }))
      .mockImplementation(async (_, init) => jsonResponse(blobQueryResponse(init)));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    await expect(adapter.readBlobTexts([listedBlob(1), listedBlob(2)])).rejects.toMatchObject({ code: "GITHUB_GRAPHQL_ERROR" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(adapter.readBlobTexts([listedBlob(1), listedBlob(2)])).resolves.toHaveLength(2);
    expect(Object.keys(JSON.parse(String(fetcher.mock.lastCall?.[1]?.body)).variables)).toHaveLength(4);
  });

  it.each(["timeout", "unavailable", "rate limit", "secondary rate limit"])("does not fan out a GraphQL %s into REST requests", async (failure) => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      if (failure === "timeout") throw new DOMException("timed out", "TimeoutError");
      if (failure === "rate limit") return new Response("{}", { status: 403, headers: { "X-RateLimit-Remaining": "0" } });
      if (failure === "secondary rate limit") return new Response("{}", { status: 403, headers: { "Retry-After": "60" } });
      return jsonResponse({}, 503);
    });
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    await expect(adapter.readBlobTexts(Array.from({ length: 100 }, (_, index) => listedBlob(index)))).rejects.toBeInstanceOf(GitHubDataError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("supports tokens whose GraphQL blob access is denied while REST Contents access works", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: { repository: { blob0: null } }, errors: [{ type: "FORBIDDEN" }] }))
      .mockImplementation(async (url) => jsonResponse({ sha: String(url).split("/").at(-1), size: 2, encoding: "base64", content: btoa("{}") }));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    await expect(adapter.readBlobTexts([listedBlob(1)])).resolves.toHaveLength(1);
    await expect(adapter.readBlobTexts([listedBlob(2)])).resolves.toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/graphql"))).toHaveLength(1);
  });

  it("checks UTF-8 byte counts and rejects missing aliases and malformed blob responses", async () => {
    const valid = { data: { repository: { blob0: { __typename: "Blob", oid: listedBlob(1).blobSha, byteSize: 6, isTruncated: false, text: "正文" } } } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(valid));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    await expect(adapter.readBlobTexts([listedBlob(1, 6)])).resolves.toMatchObject([{ text: "正文" }]);
    for (const response of [null, { errors: {} }, { data: { repository: {} } }, { data: { repository: { blob0: null } } }]) {
      const invalid = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(response)));
      await expect(invalid.readBlobTexts([listedBlob(1)])).rejects.toBeInstanceOf(GitHubDataError);
    }
    await expect(adapter.readBlobTexts([listedBlob(1, 7)])).rejects.toMatchObject({ code: "GITHUB_INVALID_RESPONSE" });
  });

  it("validates listed SHA, size, and path before sending a query", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    await expect(adapter.readBlobTexts([{ ...listedBlob(1), blobSha: "bad" }])).rejects.toThrow("INVALID_GITHUB_BLOB_SHA");
    await expect(adapter.readBlobTexts([{ ...listedBlob(1), path: "../secret.json" }])).rejects.toThrow("INVALID_GITHUB_PATH");
    await expect(adapter.readBlobTexts([listedBlob(1, -1)])).rejects.toThrow("INVALID_GITHUB_BLOB_SIZE");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { __typename: "Tree" }, { oid: "b".repeat(40) }, { byteSize: 3 }, { text: null }, { text: "incomplete" }, { isTruncated: undefined },
  ])("rejects invalid or incomplete GraphQL blobs: %j", async (override) => {
    const fetcher = vi.fn<typeof fetch>(async (_, init) => {
      const body = blobQueryResponse(init);
      Object.assign(body.data.repository.blob0, override);
      return jsonResponse(body);
    });
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    await expect(adapter.readBlobTexts([listedBlob(1)])).rejects.toMatchObject({ code: "GITHUB_UNSUPPORTED_CONTENT" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retrieves only truncated GraphQL blobs through REST and preserves requested ordering", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async (_, init) => {
      const body = blobQueryResponse(init);
      body.data.repository.blob0.isTruncated = true;
      body.data.repository.blob0.text = "{";
      return jsonResponse(body);
    }).mockResolvedValueOnce(jsonResponse({ sha: listedBlob(1).blobSha, size: 2, encoding: "base64", content: btoa("{}") }));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    expect((await adapter.readBlobTexts([listedBlob(1), listedBlob(2)])).map((file) => file.path)).toEqual([listedBlob(1).path, listedBlob(2).path]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.lastCall?.[0]).toContain(`/git/blobs/${listedBlob(1).blobSha}`);
  });

  it("stops the next query batch after a refresh supersedes the read", async () => {
    let current = true;
    const fetcher = vi.fn<typeof fetch>(async (_, init) => {
      current = false;
      return jsonResponse(blobQueryResponse(init));
    });
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    await expect(adapter.readBlobTexts(Array.from({ length: 50 }, (_, index) => listedBlob(index)), () => current)).rejects.toThrow("HEALTH_LOAD_CANCELLED");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reads a known immutable blob in one request without a Contents lookup", async () => {
    const sha = "a".repeat(40);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ sha, size: 6, encoding: "base64", content: btoa(unescape(encodeURIComponent("正文"))) }));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    await expect(adapter.readBlobText("data/journal-entries/one.json", sha)).resolves.toMatchObject({ text: "正文", blobSha: sha });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toContain(`/git/blobs/${sha}`);
    expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    await expect(adapter.readBlobText("../bad", sha)).rejects.toThrow();
    await expect(adapter.readBlobText("data/one.json", "bad")).rejects.toThrow();
  });
  it("does not add a diagnostic network probe when a statistics read fails", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network failed"));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    await expect(adapter.readBlobText("data/one.json", "a".repeat(40))).rejects.toMatchObject({ status: 0, code: "GITHUB_TRANSPORT_ERROR" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
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

  it("reads a large file through the Git blob API when Contents omits its body", async () => {
    const sha = "a".repeat(40);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ type: "file", path: "data/journal-history-index.json", sha, size: 2_000_000, encoding: "none", content: "" }))
      .mockResolvedValueOnce(jsonResponse({ sha, size: 2_000_000, encoding: "base64", content: btoa("history") }));
    const adapter = new GitHubContentsAdapter(
      { owner: "owner", repository: "personal-workspace-data", branch: "main", token: "test-token" },
      fetcher,
    );
    await expect(adapter.readText("data/journal-history-index.json")).resolves.toMatchObject({ text: "history", blobSha: sha });
    expect(fetcher.mock.calls[1]?.[0]).toContain(`/git/blobs/${sha}`);
  });

  it("lists more than 1,000 journal files in one metadata-only GraphQL request", async () => {
    const entries = Array.from({ length: 1501 }, (_, index) => ({ name: `journal_${index}.json`, type: "blob", oid: listedBlob(index).blobSha, size: index }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(journalDirectoryResponse([
      ...entries,
      { name: "archive", type: "tree", oid: "e".repeat(40), size: 0 },
      { name: "submodule", type: "commit", oid: "f".repeat(40), size: 0 },
    ])));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", branch: "main", token: "test-token" }, fetcher);
    const records = await adapter.listDirectory("data/journal-entries", "refs/heads/journal-history");
    expect(records).toEqual([
      ...entries.map((entry) => ({ type: "file", name: entry.name, path: `data/journal-entries/${entry.name}`, blobSha: entry.oid, sizeBytes: entry.size })),
      { type: "directory", name: "archive", path: "data/journal-entries/archive", blobSha: "e".repeat(40), sizeBytes: 0 },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.github.com/graphql");
    expect(init).toMatchObject({ method: "POST", cache: "no-store" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init?.body));
    expect(body.variables).toEqual({ owner: "owner", repository: "data", expression: "refs/heads/journal-history:data/journal-entries" });
    expect(body.query).toContain("object(expression: $expression)");
    expect(body.query).toContain("entries { name type oid size }");
    expect(body.query).not.toMatch(/\b(text|content|mutation)\b|journal-history|data\/journal-entries|test-token/u);
  });

  it("accepts an explicitly empty journal tree and uses the default branch", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(journalDirectoryResponse([])));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    await expect(adapter.listDirectory("data/journal-entries")).resolves.toEqual([]);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).variables.expression).toBe("main:data/journal-entries");
  });

  it("distinguishes an unverified repository from a missing directory inside a valid repository", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: { repository: null } }))
      .mockResolvedValueOnce(jsonResponse({ data: { repository: { object: null } } }));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    await expect(adapter.listDirectory("data/journal-entries")).rejects.toMatchObject({ status: 500, code: "GITHUB_INVALID_RESPONSE" });
    await expect(adapter.listDirectory("data/journal-entries")).rejects.toMatchObject({ status: 404, code: "GITHUB_NOT_FOUND" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed, missing, or partial directory results without falling back", async () => {
    const invalidEntries = [
      null, { name: "../secret.json" }, { name: "" }, { name: "." }, { name: ".." }, { name: "nested/file.json" }, { name: "nested\\file.json" },
      { name: "bad\u0000.json" }, { name: 1 }, { type: "unknown" }, { oid: "bad" }, { oid: null },
      { size: -1 }, { size: 1.5 }, { size: "2" }, { size: null }, { size: Number.MAX_SAFE_INTEGER + 1 },
    ];
    const invalidResponses: unknown[] = [
      null, {}, { data: {} }, { data: { repository: {} } }, { errors: {} }, { errors: [null] },
      { data: { repository: null } }, { data: { repository: { object: null } } },
      { ...journalDirectoryResponse(), errors: [{ type: "INTERNAL" }] },
      { ...journalDirectoryResponse(), errors: [{ type: "FORBIDDEN" }] },
      ...[{ __typename: "Blob" }, { oid: "bad" }, { entries: null }, { entries: {} }, { entries: undefined }].map((override) => ({
        data: { repository: { object: { ...journalDirectoryResponse().data.repository.object, ...override } } },
      })),
      ...invalidEntries.map((override) => journalDirectoryResponse([
        journalDirectoryResponse().data.repository.object.entries[0],
        (override === null ? null : { name: "two.json", type: "blob", oid: "e".repeat(40), size: 2, ...override }) as never,
      ])),
      journalDirectoryResponse(Array(2).fill(journalDirectoryResponse().data.repository.object.entries[0])),
    ];
    for (const response of invalidResponses) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(response)).mockResolvedValueOnce(jsonResponse(journalDirectoryResponse()));
      const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
      await expect(adapter.listDirectory("data/journal-entries")).rejects.toBeInstanceOf(GitHubDataError);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await expect(adapter.listDirectory("data/journal-entries")).resolves.toHaveLength(1);
      expect(fetcher.mock.calls[1][0]).toBe("https://api.github.com/graphql");
    }
  });

  it.each([
    ["unauthorized HTTP", () => jsonResponse({}, 401), "GITHUB_UNAUTHORIZED"],
    ["unauthorized GraphQL", () => jsonResponse({ errors: [{ type: "UNAUTHENTICATED" }] }), "GITHUB_UNAUTHORIZED"],
    ["HTTP rate limit", () => jsonResponse({}, 429), "GITHUB_RATE_LIMITED"],
    ["secondary rate limit", () => jsonResponse({ message: "You have exceeded a secondary rate limit." }, 403), "GITHUB_RATE_LIMITED"],
    ["GraphQL rate limit", () => jsonResponse({ errors: [{ type: "RATE_LIMITED" }] }), "GITHUB_RATE_LIMITED"],
    ["unavailable HTTP", () => jsonResponse({}, 503), "GITHUB_UNAVAILABLE"],
  ] as const)("does not fan out a journal directory %s failure or disable future queries", async (_name, response, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response()).mockResolvedValueOnce(jsonResponse(journalDirectoryResponse()));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    await expect(adapter.listDirectory("data/journal-entries")).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(adapter.listDirectory("data/journal-entries")).resolves.toHaveLength(1);
    expect(fetcher.mock.calls[1][0]).toBe("https://api.github.com/graphql");
  });

  it.each([new TypeError("network failed"), new DOMException("timed out", "TimeoutError")])("does not retry or diagnose a failed directory transport: %s", async (failure) => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(failure);
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    await expect(adapter.listDirectory("data/journal-entries")).rejects.toMatchObject({ code: "GITHUB_TRANSPORT_ERROR" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["FORBIDDEN", "INSUFFICIENT_SCOPES"])("remembers directory GraphQL %s and shares REST fallback with body reads", async (type) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ errors: [{ type }] })).mockImplementation(async (url) => {
      if (String(url).includes("/git/blobs/")) return jsonResponse({ sha: String(url).split("/").at(-1), size: 2, encoding: "base64", content: btoa("{}") });
      return journalRestTreeResponse(String(url));
    });
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    await expect(adapter.listDirectory("data/journal-entries")).resolves.toHaveLength(1);
    await expect(adapter.listDirectory("data/journal-entries")).resolves.toHaveLength(1);
    await expect(adapter.readBlobTexts([listedBlob(1)])).resolves.toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/graphql"))).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it("respects GraphQL permission failures already learned by body reads", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({}, 403)).mockImplementation(async (url) => {
      if (String(url).includes("/git/blobs/")) return jsonResponse({ sha: String(url).split("/").at(-1), size: 2, encoding: "base64", content: btoa("{}") });
      return journalRestTreeResponse(String(url));
    });
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    await adapter.readBlobTexts([listedBlob(1)]);
    await expect(adapter.listDirectory("data/journal-entries")).resolves.toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/graphql"))).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("keeps a concurrent canceled body probe independent of the directory query", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }))
      .mockResolvedValueOnce(jsonResponse(journalDirectoryResponse()))
      .mockImplementation(async (_, init) => jsonResponse(blobQueryResponse(init)));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    const oldMonth = adapter.readBlobTexts([listedBlob(1)], () => true, controller.signal);
    const rejected = expect(oldMonth).rejects.toMatchObject({ name: "AbortError" });
    const directory = adapter.listDirectory("data/journal-entries");
    controller.abort();
    await rejected;
    await expect(directory).resolves.toHaveLength(1);
    await expect(adapter.readBlobTexts([listedBlob(2)])).resolves.toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("keeps a directory permission failure after an already-running body probe succeeds", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async (_, init) => {
      await gate;
      return jsonResponse(blobQueryResponse(init));
    }).mockResolvedValueOnce(jsonResponse({}, 403)).mockImplementation(async (url) => journalRestTreeResponse(String(url)));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "data", token: "test-token" }, fetcher);
    const body = adapter.readBlobTexts([listedBlob(1)]);
    await expect(adapter.listDirectory("data/journal-entries")).resolves.toHaveLength(1);
    release();
    await expect(body).resolves.toHaveLength(1);
    await expect(adapter.listDirectory("data/journal-entries")).resolves.toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/graphql"))).toHaveLength(2);
  });

  it("falls back to the small REST directory tree when GraphQL permission is denied", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}, 403))
      .mockResolvedValueOnce(jsonResponse({ truncated: false, tree: [{ path: "data", type: "tree", sha: "data-tree" }] }))
      .mockResolvedValueOnce(jsonResponse({ truncated: false, tree: [{ path: "journal-entries", type: "tree", sha: "entries-tree" }] }))
      .mockResolvedValueOnce(jsonResponse({ truncated: false, tree: [
        { path: "one.json", type: "blob", sha: "entry-one", size: 123 },
        { path: "nested", type: "tree", sha: "nested-tree" },
      ] }));
    const adapter = new GitHubContentsAdapter(
      { owner: "owner", repository: "personal-workspace-data", branch: "main", token: "test-token" }, fetcher,
    );
    await expect(adapter.listDirectory("data/journal-entries")).resolves.toEqual([
      { type: "file", name: "one.json", path: "data/journal-entries/one.json", blobSha: "entry-one", sizeBytes: 123 },
      { type: "directory", name: "nested", path: "data/journal-entries/nested", blobSha: "nested-tree", sizeBytes: 0 },
    ]);
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      "https://api.github.com/graphql",
      "https://api.github.com/repos/owner/personal-workspace-data/git/trees/main",
      "https://api.github.com/repos/owner/personal-workspace-data/git/trees/data-tree",
      "https://api.github.com/repos/owner/personal-workspace-data/git/trees/entries-tree",
    ]);
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

  it("writes batch text inline in one tree request with Git-compatible blob SHAs", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ sha: "tree-two" }, 201))
      .mockResolvedValueOnce(jsonResponse({ sha: "commit-two", tree: { sha: "tree-two" } }, 201))
      .mockResolvedValueOnce(jsonResponse({ ref: "refs/heads/main", object: { sha: "commit-two", type: "commit" } }));
    const adapter = new GitHubContentsAdapter({ owner: "owner", repository: "personal-workspace-data", branch: "main", token: "test-token" }, fetcher);
    const files = [{ path: "data/health-staging-records/one.json", text: "你好，Workout\n" }, { path: "data/workouts/one.json", text: "{\"ok\":true}\n" }];
    const result = await adapter.writeAtomicFiles({ files, message: "workout: batch import", expectedHeadCommitSha: "head-one", baseTreeSha: "tree-one", inlineContent: true });
    const treeBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(treeBody.tree).toEqual(files.map((file) => ({ path: file.path, mode: "100644", type: "blob", content: file.text })));
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.files).toEqual(files.map((file) => {
      const bytes = Buffer.from(file.text, "utf8");
      const blobSha = createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
      return { path: file.path, blobSha };
    }));
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
