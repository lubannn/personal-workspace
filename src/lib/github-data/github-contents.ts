const API_ROOT = "https://api.github.com";
const API_VERSION = "2026-03-10";
const BLOB_QUERY_BATCH_SIZE = 25;
const BLOB_READ_CONCURRENCY = 4;

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
  encoding: "base64" | "none";
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
type GitHubBlobReadResponse = { sha: string; size: number; encoding: "base64"; content: string };
type GitHubGraphQLError = { type?: string; message?: string; extensions?: { code?: string; type?: string } };
type GitHubGraphQLBlobResponse = {
  data?: { repository?: Record<string, {
    __typename?: string;
    oid?: string;
    byteSize?: number;
    isTruncated?: boolean;
    text?: string | null;
  } | null> | null } | null;
  errors?: GitHubGraphQLError[];
};
type GitHubRecursiveTreeResponse = {
  truncated: boolean;
  tree: Array<{ path: string; type: "blob" | "tree" | "commit"; sha: string; size?: number }>;
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

type ListedBlob = Pick<GitHubDirectoryItem, "path" | "blobSha" | "sizeBytes">;
export type BlobReadOptions = { maxBatchFiles?: number; onBatch?: (files: GitHubStoredFile[]) => void };

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

function blobReadSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(20_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function assertGraphQLAuthAndRate(errors: GitHubGraphQLError[]) {
  for (const error of errors) {
    if (!error || typeof error !== "object") throw new GitHubDataError("Invalid GitHub query error.", 500, "GITHUB_INVALID_RESPONSE");
    const type = error.type ?? error.extensions?.type ?? error.extensions?.code ?? "";
    const message = typeof error.message === "string" ? error.message : "";
    if (type === "RATE_LIMITED" || /rate limit|abuse detection/i.test(message)) {
      throw new GitHubDataError("GitHub request was rate limited.", 403, "GITHUB_RATE_LIMITED");
    }
    if (["UNAUTHORIZED", "UNAUTHENTICATED", "BAD_CREDENTIALS"].includes(type) || /bad credentials|requires authentication/i.test(message)) {
      throw new GitHubDataError("GitHub authentication failed.", 401, "GITHUB_UNAUTHORIZED");
    }
  }
}

function awaitWithSignal<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
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

async function gitBlobSha(text: string): Promise<string> {
  const content = new TextEncoder().encode(text);
  const header = new TextEncoder().encode(`blob ${content.byteLength}\0`);
  const bytes = new Uint8Array(header.byteLength + content.byteLength);
  bytes.set(header);
  bytes.set(content, header.byteLength);
  const digest = await globalThis.crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class GitHubContentsAdapter {
  private readonly fetcher: typeof fetch;
  // Private bodies live only for this authenticated adapter's lifetime. The SHA,
  // rather than the mutable path, determines whether a refresh can reuse a body.
  private readonly blobTextCache = new Map<string, Omit<GitHubStoredFile, "path">>();
  private readonly journalTreeCache = new Map<string, GitHubRecursiveTreeResponse>();
  private graphQLAvailable: boolean | undefined;
  private graphQLFirstRead: Promise<GitHubStoredFile[] | null> | null = null;
  private graphQLFirstReadSignal: AbortSignal | undefined;
  private activeBlobReads = 0;
  private readonly blobReadWaiters: Array<() => void> = [];

  constructor(
    private readonly config: {
      owner: string;
      repository: string;
      branch?: string;
      token: string;
      userAgent?: string;
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
      userAgent: this.config.userAgent,
    }, this.fetcher);
  }

  private async throwTransportError(error: unknown): Promise<never> {
    let publicApiReached = false;
    try {
      const probe = await this.fetcher(`${API_ROOT}/rate_limit`, {
        cache: "no-store",
        headers: { Accept: "application/vnd.github+json", ...(this.config.userAgent ? { "User-Agent": this.config.userAgent } : {}) },
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

  private async request<T>(pathname: string, init?: RequestInit, diagnoseTransport = true, callerSignal?: AbortSignal): Promise<T> {
    callerSignal?.throwIfAborted();
    let response: Response;
    try {
      response = await this.fetcher(`${API_ROOT}${pathname}`, {
        ...init,
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.config.token.trim()}`,
          "X-GitHub-Api-Version": API_VERSION,
          ...(this.config.userAgent ? { "User-Agent": this.config.userAgent } : {}),
          ...init?.headers,
        },
      });
    } catch (error) {
      callerSignal?.throwIfAborted();
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (!diagnoseTransport) throw new GitHubDataError("GitHub read timed out or failed.", 0, "GITHUB_TRANSPORT_ERROR");
      return this.throwTransportError(error);
    }
    callerSignal?.throwIfAborted();
    if (!response.ok) {
      if (response.status === 409 || response.status === 422) throw new GitHubConflictError();
      let rateLimited = response.status === 429 || (response.status === 403 && (
        response.headers.get("X-RateLimit-Remaining") === "0" || response.headers.has("Retry-After")
      ));
      if (response.status === 403 && !rateLimited) {
        const failure = await response.json().catch(() => null) as { message?: string } | null;
        callerSignal?.throwIfAborted();
        rateLimited = typeof failure?.message === "string" && /rate limit|abuse detection/i.test(failure.message);
      }
      const code = response.status === 401 ? "GITHUB_UNAUTHORIZED"
        : rateLimited ? "GITHUB_RATE_LIMITED"
          : response.status === 403 ? "GITHUB_FORBIDDEN"
            : response.status === 404 ? "GITHUB_NOT_FOUND"
              : response.status === 400 ? "GITHUB_BAD_REQUEST"
                : response.status >= 500 ? "GITHUB_UNAVAILABLE" : "GITHUB_API_ERROR";
      throw new GitHubDataError(`GitHub request failed with status ${response.status}.`, response.status, code);
    }
    try {
      const result = await response.json() as T;
      callerSignal?.throwIfAborted();
      return result;
    } catch (error) {
      callerSignal?.throwIfAborted();
      throw error;
    }
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
    if (result.type !== "file") {
      throw new GitHubDataError("Expected a base64 encoded GitHub file.", 500, "GITHUB_UNSUPPORTED_CONTENT");
    }
    if (result.encoding === "base64") {
      return { path: result.path, blobSha: result.sha, sizeBytes: result.size, text: decodeBase64(result.content) };
    }
    if (result.encoding === "none" && /^[a-f0-9]{40}$/.test(result.sha)) {
      const blob = await this.request<GitHubBlobReadResponse>(
        `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repository)}/git/blobs/${result.sha}`,
      );
      if (blob.encoding === "base64" && blob.sha === result.sha) {
        return { path: result.path, blobSha: blob.sha, sizeBytes: blob.size, text: decodeBase64(blob.content) };
      }
    }
    throw new GitHubDataError("Expected a base64 encoded GitHub file.", 500, "GITHUB_UNSUPPORTED_CONTENT");
  }

  async readBlobText(pathname: string, blobSha: string, signal?: AbortSignal): Promise<GitHubStoredFile> {
    assertFilePath(pathname);
    if (!/^[a-f0-9]{40}$/u.test(blobSha)) throw new Error("INVALID_GITHUB_BLOB_SHA");
    const blob = await this.request<GitHubBlobReadResponse>(
      `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repository)}/git/blobs/${blobSha}`,
      { signal: blobReadSignal(signal) }, false, signal,
    );
    if (blob.encoding !== "base64" || blob.sha !== blobSha) throw new GitHubDataError("Unexpected GitHub blob.", 500, "GITHUB_UNSUPPORTED_CONTENT");
    const text = decodeBase64(blob.content);
    if (new TextEncoder().encode(text).byteLength !== blob.size) throw new GitHubDataError("Incomplete GitHub blob.", 500, "GITHUB_UNSUPPORTED_CONTENT");
    return { path: pathname, blobSha, sizeBytes: blob.size, text };
  }

  private async withBlobReadSlot<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    if (this.activeBlobReads >= BLOB_READ_CONCURRENCY) {
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          signal?.removeEventListener("abort", aborted);
          resolve();
        };
        const aborted = () => {
          const index = this.blobReadWaiters.indexOf(ready);
          if (index !== -1) this.blobReadWaiters.splice(index, 1);
          reject(signal?.reason);
        };
        this.blobReadWaiters.push(ready);
        signal?.addEventListener("abort", aborted, { once: true });
      });
    } else {
      this.activeBlobReads += 1;
    }
    try {
      signal?.throwIfAborted();
      return await read();
    }
    finally {
      const next = this.blobReadWaiters.shift();
      if (next) next();
      else this.activeBlobReads -= 1;
    }
  }

  private async readRestBlobBatch(files: readonly ListedBlob[], assertCurrent: () => void, signal?: AbortSignal, onBatch?: BlobReadOptions["onBatch"]) {
    const records: GitHubStoredFile[] = [];
    for (let index = 0; index < files.length; index += BLOB_READ_CONCURRENCY) {
      assertCurrent();
      const batch = await Promise.all(files.slice(index, index + BLOB_READ_CONCURRENCY).map((file) => this.withBlobReadSlot(async () => {
        assertCurrent();
        const stored = await this.readBlobText(file.path, file.blobSha, signal);
        if (stored.sizeBytes !== file.sizeBytes) throw new GitHubDataError("Unexpected GitHub blob size.", 500, "GITHUB_UNSUPPORTED_CONTENT");
        return stored;
      }, signal)));
      assertCurrent();
      records.push(...batch);
      onBatch?.(batch);
    }
    return records;
  }

  private async readGraphQLBlobBatch(files: readonly ListedBlob[], assertCurrent: () => void, signal?: AbortSignal): Promise<GitHubStoredFile[] | null> {
    const variables: Record<string, string> = { owner: this.config.owner, repository: this.config.repository };
    files.forEach((file, index) => { variables[`oid${index}`] = file.blobSha; });
    // Read immutable objects already returned by the authenticated directory
    // listing. Never interpolate paths or credentials into the GraphQL query.
    const query = `query ReadWorkspaceBlobs($owner: String!, $repository: String!, ${files.map((_, index) => `$oid${index}: GitObjectID!`).join(", ")}) {
      repository(owner: $owner, name: $repository) {
        ${files.map((_, index) => `blob${index}: object(oid: $oid${index}) { __typename oid ... on Blob { byteSize isTruncated text } }`).join("\n")}
      }
    }`;
    let result: GitHubGraphQLBlobResponse;
    try {
      result = await this.withBlobReadSlot(() => {
        assertCurrent();
        return this.request<GitHubGraphQLBlobResponse>("/graphql", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, variables }), signal: blobReadSignal(signal),
        }, false, signal);
      }, signal);
    } catch (error) {
      signal?.throwIfAborted();
      // Some app tokens can read REST Contents but cannot use GraphQL. Remember
      // that capability once; transient/rate-limit failures must not fan out
      // into hundreds of REST retries.
      if (error instanceof GitHubDataError && ["GITHUB_FORBIDDEN", "GITHUB_NOT_FOUND", "GITHUB_BAD_REQUEST"].includes(error.code)) return null;
      throw error;
    }
    if (!result || typeof result !== "object" || (result.errors !== undefined && !Array.isArray(result.errors))) {
      throw new GitHubDataError("Invalid GitHub blob query response.", 500, "GITHUB_INVALID_RESPONSE");
    }
    if (result.errors?.length) {
      assertGraphQLAuthAndRate(result.errors);
      const noBlobs = !result.data?.repository || Object.values(result.data.repository).every((blob) => blob === null);
      if (noBlobs && result.errors.every((error) => ["FORBIDDEN", "INSUFFICIENT_SCOPES", "NOT_FOUND"].includes(error.type ?? ""))) return null;
      throw new GitHubDataError("GitHub did not return a complete blob query.", 500, "GITHUB_GRAPHQL_ERROR");
    }
    const repository = result.data?.repository;
    if (!repository) throw new GitHubDataError("GitHub did not return the requested repository.", 500, "GITHUB_INVALID_RESPONSE");
    const records: GitHubStoredFile[] = [];
    const truncated: ListedBlob[] = [];
    for (const [index, file] of files.entries()) {
      const blob = repository[`blob${index}`];
      if (!blob || blob.__typename !== "Blob" || blob.oid !== file.blobSha || blob.byteSize !== file.sizeBytes || typeof blob.isTruncated !== "boolean") {
        throw new GitHubDataError("Unexpected GitHub blob query result.", 500, "GITHUB_UNSUPPORTED_CONTENT");
      }
      if (blob.isTruncated) { truncated.push(file); continue; }
      if (typeof blob.text !== "string" || new TextEncoder().encode(blob.text).byteLength !== blob.byteSize) {
        throw new GitHubDataError("Incomplete GitHub blob query result.", 500, "GITHUB_UNSUPPORTED_CONTENT");
      }
      records.push({ path: file.path, blobSha: file.blobSha, sizeBytes: blob.byteSize, text: blob.text });
    }
    records.push(...await this.readRestBlobBatch(truncated, assertCurrent, signal));
    return records;
  }

  async readBlobTexts(files: readonly ListedBlob[], isCurrent: () => boolean = () => true, signal?: AbortSignal, options: BlobReadOptions = {}): Promise<GitHubStoredFile[]> {
    const batchSize = options.maxBatchFiles ?? BLOB_QUERY_BATCH_SIZE;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 40) throw new Error("INVALID_GITHUB_BLOB_BATCH_SIZE");
    if (batchSize > BLOB_QUERY_BATCH_SIZE && files.length > BLOB_QUERY_BATCH_SIZE && files.reduce((sum, file) => sum + file.sizeBytes, 0) > 1024 * 1024) throw new Error("GITHUB_BLOB_BATCH_TOO_LARGE");
    let failed = false;
    const assertCurrent = () => {
      signal?.throwIfAborted();
      if (failed || !isCurrent()) throw new Error("HEALTH_LOAD_CANCELLED");
    };
    assertCurrent();
    for (const file of files) {
      assertFilePath(file.path);
      if (!/^[a-f0-9]{40}$/u.test(file.blobSha)) throw new Error("INVALID_GITHUB_BLOB_SHA");
      if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) throw new Error("INVALID_GITHUB_BLOB_SIZE");
    }
    const missing = [...new Map(files.filter((file) => !this.blobTextCache.has(file.blobSha)).map((file) => [file.blobSha, file])).values()];
    let nextIndex = 0;
    const readNextBatches = async () => {
      while (nextIndex < missing.length) {
        assertCurrent();
        const batch = missing.slice(nextIndex, nextIndex + batchSize);
        nextIndex += batchSize;
        let records: GitHubStoredFile[] | null = null;
        while (this.graphQLAvailable === undefined && this.graphQLFirstRead) {
          const firstRead = this.graphQLFirstRead;
          const firstReadSignal = this.graphQLFirstReadSignal;
          try { await awaitWithSignal(firstRead, signal); }
          catch (error) {
            assertCurrent();
            // A different collection's canceled probe must not cancel this read.
            if (!firstReadSignal?.aborted && !(error instanceof Error && error.message === "HEALTH_LOAD_CANCELLED")) throw error;
          }
        }
        assertCurrent();
        if (this.graphQLAvailable === undefined) {
          this.graphQLFirstReadSignal = signal;
          this.graphQLFirstRead = this.readGraphQLBlobBatch(batch, assertCurrent, signal).then((result) => {
            this.graphQLAvailable = result !== null;
            return result;
          });
          try { records = await this.graphQLFirstRead; }
          finally { this.graphQLFirstRead = null; this.graphQLFirstReadSignal = undefined; }
        } else if (this.graphQLAvailable) {
          records = await this.readGraphQLBlobBatch(batch, assertCurrent, signal);
          if (records === null) this.graphQLAvailable = false;
        }
        const usedRest = records === null;
        records ??= await this.readRestBlobBatch(batch, assertCurrent, signal, options.onBatch);
        assertCurrent();
        for (const record of records) this.blobTextCache.set(record.blobSha, { blobSha: record.blobSha, sizeBytes: record.sizeBytes, text: record.text });
        if (!usedRest) options.onBatch?.(records);
      }
    };
    try {
      // Workers share the adapter's network slots with every other collection.
      // They all await the single capability probe before scheduling more work.
      await Promise.all(Array.from({ length: Math.min(BLOB_READ_CONCURRENCY, Math.ceil(missing.length / batchSize)) }, readNextBatches));
    } catch (error) {
      failed = true;
      throw error;
    }
    assertCurrent();
    return files.map((file) => {
      const cached = this.blobTextCache.get(file.blobSha);
      if (!cached || cached.sizeBytes !== file.sizeBytes) throw new GitHubDataError("Incomplete GitHub blob collection.", 500, "GITHUB_INVALID_RESPONSE");
      return { ...cached, path: file.path };
    });
  }

  /** Snapshot-pinned inventory without the Contents API's 1,000-file limit. */
  async listTreeFiles(treeSha: string): Promise<GitHubDirectoryItem[]> {
    if (!/^[a-f0-9]{40}$/u.test(treeSha)) throw new Error("INVALID_GITHUB_TREE_SHA");
    const tree = await this.request<GitHubRecursiveTreeResponse>(
      `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repository)}/git/trees/${treeSha}?recursive=1`,
    );
    if (tree.truncated) throw new GitHubDataError("The GitHub repository tree is incomplete.", 500, "GITHUB_TREE_TRUNCATED");
    if (!Array.isArray(tree.tree)) throw new GitHubDataError("Invalid GitHub tree.", 500, "GITHUB_INVALID_RESPONSE");
    return tree.tree.filter((item) => item.type === "blob").map((item) => {
      assertFilePath(item.path);
      if (!/^[a-f0-9]{40}$/u.test(item.sha) || !Number.isSafeInteger(item.size) || item.size! < 0) {
        throw new GitHubDataError("Invalid GitHub tree blob.", 500, "GITHUB_INVALID_RESPONSE");
      }
      return { type: "file", name: item.path.split("/").at(-1)!, path: item.path, blobSha: item.sha, sizeBytes: item.size! };
    });
  }

  private async readJournalDirectoryTree(ref: string): Promise<GitHubRecursiveTreeResponse> {
    let tree: GitHubRecursiveTreeResponse;
    try {
      tree = await this.request<GitHubRecursiveTreeResponse>(
        `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repository)}/git/trees/${encodeURIComponent(ref)}`,
        { signal: blobReadSignal() }, false,
      );
    } catch (error) {
      // A missing ref or an unreadable known tree is not proof of an empty
      // journal directory. Only a complete parent listing can establish that.
      if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") {
        throw new GitHubDataError("The GitHub directory tree could not be read.", 500, "GITHUB_INVALID_RESPONSE");
      }
      throw error;
    }
    return this.validateJournalDirectoryTree(tree);
  }

  private validateJournalDirectoryTree(tree: GitHubRecursiveTreeResponse): GitHubRecursiveTreeResponse {
    if (tree?.truncated === true) throw new GitHubDataError("The GitHub repository tree is incomplete.", 500, "GITHUB_TREE_TRUNCATED");
    if (!tree || tree.truncated !== false || !Array.isArray(tree.tree)) {
      throw new GitHubDataError("Invalid GitHub directory tree.", 500, "GITHUB_INVALID_RESPONSE");
    }
    const paths = new Set<string>();
    for (const item of tree.tree) {
      if (!item || typeof item.path !== "string" || !item.path || [".", ".."].includes(item.path) || /[/\\\\]/u.test(item.path)
        || Array.from(item.path).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
        || paths.has(item.path) || !["blob", "tree", "commit"].includes(item.type)
        || typeof item.sha !== "string" || !/^[a-f0-9]{40}$/u.test(item.sha)
        || (item.type === "blob" || item.size !== undefined) && (!Number.isSafeInteger(item.size) || item.size! < 0)) {
        throw new GitHubDataError("Invalid GitHub directory entry.", 500, "GITHUB_INVALID_RESPONSE");
      }
      paths.add(item.path);
    }
    return tree;
  }

  private async readCachedJournalTree(treeSha: string): Promise<GitHubRecursiveTreeResponse> {
    const memory = this.journalTreeCache.get(treeSha);
    if (memory) return memory;
    const key = `nexus-journal-directory-v1:${this.config.owner}/${this.config.repository}:${this.config.branch ?? "main"}`;
    try {
      const cached = JSON.parse(localStorage.getItem(key) ?? "null");
      if (cached?.sha === treeSha && Number.isSafeInteger(cached.count) && cached.count === cached.tree?.tree?.length) {
        const tree = this.validateJournalDirectoryTree(cached.tree);
        this.journalTreeCache.set(treeSha, tree);
        return tree;
      }
    } catch { /* An unavailable or corrupt optional metadata cache is fetched again. */ }
    const tree = await this.readJournalDirectoryTree(treeSha);
    this.journalTreeCache.clear();
    this.journalTreeCache.set(treeSha, tree);
    // Store filenames/SHAs/sizes only. Bodies and credentials remain in memory.
    // A fresh authenticated parent read must match this immutable tree SHA on
    // every visit; a changed, removed or inaccessible directory cannot reuse it.
    try { localStorage.setItem(key, JSON.stringify({ sha: treeSha, count: tree.tree.length, tree })); } catch { /* Storage is optional. */ }
    return tree;
  }

  /** UI inventory: read the small parent, then the complete immutable journal tree. */
  async listJournalDirectory(): Promise<GitHubDirectoryItem[]> {
    const ref = this.config.branch ?? "main";
    let parent: GitHubDirectoryResponse;
    try {
      parent = await this.request<GitHubDirectoryResponse>(
        `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repository)}/contents/data?ref=${encodeURIComponent(ref)}`,
        { signal: blobReadSignal() }, false,
      );
    } catch (error) {
      // A Contents 404 alone cannot distinguish a missing folder from a missing
      // branch. Use the existing complete-tree checks to establish absence.
      if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return this.listDirectory("data/journal-entries");
      throw error;
    }
    if (!Array.isArray(parent)) throw new GitHubDataError("Invalid GitHub parent directory.", 500, "GITHUB_INVALID_RESPONSE");
    // Contents caps directory results at 1,000. Never infer absence from a list
    // that may have reached that limit; the journal files themselves use Trees.
    if (parent.length >= 1000) return this.listDirectory("data/journal-entries");
    const names = new Set<string>();
    for (const item of parent) {
      if (!item || typeof item.name !== "string" || !item.name || [".", ".."].includes(item.name) || /[/\\]/u.test(item.name)
        || /[\u0000-\u001f\u007f]/u.test(item.name) || names.has(item.name) || item.path !== `data/${item.name}`
        || !["file", "dir", "symlink", "submodule"].includes(item.type) || typeof item.sha !== "string" || !/^[a-f0-9]{40}$/u.test(item.sha)
        || !Number.isSafeInteger(item.size) || item.size < 0) throw new GitHubDataError("Invalid GitHub parent entry.", 500, "GITHUB_INVALID_RESPONSE");
      names.add(item.name);
    }
    const directory = parent.find((item) => item.name === "journal-entries");
    if (!directory) throw new GitHubDataError("GitHub directory not found.", 404, "GITHUB_NOT_FOUND");
    if (directory.type !== "dir") throw new GitHubDataError("Expected a GitHub directory.", 500, "GITHUB_INVALID_RESPONSE");
    const tree = await this.readCachedJournalTree(directory.sha);
    return tree.tree.filter((item) => item.type === "blob" || item.type === "tree")
      .map((item) => ({ type: item.type === "tree" ? "directory" as const : "file" as const, name: item.path, path: `data/journal-entries/${item.path}`, blobSha: item.sha, sizeBytes: item.size ?? 0 }));
  }

  async listDirectory(pathname: string, refOverride?: string): Promise<GitHubDirectoryItem[]> {
    if (pathname) assertFilePath(pathname);
    const ref = refOverride ?? this.config.branch;
    if (pathname === "data/journal-entries") {
      // Follow only root -> data -> journal-entries. A non-recursive tree read
      // handles large archives without one unbounded GraphQL directory query.
      let tree = await this.readJournalDirectoryTree(ref ?? "main");
      for (const segment of pathname.split("/")) {
        const directory = tree.tree.find((item) => item.path === segment);
        if (!directory) throw new GitHubDataError("GitHub directory not found.", 404, "GITHUB_NOT_FOUND");
        if (directory.type !== "tree") throw new GitHubDataError("Expected a GitHub directory tree.", 500, "GITHUB_INVALID_RESPONSE");
        tree = await this.readJournalDirectoryTree(directory.sha);
      }
      return tree.tree.filter((item) => item.type === "blob" || item.type === "tree")
        .map((item) => ({ type: item.type === "tree" ? "directory" as const : "file" as const, name: item.path, path: `${pathname}/${item.path}`, blobSha: item.sha, sizeBytes: item.size ?? 0 }));
    }
    if (/^data\/journal-(entries|segments|revisions)$/.test(pathname)) {
      const tree = await this.request<GitHubRecursiveTreeResponse>(
        `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repository)}/git/trees/${encodeURIComponent(ref ?? "main")}?recursive=1`,
      );
      if (tree.truncated) throw new GitHubDataError("The GitHub repository tree is incomplete.", 500, "GITHUB_TREE_TRUNCATED");
      const prefix = `${pathname}/`;
      return tree.tree.filter((item) => item.path.startsWith(prefix) && !item.path.slice(prefix.length).includes("/") && (item.type === "blob" || item.type === "tree"))
        .map((item) => ({ type: item.type === "tree" ? "directory" as const : "file" as const, name: item.path.slice(prefix.length), path: item.path, blobSha: item.sha, sizeBytes: item.size ?? 0 }));
    }
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
    inlineContent?: boolean;
    beforeRefUpdate?: () => Promise<void>;
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
    const blobs = input.inlineContent
      ? await Promise.all(input.files.map(async (file) => ({ sha: await gitBlobSha(file.text) })))
      : await Promise.all(input.files.map((file) => this.request<GitHubBlobResponse>(
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
          tree: input.files.map((file, index) => input.inlineContent
            ? { path: file.path, mode: "100644", type: "blob", content: file.text }
            : { path: file.path, mode: "100644", type: "blob", sha: blobs[index]!.sha }),
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
    await input.beforeRefUpdate?.();
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
