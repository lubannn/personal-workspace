import type { ConnectionMethod } from "./page-model";

type ReadinessItem = { label: string; detail: string; done: boolean };

export function ReadinessSection({ readiness, connectionMethod }: { readiness: ReadinessItem[]; connectionMethod: ConnectionMethod | null }) {
  return (
    <section className="content-grid status-grid">
      <aside className="status-card">
        <p className="eyebrow">Live readiness</p><h2>运行状态</h2>
        <ol>{readiness.map((item) => <li key={item.label} className={item.done ? "done" : "waiting"}><i>{item.done ? "✓" : "·"}</i><div><strong>{item.label}</strong><span>{item.detail}</span></div></li>)}</ol>
        <div className="boundary-note"><strong>凭据边界</strong><p>{connectionMethod === "github-app" ? "页面刷新时会由服务端登录会话换取新的短期访问令牌；令牌只进入当前页面内存。断开连接会撤销本设备会话并清除已读取内容。" : "手动 Token 在刷新或关闭页面后需要重新输入。断开连接会立即清除当前页面内的令牌和已读取内容。"}</p></div>
      </aside>
    </section>
  );
}
