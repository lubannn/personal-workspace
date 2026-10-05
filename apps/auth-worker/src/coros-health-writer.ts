import { GitHubConflictError, type GitHubContentsAdapter } from "../../../src/lib/github-data/github-contents";
import { createAutomaticHealthMetricData, parseHealthMetricRecord } from "../../../src/lib/github-data/health-metrics";
import { createWorkspaceRecord, recordPath, serializeRecord, updateWorkspaceRecord } from "../../../src/lib/github-data/protocol";
import type { CorosHealthMetricItem } from "./coros-health-mapping";

type Adapter = Pick<GitHubContentsAdapter, "readBranchSnapshot" | "listTreeFiles" | "readBlobTexts" | "writeAtomicFiles">;
const stable = (value: unknown): string => value && typeof value === "object" && !Array.isArray(value)
  ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}` : JSON.stringify(value);
async function hash(value: string) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, "0")).join(""); }
export function corosMetricId(item: CorosHealthMetricItem) {
  return `coros_metric_${item.candidate.local_date.replaceAll("-", "")}_${item.candidate.metric_type}_${item.candidate.aggregation_period}`;
}

/** Read only incoming canonical metric paths; prior revisions and current facts share one guarded atomic commit. */
export async function writeCorosHealthMetrics(adapter: Adapter, input: { ownerId: string; items: readonly CorosHealthMetricItem[]; timestamp: string; beforeCommit?: () => Promise<void> }) {
  // 90 bulk daily/RHR dates plus one bounded HRV/activity window fit this cap.
  if (input.items.length > 500 || !Number.isFinite(Date.parse(input.timestamp))) throw new Error("COROS_SYNC_HEALTH_BATCH_INVALID");
  const prepared = await Promise.all(input.items.map(async item => {
    // Poll time alone must not cause a daily-total rewrite. The retained observation time remains truthful.
    const { measured_at: _observed, ...facts } = item.candidate;
    void _observed;
    const fingerprint = await hash(stable({ ...facts, day_complete: item.dayComplete ?? null, measurement_time_kind: item.measurementTimeKind }));
    const id = corosMetricId(item); const path = recordPath("health_metric", id);
    const record = createWorkspaceRecord({ entityType: "health_metric", id, ownerId: input.ownerId, timestamp: input.timestamp,
      data: createAutomaticHealthMetricData(item.candidate, { kind: "coros_mcp", source_id: item.sourceId, source_sha256: fingerprint, mapping_version: 1, retrieved_at: input.timestamp }, item.dayComplete, item.measurementTimeKind) });
    return { path, record, fingerprint };
  }));
  const unique = new Map<string, typeof prepared[number]>();
  for (const entry of prepared) { const old = unique.get(entry.path); if (old && old.fingerprint !== entry.fingerprint) throw new Error("COROS_SYNC_INCONSISTENT_BATCH"); unique.set(entry.path, entry); }
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await adapter.readBranchSnapshot(); const inventory = await adapter.listTreeFiles(snapshot.rootTreeSha);
    const relevant = inventory.filter(file => unique.has(file.path));
    const existing = new Map((await adapter.readBlobTexts(relevant)).map(file => [file.path, parseHealthMetricRecord(file.text)]));
    const files: { path: string; text: string }[] = []; let created = 0, updated = 0, unchanged = prepared.length - unique.size;
    for (const entry of unique.values()) {
      const old = existing.get(entry.path);
      if (!old) { files.push({ path: entry.path, text: serializeRecord(entry.record) }); created++; continue; }
      if (old.owner_id !== input.ownerId || recordPath(old.entity_type, old.id) !== entry.path || old.data.health_metric_version !== 2
        || old.data.revision_of || old.data.source.source_id !== entry.record.data.source.source_id) throw new Error("COROS_SYNC_RECORD_IDENTITY_MISMATCH");
      if (old.deleted_at !== null || old.data.source.source_sha256 === entry.fingerprint
        || Date.parse(old.data.source.retrieved_at) > Date.parse(input.timestamp)) { unchanged++; continue; }
      const revisionId = `coros_metric_revision_${await hash(`${old.id}:${old.version}:${old.data.source.source_sha256}`)}`;
      const prior = createWorkspaceRecord({ entityType: "health_metric", id: revisionId, ownerId: input.ownerId, timestamp: input.timestamp,
        data: { ...old.data, revision_of: old.id } });
      const revised = updateWorkspaceRecord(old, entry.record.data, input.timestamp);
      for (const record of [prior, revised]) { const text = serializeRecord(record); parseHealthMetricRecord(text); files.push({ path: recordPath(record.entity_type, record.id), text }); }
      updated++;
    }
    if (!files.length) return { created, updated, unchanged };
    await input.beforeCommit?.();
    try {
      await adapter.writeAtomicFiles({ files, message: "health: sync COROS daily metrics", expectedHeadCommitSha: snapshot.headCommitSha,
        baseTreeSha: snapshot.rootTreeSha, inlineContent: true, beforeRefUpdate: input.beforeCommit });
      return { created, updated, unchanged };
    } catch (error) { if (!(error instanceof GitHubConflictError) || attempt === 2) throw error; }
  }
  throw new Error("COROS_SYNC_RETRY_EXHAUSTED");
}
