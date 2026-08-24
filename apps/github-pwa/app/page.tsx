"use client";

import { useEffect, useMemo, useState } from "react";

import { createWorkspaceRecord, recordPath, serializeRecord } from "../../../src/lib/github-data/protocol";

type PreviewCapture = { path: string; text: string; serialized: string };

export default function GitHubPreviewPage() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [capture, setCapture] = useState("");
  const [preview, setPreview] = useState<PreviewCapture | null>(null);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const readiness = useMemo(() => [
    { label: "Static PWA", detail: "不需要 Mac 或 Node.js 常驻", done: true },
    { label: "Private data repo", detail: "personal-workspace-data · Private · Plaintext", done: true },
    { label: "GitHub authorization", detail: "等待注册最小权限 GitHub App", done: false },
    { label: "Real sync", detail: "授权完成前不写入私人数据", done: false },
  ], []);

  function createPreview() {
    const text = capture.trim();
    if (!text) return;
    const id = `capture_${crypto.randomUUID().replaceAll("-", "")}`;
    const record = createWorkspaceRecord({
      entityType: "capture",
      id,
      ownerId: "github_lubannn",
      data: { raw_text: text, status: "inbox" },
    });
    setPreview({ path: recordPath("capture", id), text, serialized: serializeRecord(record) });
    setCapture("");
  }

  return (
    <main className="preview-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Personal Workspace">
          <span>PW</span>
          <strong>Personal<br />Workspace</strong>
        </a>
        <div className={`network ${online === false ? "offline" : ""}`}>
          <i /> {online === null ? "检测网络" : online ? "GitHub 可连接" : "当前离线"}
        </div>
      </header>

      <section className="hero" id="top">
        <p className="eyebrow">GitHub-backed preview</p>
        <h1>工作台不再<br />依赖某一台电脑。</h1>
        <p className="lede">应用从 GitHub Pages 打开，私人数据进入单独的 Private 仓库。这个页面是纯静态构建，Mac 关机也不影响页面运行。</p>
        <div className="hero-meta">
          <span>Static export</span><span>Private repository</span><span>Plaintext accepted</span>
        </div>
      </section>

      <section className="content-grid">
        <article className="capture-card">
          <div className="card-heading">
            <div><p className="eyebrow">Protocol preview</p><h2>Quick Capture 文件预览</h2></div>
            <span className="memory-pill">仅内存，不上传</span>
          </div>
          <textarea
            value={capture}
            onChange={(event) => setCapture(event.target.value)}
            placeholder="写一点内容，查看它将如何成为 GitHub 文件…"
            maxLength={10_000}
          />
          <footer>
            <span>{capture.length} / 10,000</span>
            <button type="button" onClick={createPreview} disabled={!capture.trim()}>生成预览</button>
          </footer>
          {preview ? (
            <div className="file-preview">
              <code>{preview.path}</code>
              <p>{preview.text}</p>
              <details><summary>查看开放 JSON</summary><pre>{preview.serialized}</pre></details>
            </div>
          ) : <p className="empty-note">此处只验证文件协议；GitHub 授权完成前不会保存输入。</p>}
        </article>

        <aside className="status-card">
          <p className="eyebrow">Migration readiness</p>
          <h2>迁移状态</h2>
          <ol>
            {readiness.map((item) => (
              <li key={item.label} className={item.done ? "done" : "waiting"}>
                <i>{item.done ? "✓" : "·"}</i>
                <div><strong>{item.label}</strong><span>{item.detail}</span></div>
              </li>
            ))}
          </ol>
          <div className="boundary-note">
            <strong>明确边界</strong>
            <p>业务数据允许明文进入 Private 仓库；token、密码和恢复码永远不进入 Git。</p>
          </div>
        </aside>
      </section>

      <footer className="page-footer">
        <span>Personal Workspace</span>
        <span>GitHub transition · Phase 1B</span>
      </footer>
    </main>
  );
}
