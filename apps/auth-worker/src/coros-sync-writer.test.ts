import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GitHubConflictError, type GitHubDirectoryItem } from "../../../src/lib/github-data/github-contents";
import { createWorkspaceRecord, parseRecord, recordPath, serializeRecord, type WorkspaceRecord } from "../../../src/lib/github-data/protocol";
import { createConfirmedSleepSessionData, parseSleepSessionRecord } from "../../../src/lib/github-data/sleep-sessions";
import { acceptCorosSourceRevision, parseCorosSyncConflictRecord } from "../../../src/lib/github-data/coros-sync-conflicts";
import { COROS_SYNC_INDEX_PATH, parseCorosSyncIndexRecord } from "../../../src/lib/github-data/coros-sync-index";
import type { CorosSyncCandidate } from "./coros-sync-mapping";
import { writeCorosSyncBatch } from "./coros-sync-writer";

// Synthetic summaries only; no account responses are test fixtures.
const timestamp = "2024-01-03T01:00:00.000Z";
const ownerId = "owner_test";
const sleep: Extract<CorosSyncCandidate, { kind: "sleep" }> = {
  kind: "sleep", sourceId: "sleep:2024-01-02:main",
  candidate: { start_at: "2024-01-01T15:00:00.000Z", end_at: "2024-01-01T23:00:00.000Z", local_date: "2024-01-01", timezone: "Asia/Shanghai", session_type: "main_sleep", duration_minutes: 480 },
  metrics: { asleep_minutes: 450, awake_minutes: 30, score: 80, wake_date: "2024-01-02" },
};
const workout: Extract<CorosSyncCandidate, { kind: "workout" }> = {
  kind: "workout", sourceId: "workout:123456789012345678",
  candidate: { activity_type: "run", start_at: "2024-01-02T00:00:00.000Z", end_at: "2024-01-02T01:00:00.000Z", timezone: "Asia/Shanghai", duration_seconds: 3600, distance: 6250, distance_unit: "m", training_load: null, metrics_json: { elapsed_seconds: 3600, moving_seconds: null, calories: null, average_heart_rate_bpm: null, maximum_heart_rate_bpm: null, average_cadence_rpm: null, average_power_watts: null, trackpoints: 0 } },
};
function fakeAdapter(initial: WorkspaceRecord[] = []) {
  let revision = 1;
  const files = new Map(initial.map((record) => [recordPath(record.entity_type, record.id), serializeRecord(record)]));
  const sha = (text: string) => createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex");
  const snapshot = () => ({ branch: "main", headCommitSha: revision.toString(16).padStart(40, "0"), rootTreeSha: (revision + 100).toString(16).padStart(40, "0") });
  const snapshots = new Map<string, Map<string, string>>();
  const readBranchSnapshot = vi.fn(async () => { snapshots.set(snapshot().rootTreeSha, new Map(files)); return snapshot(); });
  const listTreeFiles = vi.fn(async (treeSha: string): Promise<GitHubDirectoryItem[]> => [...snapshots.get(treeSha)!].map(([path, text]) => ({ type: "file", name: path.split("/").at(-1)!, path, blobSha: sha(text), sizeBytes: Buffer.byteLength(text) })));
  const readBlobTexts = vi.fn(async (items: readonly { path: string; blobSha: string; sizeBytes: number }[]) => items.map((item) => {
    const text = [...snapshots.values()].flatMap((map) => [...map]).find(([path, value]) => path === item.path && sha(value) === item.blobSha)?.[1];
    if (text === undefined) throw new Error("missing blob");
    return { ...item, text };
  }));
  const writeAtomicFiles = vi.fn(async (input: { files: Array<{ path: string; text: string }>; expectedHeadCommitSha: string; baseTreeSha: string; beforeRefUpdate?: () => Promise<void> }) => {
    if (input.expectedHeadCommitSha !== snapshot().headCommitSha || input.baseTreeSha !== snapshot().rootTreeSha) throw new GitHubConflictError();
    await input.beforeRefUpdate?.();
    input.files.forEach((file) => files.set(file.path, file.text));
    revision += 1;
    return { commitSha: snapshot().headCommitSha, treeSha: snapshot().rootTreeSha, files: input.files.map((file) => ({ path: file.path, blobSha: sha(file.text) })) };
  });
  return { files, adapter: { readBranchSnapshot, listTreeFiles, readBlobTexts, writeAtomicFiles }, advance: () => { revision += 1; } };
}

