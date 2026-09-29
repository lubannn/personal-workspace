import { describe, expect, it, vi } from "vitest";

import { GitHubDataError, type GitHubContentsAdapter } from "./github-contents";
import { prepareLegacyJournalAtomicPayload, readLegacyJournalScopedPlanningSnapshot } from "./legacy-journal-atomic-writer";
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
