import { afterEach, describe, expect, it, vi } from "vitest";
import { HabitOrderQueue, saveHabitOrder, type HabitOrderSnapshot } from "./habit-order-sync";
import { activeHabits, createHabitData, reorderHabits } from "./habits";
import { createWorkspaceRecord, serializeRecord } from "./protocol";

function fixture() {
  vi.useFakeTimers();
  let items = ["A", "B", "C", "D"].map((name, index) => {
    const record = createWorkspaceRecord({ entityType: "habit", id: `habit_${name}`, ownerId: "owner_test", timestamp: "2026-10-09T00:00:00.000Z", data: createHabitData({
      name, description_markdown: "", schedule_json: { frequency: "daily", weekdays: [] }, timezone: "Asia/Shanghai",
      tracking_type: "boolean", target_json: { value: 1, unit: null }, automation_mode: "manual", start_date: "2026-10-01", end_date: null,
    }, index) });
    return { record, path: `data/habits/${record.id}.json`, blobSha: `initial-${index}` };
  });
  const remote = new Map(items.map((item) => [item.path, { text: serializeRecord(item.record), blobSha: item.blobSha, path: item.path }]));
  let revision = 0;
  let current = true;
  const readBranchSnapshot = vi.fn(async () => ({ branch: "main", headCommitSha: `head-${revision}`, rootTreeSha: `tree-${revision}` }));
  const readText = vi.fn(async (path: string, ref?: string) => { if (!ref) throw new Error("EXPECTED_PINNED_READ"); return { ...remote.get(path)!, sizeBytes: 1 }; });
  const writeAtomicFiles = vi.fn(async (input: Parameters<Parameters<typeof saveHabitOrder>[0]["writeAtomicFiles"]>[0]) => {
    await input.beforeRefUpdate?.();
    revision++;
    const files = input.files.map((file, index) => {
      const saved = { ...file, blobSha: `saved-${revision}-${index}` };
      remote.set(file.path, saved);
      return { path: file.path, blobSha: saved.blobSha };
    });
    return { files, commitSha: `head-${revision}`, treeSha: `tree-${revision}` };
  });
  const adapter = { readBranchSnapshot, readText, writeAtomicFiles };
  const snapshots: HabitOrderSnapshot[] = [];
  const save = vi.fn((files, order, isCurrent) => saveHabitOrder(adapter, files, order, isCurrent));
  const onSaved = vi.fn((saved: typeof items) => {
    const byId = new Map(saved.map((item) => [item.record.id, item]));
    items = items.map((item) => byId.get(item.record.id) ?? item);
  });
  const queue = new HabitOrderQueue(items, { save, isCurrent: () => current, onSaved, onChange: (snapshot) => snapshots.push(snapshot) });
  return { queue, adapter, remote, save, snapshots, onSaved, items: () => items, disconnect: () => { current = false; } };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const ids = (names: string) => names.split("").map((name) => `habit_${name}`);
const savedIds = (f: ReturnType<typeof fixture>) => activeHabits(f.items().map((item) => item.record)).map((record) => record.id);
afterEach(() => { vi.useRealTimers(); });

describe("Instant habit ordering with serialized background saves", () => {
  it("moves immediately and coalesces rapid clicks into a single versioned atomic save", async () => {
    const f = fixture();
    f.queue.move("habit_D", "up");
    expect(f.queue.getSnapshot()).toMatchObject({ order: ids("ABDC"), status: "pending" });
    expect(f.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    f.queue.move("habit_D", "up");
    f.queue.move("habit_D", "up");
    expect(f.queue.getSnapshot().order).toEqual(ids("DABC"));
    await vi.advanceTimersByTimeAsync(449);
    expect(f.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.save).toHaveBeenCalledOnce();
    expect(savedIds(f)).toEqual(ids("DABC"));
    expect(f.items().every((item) => item.record.version === 2)).toBe(true);
    expect(f.queue.getSnapshot()).toEqual({ order: null, status: "saved" });
    const write = f.adapter.writeAtomicFiles.mock.calls[0]![0];
    expect(write).toMatchObject({ inlineContent: true, expectedHeadCommitSha: "head-0", baseTreeSha: "tree-0" });
    expect(f.adapter.readText.mock.calls.every((call) => call[1] === "head-0")).toBe(true);
  });

  it("accepts further clicks during a slow save without reverting the latest order or overlapping writes", async () => {
    const f = fixture(); const gate = deferred();
    const write = f.adapter.writeAtomicFiles.getMockImplementation()!;
    f.adapter.writeAtomicFiles.mockImplementationOnce(async (input) => { await gate.promise; return write(input); });
    f.queue.move("habit_C", "up");
    await vi.advanceTimersByTimeAsync(450);
    expect(f.queue.getSnapshot()).toMatchObject({ order: ids("ACBD"), status: "saving" });
    f.queue.move("habit_C", "up");
    f.queue.move("habit_D", "up");
    expect(f.queue.getSnapshot().order).toEqual(ids("CADB"));
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.save).toHaveBeenCalledOnce();
    gate.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(savedIds(f)).toEqual(ids("ACBD"));
    expect(f.queue.getSnapshot()).toMatchObject({ order: ids("CADB"), status: "pending" });
    await vi.advanceTimersByTimeAsync(450);
    expect(f.save).toHaveBeenCalledTimes(2);
    expect(savedIds(f)).toEqual(ids("CADB"));
    expect(f.queue.getSnapshot()).toEqual({ order: null, status: "saved" });
    expect(f.items().find((item) => item.record.id === "habit_C")!.record.version).toBe(3);
  });

  it("skips a save when moves return to the acknowledged order", async () => {
    const f = fixture();
    f.queue.move("habit_A", "up");
    f.queue.move("habit_D", "down");
    expect(f.queue.getSnapshot().order).toBeNull();
    f.queue.move("habit_B", "up");
    f.queue.move("habit_B", "down");
    await vi.advanceTimersByTimeAsync(450);
    expect(f.save).not.toHaveBeenCalled();
    expect(savedIds(f)).toEqual(ids("ABCD"));
  });

  it("retains the newest order on failure and saves it on retry", async () => {
    const f = fixture(); const gate = deferred();
    f.adapter.writeAtomicFiles.mockImplementationOnce(async () => { await gate.promise; throw new Error("offline"); });
    f.queue.move("habit_C", "up"); await vi.advanceTimersByTimeAsync(450);
    f.queue.move("habit_C", "up");
    gate.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(f.queue.getSnapshot()).toMatchObject({ order: ids("CABD"), status: "error" });
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.save).toHaveBeenCalledOnce();
    expect(savedIds(f)).toEqual(ids("ABCD"));
    f.queue.retry(); await vi.advanceTimersByTimeAsync(0);
    expect(savedIds(f)).toEqual(ids("CABD"));
    expect(f.queue.getSnapshot()).toEqual({ order: null, status: "saved" });
  });

  it("does not overwrite another device's habit changes, and allows discarding a failed adjustment", async () => {
    const f = fixture();
    f.queue.move("habit_B", "up");
    f.remote.get(f.items()[0]!.path)!.blobSha = "other-device-sha";
    await vi.advanceTimersByTimeAsync(450);
    expect(f.queue.getSnapshot()).toMatchObject({ order: ids("BACD"), status: "error", error: { code: "GITHUB_SYNC_CONFLICT" } });
    expect(f.adapter.writeAtomicFiles).not.toHaveBeenCalled();
    f.queue.discard();
    expect(f.queue.getSnapshot()).toEqual({ order: null, status: "idle" });
    expect(savedIds(f)).toEqual(ids("ABCD"));
  });

  it("cancels queued saves on disposal and guards a disconnected in-flight commit", async () => {
    const canceled = fixture();
    canceled.queue.move("habit_B", "up"); canceled.queue.dispose();
    await vi.advanceTimersByTimeAsync(450);
    expect(canceled.save).not.toHaveBeenCalled();
    const f = fixture(); const gate = deferred();
    const write = f.adapter.writeAtomicFiles.getMockImplementation()!;
    f.adapter.writeAtomicFiles.mockImplementationOnce(async (input) => { await gate.promise; return write(input); });
    f.queue.move("habit_B", "up"); await vi.advanceTimersByTimeAsync(450);
    f.disconnect(); gate.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(f.onSaved).not.toHaveBeenCalled();
    expect(f.remote.get(f.items()[0]!.path)!.blobSha).toBe("initial-0");
    expect(f.queue.getSnapshot().status).toBe("error");
  });

  it("rejects incomplete or duplicate orders before making network requests", async () => {
    const f = fixture();
    expect(() => reorderHabits(f.items().map((item) => item.record), ids("AABC"))).toThrow("INVALID_HABIT_ORDER");
    await expect(saveHabitOrder(f.adapter, f.items(), ids("AB"), () => true)).rejects.toThrow("INVALID_HABIT_ORDER");
    expect(f.adapter.readBranchSnapshot).not.toHaveBeenCalled();
  });
});
