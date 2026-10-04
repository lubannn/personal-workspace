"use client";

import { useId } from "react";
import { CAPTURE_KINDS, CAPTURE_KIND_LABELS, type CaptureFields, type CaptureSuggestion } from "../../../../src/lib/github-data/capture-details";
import { CAPTURE_DESTINATIONS } from "../../../../src/lib/github-data/capture-routing";
import { captureBody } from "../../../../src/lib/github-data/capture-details";
import type { CaptureDraft } from "./use-capture-draft";

export function CaptureComposer({ draft, fields, suggestion, saving, connected, online, storageFailed, onChange, onSave, onClear }: {
  draft: CaptureDraft; fields: CaptureFields; suggestion: CaptureSuggestion; saving: boolean; connected: boolean;
  online: boolean | null; storageFailed: boolean; onChange: (patch: Partial<CaptureDraft>) => void; onSave: () => void; onClear: () => void;
}) {
  const id = useId();
  const canSave = connected && online !== false && !saving && Boolean(captureBody(draft.text)) && !(fields.time && !fields.date)
    && !(["schedule", "deadline"].includes(fields.kind) && !fields.date)
    && !(fields.kind === "schedule" && fields.endTime && fields.endTime === fields.time)
    && !(["schedule", "deadline"].includes(fields.kind) && suggestion.warning === "时间无效，请手动选择。" && draft.time === null)
    && !(["schedule", "deadline"].includes(fields.kind) && suggestion.warning === "日期无效，请手动选择。" && draft.date === null);
  return (
    <form className="widget-capture capture-composer" onSubmit={(event) => { event.preventDefault(); if (canSave) onSave(); }}>
      <div className="capture-kind-options" aria-label="随手记分类">
        {(["auto", ...CAPTURE_KINDS] as const).map((kind) => <button key={kind} className={`view-button ${draft.kind === kind ? "active" : ""}`} type="button" aria-pressed={draft.kind === kind} disabled={saving} onClick={() => onChange({ kind })}>{kind === "auto" ? "自动识别" : CAPTURE_KIND_LABELS[kind]}</button>)}
      </div>
      <label className="visually-hidden" htmlFor={`${id}-text`}>随手记内容</label>
      <textarea id={`${id}-text`} value={draft.text} onChange={(event) => onChange({ text: event.target.value })} placeholder="明天十点开会、买牛奶、日记：今天的事…" maxLength={10_000} disabled={saving} aria-describedby={`${id}-hint`} onKeyDown={(event) => {
        if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229 || event.shiftKey || event.altKey) return;
        // Plain Enter saves a single line; multiline drafts keep normal Enter, with Cmd/Ctrl+Enter to save.
        if (event.metaKey || event.ctrlKey || !draft.text.includes("\n")) { event.preventDefault(); if (canSave) event.currentTarget.form?.requestSubmit(); }
      }} />
      <div className="capture-datetime">
        <label>日期<input type="date" value={fields.date ?? ""} disabled={saving} onChange={(event) => onChange({ date: event.target.value })} /></label>
        {fields.kind !== "journal" ? <label>时间<input type="time" value={fields.time ?? ""} disabled={saving} onChange={(event) => onChange({ time: event.target.value })} /></label> : null}
        {fields.kind === "schedule" && fields.time ? <label>结束<input type="time" value={fields.endTime ?? ""} disabled={saving} onChange={(event) => onChange({ endTime: event.target.value })} /></label> : null}
        <button className="view-button" type="button" disabled={saving} onClick={() => onChange({ date: null, time: null, endTime: null })}>重新识别日期</button>
      </div>
      <p id={`${id}-hint`} className="capture-hint" aria-live="polite">{draft.text.trim() ? `将进入${CAPTURE_DESTINATIONS[fields.kind]}${fields.date ? ` · ${fields.date}` : ""}${fields.time ? ` ${fields.time}` : ""}。` : "单行 Enter 保存 · Shift+Enter 换行 · ⌘ / Ctrl+Enter 保存多行。"}</p>
      {draft.text.trim() ? <p className="capture-hint">{draft.kind === "auto" ? suggestion.reason : "使用你手动选择的分类"}{fields.kind === "schedule" ? fields.time ? fields.endTime ? ` · 时间段 ${fields.time}–${fields.endTime}${fields.endTime < fields.time ? "（次日结束）" : ""}` : " · 未填写结束时间，按 1 小时保存" : " · 未写时间，按全天日程保存" : ""}。</p> : null}
      {["schedule", "deadline"].includes(fields.kind) && !fields.date ? <p className="capture-hint">请选择日期后保存，或切换到随记。</p> : null}
      {suggestion.warning ? <p className="capture-hint">{suggestion.warning}</p> : null}
      {fields.kind === "schedule" && fields.time && fields.endTime === fields.time ? <p className="capture-hint">开始和结束时间不能相同。</p> : null}
      {fields.time && !fields.date ? <p className="capture-hint">请选择日期，或清除时间后保存。</p> : null}
      <p className="capture-hint" role="status">{storageFailed ? "本机草稿保存失败，内容暂留此页面，请复制备份。" : draft.text ? "未提交草稿已暂存在此设备。" : "草稿仅暂存在此设备。"}{!connected ? " 连接后可同步保存。" : online === false ? " 当前离线，联网后可同步保存。" : ""}</p>
      <footer><span>{draft.text.length.toLocaleString("zh-CN")} / 10,000</span><div className="capture-submit-actions"><button className="view-button" type="button" disabled={saving || !draft.text} onClick={() => onClear()}>清空草稿</button><button className="primary-button" type="submit" disabled={!canSave}>{saving ? "正在保存…" : `保存到${CAPTURE_DESTINATIONS[fields.kind]}` }</button></div></footer>
    </form>
  );
}
