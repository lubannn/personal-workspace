import { GitHubConflictError, type GitHubContentsAdapter } from "../../../src/lib/github-data/github-contents";
import { acceptCorosSourceRevision, supersedeCorosSourceRevision, createCorosSyncConflictRecord, parseCorosSyncConflictRecord, type CorosSyncConflictPayload, type CorosSyncConflictRecord } from "../../../src/lib/github-data/coros-sync-conflicts";
import { createWorkspaceRecord, recordPath, serializeRecord, updateWorkspaceRecord } from "../../../src/lib/github-data/protocol";
import { createAutomaticSleepSessionData, parseSleepSessionRecord, type SleepSessionRecord } from "../../../src/lib/github-data/sleep-sessions";
import { createAutomaticWorkoutData, parseWorkoutRecord, type WorkoutRecord } from "../../../src/lib/github-data/workouts";
import type { CorosProvenance } from "../../../src/lib/github-data/coros-sync-types";
import { COROS_SYNC_INDEX_ID, COROS_SYNC_INDEX_PATH, corosCanonicalBlobSha, corosSyncIndexEntry, parseCorosSyncIndexRecord, type CorosSyncConflictIndexEntry, type CorosSyncIndexEntry, type CorosSyncIndexRecord } from "../../../src/lib/github-data/coros-sync-index";
import type { CorosSyncCandidate } from "./coros-sync-mapping";

