"use client";

import { useEffect, useRef, useState } from "react";
import type { HabitCheckInStatus } from "../../../../src/lib/github-data/habit-check-ins";

export function SleepHabitStatusDialog({ name, date, status, disabled, onSave, onClose }: {
  name: string; date: string; status: HabitCheckInStatus | "none"; disabled: boolean;
  onSave: (status: HabitCheckInStatus) => Promise<boolean>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const busy = disabled || saving;
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  async function save(next: HabitCheckInStatus) {
    if (busy) return;
    setSaving(true); setError("");
    try {
      if (await onSave(next)) onClose();
      else setError("保存失败，请重试。");
    } catch { setError("保存失败，请重试。"); }
    finally { setSaving(false); }
  }
  const current = status === "none" ? "unknown" : status;
  return <dialog ref={dialog} className="sleep-habit-status-dialog" aria-labelledby="sleep-habit-status-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="sleep-habit-status-heading"><h3 id="sleep-habit-status-title">{name} · {date}</h3><button type="button" className="text-button" autoFocus disabled={busy} onClick={onClose}>取消</button></div>
    <p>选择打卡状态。通宵未睡时可选择“未完成”，无需睡眠记录。</p>
    <div className="sleep-habit-status-options" role="group" aria-label="打卡状态">
      {([['completed', '已完成'], ['missed', '未完成'], ['unknown', '未打卡']] as const).map(([value, label]) => <button type="button" key={value} data-status={value} aria-pressed={current === value} disabled={busy || current === value} onClick={() => void save(value)}>{label}</button>)}
    </div>
    {saving ? <p role="status">正在保存…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </dialog>;
}
