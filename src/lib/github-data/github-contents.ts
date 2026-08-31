const API_ROOT = "https://api.github.com";
const API_VERSION = "2026-03-10";

export class GitHubDataError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "GitHubDataError";
  }
}

export class GitHubConflictError extends GitHubDataError {
  constructor(message = "The GitHub file changed on another device.") {
    super(message, 409, "GITHUB_SYNC_CONFLICT");
    this.name = "GitHubConflictError";
  }
}

type GitHubFileResponse = {
  type: "file";
  path: string;
  sha: string;
  size: number;
  encoding: "base64";
  content: string;
};

type GitHubWriteResponse = {
  content: { path: string; sha: string } | null;
  commit: { sha: string };
};

type GitHubRefResponse = {
  ref: string;
  object: { sha: string; type: "commit" };
};

type GitHubCommitResponse = {
  sha: string;
  tree: { sha: string };
};

type GitHubBlobResponse = { sha: string };
type GitHubTreeResponse = { sha: string };

type GitHubDirectoryResponse = Array<{
  type: "file" | "dir" | "symlink" | "submodule";
  name: string;
  path: string;
  sha: string;
  size: number;
}>;

export type GitHubStoredFile = {
  path: string;
  blobSha: string;
  sizeBytes: number;
  text: string;
};

export type GitHubDirectoryItem = {
  type: "file" | "directory";
  name: string;
  path: string;
  blobSha: string;
  sizeBytes: number;
};

export type GitHubRepositoryStatus = {
  fullName: string;
  private: boolean;
  visibility: string;
  defaultBranch: string;
};

export type GitHubBranchSnapshot = {
  branch: string;
  headCommitSha: string;
  rootTreeSha: string;
};

function encodeRepositoryPath(value: string) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function assertRepositoryPart(value: string) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(value)) throw new Error("INVALID_GITHUB_REPOSITORY");
}

function assertFilePath(value: string) {
  if (!value || value.startsWith("/") || value.includes("\\")) throw new Error("INVALID_GITHUB_PATH");
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw new Error("INVALID_GITHUB_PATH");
}

