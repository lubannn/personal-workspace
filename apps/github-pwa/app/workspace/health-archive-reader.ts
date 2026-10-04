import { type GitHubContentsAdapter, type GitHubDirectoryItem, type GitHubStoredFile } from "../../../../src/lib/github-data/github-contents";
import { COROS_SYNC_INDEX_PATH, corosSyncIndexEntry, parseCorosSyncIndexRecord, type CorosSyncIndexEntry } from "../../../../src/lib/github-data/coros-sync-index";
import { parseSleepSessionRecord } from "../../../../src/lib/github-data/sleep-sessions";
import { isWorkoutLinkedToStaging, parseWorkoutRecord } from "../../../../src/lib/github-data/workouts";
import { parseHealthStagingRecord } from "../../../../src/lib/github-data/health-staging-records";
import { recordPath } from "../../../../src/lib/github-data/protocol";
import { EncryptedHealthBlobCache, type HealthBlobCache } from "../../../../src/lib/github-data/health-blob-cache";
import { healthLocalParts } from "./health-records";
import type { SyncedHealthStagingRecord, SyncedSleepSession, SyncedWorkout } from "./page-model";

export type HealthArchiveSnapshot = {
  months: string[]; loadedMonths: string[]; month: string;
  sleepSessions: SyncedSleepSession[]; workouts: SyncedWorkout[]; staging: SyncedHealthStagingRecord[];
  latestSleep: string | null; latestWorkout: string | null; latestReady: boolean; unverifiedWorkoutCount: number;
};
type Canonical = SyncedSleepSession | SyncedWorkout;
type DateHint = { path: string; blob_sha: string; kind: "sleep" | "workout"; date: string; deleted: boolean };
type Reader = Pick<GitHubContentsAdapter, "listHealthArchive" | "readBlobTexts"> & Partial<Pick<GitHubContentsAdapter, "healthArchiveMetadataCacheKey">>;

/** Authenticate fresh metadata first; reuse encrypted local bodies by SHA and read months on demand. */
export class HealthArchiveReader {
  private catalog = new Map<string, GitHubDirectoryItem>();
  private dates = new Map<string, DateHint>();
  private entries = new Map<string, Canonical>();
  private sources = new Map<string, SyncedHealthStagingRecord>();
  private index?: { sha: string; entries: CorosSyncIndexEntry[] };
  private catalogReady = false;
  private catalogRequest?: Promise<void>;
  private completedMonths = new Set<string>();
  private month = "";
  private latestReady = false;
  private readonly lifetime = new AbortController();
  private catalogVersion = 0;
  private readonly bodyCache?: HealthBlobCache;

  constructor(private readonly adapter: Reader, private readonly timezone = "Asia/Shanghai", cache?: HealthBlobCache) {
    const scope = adapter.healthArchiveMetadataCacheKey?.("records");
    this.bodyCache = cache ?? (scope ? new EncryptedHealthBlobCache(scope) : undefined);
  }

  async clearLocalCache() { await this.bodyCache?.clear(); }

  async prefetchNeighbors(month: string, signal?: AbortSignal) {
    const months = this.months();
    const index = months.indexOf(month);
    if (index < 0) return;
    const version = this.catalogVersion;
    for (const neighbor of [months[index - 1], months[index + 1]]) {
      signal?.throwIfAborted(); this.lifetime.signal.throwIfAborted();
      if (version !== this.catalogVersion) return;
      if (!neighbor || this.completedMonths.has(neighbor)) continue;
      const entries = [...this.dates.values()].filter(entry => !entry.deleted && this.date(entry).startsWith(`${neighbor}-`));
      await this.loadEntries(entries, signal);
      if (version !== this.catalogVersion) return;
      this.completedMonths.add(neighbor);
    }
  }

  private async readFiles(files: readonly GitHubDirectoryItem[], signal = this.lifetime.signal): Promise<GitHubStoredFile[]> {
    const activeSignal = AbortSignal.any([signal, this.lifetime.signal]);
    activeSignal.throwIfAborted();
    const cached = await this.bodyCache?.read(files) ?? [];
    activeSignal.throwIfAborted();
    const byPath = new Map(cached.filter(file => files.some(item => item.path === file.path && item.blobSha === file.blobSha && item.sizeBytes === file.sizeBytes)).map(file => [file.path, file]));
    const missing = files.filter(file => !byPath.has(file.path));
    if (missing.length) {
      const fresh = await this.adapter.readBlobTexts(missing, () => !activeSignal.aborted, activeSignal, { maxBatchFiles: 40 });
      activeSignal.throwIfAborted();
      if (fresh.length !== missing.length) throw new Error("HEALTH_ARCHIVE_INCOMPLETE_BATCH");
      for (const file of fresh) {
        if (!missing.some(item => item.path === file.path && item.blobSha === file.blobSha)) throw new Error("HEALTH_ARCHIVE_INCOMPLETE_BATCH");
        byPath.set(file.path, file);
      }
      await this.bodyCache?.remember(fresh);
      activeSignal.throwIfAborted();
    }
    return files.map(file => byPath.get(file.path)!);
  }

