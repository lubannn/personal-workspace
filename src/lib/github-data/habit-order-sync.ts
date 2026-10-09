import { GitHubContentsAdapter, GitHubDataError } from "./github-contents";
import { activeHabits, reorderHabits, type HabitRecord } from "./habits";
import { serializeRecord } from "./protocol";

type HabitFile = { record: HabitRecord; path: string; blobSha: string };
type OrderAdapter = Pick<GitHubContentsAdapter, "readBranchSnapshot" | "readText" | "writeAtomicFiles">;
export type HabitOrderSnapshot = {
  order: readonly string[] | null;
  status: "idle" | "pending" | "saving" | "saved" | "error";
  error?: unknown;
};
export const IDLE_HABIT_ORDER: HabitOrderSnapshot = { order: null, status: "idle" };

export async function saveHabitOrder(adapter: OrderAdapter, items: HabitFile[], order: readonly string[], isCurrent: () => boolean) {
  const assertCurrent = async () => { if (!isCurrent()) throw new Error("HABIT_ORDER_CANCELLED"); };
  await assertCurrent();
  const changed = reorderHabits(items.map((item) => item.record), order);
  if (!changed.length) return [];
  const byId = new Map(items.map((item) => [item.record.id, item]));
  const snapshot = await adapter.readBranchSnapshot();
  await assertCurrent();
  const activeFiles = activeHabits(items.map((item) => item.record)).map((record) => byId.get(record.id)!);
  const latest = await Promise.all(activeFiles.map((item) => adapter.readText(item.path, snapshot.headCommitSha)));
  await assertCurrent();
  if (latest.some((file, index) => file.blobSha !== activeFiles[index]!.blobSha)) {
    throw new GitHubDataError("Habit order changed on another device.", 409, "GITHUB_SYNC_CONFLICT");
  }
  const result = await adapter.writeAtomicFiles({
    files: changed.map((record) => ({ path: byId.get(record.id)!.path, text: serializeRecord(record) })),
    message: "habit: reorder",
    expectedHeadCommitSha: snapshot.headCommitSha,
    baseTreeSha: snapshot.rootTreeSha,
    inlineContent: true,
    beforeRefUpdate: assertCurrent,
  });
  await assertCurrent();
  return changed.map((record) => {
    const path = byId.get(record.id)!.path;
    return { record, path, blobSha: result.files.find((file) => file.path === path)!.blobSha };
  });
}

/** Keep the desired order separate from acknowledged records until a batch saves. */
export class HabitOrderQueue {
  private snapshot: HabitOrderSnapshot = IDLE_HABIT_ORDER;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private disposed = false;

  constructor(private items: HabitFile[], private options: {
    save: (items: HabitFile[], order: readonly string[], isCurrent: () => boolean) => Promise<HabitFile[]>;
    isCurrent: () => boolean;
    onChange: (snapshot: HabitOrderSnapshot) => void;
    onSaved: (items: HabitFile[]) => void;
    delay?: number;
  }) {}

  getSnapshot() { return this.snapshot; }
  private isCurrent = () => !this.disposed && this.options.isCurrent();
  private publish(snapshot: HabitOrderSnapshot) {
    this.snapshot = snapshot;
    if (!this.disposed) this.options.onChange(snapshot);
  }
  private schedule() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.options.delay ?? 450);
  }

  move(id: string, direction: "up" | "down") {
    if (this.disposed) return;
    const order = [...(this.snapshot.order ?? activeHabits(this.items.map((item) => item.record)).map((record) => record.id))];
    const index = order.indexOf(id);
    const target = index + (direction === "up" ? -1 : 1);
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target]!, order[index]!];
    this.publish({ order, status: this.running ? "saving" : "pending" });
    this.schedule();
  }

  retry() {
    if (this.snapshot.status === "error") void this.flush();
  }

  discard() {
    // An in-flight commit cannot be discarded safely; this is a failure recovery action.
    if (this.running || this.disposed) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.publish(IDLE_HABIT_ORDER);
  }

  dispose() {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async flush() {
    if (this.running || this.disposed || !this.snapshot.order) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const order = this.snapshot.order;
    const persisted = activeHabits(this.items.map((item) => item.record)).map((record) => record.id);
    if (sameOrder(order, persisted)) {
      this.publish({ order: null, status: "saved" });
      return;
    }
    this.running = true;
    this.publish({ order, status: "saving" });
    try {
      const saved = await this.options.save(this.items, order, this.isCurrent);
      if (!this.isCurrent()) return;
      const byId = new Map(saved.map((item) => [item.record.id, item]));
      this.items = this.items.map((item) => byId.get(item.record.id) ?? item);
      this.options.onSaved(saved);
      if (sameOrder(this.snapshot.order!, order)) this.publish({ order: null, status: "saved" });
      else {
        this.publish({ order: this.snapshot.order, status: "pending" });
        this.schedule();
      }
    } catch (error) {
      if (!this.disposed) {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        this.publish({ order: this.snapshot.order, status: "error", error });
      }
    } finally { this.running = false; }
  }
}

function sameOrder(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
