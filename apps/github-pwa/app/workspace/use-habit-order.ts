"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { GitHubContentsAdapter } from "../../../../src/lib/github-data/github-contents";
import { HabitOrderQueue, IDLE_HABIT_ORDER, saveHabitOrder, type HabitOrderSnapshot } from "../../../../src/lib/github-data/habit-order-sync";
import { friendlyError, type Connection, type SyncedHabit } from "./page-model";

export function useHabitOrder(adapterRef: MutableRefObject<GitHubContentsAdapter | null>, connection: Connection | null, items: SyncedHabit[], setItems: Dispatch<SetStateAction<SyncedHabit[]>>) {
  const queueRef = useRef<{ queue: HabitOrderQueue; adapter: GitHubContentsAdapter } | null>(null);
  const [state, setState] = useState<{ connection: Connection | null; snapshot: HabitOrderSnapshot }>({ connection: null, snapshot: IDLE_HABIT_ORDER });
  const snapshot = state.connection === connection ? state.snapshot : IDLE_HABIT_ORDER;
  useEffect(() => () => { queueRef.current?.queue.dispose(); queueRef.current = null; }, [connection]);
  useEffect(() => {
    if (!snapshot.order) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [snapshot.order]);

  function move(item: SyncedHabit, direction: "up" | "down") {
    const adapter = adapterRef.current;
    if (!adapter || !connection) return;
    if (queueRef.current?.adapter !== adapter || !queueRef.current.queue.getSnapshot().order) {
      queueRef.current?.queue.dispose();
      const queue: HabitOrderQueue = new HabitOrderQueue(items, {
        save: (files, order, isCurrent) => saveHabitOrder(adapter, files, order, isCurrent),
        isCurrent: () => adapterRef.current === adapter && queueRef.current?.queue === queue,
        onChange: (next) => { if (queueRef.current?.queue === queue) setState({ connection, snapshot: next }); },
        onSaved: (saved) => {
          const byId = new Map(saved.map((file) => [file.record.id, file]));
          setItems((current) => current.map((file) => byId.get(file.record.id) ?? file));
        },
      });
      queueRef.current = { queue, adapter };
    }
    queueRef.current.queue.move(item.record.id, direction);
  }

  const displayed = useMemo(() => {
    if (!snapshot.order) return items;
    const positions = new Map(snapshot.order.map((id, index) => [id, index]));
    return items.map((item) => positions.has(item.record.id) ? {
      ...item, record: { ...item.record, data: { ...item.record.data, sort_order: positions.get(item.record.id)! } },
    } : item);
  }, [items, snapshot.order]);
  return {
    items: displayed, move, pending: snapshot.order !== null, status: snapshot.status,
    error: snapshot.status === "error" ? `${friendlyError(snapshot.error)} 当前顺序已保留，可重试；若有冲突，请取消调整后刷新。` : "",
    retry: () => queueRef.current?.queue.retry(),
    discard: () => queueRef.current?.queue.discard(),
  };
}
