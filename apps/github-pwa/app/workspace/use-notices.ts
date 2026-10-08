"use client";

import { useCallback, useRef, useState, type MutableRefObject } from "react";
import type { GitHubContentsAdapter } from "../../../../src/lib/github-data/github-contents";
import { readNotices, writeNotice, type SyncedNotice, type NoticeMutation } from "../../../../src/lib/github-data/notice-sync";
import { GitHubDataError } from "../../../../src/lib/github-data/github-contents";
import { friendlyError, type Connection } from "./page-model";

export function useNotices(adapterRef: MutableRefObject<GitHubContentsAdapter | null>, connection: Connection | null, online: boolean | null) {
  const [files, setFiles] = useState<SyncedNotice[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const operationRef = useRef<object | null>(null);
  const requestRef = useRef(0);
  const submissionRef = useRef<{ fingerprint: string; id: string; timestamp: string } | null>(null);
  const clear = useCallback(() => {
    requestRef.current++;
    submissionRef.current = null;
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
      const records = await readNotices(adapter, connection.ownerId);
      if (adapterRef.current !== adapter || requestRef.current !== request) return false;
      setFiles(records); setReady(true);
      return true;
    } catch (cause) {
      if (adapterRef.current === adapter && requestRef.current === request) {
        setReady(false);
        setError(cause instanceof Error && cause.message === "NOTICE_SNAPSHOT_CHANGED" ? "通告在读取期间发生变化，请刷新核对。" : noticeError(cause));
      }
      return false;
    } finally {
      if (operationRef.current === operation) { operationRef.current = null; setLoading(false); }
    }
  }, [adapterRef, connection]);
  async function mutate(input: NoticeMutation) {
    const adapter = adapterRef.current;
    if (!adapter || !connection || online === false || !ready || operationRef.current) return false;
    const operation = {};
    operationRef.current = operation;
    const request = ++requestRef.current;
    setSaving(true); setError("");
    try {
      const fingerprint = JSON.stringify({ ownerId: connection.ownerId, repository: connection.repository, input });
      if (submissionRef.current?.fingerprint !== fingerprint) submissionRef.current = { fingerprint, id: `notice_${crypto.randomUUID()}`, timestamp: new Date().toISOString() };
      const submission = submissionRef.current;
      const file = await writeNotice(adapter, connection.ownerId, { ...input, ...submission });
      if (adapterRef.current !== adapter || requestRef.current !== request) return false;
      submissionRef.current = null;
      setFiles(previous => [...previous.filter(item => item.record.id !== file.record.id), file]);
      return true;
    } catch (cause) {
      if (adapterRef.current === adapter && requestRef.current === request) setError(noticeError(cause));
      return false;
    } finally {
      if (operationRef.current === operation) { operationRef.current = null; setSaving(false); }
    }
  }
  return { files: connection ? files : [], loading, ready, saving, error, clear, load,
    save: (body: string, current?: SyncedNotice) => mutate({ kind: "save", body, current }),
    remove: (current: SyncedNotice) => mutate({ kind: "delete", current }),
    restore: (current: SyncedNotice) => mutate({ kind: "restore", current }),
  };
}

function noticeError(cause: unknown) {
  if (cause instanceof GitHubDataError && cause.code === "GITHUB_SYNC_CONFLICT") return "通告已在其他设备更新，未覆盖。请刷新核对后重新打开编辑；当前输入已保留。";
  if (cause instanceof Error && (cause.message === "INVALID_NOTICE" || cause.message === "UNSUPPORTED_OR_INVALID_RECORD" || cause instanceof SyntaxError)) return "通告内容或记录无效，未保存。";
  return friendlyError(cause);
}
