"use client";

import { useState } from "react";

type Conflict = { id: string; kind: "sleep" | "workout"; reason: string; status: "pending" | "resolved";
  scoreChange: { from: number | null; to: number | null } | null; startAt: string; endAt: string;
  existingRecordUrl: string; detailUrl: string };
function safeLink(value: string) {
  try { const url = new URL(value); return url.origin === "https://github.com" && url.pathname.startsWith("/lubannn/personal-workspace-data/blob/") ? url.href : undefined; }
  catch { return undefined; }
}
export function CorosConflicts({ count }: { count: number }) {
  const [items, setItems] = useState<Conflict[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  async function load() {
    setBusy(true); setFailed(false);
    try {
      const response = await fetch("/coros/conflicts", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json() as { total: number; items: Conflict[] };
      if (!Array.isArray(data.items) || !Number.isInteger(data.total) || data.total < 0) throw new Error();
      setPending(data.total);
      setItems(data.items);
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }
  return <div>
    <p>{(pending ?? count) > 0 ? `有 ${pending ?? count} 项差异待核对，已保留原有记录。` : "没有待核对差异。已解决差异的变更记录仍保留。"}</p>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => void load()}>{busy ? "读取中…" : "查看差异与变更记录"}</button>
    {failed ? <p role="alert">暂时无法读取差异详情，请稍后重试。</p> : null}
    {items ? <ul>{items.map(item => <li key={item.id}>
      {item.kind === "sleep" ? "睡眠" : "运动"} · {new Date(item.startAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} · {item.reason === "source_changed" ? "COROS 内容有更新" : "与现有记录时间相同"}
      {" · "}{item.status === "resolved" ? "已解决" : "待核对"}
      {item.scoreChange ? ` · 评分 ${item.scoreChange.from ?? "无"}→${item.scoreChange.to ?? "无"}` : null}
      {" · "}<a href={safeLink(item.existingRecordUrl)} target="_blank" rel="noreferrer">当前记录</a>{" · "}<a href={safeLink(item.detailUrl)} target="_blank" rel="noreferrer">差异与变更记录</a>
    </li>)}</ul> : null}
    {items?.length === 50 ? <p>此处展示前 50 项，完整差异保存在私有数据仓库。</p> : null}
  </div>;
}
