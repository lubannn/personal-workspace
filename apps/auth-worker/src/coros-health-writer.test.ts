import { describe, expect, it, vi } from "vitest";
import { GitHubConflictError } from "../../../src/lib/github-data/github-contents";
import { parseHealthMetricRecord } from "../../../src/lib/github-data/health-metrics";
import { recordPath, serializeRecord } from "../../../src/lib/github-data/protocol";
import { corosMetricId, writeCorosHealthMetrics } from "./coros-health-writer";
import type { CorosHealthMetricItem } from "./coros-health-mapping";

const timestamp = "2024-02-01T04:00:00.000Z";
const item: CorosHealthMetricItem = { sourceId: "health:2024-02-01:steps:daily", measurementTimeKind: "observed_at",
  candidate: { metric_type: "steps", value: 1234, unit: "steps", local_date: "2024-02-01", measured_at: timestamp, timezone: "Asia/Shanghai", aggregation_period: "daily" } };
function fake() {
  const files = new Map<string, string>(); let version = 1;
  const adapter: Parameters<typeof writeCorosHealthMetrics>[0] = {
    readBranchSnapshot: vi.fn(async () => ({ branch: "main", headCommitSha: String(version).padStart(40, "0"), rootTreeSha: "b".repeat(40) })),
    listTreeFiles: vi.fn(async () => [...files].map(([path, text]) => ({ type: "file" as const, name: path.split("/").at(-1)!, path, blobSha: "a".repeat(40), sizeBytes: text.length }))),
    readBlobTexts: vi.fn<Parameters<typeof writeCorosHealthMetrics>[0]["readBlobTexts"]>(async entries => entries.map(entry => ({ ...entry, text: files.get(entry.path)! }))),
    writeAtomicFiles: vi.fn<Parameters<typeof writeCorosHealthMetrics>[0]["writeAtomicFiles"]>(async input => {
      if (input.expectedHeadCommitSha !== String(version).padStart(40, "0")) throw new GitHubConflictError();
      await input.beforeRefUpdate?.(); input.files.forEach(entry => files.set(entry.path, entry.text)); version++;
      return { commitSha: String(version).padStart(40, "0"), treeSha: "b".repeat(40), files: input.files.map(entry => ({ path: entry.path, blobSha: "a".repeat(40) })) };
    }),
  };
  return { adapter, files, advance: () => version++ };
}
describe("atomic metric persistence and revisions", () => {
  it("stores normalized facts only, is idempotent across poll times, and reads only incoming paths", async () => {
    const f = fake(); const input = { ownerId: "synthetic_owner", items: [item, item], timestamp };
    expect(await writeCorosHealthMetrics(f.adapter, input)).toEqual({ created: 1, updated: 0, unchanged: 1 });
    const path = recordPath("health_metric", corosMetricId(item)); const original = parseHealthMetricRecord(f.files.get(path)!);
    expect(original.data).toMatchObject({ value: 1234, measurement_time_kind: "observed_at", import_mode: "automatic" });
    expect(original.data).not.toHaveProperty("day_complete"); expect(JSON.stringify(original)).not.toMatch(/token|raw_text|time_series/);
    const later = "2024-02-02T04:00:00.000Z";
    expect(await writeCorosHealthMetrics(f.adapter, { ...input, items: [{ ...item, candidate: { ...item.candidate, measured_at: later } }], timestamp: later })).toEqual({ created: 0, updated: 0, unchanged: 1 });
    expect(f.adapter.writeAtomicFiles).toHaveBeenCalledTimes(1); expect(f.files.get(path)).toBe(serializeRecord(original));
    expect(vi.mocked(f.adapter.readBlobTexts).mock.calls.at(-1)![0].map(file => file.path)).toEqual([path]);
  });
  it("preserves a source revision alongside the updated canonical record and never resurrects a tombstone", async () => {
    const f = fake(); await writeCorosHealthMetrics(f.adapter, { ownerId: "synthetic_owner", items: [item], timestamp });
    const path = recordPath("health_metric", corosMetricId(item)); const old = parseHealthMetricRecord(f.files.get(path)!);
    const later = "2024-02-02T04:00:00.000Z"; const revised = { ...item, candidate: { ...item.candidate, value: 1500, measured_at: later } };
    expect(await writeCorosHealthMetrics(f.adapter, { ownerId: "synthetic_owner", items: [revised], timestamp: later })).toEqual({ created: 0, updated: 1, unchanged: 0 });
    const current = parseHealthMetricRecord(f.files.get(path)!); expect(current.data.value).toBe(1500); expect(current.version).toBe(2);
    const archive = [...f.files].find(([p]) => p.includes("coros_metric_revision_"))!;
    expect(parseHealthMetricRecord(archive[1]).data).toEqual({ ...old.data, revision_of: old.id });
    f.files.set(path, serializeRecord({ ...current, deleted_at: later }));
    expect(await writeCorosHealthMetrics(f.adapter, { ownerId: "synthetic_owner", items: [item], timestamp: later })).toMatchObject({ unchanged: 1, updated: 0 });
    expect(parseHealthMetricRecord(f.files.get(path)!).deleted_at).toBe(later);
  });
  it("checks ownership, duplicate candidates, lease cancellation and optimistic transaction conflicts", async () => {
    const f = fake(); await writeCorosHealthMetrics(f.adapter, { ownerId: "synthetic_owner", items: [item], timestamp });
    await expect(writeCorosHealthMetrics(f.adapter, { ownerId: "wrong_owner", items: [item], timestamp })).rejects.toThrow("IDENTITY_MISMATCH");
    await expect(writeCorosHealthMetrics(f.adapter, { ownerId: "synthetic_owner", items: [item, { ...item, candidate: { ...item.candidate, value: 1 } }], timestamp })).rejects.toThrow("INCONSISTENT_BATCH");
    const revised = { ...item, candidate: { ...item.candidate, value: 2 } };
    await expect(writeCorosHealthMetrics(f.adapter, { ownerId: "synthetic_owner", items: [revised], timestamp, beforeCommit: async () => { throw new Error("COROS_SYNC_CANCELLED"); } })).rejects.toThrow("CANCELLED");
    const active = vi.fn(async () => { if (active.mock.calls.length === 1) f.advance(); });
    expect(await writeCorosHealthMetrics(f.adapter, { ownerId: "synthetic_owner", items: [revised], timestamp, beforeCommit: active })).toMatchObject({ updated: 1 });
    expect(f.files.size).toBe(2);
  });
});
