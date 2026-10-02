import { describe, expect, it, vi } from "vitest";

import { GitHubDataError, type GitHubContentsAdapter } from "./github-contents";
import { prepareLegacyJournalAtomicPayload, readLegacyJournalBatchHistory, readLegacyJournalScopedPlanningSnapshot } from "./legacy-journal-atomic-writer";
import { buildLegacyJournalDateBatches } from "./legacy-journal-batches";
import { buildLegacyJournalCommitPlan } from "./legacy-journal-commit-plan";
import { isLegacyJournalSourceFullyImported } from "./legacy-journal-import-status";
import { previewLegacyJournalText } from "./legacy-text-preview";
import { recordPath, serializeRecord } from "./protocol";

const head = "a".repeat(40);
const blob = "b".repeat(40);

async function fixture() {
  const source = ["2026年08月的日记", "八", "31", "12:30", "测试正文。", "< 08月 ><< 2026 >>"].join("\n");
  const bytes = new TextEncoder().encode(source);
  const preview = await previewLegacyJournalText({
    name: "Dairy.txt", size: bytes.length, lastModified: 0, arrayBuffer: async () => bytes.slice().buffer,
  }, { timezone: "Asia/Shanghai" });
  const plan = await buildLegacyJournalCommitPlan({
    preview, ownerId: "github_owner", expectedHeadCommitSha: head, selectedDates: ["2026-08-31"],
    existing: { entries: [], revisions: [], segments: [] }, plannedAt: "2026-09-01T00:00:00.000Z",
  });
  const payload = await prepareLegacyJournalAtomicPayload(plan);
  return { preview, plan, payload };
}

function adapterFor(files: Map<string, string>, indexed = false) {
  const entry = [...files.entries()].find(([path]) => path.startsWith("data/journal-entries/"));
  if (indexed && entry) {
    files.set("data/journal-history-index.json", JSON.stringify({ kind: "legacy_journal_entry_index", entries: [{ path: entry[0], blobSha: blob, record: JSON.parse(entry[1]) }] }));
  }
  const readText = vi.fn(async (path: string) => {
    const text = files.get(path);
    if (!text) throw new GitHubDataError("missing", 404, "GITHUB_NOT_FOUND");
    return { path, text, blobSha: blob, sizeBytes: text.length };
  });
  const adapter = {
    readBranchSnapshot: async () => ({ branch: "main", headCommitSha: head, rootTreeSha: "c".repeat(40) }),
    listDirectory: async (directory: string) => [...files.entries()].filter(([path]) => path.startsWith(`${directory}/`))
      .map(([path, text]) => ({ type: "file" as const, name: path.slice(directory.length + 1), path, blobSha: blob, sizeBytes: text.length })),
    readText,
  } as unknown as GitHubContentsAdapter;
  return { adapter, readText };
}

