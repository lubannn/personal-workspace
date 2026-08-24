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
    fetcher: typeof fetch = fetch,
  ) {
    assertRepositoryPart(config.owner);
    assertRepositoryPart(config.repository);
    if (!config.token) throw new Error("GITHUB_TOKEN_REQUIRED");
    this.fetcher = fetcher;
  }

  private async request<T>(pathname: string, init?: RequestInit): Promise<T> {
    const response = await this.fetcher(`${API_ROOT}${pathname}`, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.config.token}`,
        "X-GitHub-Api-Version": API_VERSION,
        ...init?.headers,
      },
    });
    if (!response.ok) {
      if (response.status === 409 || response.status === 422) throw new GitHubConflictError();
      const code = response.status === 401 ? "GITHUB_UNAUTHORIZED"
        : response.status === 403 ? "GITHUB_FORBIDDEN"
          : response.status === 404 ? "GITHUB_NOT_FOUND" : "GITHUB_API_ERROR";
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

  async readText(pathname: string): Promise<GitHubStoredFile> {
    assertFilePath(pathname);
    const branch = this.config.branch ? `?ref=${encodeURIComponent(this.config.branch)}` : "";
    const result = await this.request<GitHubFileResponse>(
      `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repository)}/contents/${encodeRepositoryPath(pathname)}${branch}`,
    );
    if (result.type !== "file" || result.encoding !== "base64") {
      throw new GitHubDataError("Expected a base64 encoded GitHub file.", 500, "GITHUB_UNSUPPORTED_CONTENT");
    }
    return { path: result.path, blobSha: result.sha, sizeBytes: result.size, text: decodeBase64(result.content) };
  }

  async listDirectory(pathname: string): Promise<GitHubDirectoryItem[]> {
    assertFilePath(pathname);
    const branch = this.config.branch ? `?ref=${encodeURIComponent(this.config.branch)}` : "";
    const result = await this.request<GitHubDirectoryResponse>(
      `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repository)}/contents/${encodeRepositoryPath(pathname)}${branch}`,
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
}
