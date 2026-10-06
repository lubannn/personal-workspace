"use client";

import { useCallback, useRef, useState, type MutableRefObject } from "react";
import type { GitHubContentsAdapter } from "../../../../src/lib/github-data/github-contents";
import { readTravelVisits, writeTravelVisit, type SyncedTravelVisit } from "../../../../src/lib/github-data/travel-sync";
import type { TravelVisitFields } from "../../../../src/lib/github-data/travel-visits";
import { friendlyError, type Connection } from "./page-model";

export function useTravelVisits(adapterRef: MutableRefObject<GitHubContentsAdapter | null>, connection: Connection | null, online: boolean | null) {
  const [files, setFiles] = useState<SyncedTravelVisit[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const operationRef = useRef<object | null>(null);
  const requestRef = useRef(0);
  const clear = useCallback(() => {
    requestRef.current++;
    operationRef.current = null;
    setFiles([]); setReady(false); setLoading(false); setSaving(false); setError("");
  }, []);
  const load = useCallback(async (adapter = adapterRef.current) => {
    if (!adapter || !connection || operationRef.current) return false;
    const request = ++requestRef.current;
    const operation = {};
    operationRef.current = operation;
    setLoading(true); setError("");
    try {
      const records = await readTravelVisits(adapter, connection.ownerId);
      if (adapterRef.current !== adapter || requestRef.current !== request) return false;
      setFiles(records); setReady(true);
      return true;
    } catch (cause) {
      if (adapterRef.current === adapter && requestRef.current === request) {
        setReady(false);
        setError(cause instanceof Error && cause.message === "TRAVEL_SNAPSHOT_CHANGED" ? "旅游记录在读取期间发生变化，请刷新核对。" : travelError(cause));
      }
      return false;
    } finally {
      if (operationRef.current === operation) { operationRef.current = null; setLoading(false); }
    }
  }, [adapterRef, connection]);
  async function mutate(input: Parameters<typeof writeTravelVisit>[2]) {
    const adapter = adapterRef.current;
    if (!adapter || !connection || online === false || !ready || operationRef.current) return false;
    const operation = {};
    operationRef.current = operation;
    const request = ++requestRef.current;
    setSaving(true); setError("");
    try {
      const file = await writeTravelVisit(adapter, connection.ownerId, input);
      if (adapterRef.current !== adapter || requestRef.current !== request) return false;
      setFiles(previous => [...previous.filter(item => item.record.id !== file.record.id), file]);
      return true;
    } catch (cause) {
      if (adapterRef.current === adapter && requestRef.current === request) setError(travelError(cause));
      return false;
    } finally {
      if (operationRef.current === operation) { operationRef.current = null; setSaving(false); }
    }
  }
  return { files: connection ? files : [], loading, ready, saving, error, clear, load,
    save: (fields: TravelVisitFields, current?: SyncedTravelVisit) => mutate({ kind: "save", fields, current }),
    remove: (current: SyncedTravelVisit) => mutate({ kind: "delete", current }),
    restore: (current: SyncedTravelVisit) => mutate({ kind: "restore", current }),
  };
}

function travelError(cause: unknown) {
  if (cause instanceof Error && (cause.message === "INVALID_TRAVEL_VISIT" || cause.message === "UNSUPPORTED_OR_INVALID_RECORD" || cause instanceof SyntaxError)) return "旅游记录无效，请检查省份、城市和日期；未保存。";
  return friendlyError(cause);
}
