import { GitHubDataError, type GitHubContentsAdapter, type GitHubDirectoryItem } from "./github-contents";
import { journalMonthFileCandidates, recentJournalFileCandidates } from "./journal-archive-catalog";
import { parseJournalEntryRecord, type JournalEntryRecord } from "./journal-entries";

export type JournalArchiveEntry = { record: JournalEntryRecord; path: string; blobSha: string };
export type JournalArchiveSnapshot = { catalog: GitHubDirectoryItem[]; catalogReady: boolean; entries: JournalArchiveEntry[]; loadedMonths: string[] };

type DirectoryRequest = { id: number; saveVersion: number; result: Promise<GitHubDirectoryItem[]> };
const MAX_BATCH_FILES = 40;
const MAX_BATCH_BYTES = 1024 * 1024;

function aborted() {
  return new DOMException("The journal archive load was superseded.", "AbortError");
}

export class JournalArchiveReader {
  private catalog = new Map<string, GitHubDirectoryItem>();
  private readonly entries = new Map<string, JournalArchiveEntry>();
  private readonly loadedMonths = new Set<string>();
  private readonly rememberedVersions = new Map<string, number>();
  private initialized = false;
  private saveVersion = 0;
  private requestId = 0;
  private catalogId = 0;
  private directoryRequest?: DirectoryRequest;

  constructor(private readonly adapter: Pick<GitHubContentsAdapter, "listDirectory" | "readBlobTexts">) {}

  snapshot(): JournalArchiveSnapshot {
    return {
      catalog: [...this.catalog.values()],
      catalogReady: this.initialized,
      entries: [...this.entries.values()].filter((entry) => this.catalog.get(entry.path)?.blobSha === entry.blobSha),
      loadedMonths: [...this.loadedMonths].sort(),
    };
  }

  isMonthLoaded(month: string) {
    return this.loadedMonths.has(month);
  }

  remember(entry: JournalArchiveEntry) {
    const current = this.entries.get(entry.path);
    if (current && current.record.version > entry.record.version) return;
    this.entries.set(entry.path, entry);
    this.rememberedVersions.set(entry.path, ++this.saveVersion);
    this.catalog.set(entry.path, {
      type: "file", name: entry.path.split("/").at(-1)!, path: entry.path, blobSha: entry.blobSha,
      sizeBytes: new TextEncoder().encode(JSON.stringify(entry.record)).byteLength,
    });
  }

  async load(month?: string, options: {
    refresh?: boolean;
    signal?: AbortSignal;
    onCatalog?: (snapshot: JournalArchiveSnapshot) => void;
  } = {}): Promise<JournalArchiveSnapshot> {
    const { signal } = options;
    signal?.throwIfAborted();
    // Validate before making a request, even when this month has already been visited.
    if (month) journalMonthFileCandidates([], month);
    const catalogId = await this.ensureCatalog(Boolean(options.refresh), signal);
    this.assertCurrent(catalogId, signal);
    // Calendar and SHA-matched statistics can use the catalog while bodies load.
    options.onCatalog?.(this.snapshot());
    this.assertCurrent(catalogId, signal);
    if (month && this.loadedMonths.has(month)) return this.snapshot();

    const candidates = month ? journalMonthFileCandidates([...this.catalog.values()], month)
      : recentJournalFileCandidates([...this.catalog.values()]);
    const missing = candidates.filter((file) => this.entries.get(file.path)?.blobSha !== file.blobSha);
    for (const batch of batches(missing)) {
      this.assertCurrent(catalogId, signal);
      // A successful save may have supplied a newer version since this load began.
      const needed = batch.filter((file) => this.catalog.get(file.path)?.blobSha === file.blobSha
        && this.entries.get(file.path)?.blobSha !== file.blobSha);
      if (needed.length === 0) continue;
      const files = await this.adapter.readBlobTexts(
        needed.map(({ path, blobSha, sizeBytes }) => ({ path, blobSha, sizeBytes })),
        () => !signal?.aborted,
        signal,
      );
      this.assertCurrent(catalogId, signal);
      const byPath = new Map(files.map((file) => [file.path, file]));
      const parsed: JournalArchiveEntry[] = [];
      for (const requested of needed) {
        if (this.catalog.get(requested.path)?.blobSha !== requested.blobSha) continue;
        const file = byPath.get(requested.path);
        if (!file || file.blobSha !== requested.blobSha) throw new Error("JOURNAL_ARCHIVE_INCOMPLETE_BATCH");
        parsed.push({ record: parseJournalEntryRecord(file.text), path: file.path, blobSha: file.blobSha });
      }
      // Commit each completed batch so retries only fetch the remaining files.
      for (const entry of parsed) this.entries.set(entry.path, entry);
    }
    this.assertCurrent(catalogId, signal);
    if (month) this.loadedMonths.add(month);
    return this.snapshot();
  }

  private assertCurrent(catalogId: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.catalogId !== catalogId || (this.directoryRequest && this.directoryRequest.id > catalogId)) throw aborted();
  }

  private async ensureCatalog(refresh: boolean, signal?: AbortSignal) {
    if (!refresh && this.initialized && !this.directoryRequest) return this.catalogId;
    if (refresh || !this.directoryRequest) {
      this.directoryRequest = { id: ++this.requestId, saveVersion: this.saveVersion, result: this.readDirectory() };
    }
    const request = this.directoryRequest;
    let files: GitHubDirectoryItem[];
    try {
      files = await request.result;
    } catch (error) {
      if (this.directoryRequest === request) this.directoryRequest = undefined;
      signal?.throwIfAborted();
      throw error;
    }
    signal?.throwIfAborted();
    if (request.id !== this.requestId) throw aborted();
    if (request.id !== this.catalogId) {
      const catalog = new Map(files.map((file) => [file.path, file]));
      for (const [path, version] of this.rememberedVersions) {
        if (version > request.saveVersion) {
          const saved = this.catalog.get(path);
          if (saved) catalog.set(path, saved);
        }
      }
      this.catalog = catalog;
      for (const [path, entry] of this.entries) {
        if (catalog.get(path)?.blobSha !== entry.blobSha) this.entries.delete(path);
      }
      this.loadedMonths.clear();
      this.catalogId = request.id;
      this.initialized = true;
    }
    if (this.directoryRequest === request) this.directoryRequest = undefined;
    return request.id;
  }

  private async readDirectory() {
    try {
      return await this.adapter.listDirectory("data/journal-entries");
    } catch (error) {
      if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return [];
      throw error;
    }
  }
}

function* batches(files: GitHubDirectoryItem[]) {
  let batch: GitHubDirectoryItem[] = [];
  let bytes = 0;
  for (const file of files) {
    if (batch.length && (batch.length >= MAX_BATCH_FILES || bytes + file.sizeBytes > MAX_BATCH_BYTES)) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(file);
    bytes += file.sizeBytes;
  }
  if (batch.length) yield batch;
}
