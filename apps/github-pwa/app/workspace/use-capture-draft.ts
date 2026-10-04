"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { CAPTURE_KINDS, isCaptureDate, isCaptureTime, type CaptureKind } from "../../../../src/lib/github-data/capture-details";

export type CaptureDraft = { text: string; kind: CaptureKind | "auto"; date: string | null; time: string | null; endTime: string | null };
const EMPTY: CaptureDraft = { text: "", kind: "auto", date: null, time: null, endTime: null };
const EVENT = "pw-pwa-capture-draft";
const memory = new Map<string, string>();
const failed = new Set<string>();

export function parseCaptureDraft(value: string): CaptureDraft {
  try {
    const item = JSON.parse(value);
    if (!item || typeof item.text !== "string" || item.text.length > 10_000
      || (item.kind !== "auto" && !CAPTURE_KINDS.includes(item.kind))
      || (item.date !== null && item.date !== "" && !isCaptureDate(item.date))
      || (item.time !== null && item.time !== "" && !isCaptureTime(item.time))) return EMPTY;
    if (item.endTime != null && item.endTime !== "" && !isCaptureTime(item.endTime)) return EMPTY;
    return { text: item.text, kind: item.kind, date: item.date, time: item.time, endTime: item.endTime ?? null };
  } catch { return EMPTY; }
}

// Only unsent drafts are stored locally. Repository records and credentials never enter this store.
export function useCaptureDraft(scope: string) {
  const key = `pw.pwa.capture-draft:${scope}`;
  const read = useCallback(() => {
    if (memory.has(key)) return memory.get(key)!;
    try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
  }, [key]);
  const subscribe = useCallback((notify: () => void) => {
    const storage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) { memory.delete(key); failed.delete(key); notify(); }
    };
    window.addEventListener(EVENT, notify);
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener(EVENT, notify); window.removeEventListener("storage", storage); };
  }, [key]);
  const raw = useSyncExternalStore(subscribe, read, () => "");
  const storageFailed = useSyncExternalStore(subscribe, () => failed.has(key), () => false);
  const draft = useMemo(() => parseCaptureDraft(raw), [raw]);
  const updateDraft = useCallback((patch: Partial<CaptureDraft>) => {
    const value = JSON.stringify({ ...parseCaptureDraft(read()), ...patch });
    memory.set(key, value);
    try { localStorage.setItem(key, value); failed.delete(key); } catch { failed.add(key); }
    window.dispatchEvent(new Event(EVENT));
  }, [key, read]);
  const clearDraft = useCallback((expected?: CaptureDraft) => {
    if (expected && JSON.stringify(parseCaptureDraft(read())) !== JSON.stringify(expected)) return;
    memory.set(key, "");
    try { localStorage.removeItem(key); failed.delete(key); } catch { failed.add(key); }
    window.dispatchEvent(new Event(EVENT));
  }, [key, read]);
  return { draft, updateDraft, clearDraft, storageFailed };
}