function decodeBase64(value: string) {
  const binary = atob(value.replaceAll(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export class GitHubContentsAdapter {
  private readonly fetcher: typeof fetch;

  constructor(
    private readonly config: {
      owner: string;
      repository: string;
      branch?: string;
      token: string;
    },
    fetcher?: typeof fetch,
  ) {
    assertRepositoryPart(config.owner);
    assertRepositoryPart(config.repository);
    if (!config.token.trim()) throw new Error("GITHUB_TOKEN_REQUIRED");
    const transport = fetcher ?? globalThis.fetch.bind(globalThis);
    this.fetcher = (input, init) => transport(input, init);
  }

  forRepository(owner: string, repository: string, branch = "main") {
    return new GitHubContentsAdapter({
      owner,
      repository,
      branch,
      token: this.config.token,
    }, this.fetcher);
  }

  private async throwTransportError(error: unknown): Promise<never> {
    let publicApiReached = false;
    try {
      const probe = await this.fetcher(`${API_ROOT}/rate_limit`, {
        cache: "no-store",
        headers: { Accept: "application/vnd.github+json" },
      });
      publicApiReached = probe.status > 0;
    } catch {
      // The public probe deliberately has no token and is only used to classify the failure.
    }

    const reason = error instanceof Error ? `${error.name}: ${error.message}` : "Unknown browser error";
    if (publicApiReached) {
      throw new GitHubDataError(
        `The browser blocked the authenticated GitHub request (${reason}).`,
        0,
        "GITHUB_AUTH_REQUEST_BLOCKED",
      );
    }
    throw new GitHubDataError(
      `The browser blocked cross-origin GitHub API requests (${reason}).`,
      0,
      "GITHUB_CROSS_ORIGIN_BLOCKED",
    );
  }

  private async request<T>(pathname: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${API_ROOT}${pathname}`, {
        ...init,
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.config.token.trim()}`,
          "X-GitHub-Api-Version": API_VERSION,
          ...init?.headers,
        },
      });
    } catch (error) {
      return this.throwTransportError(error);
    }
    if (!response.ok) {
      if (response.status === 409 || response.status === 422) throw new GitHubConflictError();
      const code = response.status === 401 ? "GITHUB_UNAUTHORIZED"
        : response.status === 403 && response.headers.get("X-RateLimit-Remaining") === "0" ? "GITHUB_RATE_LIMITED"
          : response.status === 403 ? "GITHUB_FORBIDDEN"
            : response.status === 404 ? "GITHUB_NOT_FOUND"
              : response.status === 400 ? "GITHUB_BAD_REQUEST"
                : response.status >= 500 ? "GITHUB_UNAVAILABLE" : "GITHUB_API_ERROR";
      throw new GitHubDataError(`GitHub request failed with status ${response.status}.`, response.status, code);
    }
    return response.json() as Promise<T>;
  }

  async verifyPrivateRepository(): Promise<GitHubRepositoryStatus> {
    const result = await this.request<{
      full_name: string;
      private: boolean;
      visibility: string;
      default_branch: string;
    }>(`/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repository)}`);
    if (!result.private || result.visibility !== "private") {
      throw new GitHubDataError("The configured data repository is not private.", 400, "GITHUB_REPOSITORY_NOT_PRIVATE");
    }
    return {
      fullName: result.full_name,
      private: result.private,
      visibility: result.visibility,
      defaultBranch: result.default_branch,
    };
  }

  async readText(pathname: string, refOverride?: string): Promise<GitHubStoredFile> {
    assertFilePath(pathname);
    const ref = refOverride ?? this.config.branch;
    const branch = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const result = await this.request<GitHubFileResponse>(
      `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repository)}/contents/${encodeRepositoryPath(pathname)}${branch}`,
    );
    if (result.type !== "file" || result.encoding !== "base64") {
      throw new GitHubDataError("Expected a base64 encoded GitHub file.", 500, "GITHUB_UNSUPPORTED_CONTENT");
    }
    return { path: result.path, blobSha: result.sha, sizeBytes: result.size, text: decodeBase64(result.content) };
  }

  async listDirectory(pathname: string, refOverride?: string): Promise<GitHubDirectoryItem[]> {
    if (pathname) assertFilePath(pathname);
    const ref = refOverride ?? this.config.branch;
    const branch = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const contentsPath = pathname ? `/contents/${encodeRepositoryPath(pathname)}` : "/contents";
    const result = await this.request<GitHubDirectoryResponse>(
      `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repository)}${contentsPath}${branch}`,
    );
    if (!Array.isArray(result)) {
      throw new GitHubDataError("Expected a GitHub directory listing.", 500, "GITHUB_UNSUPPORTED_CONTENT");
    }
    return result
      .filter((item) => item.type === "file" || item.type === "dir")
      .map((item) => ({
        type: item.type === "dir" ? "directory" : "file",
        name: item.name,
        path: item.path,
        blobSha: item.sha,
        sizeBytes: item.size,
      }));
  }

  async writeText(input: {
    path: string;
    text: string;
    message: string;
    expectedBlobSha?: string;
  }) {
    assertFilePath(input.path);
    if (!input.message || input.message.length > 120) throw new Error("INVALID_COMMIT_MESSAGE");
    const body: Record<string, string> = {
      message: input.message,
      content: encodeBase64(input.text),
    };
    if (this.config.branch) body.branch = this.config.branch;
    if (input.expectedBlobSha) body.sha = input.expectedBlobSha;

    const result = await this.request<GitHubWriteResponse>(
      `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repository)}/contents/${encodeRepositoryPath(input.path)}`,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    if (!result.content) throw new GitHubDataError("GitHub did not return the updated file.", 500, "GITHUB_INVALID_RESPONSE");
    return { path: result.content.path, blobSha: result.content.sha, commitSha: result.commit.sha };
  }

  async readBranchSnapshot(): Promise<GitHubBranchSnapshot> {
    const branch = this.config.branch ?? "main";
    const encodedOwner = encodeURIComponent(this.config.owner);
    const encodedRepository = encodeURIComponent(this.config.repository);
    const ref = await this.request<GitHubRefResponse>(
      `/repos/${encodedOwner}/${encodedRepository}/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    const commit = await this.request<GitHubCommitResponse>(
      `/repos/${encodedOwner}/${encodedRepository}/git/commits/${encodeURIComponent(ref.object.sha)}`,
    );
    return { branch, headCommitSha: ref.object.sha, rootTreeSha: commit.tree.sha };
  }

  async writeAtomicFiles(input: {
    files: Array<{ path: string; text: string }>;
    message: string;
    expectedHeadCommitSha: string;
    baseTreeSha: string;
  }) {
    if (input.files.length === 0) throw new Error("ATOMIC_WRITE_FILES_REQUIRED");
    if (!input.message || input.message.length > 120) throw new Error("INVALID_COMMIT_MESSAGE");
    const seenPaths = new Set<string>();
    for (const file of input.files) {
      assertFilePath(file.path);
      if (seenPaths.has(file.path)) throw new Error("DUPLICATE_GITHUB_PATH");
      seenPaths.add(file.path);
    }

    const encodedOwner = encodeURIComponent(this.config.owner);
    const encodedRepository = encodeURIComponent(this.config.repository);
    const blobs = await Promise.all(input.files.map((file) => this.request<GitHubBlobResponse>(
      `/repos/${encodedOwner}/${encodedRepository}/git/blobs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: encodeBase64(file.text), encoding: "base64" }),
      },
    )));
    const tree = await this.request<GitHubTreeResponse>(
      `/repos/${encodedOwner}/${encodedRepository}/git/trees`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_tree: input.baseTreeSha,
          tree: input.files.map((file, index) => ({
            path: file.path,
            mode: "100644",
            type: "blob",
            sha: blobs[index]!.sha,
          })),
        }),
      },
    );
    const commit = await this.request<GitHubCommitResponse>(
      `/repos/${encodedOwner}/${encodedRepository}/git/commits`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input.message,
          tree: tree.sha,
          parents: [input.expectedHeadCommitSha],
        }),
      },
    );
    await this.request<GitHubRefResponse>(
      `/repos/${encodedOwner}/${encodedRepository}/git/refs/heads/${encodeURIComponent(this.config.branch ?? "main")}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha: commit.sha, force: false }),
      },
    );
    return {
      commitSha: commit.sha,
      treeSha: tree.sha,
      files: input.files.map((file, index) => ({ path: file.path, blobSha: blobs[index]!.sha })),
    };
  }
}
