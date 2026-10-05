import { describe, expect, it, vi } from "vitest";
import { GitHubConflictError } from "../../../src/lib/github-data/github-contents";
import { parseHealthMetricRecord } from "../../../src/lib/github-data/health-metrics";
import { recordPath, serializeRecord } from "../../../src/lib/github-data/protocol";
import { corosMetricId, writeCorosHealthMetrics } from "./coros-health-writer";
import type { CorosHealthMetricItem } from "./coros-health-mapping";
import { collectBulkHealthHistory } from "./coros-health-history";
import { initialSyncProgress, shiftDate } from "./coros-sync-state";

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
  it("filters a complete 600-day relative response before the atomic batch limit, then replays without another commit", async () => {
    const now = new Date(timestamp), start = shiftDate("2024-02-01", -599), p = initialSyncProgress(start, "Asia/Shanghai");
    const body = `Daily Health Data — Last 600 days | Resting HR: 50 bpm | HRV Baseline: 40 ms\nNote: sleep entries are dated by their wake-up day.`
      + Array.from({ length: 600 }, (_, index) => `\n\n--- ${shiftDate(start, index).replaceAll("-", "")} ---\nSteps: 100 | Calories: 10 kcal | Exercise: 0 min`).join("");
    const result = await collectBulkHealthHistory(async () => ({ format: "content", payload: [{ type: "text", text: JSON.stringify(body) }] }),
      { domain: "health", source: "dailyHealth", recent: false, from: start, through: shiftDate(start, 27) }, p, async () => {}, now);
    expect(result.items).toHaveLength(84); expect(result.observedDates).toHaveLength(28);
    expect(result.items.every(item => item.candidate.local_date <= shiftDate(start, 27))).toBe(true);
    const f = fake();
    expect(await writeCorosHealthMetrics(f.adapter, { ownerId: "synthetic_owner", items: result.items, timestamp })).toMatchObject({ created: 84 });
    expect(f.adapter.writeAtomicFiles).toHaveBeenCalledTimes(1); expect(f.files.size).toBe(84);
    expect(await writeCorosHealthMetrics(f.adapter, { ownerId: "synthetic_owner", items: result.items, timestamp })).toMatchObject({ created: 0, unchanged: 84 });
    expect(f.adapter.writeAtomicFiles).toHaveBeenCalledTimes(1);
  });
  it("holds a locally modified canonical value rather than overwriting it with a backfill", async () => {
    const f = fake(); await writeCorosHealthMetrics(f.adapter, { ownerId: "synthetic_owner", items: [item], timestamp });
    const path = recordPath("health_metric", corosMetricId(item)); const old = parseHealthMetricRecord(f.files.get(path)!);
    f.files.set(path, serializeRecord({ ...old, data: { ...old.data, value: 99 } }));
    const before = f.files.get(path);
    await expect(writeCorosHealthMetrics(f.adapter, { ownerId: "synthetic_owner", items: [{ ...item, candidate: { ...item.candidate, value: 1500 } }], timestamp }))
      .rejects.toThrow("STORED_RECORD_MODIFIED");
    expect(f.files.get(path)).toBe(before); expect(f.adapter.writeAtomicFiles).toHaveBeenCalledTimes(1);
  });
  it("persists a 90-day bulk baseline in one atomic commit without a 200-item ceiling", async () => {
    const f = fake();
    const items = Array.from({ length: 90 }, (_, index) => new Date(Date.parse("2024-02-01") - index * 86400_000).toISOString().slice(0, 10))
      .flatMap(date => ["steps", "exercise_minutes", "active_calories", "resting_heart_rate"].map(metric => ({ ...item, sourceId: `health:${date}:${metric}:daily`,
        candidate: { ...item.candidate, local_date: date, metric_type: metric } })));
    expect(await writeCorosHealthMetrics(f.adapter, { ownerId: "synthetic_owner", items, timestamp })).toMatchObject({ created: 360 });
    expect(f.adapter.writeAtomicFiles).toHaveBeenCalledTimes(1); expect(f.files.size).toBe(360);
  });
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
