"use client";

import { useId } from "react";
import { captureBody } from "../../../../src/lib/github-data/capture-details";

export type IdeaComposerProps = {
  text: string;
  connected: boolean;
  online: boolean | null;
  saving: boolean;
  storageFailed: boolean;
  disabled?: boolean;
  loading?: boolean;
  onChange: (text: string) => void;
  onSave: () => Promise<boolean>;
  onClear: () => void;
};

export function IdeaComposer({ text, connected, online, saving, storageFailed, disabled = false, loading = false, onChange, onSave, onClear }: IdeaComposerProps) {
  const id = useId();
  const canSave = connected && online !== false && !saving && !disabled && !loading && text.length <= 10_000 && Boolean(captureBody(text));
  return <form className="idea-composer" aria-label="新增想法" onSubmit={async (event) => { event.preventDefault(); if (canSave) await onSave(); }}>
    <label htmlFor={`${id}-idea`}>写下想法</label>
    <textarea id={`${id}-idea`} value={text} rows={3} maxLength={10_000} placeholder="灵感、计划、值得琢磨的事，都可以先写在这里…" disabled={saving || disabled} aria-describedby={`${id}-hint`} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing && event.keyCode !== 229) {
        event.preventDefault(); if (canSave) event.currentTarget.form?.requestSubmit();
      }
    }} />
    <div className="idea-composer-footer"><p id={`${id}-hint`}>{disabled ? "请先完成或取消当前想法的编辑。" : !connected ? "连接后可保存，草稿暂存在此设备。" : online === false ? "当前离线，草稿已保留，联网后可保存。" : loading ? "正在读取想法，完成后可保存新想法。" : "直接保存到想法 · Enter 换行 · ⌘ / Ctrl+Enter 保存"}</p>
      <div><button type="button" className="view-button" disabled={saving || disabled || !text} onClick={onClear}>清空</button><button type="submit" className="primary-button" disabled={!canSave}>{saving ? "正在保存…" : "保存想法"}</button></div>
    </div>
    {storageFailed ? <p className="capture-hint" role="alert">本机想法草稿保存失败，内容暂留此页面，请复制备份。</p> : null}
  </form>;
}