describe("atomic COROS synchronization writer", () => {
  it("creates sleep and workout in one pinned commit, then retries as a no-op", async () => {
    const fake = fakeAdapter();
    const beforeCommit = vi.fn(async () => {});
    const result = await writeCorosSyncBatch(fake.adapter, { ownerId, items: [sleep, workout], timestamp, beforeCommit });
    expect(result).toMatchObject({ created: 2, unchanged: 0, conflicts: 0, totalPendingConflicts: 0, latestSleepDate: "2024-01-02", latestWorkoutDate: "2024-01-02" });
    expect(fake.adapter.writeAtomicFiles).toHaveBeenCalledTimes(1);
    expect(fake.adapter.writeAtomicFiles.mock.calls[0][0]).toMatchObject({ expectedHeadCommitSha: "1".padStart(40, "0"), baseTreeSha: "65".padStart(40, "0"), inlineContent: true });
    expect(beforeCommit).toHaveBeenCalledTimes(2);
    const records = [...fake.files].filter(([path]) => path !== COROS_SYNC_INDEX_PATH).map(([, text]) => parseRecord(text));
    expect(records.every((record) => record.id.startsWith("coros_") && record.data.import_mode === "automatic")).toBe(true);
    expect(JSON.stringify(records)).not.toMatch(/confirmation_status|staging_record_id|coordinates|raw_text/u);
    const again = await writeCorosSyncBatch(fake.adapter, { ownerId, items: [sleep, workout], timestamp: "2024-01-04T00:00:00.000Z" });
    expect(again).toMatchObject({ created: 0, unchanged: 2, conflicts: 0 });
    expect(fake.adapter.writeAtomicFiles).toHaveBeenCalledTimes(1);
  });

  it("automatically applies source revisions and preserves the old facts in a resolved audit", async () => {
    const fake = fakeAdapter();
    await writeCorosSyncBatch(fake.adapter, { ownerId, items: [sleep], timestamp });
    const original = [...fake.files][0];
    const revised = { ...sleep, metrics: { ...sleep.metrics, score: 81 } };
    expect(await writeCorosSyncBatch(fake.adapter, { ownerId, items: [revised, workout], timestamp })).toMatchObject({ created: 1, updated: 1, conflicts: 0, totalPendingConflicts: 0 });
    expect(parseSleepSessionRecord(fake.files.get(original[0])!).data.sleep_metrics_json.score).toBe(81);
    const conflict = [...fake.files].find(([path]) => path.includes("coros-sync-conflicts"))!;
    expect(parseCorosSyncConflictRecord(conflict[1]).data).toMatchObject({ status: "resolved", candidate: { metrics: { score: 81 } }, resolution: { previous_record: parseRecord(original[1]) } });
    expect(fake.adapter.writeAtomicFiles.mock.calls[1][0].files).toHaveLength(4);
    expect(await writeCorosSyncBatch(fake.adapter, { ownerId, items: [revised], timestamp })).toMatchObject({ created: 0, unchanged: 1, updated: 0, conflicts: 0, totalPendingConflicts: 0 });
    expect(fake.adapter.writeAtomicFiles).toHaveBeenCalledTimes(2);
    expect(() => parseCorosSyncConflictRecord(JSON.stringify({ ...parseRecord(conflict[1]), data: { ...parseRecord(conflict[1]).data, raw_text: "unexpected" } }))).toThrow("INVALID_COROS_SYNC_CONFLICT_RECORD");
  });
  it("enriches only an omitted daily total atomically and idempotently, preserving episode facts and index consistency", async () => {
    const fake = fakeAdapter();
    await writeCorosSyncBatch(fake.adapter, { ownerId, items: [sleep], timestamp });
    const path = [...fake.files.keys()].find(path => path.startsWith("data/sleep-sessions/"))!;
    const before = parseSleepSessionRecord(fake.files.get(path)!);
    const enriched = { ...sleep, metrics: { ...sleep.metrics, daily_sleep_minutes: 495 } };
    expect(await writeCorosSyncBatch(fake.adapter, { ownerId, items: [enriched], timestamp })).toMatchObject({ created: 0, conflicts: 0, unchanged: 1 });
    const after = parseSleepSessionRecord(fake.files.get(path)!);
    expect(after.id).toBe(before.id);
    expect(after.created_at).toBe(before.created_at);
    expect(after.version).toBe(before.version + 1);
    expect(after.data.sleep_metrics_json).toEqual(enriched.metrics);
    expect(after.data.start_at).toBe(before.data.start_at);
    expect(after.data.end_at).toBe(before.data.end_at);
    const index = parseCorosSyncIndexRecord(fake.files.get(COROS_SYNC_INDEX_PATH)!);
    expect(index.data.records[0]).toMatchObject({ source: { source_sha256: after.data.sleep_session_version === 2 ? after.data.source.source_sha256 : "" } });
    expect([...fake.files.keys()].some(path => path.includes("coros-sync-conflicts"))).toBe(false);
    const commits = fake.adapter.writeAtomicFiles.mock.calls.length;
    await writeCorosSyncBatch(fake.adapter, { ownerId, items: [enriched], timestamp });
    expect(fake.adapter.writeAtomicFiles).toHaveBeenCalledTimes(commits);
    expect(await writeCorosSyncBatch(fake.adapter, { ownerId, items: [{ ...enriched, metrics: { ...enriched.metrics, daily_sleep_minutes: 500 } }], timestamp })).toMatchObject({ updated: 1, conflicts: 0 });
  });
  it("automatically updates both score and daily total, keeping an audit", async () => {
    const fake = fakeAdapter();
    await writeCorosSyncBatch(fake.adapter, { ownerId, items: [sleep], timestamp });
    expect(await writeCorosSyncBatch(fake.adapter, { ownerId, items: [{ ...sleep, metrics: { ...sleep.metrics, score: 90, daily_sleep_minutes: 500 } }], timestamp })).toMatchObject({ updated: 1, conflicts: 0 });
  });

  it("retains correction evidence in canonical data and fingerprints without duplicating a later corrected source", async () => {
    const corrected: Extract<CorosSyncCandidate, { kind: "sleep" }> = {
      kind: "sleep", sourceId: "sleep:2025-01-10:nap:2025-01-10T04:00:00.000Z",
      candidate: { start_at: "2025-01-10T04:00:00.000Z", end_at: "2025-01-10T04:30:00.000Z", local_date: "2025-01-10",
        timezone: "Asia/Shanghai", session_type: "nap", duration_minutes: 30 },
      metrics: { asleep_minutes: null, awake_minutes: null, score: null, wake_date: "2025-01-10", date_correction: {
        reason: "coros_legacy_nap_year_1982", original_start_at: "1982-01-10T04:00:00.000Z", original_end_at: "1982-01-10T04:30:00.000Z",
      } },
    };
    const fake = fakeAdapter(); const input = { ownerId, items: [corrected], timestamp: "2025-01-11T00:00:00.000Z" };
    expect(await writeCorosSyncBatch(fake.adapter, input)).toMatchObject({ created: 1, conflicts: 0 });
    const original = [...fake.files].find(([path]) => path.startsWith("data/sleep-sessions/"))!;
    expect(parseSleepSessionRecord(original[1]).data.sleep_metrics_json).toEqual(corrected.metrics);
    expect(await writeCorosSyncBatch(fake.adapter, input)).toMatchObject({ created: 0, unchanged: 1, conflicts: 0 });
    expect(fake.adapter.writeAtomicFiles).toHaveBeenCalledTimes(1);
    const upstreamFixed = { ...corrected, metrics: { asleep_minutes: null, awake_minutes: null, score: null, wake_date: "2025-01-10" } };
    expect(await writeCorosSyncBatch(fake.adapter, { ...input, items: [upstreamFixed] })).toMatchObject({ created: 0, updated: 1, conflicts: 0 });
    expect(parseSleepSessionRecord(fake.files.get(original[0])!).data.sleep_metrics_json).toEqual(upstreamFixed.metrics);
    const conflict = [...fake.files].find(([path]) => path.includes("coros-sync-conflicts"))!;
    expect(parseCorosSyncConflictRecord(conflict[1]).data).toMatchObject({ reason: "source_changed",
      existing_record_id: parseRecord(original[1]).id, candidate: { kind: "sleep", metrics: upstreamFixed.metrics } });
  });

  it("accepts an existing pending proposal and preserves earlier resolved revisions", async () => {
    const fake = fakeAdapter();
    await writeCorosSyncBatch(fake.adapter, { ownerId, items: [sleep], timestamp });
    const [path, text] = [...fake.files].find(([path]) => path.startsWith("data/sleep-sessions/"))!;
    const revised = { ...sleep, metrics: { ...sleep.metrics, score: 86 } };
    await writeCorosSyncBatch(fake.adapter, { ownerId, items: [revised], timestamp });
    const [conflictPath, conflictText] = [...fake.files].find(([path]) => path.includes("coros-sync-conflicts"))!;
    const resolved = parseCorosSyncConflictRecord(conflictText);
    const data = { ...resolved.data }; delete data.resolution;
    const conflict = parseCorosSyncConflictRecord(JSON.stringify({ ...resolved, version: 1, updated_at: resolved.created_at, data: { ...data, status: "pending" } }));
    fake.files.set(path, text);
    fake.files.set(conflictPath, serializeRecord(conflict));
    expect(await writeCorosSyncBatch(fake.adapter, { ownerId, items: [revised], timestamp: "2024-01-04T00:00:00.000Z" })).toMatchObject({ updated: 1, conflicts: 0, totalPendingConflicts: 0 });
    const accepted = parseCorosSyncConflictRecord(fake.files.get(conflictPath)!);
    expect(accepted.data).toMatchObject({ status: "resolved", resolution: { previous_record: parseRecord(text) } });
    const future = { ...sleep, metrics: { ...sleep.metrics, score: 88 } };
    expect(await writeCorosSyncBatch(fake.adapter, { ownerId, items: [future], timestamp: "2024-01-05T00:00:00.000Z" })).toMatchObject({ updated: 1, conflicts: 0, totalPendingConflicts: 0 });
    expect(fake.files.get(conflictPath)).toBe(serializeRecord(accepted));
    const previous = parseSleepSessionRecord(text);
    expect(() => acceptCorosSourceRevision(conflict, parseSleepSessionRecord(fake.files.get(path)!), "2024-01-06T00:00:00.000Z")).toThrow("COROS_CONFLICT_RECORD_CHANGED");
    const forged = structuredClone(accepted);
    forged.data.resolution!.previous_record!.owner_id = "someone_else";
    expect(() => parseCorosSyncConflictRecord(JSON.stringify(forged))).toThrow("INVALID_COROS_SYNC_CONFLICT_RECORD");
    expect(() => acceptCorosSourceRevision(conflict, previous, "2024-01-01T00:00:00.000Z")).toThrow("INVALID_COROS_SYNC_CONFLICT_RECORD");
  });

  it("supersedes stale pending candidates with the latest source without applying stale values", async () => {
    const fake = fakeAdapter();
    await writeCorosSyncBatch(fake.adapter, { ownerId, items: [sleep], timestamp });
    const [path, text] = [...fake.files].find(([path]) => path.startsWith("data/sleep-sessions/"))!;
    await writeCorosSyncBatch(fake.adapter, { ownerId, items: [{ ...sleep, metrics: { ...sleep.metrics, score: 85 } }], timestamp });
    const [auditPath, auditText] = [...fake.files].find(([path]) => path.includes("coros-sync-conflicts"))!;
    const audit = parseCorosSyncConflictRecord(auditText);
    const data = { ...audit.data }; delete data.resolution;
    fake.files.set(auditPath, serializeRecord({ ...audit, version: 1, data: { ...data, status: "pending" } }));
    fake.files.set(path, text);
    expect(await writeCorosSyncBatch(fake.adapter, { ownerId, items: [{ ...sleep, metrics: { ...sleep.metrics, score: 90 } }], timestamp })).toMatchObject({ updated: 1, totalPendingConflicts: 0 });
    expect(parseSleepSessionRecord(fake.files.get(path)!).data.sleep_metrics_json.score).toBe(90);
    expect(parseCorosSyncConflictRecord(fake.files.get(auditPath)!).data).toMatchObject({ status: "resolved", resolution: { action: "superseded" } });
  });

  it("retains every revision when the same values recur and updates workout metrics automatically", async () => {
    const fake = fakeAdapter();
    await writeCorosSyncBatch(fake.adapter, { ownerId, items: [sleep, workout], timestamp });
    for (const score of [84, 80, 84]) {
      expect(await writeCorosSyncBatch(fake.adapter, { ownerId, items: [{ ...sleep, metrics: { ...sleep.metrics, score } }], timestamp })).toMatchObject({ updated: 1, conflicts: 0 });
    }
    expect([...fake.files.keys()].filter(path => path.includes("coros-sync-conflicts"))).toHaveLength(3);
    const revised = { ...workout, candidate: { ...workout.candidate, distance: 6300 } };
    expect(await writeCorosSyncBatch(fake.adapter, { ownerId, items: [revised], timestamp })).toMatchObject({ updated: 1, conflicts: 0 });
    expect(parseRecord([...fake.files].find(([path]) => path.startsWith("data/workouts/"))![1]).data.distance).toBe(6300);
    const reads = fake.adapter.readBlobTexts.mock.calls.at(-1)![0];
    expect(reads.filter(file => file.path.startsWith("data/sleep-sessions/"))).toHaveLength(0);
    expect(reads.filter(file => file.path.startsWith("data/workouts/"))).toHaveLength(1);
  });

  it("does not resurrect deleted automatic sources or exact-interval legacy records", async () => {
    const fake = fakeAdapter();
    await writeCorosSyncBatch(fake.adapter, { ownerId, items: [sleep], timestamp });
    const [path, text] = [...fake.files][0];
    fake.files.set(path, serializeRecord({ ...parseRecord(text), deleted_at: timestamp, version: 2 }));
    const revised = { ...sleep, metrics: { ...sleep.metrics, score: 82 } };
    expect(await writeCorosSyncBatch(fake.adapter, { ownerId, items: [revised], timestamp })).toMatchObject({ created: 0, unchanged: 1, conflicts: 0, latestSleepDate: null });
    expect(fake.adapter.writeAtomicFiles).toHaveBeenCalledTimes(2);
  });

  it("recognizes FIT workouts without rewriting them or requiring duplicate review", async () => {
    const key = "a".repeat(64);
    const fit = createWorkspaceRecord({ entityType: "workout", id: `workout_${key}`, ownerId, timestamp, data: { ...workout.candidate, activity_type: "other", workout_version: 1, confirmation_status: "confirmed", staging_record_id: `coros_workout_${key}`, import_key: key, source_sha256: "b".repeat(64), confirmed_at: timestamp } });
    const fake = fakeAdapter([fit]);
    expect(await writeCorosSyncBatch(fake.adapter, { ownerId, items: [workout], timestamp })).toMatchObject({ created: 0, unchanged: 1, conflicts: 0 });
    expect(fake.adapter.writeAtomicFiles).toHaveBeenCalledTimes(1);
    expect(fake.adapter.writeAtomicFiles.mock.calls[0][0].files.map((file) => file.path)).toEqual([COROS_SYNC_INDEX_PATH]);
  });

  it("preserves manual sleep and exposes COROS metrics as a conflict even for identical intervals", async () => {
    const manual = createWorkspaceRecord({ entityType: "sleep_session", id: "manual_sleep", ownerId, timestamp, data: createConfirmedSleepSessionData(sleep.candidate, "staging_sleep") });
    const fake = fakeAdapter([manual]);
    const result = await writeCorosSyncBatch(fake.adapter, { ownerId, items: [sleep], timestamp });
    expect(result).toMatchObject({ created: 0, unchanged: 0, conflicts: 1, totalPendingConflicts: 1, conflictDetails: [{ existingId: manual.id, reason: "existing_record" }] });
    expect(fake.files.get(recordPath("sleep_session", manual.id))).toBe(serializeRecord(manual));
    const conflict = [...fake.files].find(([path]) => path.includes("coros-sync-conflicts"))!;
    expect(parseCorosSyncConflictRecord(conflict[1]).data).toMatchObject({ existing_source_sha256: null, candidate: { kind: "sleep", metrics: sleep.metrics } });
    expect(await writeCorosSyncBatch(fake.adapter, { ownerId, items: [sleep], timestamp })).toMatchObject({ conflicts: 1, totalPendingConflicts: 1 });
    expect(fake.adapter.writeAtomicFiles).toHaveBeenCalledTimes(1);
  });

  it("holds a different source identity for an existing interval", async () => {
    const fake = fakeAdapter();
    await writeCorosSyncBatch(fake.adapter, { ownerId, items: [workout], timestamp });
    const result = await writeCorosSyncBatch(fake.adapter, { ownerId, items: [{ ...workout, sourceId: "workout:987654321012345678" }], timestamp });
    expect(result).toMatchObject({ created: 0, conflicts: 1, conflictDetails: [{ reason: "existing_record" }] });
  });

  it("re-reads after a competing commit and recognizes a concurrently inserted record", async () => {
    const fake = fakeAdapter();
    const write = fake.adapter.writeAtomicFiles.getMockImplementation()!;
    fake.adapter.writeAtomicFiles.mockImplementationOnce(async (input) => {
      input.files.forEach((file) => fake.files.set(file.path, file.text));
      fake.advance();
      throw new GitHubConflictError();
    }).mockImplementation(write);
    const result = await writeCorosSyncBatch(fake.adapter, { ownerId, items: [sleep], timestamp });
    expect(result).toMatchObject({ created: 0, unchanged: 1 });
    expect(fake.adapter.readBranchSnapshot).toHaveBeenCalledTimes(2);
    expect(fake.adapter.writeAtomicFiles).toHaveBeenCalledTimes(1);
  });

  it("limits races to three attempts and does not retry other write failures", async () => {
    const fake = fakeAdapter();
    fake.adapter.writeAtomicFiles.mockRejectedValue(new GitHubConflictError());
    await expect(writeCorosSyncBatch(fake.adapter, { ownerId, items: [sleep], timestamp })).rejects.toBeInstanceOf(GitHubConflictError);
    expect(fake.adapter.writeAtomicFiles).toHaveBeenCalledTimes(3);
    fake.adapter.writeAtomicFiles.mockReset().mockRejectedValue(new Error("service unavailable"));
    await expect(writeCorosSyncBatch(fake.adapter, { ownerId, items: [sleep], timestamp })).rejects.toThrow("service unavailable");
    expect(fake.adapter.writeAtomicFiles).toHaveBeenCalledTimes(1);
  });

  it("does not commit after the pause/disconnect guard rejects", async () => {
    const fake = fakeAdapter();
    await expect(writeCorosSyncBatch(fake.adapter, { ownerId, items: [sleep], timestamp, beforeCommit: async () => { throw new Error("COROS_SYNC_PAUSED"); } })).rejects.toThrow("COROS_SYNC_PAUSED");
    expect(fake.adapter.writeAtomicFiles).not.toHaveBeenCalled();
  });

  it("rejects contradictory duplicates and invalid candidates before reading or writing", async () => {
    const fake = fakeAdapter();
    await expect(writeCorosSyncBatch(fake.adapter, { ownerId, items: [sleep, { ...sleep, metrics: { ...sleep.metrics, score: 82 } }], timestamp })).rejects.toThrow("COROS_SYNC_INCONSISTENT_BATCH");
    await expect(writeCorosSyncBatch(fake.adapter, { ownerId, items: [{ ...sleep, metrics: { ...sleep.metrics, score: 101 } }], timestamp })).rejects.toThrow();
    expect(fake.adapter.readBranchSnapshot).not.toHaveBeenCalled();
    expect(fake.adapter.writeAtomicFiles).not.toHaveBeenCalled();
  });

  it("rejects foreign ownership and path mismatches instead of hiding records", async () => {
    const foreign = createWorkspaceRecord({ entityType: "sleep_session", id: "foreign_sleep", ownerId: "another_owner", timestamp, data: createConfirmedSleepSessionData(sleep.candidate, "staging_sleep") });
    const fake = fakeAdapter([foreign]);
    await expect(writeCorosSyncBatch(fake.adapter, { ownerId, items: [sleep], timestamp })).rejects.toThrow("COROS_SYNC_RECORD_IDENTITY_MISMATCH");
    expect(fake.adapter.writeAtomicFiles).not.toHaveBeenCalled();
  });

  it("uses a derived SHA index so 1,500 unchanged records need one blob read", async () => {
    const many = Array.from({ length: 1500 }, (_, index) => {
      const start = new Date(Date.UTC(2020, 0, index + 1));
      const candidate = { ...sleep.candidate, start_at: start.toISOString(), end_at: new Date(start.valueOf() + 480 * 60_000).toISOString(), timezone: "UTC", local_date: start.toISOString().slice(0, 10) };
      return createWorkspaceRecord({ entityType: "sleep_session", id: `manual_${index}`, ownerId, timestamp, data: createConfirmedSleepSessionData(candidate, `staging_${index}`) });
    });
    const fake = fakeAdapter(many);
    await writeCorosSyncBatch(fake.adapter, { ownerId, items: [], timestamp });
    expect(parseCorosSyncIndexRecord(fake.files.get(COROS_SYNC_INDEX_PATH)!).data.records).toHaveLength(1500);
    fake.adapter.readBlobTexts.mockClear();
    const writes = fake.adapter.writeAtomicFiles.mock.calls.length;
    await writeCorosSyncBatch(fake.adapter, { ownerId, items: [], timestamp });
    expect(fake.adapter.readBlobTexts.mock.calls.flatMap(([files]) => files)).toHaveLength(1);
    expect(fake.adapter.writeAtomicFiles).toHaveBeenCalledTimes(writes);
    // Another device deletes one record: tree SHA revalidation fetches exactly that changed blob.
    const changedPath = recordPath("sleep_session", many[0].id);
    fake.files.set(changedPath, serializeRecord({ ...many[0], version: 2, deleted_at: timestamp }));
    fake.adapter.readBlobTexts.mockClear();
    await writeCorosSyncBatch(fake.adapter, { ownerId, items: [], timestamp });
    expect(fake.adapter.readBlobTexts.mock.calls.flatMap(([files]) => files).map((file) => file.path).sort()).toEqual([COROS_SYNC_INDEX_PATH, changedPath].sort());
    expect(parseCorosSyncIndexRecord(fake.files.get(COROS_SYNC_INDEX_PATH)!).data.records.find((entry) => entry.path === changedPath)?.deleted_at).toBe(timestamp);
  });

  it("rebuilds malformed derived metadata and drops hard-deleted cache entries", async () => {
    const fake = fakeAdapter();
    await writeCorosSyncBatch(fake.adapter, { ownerId, items: [sleep], timestamp });
    const path = [...fake.files.keys()].find((key) => key !== COROS_SYNC_INDEX_PATH)!;
    fake.files.set(COROS_SYNC_INDEX_PATH, "{invalid");
    await writeCorosSyncBatch(fake.adapter, { ownerId, items: [sleep], timestamp });
    expect(parseCorosSyncIndexRecord(fake.files.get(COROS_SYNC_INDEX_PATH)!).data.records).toHaveLength(1);
    fake.files.delete(path);
    await writeCorosSyncBatch(fake.adapter, { ownerId, items: [], timestamp });
    expect(parseCorosSyncIndexRecord(fake.files.get(COROS_SYNC_INDEX_PATH)!).data.records).toEqual([]);
  });

  it("rechecks pause after preparing Git objects and aborts the ref update", async () => {
    const fake = fakeAdapter();
    const guard = vi.fn<() => Promise<void>>().mockResolvedValueOnce().mockRejectedValueOnce(new Error("COROS_SYNC_PAUSED"));
    await expect(writeCorosSyncBatch(fake.adapter, { ownerId, items: [sleep], timestamp, beforeCommit: guard })).rejects.toThrow("COROS_SYNC_PAUSED");
    expect(guard).toHaveBeenCalledTimes(2);
    expect(fake.files.size).toBe(0);
  });
});
