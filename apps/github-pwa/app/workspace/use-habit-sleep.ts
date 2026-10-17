"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { GitHubContentsAdapter } from "../../../../src/lib/github-data/github-contents";
import { HealthArchiveReader } from "./health-archive-reader";
import { friendlyError, type Connection, type SyncedSleepSession } from "./page-model";

/** The habit panel reads recent evidence independently of the health panel's selected month. */
export function useHabitSleep(adapterRef: MutableRefObject<GitHubContentsAdapter | null>, connection: Connection | null, today: string, enabled: boolean) {
  const [sessions, setSessions] = useState<SyncedSleepSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    const adapter = adapterRef.current;
    if (!adapter || !connection || !today) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const reader = new HealthArchiveReader(adapter, connection.timezone);
    const current = () => !controller.signal.aborted && adapterRef.current === adapter;
    setLoading(true); setError("");
    try {
      const snapshot = await reader.loadRecent(today, { refresh: true, signal: controller.signal });
      if (current()) setSessions(snapshot.sleepSessions);
    } catch (cause) {
      if (current()) { setSessions([]); setError(`睡眠记录读取失败：${friendlyError(cause)}`); }
    } finally {
      reader.dispose();
      if (current()) { setLoading(false); request.current = null; }
    }
  }, [adapterRef, connection, today]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setSessions([]); setError(""); setLoading(false);
      if (enabled) void refresh();
    });
    return () => { active = false; request.current?.abort(); };
  }, [enabled, refresh]);
  return { sessions, loading, error, refresh };
}