type SyncAdapter = Pick<GitHubContentsAdapter, "readBranchSnapshot" | "listTreeFiles" | "readBlobTexts" | "writeAtomicFiles">;
type CanonicalRecord = SleepSessionRecord | WorkoutRecord;
type ConflictDetail = { id: string; sourceId: string; reason: "source_changed" | "existing_record"; existingId: string };
export type CorosSyncWriteResult = {
  created: number;
  unchanged: number;
  updated?: number;
  conflicts: number;
  totalPendingConflicts: number;
  conflictDetails: ConflictDetail[];
  latestSleepDate: string | null;
  latestWorkoutDate: string | null;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameInterval(record: CorosSyncIndexEntry, item: CorosSyncCandidate): boolean {
  return record.kind === item.kind && Date.parse(record.start_at) === Date.parse(item.candidate.start_at)
    && Date.parse(record.end_at) === Date.parse(item.candidate.end_at);
}

function latestDates(records: CorosSyncIndexEntry[]): Pick<CorosSyncWriteResult, "latestSleepDate" | "latestWorkoutDate"> {
  let latestSleepDate: string | null = null;
  let latestWorkoutDate: string | null = null;
  for (const record of records) {
    if (record.deleted_at !== null) continue;
    if (record.kind === "sleep") {
      const date = record.latest_date;
      if (latestSleepDate === null || date > latestSleepDate) latestSleepDate = date;
    } else {
      const date = record.latest_date;
      if (latestWorkoutDate === null || date > latestWorkoutDate) latestWorkoutDate = date;
    }
  }
  return { latestSleepDate, latestWorkoutDate };
}

/** New canonical facts and conflict facts become visible in one compare-and-swap Git commit. */
export async function writeCorosSyncBatch(adapter: SyncAdapter, input: {
  ownerId: string;
  items: readonly CorosSyncCandidate[];
  timestamp: string;
  /** Recheck connection state and scheduler lease immediately before the Git transaction. */
  beforeCommit?: () => Promise<void>;
}): Promise<CorosSyncWriteResult> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(input.ownerId) || !Number.isFinite(Date.parse(input.timestamp))) throw new Error("COROS_SYNC_INVALID_CONTEXT");
  if (input.items.length > 200) throw new Error("COROS_SYNC_BATCH_TOO_LARGE");
  const prepared = await Promise.all(input.items.map(async (item) => {
    const payload: CorosSyncConflictPayload = item.kind === "sleep"
      ? { kind: item.kind, candidate: item.candidate, metrics: item.metrics }
      : { kind: item.kind, candidate: item.candidate };
    const fingerprint = await hash(stableJson(payload));
    let legacyFingerprint: string | null = null;
    if (item.kind === "sleep" && item.metrics.daily_sleep_minutes !== undefined) {
      const metrics = { ...item.metrics }; delete metrics.daily_sleep_minutes;
      legacyFingerprint = await hash(stableJson({ kind: "sleep", candidate: item.candidate, metrics }));
    }
    const source: CorosProvenance = { kind: "coros_mcp", source_id: item.sourceId, source_sha256: fingerprint, mapping_version: 1, retrieved_at: input.timestamp };
    const id = `coros_${item.kind}_${await hash(item.sourceId)}`;
    const record: CanonicalRecord = item.kind === "sleep"
      ? createWorkspaceRecord({ entityType: "sleep_session", id, ownerId: input.ownerId, timestamp: input.timestamp, data: createAutomaticSleepSessionData(item.candidate, source, item.metrics) })
      : createWorkspaceRecord({ entityType: "workout", id, ownerId: input.ownerId, timestamp: input.timestamp, data: createAutomaticWorkoutData(item.candidate, source) });
    return { item, payload, fingerprint, legacyFingerprint, record, key: `${item.kind}:${item.sourceId}` };
  }));
  const unique = new Map<string, typeof prepared[number]>();
  let repeated = 0;
  for (const item of prepared) {
    const prior = unique.get(item.key);
    if (prior && prior.fingerprint !== item.fingerprint) throw new Error("COROS_SYNC_INCONSISTENT_BATCH");
    if (prior) repeated += 1;
    else unique.set(item.key, item);
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await adapter.readBranchSnapshot();
    const inventory = await adapter.listTreeFiles(snapshot.rootTreeSha);
    const indexFile = inventory.find((file) => file.path === COROS_SYNC_INDEX_PATH);
    let previousIndex: CorosSyncIndexRecord | null = null;
    if (indexFile) {
      const [storedIndex] = await adapter.readBlobTexts([indexFile]);
      try {
        previousIndex = parseCorosSyncIndexRecord(storedIndex.text);
        if (previousIndex.owner_id !== input.ownerId) throw new Error("COROS_SYNC_RECORD_IDENTITY_MISMATCH");
      } catch (error) {
        // Invalid derived metadata can be safely rebuilt; ownership errors cannot.
        if (error instanceof Error && error.message === "COROS_SYNC_RECORD_IDENTITY_MISMATCH") throw error;
        previousIndex = null;
      }
    }
    const cached = new Map(previousIndex?.data.records.map((entry) => [entry.path, { ...entry, source: entry.source ? { ...entry.source } : null }]));
    const canonicalFiles = inventory.filter((file) => /^data\/(?:sleep-sessions|workouts)\/[^/]+\.json$/u.test(file.path));
    const records: CorosSyncIndexEntry[] = [];
    const selected = canonicalFiles.filter((file) => {
      const entry = cached.get(file.path);
      if (entry?.blob_sha === file.blobSha) { records.push(entry); return false; }
      return true;
    });
    const cachedConflicts = new Map(previousIndex?.data.conflicts?.map(entry => [entry.path, entry]));
    const conflictIndex = new Map<string, CorosSyncConflictIndexEntry>();
    const conflictFiles = inventory.filter(file => /^data\/coros-sync-conflicts\/[^/]+\.json$/u.test(file.path));
    selected.push(...conflictFiles.filter(file => {
      const cached = cachedConflicts.get(file.path);
      // Immutable blob identity validates the cached status. Pending and changed
      // audits are still read so source revisions and external reviews reconcile.
      if (cached && cached.blob_sha === file.blobSha && cached.status !== "pending") {
        conflictIndex.set(cached.id, cached); return false;
      }
      return true;
    }));
    const stored = await adapter.readBlobTexts(selected);
    const existingConflicts = new Map<string, CorosSyncConflictRecord>();
    for (const file of stored) {
      const record = file.path.startsWith("data/coros-sync-conflicts/") ? parseCorosSyncConflictRecord(file.text)
        : file.path.startsWith("data/sleep-sessions/") ? parseSleepSessionRecord(file.text) : parseWorkoutRecord(file.text);
      if (record.owner_id !== input.ownerId || recordPath(record.entity_type, record.id) !== file.path) throw new Error("COROS_SYNC_RECORD_IDENTITY_MISMATCH");
      if (record.entity_type === "coros_sync_conflict") {
        const audit = record as CorosSyncConflictRecord;
        existingConflicts.set(record.id, audit);
        conflictIndex.set(audit.id, { id: audit.id, path: file.path, blob_sha: file.blobSha, status: audit.data.status });
      }
      else records.push(corosSyncIndexEntry(record as CanonicalRecord, file.blobSha));
    }
    const sourceIndex = new Map<string, CorosSyncIndexEntry>();
    for (const record of records) {
      const source = record.source;
      if (!source) continue;
      const key = `${record.kind}:${source.source_id}`;
      if (sourceIndex.has(key)) throw new Error("COROS_SYNC_DUPLICATE_STORED_SOURCE");
      sourceIndex.set(key, record);
    }
    const files: Array<{ path: string; text: string }> = [];
    // Adding a previously omitted daily total is schema enrichment, not a changed sleep episode.
    // Read only changed sources in one batch; unchanged records stay on the compact index.
    const changedPaths = new Set([...unique.values()].flatMap(entry => {
      const existing = sourceIndex.get(entry.key);
      return existing?.deleted_at === null && existing.source?.source_sha256 !== entry.fingerprint ? [existing.path] : [];
    }));
    const hydrated = new Map(stored.map(file => [file.path, file.text]));
    const changedFiles = canonicalFiles.filter(file => changedPaths.has(file.path) && !hydrated.has(file.path));
    if (changedFiles.length) for (const file of await adapter.readBlobTexts(changedFiles)) hydrated.set(file.path, file.text);
    const paths = new Set(inventory.map((file) => file.path));
    const result: CorosSyncWriteResult = { created: 0, updated: 0, unchanged: repeated, conflicts: 0, totalPendingConflicts: [...existingConflicts.values()].filter(conflict => conflict.data.status === "pending").length, conflictDetails: [], latestSleepDate: null, latestWorkoutDate: null };
    const closeOlderProposals = (sourceId: string, sourceSha256: string) => {
      for (const audit of existingConflicts.values()) {
        if (audit.data.status !== "pending" || audit.data.reason !== "source_changed" || audit.data.source_id !== sourceId) continue;
        const resolved = supersedeCorosSourceRevision(audit, sourceSha256, input.timestamp);
        existingConflicts.set(resolved.id, resolved);
        files.push({ path: recordPath("coros_sync_conflict", resolved.id), text: serializeRecord(resolved) });
        result.totalPendingConflicts -= 1;
      }
    };
    for (const entry of unique.values()) {
      const sameSource = sourceIndex.get(entry.key);
      const duplicate = sameSource ?? records.find((record) => sameInterval(record, entry.item));
      const oldSource = duplicate?.source ?? null;
      // Respect tombstones even if COROS later changes the source. Never recreate a deletion.
      if (duplicate && duplicate.deleted_at !== null) { result.unchanged += 1; continue; }
      if (sameSource && oldSource?.source_sha256 === entry.fingerprint) { closeOlderProposals(entry.item.sourceId, entry.fingerprint); result.unchanged += 1; continue; }
      if (sameSource && entry.item.kind === "sleep" && entry.legacyFingerprint && oldSource?.source_sha256 === entry.legacyFingerprint) {
        const current = parseSleepSessionRecord(hydrated.get(sameSource.path)!);
        const candidate = entry.item.candidate;
        const metrics = { ...entry.item.metrics }; delete metrics.daily_sleep_minutes;
        if (current.owner_id !== input.ownerId || current.id !== sameSource.id || current.deleted_at !== null
          || current.data.sleep_session_version !== 2 || current.data.source.source_id !== entry.item.sourceId
          || current.data.source.source_sha256 !== entry.legacyFingerprint
          || stableJson(current.data.sleep_metrics_json) !== stableJson(metrics)
          || Object.entries(candidate).some(([key, value]) => current.data[key as keyof typeof candidate] !== value)) throw new Error("COROS_SYNC_RECORD_IDENTITY_MISMATCH");
        const next = updateWorkspaceRecord(current, { ...current.data, sleep_metrics_json: entry.item.metrics,
          source: { ...current.data.source, source_sha256: entry.fingerprint, retrieved_at: input.timestamp } }, input.timestamp);
        const text = serializeRecord(next);
        parseSleepSessionRecord(text);
        files.push({ path: sameSource.path, text });
        Object.assign(sameSource, corosSyncIndexEntry(next, await corosCanonicalBlobSha(text)));
        closeOlderProposals(entry.item.sourceId, entry.fingerprint);
        result.unchanged += 1;
        continue;
      }
      if (sameSource) {
        const text = hydrated.get(sameSource.path)!;
        const current = entry.item.kind === "sleep" ? parseSleepSessionRecord(text) : parseWorkoutRecord(text);
        if ("source" in current.data && Date.parse(current.data.source.retrieved_at) > Date.parse(input.timestamp)) { result.unchanged += 1; continue; }
        const currentData = current.data;
        const candidate = Object.fromEntries(Object.keys(entry.item.candidate).map(key => [key, currentData[key as keyof typeof currentData]]));
        const storedFingerprint = await hash(stableJson(entry.item.kind === "sleep"
          ? { kind: "sleep", candidate, metrics: (current as SleepSessionRecord).data.sleep_metrics_json }
          : { kind: "workout", candidate }));
        if (storedFingerprint !== oldSource?.source_sha256) throw new Error("COROS_SYNC_STORED_RECORD_MODIFIED");
        const prior = [...existingConflicts.values()].find(audit => audit.data.status === "pending" && audit.data.reason === "source_changed"
          && audit.data.source_id === entry.item.sourceId && audit.data.source_sha256 === entry.fingerprint
          && audit.data.existing_record_id === current.id && audit.data.existing_source_sha256 === oldSource?.source_sha256);
        const id = prior?.id ?? `coros_conflict_${await hash(stableJson({ source: entry.key, fingerprint: entry.fingerprint, existingId: current.id, previousVersion: current.version }))}`;
        const audit = prior ?? createCorosSyncConflictRecord({ id, ownerId: input.ownerId, detectedAt: input.timestamp, data: {
          source_id: entry.item.sourceId, source_sha256: entry.fingerprint, mapping_version: 1, record_kind: entry.item.kind,
          reason: "source_changed", existing_record_id: current.id, existing_source_sha256: oldSource?.source_sha256 ?? null, candidate: entry.payload,
        } });
        const accepted = acceptCorosSourceRevision(audit, current, input.timestamp);
        const nextText = serializeRecord(accepted.record);
        files.push({ path: sameSource.path, text: nextText }, { path: recordPath("coros_sync_conflict", id), text: serializeRecord(accepted.conflict) });
        existingConflicts.set(id, accepted.conflict);
        if (prior) result.totalPendingConflicts -= 1;
        Object.assign(sameSource, corosSyncIndexEntry(accepted.record, await corosCanonicalBlobSha(nextText)));
        closeOlderProposals(entry.item.sourceId, entry.fingerprint);
        result.updated = (result.updated ?? 0) + 1;
        continue;
      }
      // Exact FIT intervals are already present; sport labels may differ between parsers.
      // Manual sleep remains a reviewable conflict even when its interval matches exactly.
      if (duplicate && !oldSource && entry.item.kind === "workout") {
        result.unchanged += 1;
        continue;
      }
      if (duplicate) {
        const reason = "existing_record" as const;
        const id = `coros_conflict_${await hash(stableJson({ source: entry.key, fingerprint: entry.fingerprint, existingId: duplicate.id, reason }))}`;
        const conflict = createCorosSyncConflictRecord({ id, ownerId: input.ownerId, detectedAt: input.timestamp, data: {
          source_id: entry.item.sourceId, source_sha256: entry.fingerprint, mapping_version: 1, record_kind: entry.item.kind,
          reason, existing_record_id: duplicate.id, existing_source_sha256: oldSource?.source_sha256 ?? null, candidate: entry.payload,
        } });
        const path = recordPath("coros_sync_conflict", id);
        if (!existingConflicts.has(id) && !conflictIndex.has(id)) {
          if (paths.has(path)) throw new Error("COROS_SYNC_PATH_COLLISION");
          files.push({ path, text: serializeRecord(conflict) });
          paths.add(path);
          existingConflicts.set(id, conflict);
          result.totalPendingConflicts += 1;
        }
        result.conflicts += 1;
        result.conflictDetails.push({ id, sourceId: entry.item.sourceId, reason, existingId: duplicate.id });
        continue;
      }
      const path = recordPath(entry.record.entity_type, entry.record.id);
      if (paths.has(path)) throw new Error("COROS_SYNC_PATH_COLLISION");
      const text = serializeRecord(entry.record);
      files.push({ path, text });
      paths.add(path);
      const indexed = corosSyncIndexEntry(entry.record, await corosCanonicalBlobSha(text));
      records.push(indexed);
      sourceIndex.set(entry.key, indexed);
      result.created += 1;
    }
    Object.assign(result, latestDates(records));
    records.sort((a, b) => a.path.localeCompare(b.path));
    for (const file of files.filter(file => file.path.startsWith("data/coros-sync-conflicts/"))) {
      const audit = parseCorosSyncConflictRecord(file.text);
      conflictIndex.set(audit.id, { id: audit.id, path: file.path, blob_sha: await corosCanonicalBlobSha(file.text), status: audit.data.status });
    }
    const conflicts = [...conflictIndex.values()].sort((a, b) => a.path.localeCompare(b.path));
    if (!previousIndex || stableJson(previousIndex.data.records) !== stableJson(records)
      || stableJson(previousIndex.data.conflicts ?? null) !== stableJson(conflicts)) {
      const data = { index_version: 1 as const, records, conflicts };
      const index = previousIndex ? updateWorkspaceRecord(previousIndex, data, input.timestamp)
        : createWorkspaceRecord({ entityType: "coros_sync_index", id: COROS_SYNC_INDEX_ID, ownerId: input.ownerId, timestamp: input.timestamp, data });
      const text = serializeRecord(index);
      parseCorosSyncIndexRecord(text);
      files.push({ path: COROS_SYNC_INDEX_PATH, text });
    }
    if (files.length === 0) return result;
    await input.beforeCommit?.();
    try {
      await adapter.writeAtomicFiles({ files, message: "health: sync COROS records", expectedHeadCommitSha: snapshot.headCommitSha, baseTreeSha: snapshot.rootTreeSha, inlineContent: true, beforeRefUpdate: input.beforeCommit });
      return result;
    } catch (error) {
      if (!(error instanceof GitHubConflictError) || attempt === 2) throw error;
    }
  }
  throw new Error("COROS_SYNC_RETRY_EXHAUSTED");
}