describe("Legacy Journal scoped remote reads", () => {
  it("skips the successfully committed first batch and plans the remaining dates", async () => {
    const source = ["2026年09月的日记"];
    for (let day = 1; day <= 30; day += 1) {
      source.push("九", String(day));
      for (let index = 0; index < 10; index += 1) source.push(`12:${String(index).padStart(2, "0")}`, `第 ${day} 天第 ${index} 条。`);
    }
    source.push("< 09月 ><< 2026 >>");
    const bytes = new TextEncoder().encode(source.join("\n"));
    const preview = await previewLegacyJournalText({
      name: "September.txt", size: bytes.length, lastModified: 0, arrayBuffer: async () => bytes.slice().buffer,
    }, { timezone: "Asia/Shanghai" });
    expect(preview.parse.entries).toHaveLength(30);
    const batches = buildLegacyJournalDateBatches(preview.parse.entries);
    expect(batches.length).toBeGreaterThan(1);
    const first = await buildLegacyJournalCommitPlan({
      preview, ownerId: "github_owner", expectedHeadCommitSha: head, selectedDates: batches[0]!.dates,
      existing: { entries: [], revisions: [], segments: [] }, plannedAt: "2026-10-01T00:00:00.000Z",
    });
    const payload = await prepareLegacyJournalAtomicPayload(first);
    const { adapter } = adapterFor(new Map(payload.files.map((file) => [file.path, file.text])));
    const snapshot = await readLegacyJournalScopedPlanningSnapshot(adapter, preview.parse.entries.map((entry) => entry.date));
    await expect(isLegacyJournalSourceFullyImported(adapter, preview, snapshot)).resolves.toBe(false);
    const completed = await buildLegacyJournalCommitPlan({
      preview, ownerId: "github_owner", expectedHeadCommitSha: head, selectedDates: batches[0]!.dates,
      existing: await readLegacyJournalBatchHistory(adapter, snapshot, batches[0]!.dates), plannedAt: "2026-10-01T01:00:00.000Z",
    });
    expect(completed.summary).toMatchObject({ pending: 0, conflicts: 0, alreadyImported: batches[0]!.dates.length });
    const remaining = await buildLegacyJournalCommitPlan({
      preview, ownerId: "github_owner", expectedHeadCommitSha: head, selectedDates: batches[1]!.dates,
      existing: await readLegacyJournalBatchHistory(adapter, snapshot, batches[1]!.dates), plannedAt: "2026-10-01T01:00:00.000Z",
    });
    expect(remaining.commitReady).toBe(true);
    expect(remaining.summary.pending).toBe(batches[1]!.dates.length);
    expect(remaining.selectedDates.some((date) => first.selectedDates.includes(date))).toBe(false);
  });

  it("still blocks a previously imported batch when a stored segment changed", async () => {
    const { preview, plan, payload } = await fixture();
    const files = new Map(payload.files.map((file) => [file.path, file.text]));
    const segmentPath = plan.files.find((file) => file.entityType === "journal_segment")!.path;
    const changed = JSON.parse(files.get(segmentPath)!);
    changed.data.body_markdown = "修改过的正文。";
    files.set(segmentPath, JSON.stringify(changed));
    const { adapter } = adapterFor(files);
    const snapshot = await readLegacyJournalScopedPlanningSnapshot(adapter, plan.selectedDates);
    const retry = await buildLegacyJournalCommitPlan({
      preview, ownerId: "github_owner", expectedHeadCommitSha: head, selectedDates: plan.selectedDates,
      existing: await readLegacyJournalBatchHistory(adapter, snapshot, plan.selectedDates), plannedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(retry.commitReady).toBe(false);
    expect(retry.summary.conflicts).toBe(1);
  });

  it("recognizes an already imported complete source without reading each indexed entry", async () => {
    const { preview, plan, payload } = await fixture();
    const files = new Map(payload.files.map((file) => [file.path, file.text]));
    const { adapter, readText } = adapterFor(files, true);
    const snapshot = await readLegacyJournalScopedPlanningSnapshot(adapter, ["2026-08-31"]);
    expect(snapshot.entries).toHaveLength(1);
    expect(readText.mock.calls.some(([path]) => path.startsWith("data/journal-entries/"))).toBe(false);
    await expect(isLegacyJournalSourceFullyImported(adapter, preview, snapshot)).resolves.toBe(true);
    files.delete(recordPath("journal_revision", plan.items[0]!.artifacts!.revision.id));
    const missing = await readLegacyJournalScopedPlanningSnapshot(adapter, ["2026-08-31"]);
    await expect(isLegacyJournalSourceFullyImported(adapter, preview, missing)).resolves.toBe(false);
  });

  it("reads only unindexed entries and keeps every existing path for collision checks", async () => {
    const { plan } = await fixture();
    const entry = plan.items[0]!.artifacts!.entry;
    const path = recordPath("journal_entry", entry.id);
    const { adapter, readText } = adapterFor(new Map([[path, serializeRecord(entry)]]));
    const snapshot = await readLegacyJournalScopedPlanningSnapshot(adapter, ["2026-08-31"]);
    expect(snapshot.entries.map((record) => record.id)).toEqual([entry.id]);
    expect(snapshot.existingPaths.has(path)).toBe(true);
    expect(readText.mock.calls.map(([requested]) => requested)).toContain(path);
  });
});