  dispose() { this.lifetime.abort(); }

  snapshot(): HealthArchiveSnapshot {
    const entries = [...this.entries.values()].filter(item => this.catalog.get(item.path)?.blobSha === item.blobSha);
    const staging = [...this.sources.values()].filter(item => this.catalog.get(item.path)?.blobSha === item.blobSha);
    const sourceById = new Map(staging.map(item => [item.record.id, item.record]));
    const sleepSessions = entries.filter((item): item is SyncedSleepSession => item.record.entity_type === "sleep_session");
    const candidates = entries.filter((item): item is SyncedWorkout => item.record.entity_type === "workout");
    const workouts = candidates.filter(item => item.record.data.workout_version === 2 || Boolean(sourceById.get(item.record.data.staging_record_id) && isWorkoutLinkedToStaging(item.record, sourceById.get(item.record.data.staging_record_id)!)));
    // A body may arrive before its evidence during prefetch or a cancelled read.
    // Only report a failed check once evidence was loaded, or is absent remotely.
    const unverifiedWorkoutCount = candidates.filter(item => {
      const data = item.record.data;
      if (item.record.deleted_at !== null || workouts.includes(item) || data.workout_version !== 1) return false;
      return sourceById.has(data.staging_record_id) || !this.catalog.has(recordPath("health_staging_record", data.staging_record_id));
    }).length;
    const latest = (items: Canonical[]) => items.filter(item => item.record.deleted_at === null)
      .map(item => this.date(this.dates.get(item.path)!)).sort().at(-1) ?? null;
    return {
      months: this.months(), loadedMonths: [...this.completedMonths], month: this.month,
      sleepSessions, workouts, staging, latestSleep: latest(sleepSessions), latestWorkout: latest(workouts), latestReady: this.latestReady,
      unverifiedWorkoutCount,
    };
  }

  async load(requestedMonth?: string, options: { refresh?: boolean; signal?: AbortSignal; onCatalog?: (snapshot: HealthArchiveSnapshot) => void; onProgress?: (snapshot: HealthArchiveSnapshot) => void } = {}) {
    const { signal } = options;
    signal?.throwIfAborted();
    if (requestedMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)) throw new Error("INVALID_HEALTH_MONTH");
    if (!this.catalogReady || options.refresh || this.catalogRequest) {
      // Share the inventory request when navigation supersedes the initial load.
      if (!this.catalogRequest) this.catalogRequest = this.refreshCatalog().finally(() => { this.catalogRequest = undefined; });
      await this.catalogRequest;
    }
    signal?.throwIfAborted();
    const months = this.months();
    this.month = requestedMonth && months.includes(requestedMonth) ? requestedMonth : months.at(-1) ?? "";
    options.onCatalog?.(this.snapshot());
    const needed = [...this.dates.values()].filter(entry => !entry.deleted && this.date(entry).startsWith(`${this.month}-`));
    await this.loadEntries(needed, signal);
    if (this.month) this.completedMonths.add(this.month);
    options.onProgress?.(this.snapshot());
    // The newest workout may be in another month. Verify it rather than treating an index hint as a record.
    if (!this.latestReady) {
      for (const kind of ["sleep", "workout"] as const) {
        const ordered = [...this.dates.values()].filter(entry => entry.kind === kind && !entry.deleted)
          .sort((a, b) => this.date(b).localeCompare(this.date(a)));
        for (const entry of ordered) {
          await this.loadEntries([entry], signal);
          const snapshot = this.snapshot();
          const valid = kind === "sleep" ? snapshot.sleepSessions : snapshot.workouts;
          if (valid.some(item => item.path === entry.path)) break;
        }
      }
      this.latestReady = true;
    }
    signal?.throwIfAborted();
    return this.snapshot();
  }

  private date(entry: DateHint) { return entry.date; }

  private hint(entry: CorosSyncIndexEntry, timezone = this.timezone): DateHint {
    return { path: entry.path, blob_sha: entry.blob_sha, kind: entry.kind, deleted: entry.deleted_at !== null,
      date: entry.kind === "sleep" ? entry.source ? entry.latest_date : healthLocalParts(entry.end_at, timezone).date
        : healthLocalParts(entry.start_at, this.timezone).date };
  }

  private cachedHints(): DateHint[] {
    const key = this.adapter.healthArchiveMetadataCacheKey?.(this.timezone);
    if (!key) return [];
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "null");
      if (value?.version !== 1 || !Array.isArray(value.records) || value.count !== value.records.length) return [];
      const paths = new Set<string>();
      for (const entry of value.records) {
        if (!entry || Object.keys(entry).sort().join(",") !== "blob_sha,date,deleted,kind,path"
          || !["sleep", "workout"].includes(entry.kind) || typeof entry.path !== "string"
          || !new RegExp(`^data/${entry.kind === "sleep" ? "sleep-sessions" : "workouts"}/[a-zA-Z0-9_-]+\\.json$`).test(entry.path)
          || paths.has(entry.path) || !/^[a-f0-9]{40}$/.test(entry.blob_sha)
          || typeof entry.deleted !== "boolean" || typeof entry.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)
          || !Number.isFinite(Date.parse(`${entry.date}T00:00:00Z`)) || new Date(`${entry.date}T00:00:00Z`).toISOString().slice(0, 10) !== entry.date) return [];
        paths.add(entry.path);
      }
      return value.records;
    } catch { return []; }
  }

  private months() {
    const dates = [...this.dates.values()].filter(entry => !entry.deleted).map(entry => this.date(entry).slice(0, 7)).sort();
    if (!dates.length) return [];
    const result: string[] = [];
    const cursor = new Date(`${dates[0]}-01T00:00:00Z`);
    while (cursor.toISOString().slice(0, 7) <= dates.at(-1)!) {
      result.push(cursor.toISOString().slice(0, 7)); cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return result;
  }

  private async refreshCatalog() {
    const files = await this.adapter.listHealthArchive();
    this.lifetime.signal.throwIfAborted();
    const catalog = new Map(files.filter(file => file.type === "file" && file.name.endsWith(".json")).map(file => [file.path, file]));
    const canonical = files.filter(file => file.type === "file" && /^data\/(sleep-sessions|workouts)\/[^/]+\.json$/.test(file.path));
    // Persist date/SHA metadata only, like journal filenames. Fresh authenticated
    // directory SHAs must match before reuse; no scores, durations, bodies or tokens are stored.
    const dates = new Map([...this.cachedHints(), ...this.dates.values()]
      .filter(entry => catalog.get(entry.path)?.blobSha === entry.blob_sha).map(entry => [entry.path, entry]));
    const indexedFile = catalog.get(COROS_SYNC_INDEX_PATH);
    let index = this.index;
    if (!dates.size && canonical.length && indexedFile) {
      if (index?.sha !== indexedFile.blobSha) {
        const [file] = await this.adapter.readBlobTexts([indexedFile], () => !this.lifetime.signal.aborted, this.lifetime.signal);
        if (!file || file.blobSha !== indexedFile.blobSha) throw new Error("HEALTH_ARCHIVE_INCOMPLETE_BATCH");
        try { index = { sha: file.blobSha, entries: parseCorosSyncIndexRecord(file.text).data.records }; }
        catch { index = undefined; }
      }
      for (const entry of index?.entries ?? []) {
        // Legacy manual sleep index entries omit timezone. Read these few bodies
        // once to get the correct local wake month, even across time zones.
        if (entry.kind === "sleep" && !entry.source) continue;
        if (catalog.get(entry.path)?.blobSha === entry.blob_sha) dates.set(entry.path, this.hint(entry));
      }
    }
    // A new/manual/changed record can precede index maintenance. Read only those SHA mismatches.
    const unknown = canonical.filter(file => !dates.has(file.path));
    for (let offset = 0; offset < unknown.length; offset += 40) {
      const batch = unknown.slice(offset, offset + 40);
      const read = await this.readFiles(batch);
      for (const file of read) {
        if (!batch.some(item => item.path === file.path && item.blobSha === file.blobSha)) throw new Error("HEALTH_ARCHIVE_INCOMPLETE_BATCH");
        const entry = this.parseCanonical(file);
        this.entries.set(file.path, entry);
        dates.set(file.path, this.hint(corosSyncIndexEntry(entry.record, file.blobSha), entry.record.data.timezone));
      }
      if (read.length !== batch.length) throw new Error("HEALTH_ARCHIVE_INCOMPLETE_BATCH");
    }
    const changedMonths = new Set<string>();
    for (const [path, entry] of this.dates) if (catalog.get(path)?.blobSha !== entry.blob_sha) changedMonths.add(this.date(entry).slice(0, 7));
    for (const [path, entry] of dates) if (this.dates.get(path)?.blob_sha !== entry.blob_sha) changedMonths.add(this.date(entry).slice(0, 7));
    const sourceChanged = [...this.entries.values()].some(item => {
      const data = item.record.data;
      if (!("staging_record_id" in data) || typeof data.staging_record_id !== "string") return false;
      const path = recordPath("health_staging_record", data.staging_record_id);
      return catalog.get(path)?.blobSha !== this.catalog.get(path)?.blobSha;
    });
    if (sourceChanged) this.completedMonths.clear();
    else for (const month of changedMonths) this.completedMonths.delete(month);
    this.latestReady = this.catalogReady && !sourceChanged && changedMonths.size === 0;
    this.catalog = catalog; this.dates = dates; this.index = index; this.catalogReady = true; this.catalogVersion += 1;
    const cacheKey = this.adapter.healthArchiveMetadataCacheKey?.(this.timezone);
    if (cacheKey) try { localStorage.setItem(cacheKey, JSON.stringify({ version: 1, count: dates.size, records: [...dates.values()] })); } catch { /* Metadata caching is optional. */ }
    for (const [path, entry] of this.entries) if (catalog.get(path)?.blobSha !== entry.blobSha) this.entries.delete(path);
    for (const [path, entry] of this.sources) if (catalog.get(path)?.blobSha !== entry.blobSha) this.sources.delete(path);
  }

  private parseCanonical(file: { text: string; path: string; blobSha: string }): Canonical {
    try {
      const record = file.path.startsWith("data/sleep-sessions/") ? parseSleepSessionRecord(file.text) : parseWorkoutRecord(file.text);
      if (recordPath(record.entity_type, record.id) !== file.path) throw new Error();
      return { record, path: file.path, blobSha: file.blobSha } as Canonical;
    } catch { throw new Error("HEALTH_RECORD_INVALID"); }
  }

  private async loadEntries(entries: DateHint[], signal?: AbortSignal) {
    signal?.throwIfAborted();
    const missing = entries.filter(entry => this.entries.get(entry.path)?.blobSha !== entry.blob_sha).map(entry => this.catalog.get(entry.path)!);
    for (let offset = 0; offset < missing.length; offset += 40) {
      const batch = missing.slice(offset, offset + 40);
      const files = await this.readFiles(batch, signal);
      signal?.throwIfAborted();
      if (files.length !== batch.length) throw new Error("HEALTH_ARCHIVE_INCOMPLETE_BATCH");
      for (const file of files) {
        if (!batch.some(item => item.path === file.path && item.blobSha === file.blobSha)) throw new Error("HEALTH_ARCHIVE_INCOMPLETE_BATCH");
        if (this.catalog.get(file.path)?.blobSha !== file.blobSha) throw new DOMException("Health catalog changed.", "AbortError");
        this.entries.set(file.path, this.parseCanonical(file));
      }
    }
    const sources = entries.flatMap(entry => {
      const item = this.entries.get(entry.path)!;
      const data = item.record.data;
      if (!("staging_record_id" in data) || typeof data.staging_record_id !== "string") return [];
      const path = recordPath("health_staging_record", data.staging_record_id);
      const file = this.catalog.get(path);
      return file && this.sources.get(path)?.blobSha !== file.blobSha ? [file] : [];
    });
    const unique = [...new Map(sources.map(file => [file.path, file])).values()];
    if (unique.length) {
      const files = await this.readFiles(unique, signal);
      signal?.throwIfAborted();
      if (files.length !== unique.length) throw new Error("HEALTH_ARCHIVE_INCOMPLETE_BATCH");
      for (const file of files) {
        if (!unique.some(item => item.path === file.path && item.blobSha === file.blobSha)) throw new Error("HEALTH_ARCHIVE_INCOMPLETE_BATCH");
        try {
          const record = parseHealthStagingRecord(file.text);
          if (recordPath(record.entity_type, record.id) !== file.path) throw new Error();
          if (this.catalog.get(file.path)?.blobSha !== file.blobSha) throw new DOMException("Health catalog changed.", "AbortError");
          this.sources.set(file.path, { record, path: file.path, blobSha: file.blobSha });
        } catch { throw new Error("HEALTH_RECORD_INVALID"); }
      }
    }
  }
}
