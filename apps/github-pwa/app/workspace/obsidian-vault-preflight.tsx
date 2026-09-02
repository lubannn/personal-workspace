"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import {
  buildObsidianVaultPreflightPlan,
  inspectObsidianVaultPreflightFile,
  type ObsidianVaultPreflightPlan,
} from "../../../../src/lib/github-data/obsidian-vault-preflight";

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
};

type Result = {
  tone: "ready" | "verified" | "conflict" | "error";
  title: string;
  detail: string;
  sha256?: string | null;
};

export function ObsidianVaultPreflight() {
  const [directory, setDirectory] = useState<FileSystemDirectoryHandle | null>(null);
  const [subdirectory, setSubdirectory] = useState("Personal Workspace");
  const [confirmation, setConfirmation] = useState("");
  const [plan, setPlan] = useState<ObsidianVaultPreflightPlan | null>(null);
  const [planError, setPlanError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const planRequestId = useRef(0);
  const supported = useSyncExternalStore(noopSubscribe, browserSupportsDirectoryPicker, () => false);

  async function updatePlan(nextDirectory: FileSystemDirectoryHandle, nextSubdirectory: string) {
    const requestId = ++planRequestId.current;
    setResult(null);
    setConfirmation("");
    setPlan(null);
    try {
      const next = await buildObsidianVaultPreflightPlan({ vaultName: nextDirectory.name, subdirectory: nextSubdirectory });
      if (requestId === planRequestId.current) { setPlan(next); setPlanError(""); }
    } catch {
      if (requestId === planRequestId.current) {
        setPlan(null);
        setPlanError("子目录只能使用安全的相对路径，不能包含 ..、反斜杠或系统保留字符。");
      }
    }
  }

  async function selectVault() {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker || busy) return;
    setBusy(true); setResult(null);
    try {
      const selected = await picker({ id: "personal-workspace-vault", mode: "readwrite" });
      setDirectory(selected);
      await updatePlan(selected, subdirectory);
      setResult({ tone: "ready", title: "Vault 已在当前页面内存中选择", detail: "尚未枚举目录或写入文件。刷新或关闭页面后需要重新选择。" });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setResult({ tone: "error", title: "未能选择 Vault", detail: friendlyFileSystemError(error) });
    } finally { setBusy(false); }
  }

  async function inspect() {
    if (!directory || !plan || busy) return;
    setBusy(true); setResult(null);
    try {
      const current = await readTarget(directory, plan, false);
      const inspection = await inspectObsidianVaultPreflightFile(current, plan);
      setResult(resultForInspection(inspection.status, inspection.sha256));
    } catch (error) {
      setResult({ tone: "error", title: "只读核验失败", detail: friendlyFileSystemError(error) });
    } finally { setBusy(false); }
  }

  async function runSyntheticWriteTest() {
    if (!directory || !plan || confirmation !== plan.confirmation || busy) return;
    setBusy(true); setResult(null);
    try {
      const initial = await readTarget(directory, plan, false);
      const initialInspection = await inspectObsidianVaultPreflightFile(initial, plan);
      if (initialInspection.status === "conflict") {
        setResult(resultForInspection("conflict", initialInspection.sha256));
        return;
      }
      if (initialInspection.status === "verified") {
        setResult(resultForInspection("verified", initialInspection.sha256));
        return;
      }

      if (initialInspection.status === "missing") {
        await createMissingFixture(directory, plan, plan.stages[0].markdown);
        const created = await readTarget(directory, plan, true);
        const createdInspection = await inspectObsidianVaultPreflightFile(created, plan);
        if (createdInspection.status !== "stage_1") throw new Error("OBSIDIAN_PREFLIGHT_CREATE_VERIFY_FAILED");
      }

      await replaceFixture(directory, plan, plan.stages[0].sha256, plan.stages[1].markdown);
      const completed = await readTarget(directory, plan, true);
      const completedInspection = await inspectObsidianVaultPreflightFile(completed, plan);
      if (completedInspection.status !== "verified") throw new Error("OBSIDIAN_PREFLIGHT_REPLACE_VERIFY_FAILED");
      setResult({
        tone: "verified",
        title: "合成测试文件已通过两阶段核验",
        detail: "已验证目录权限、UTF-8/LF 回读、SHA-256 基线和 commit-on-close 替换。测试文件会保留，未读取或写入任何 Journal 正文。",
        sha256: completedInspection.sha256,
      });
    } catch (error) {
      const conflict = error instanceof Error && error.message.startsWith("OBSIDIAN_PREFLIGHT_CONFLICT");
      setResult({
        tone: conflict ? "conflict" : "error",
        title: conflict ? "检测到文件变化，已停止" : "兼容性测试未完成",
        detail: friendlyFileSystemError(error),
      });
    } finally { setBusy(false); }
  }

  return <section className="obsidian-preflight" aria-labelledby="obsidian-preflight-title">
    <div className="obsidian-preflight-heading">
      <div><p className="eyebrow">Phase 3B · Synthetic preflight</p><h3 id="obsidian-preflight-title">Obsidian Vault 兼容性预检</h3></div>
      <span className={supported ? "available" : "unavailable"}>{supported ? "Desktop Chromium" : "当前浏览器不支持"}</span>
    </div>
    <p>只对你主动选择的 Vault 写入一份固定的无私人内容测试文件；不扫描其他笔记、不读取 Journal、不保存目录权限，也不启用双向同步。</p>
    <div className="obsidian-preflight-controls">
      <button className="secondary-button" type="button" onClick={selectVault} disabled={!supported || busy}>{busy ? "处理中…" : directory ? "重新选择 Vault" : "选择 Vault"}</button>
      <label>目标子目录<input value={subdirectory} onChange={(event) => { const value = event.target.value; setSubdirectory(value); if (directory) void updatePlan(directory, value); }} maxLength={240} disabled={!directory || busy} /></label>
    </div>
    {!supported ? <p className="empty-note">目录选择器目前不是跨浏览器 Baseline；可继续使用单篇 Markdown 下载，Vault 测试需在支持 File System Access API 的桌面 Chromium 中运行。</p> : null}
    {directory && plan ? <>
      <dl className="obsidian-preflight-plan">
        <div><dt>Vault</dt><dd>{plan.vaultName}</dd></div>
        <div><dt>唯一目标文件</dt><dd><code>{plan.relativePath}</code></dd></div>
        <div><dt>Stage 1</dt><dd>{plan.stages[0].utf8Bytes} bytes · <code>{shortHash(plan.stages[0].sha256)}</code></dd></div>
        <div><dt>Stage 2</dt><dd>{plan.stages[1].utf8Bytes} bytes · <code>{shortHash(plan.stages[1].sha256)}</code></dd></div>
      </dl>
      <div className="obsidian-preflight-confirmation">
        <label>输入完整目标以允许写入 <code>{plan.confirmation}</code><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} disabled={busy} /></label>
        <div><button className="secondary-button" type="button" onClick={inspect} disabled={busy}>只读核验</button><button className="primary-button" type="button" onClick={runSyntheticWriteTest} disabled={busy || confirmation !== plan.confirmation}>写入合成测试文件</button></div>
      </div>
    </> : null}
    {planError ? <p className="obsidian-preflight-error" role="alert">{planError}</p> : null}
    {result ? <div className={`obsidian-preflight-result ${result.tone}`} role="status" aria-live="polite"><strong>{result.title}</strong><p>{result.detail}</p>{result.sha256 ? <code>SHA-256 {result.sha256}</code> : null}</div> : null}
    <div className="obsidian-preflight-boundary"><strong>当前仍不是 Journal 同步</strong><p>测试文件不会自动删除；浏览器写入在 writable stream 成功关闭后提交，但云盘同步、文件锁和并发编辑仍需单独实机验证。任何非精确 fixture 都会按冲突停止，正式日记导出和 Obsidian → Workspace 覆盖均保持关闭。</p></div>
  </section>;
}

async function readTarget(root: FileSystemDirectoryHandle, plan: ObsidianVaultPreflightPlan, required: boolean) {
  try {
    const directory = await resolveDirectory(root, plan.subdirectory.split("/"), false);
    const fileHandle = await directory.getFileHandle(plan.relativePath.split("/").at(-1)!, { create: false });
    return await (await fileHandle.getFile()).text();
  } catch (error) {
    if (!required && error instanceof DOMException && error.name === "NotFoundError") return null;
    throw error;
  }
}

async function createMissingFixture(root: FileSystemDirectoryHandle, plan: ObsidianVaultPreflightPlan, markdown: string) {
  const directory = await resolveDirectory(root, plan.subdirectory.split("/"), true);
  const fileName = plan.relativePath.split("/").at(-1)!;
  try {
    const existing = await directory.getFileHandle(fileName, { create: false });
    const current = await (await existing.getFile()).text();
    if (current !== markdown) throw new Error("OBSIDIAN_PREFLIGHT_CONFLICT_TARGET_APPEARED");
    return;
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
  }
  const handle = await directory.getFileHandle(fileName, { create: true });
  const current = await handle.getFile();
  if (current.size !== 0) throw new Error("OBSIDIAN_PREFLIGHT_CONFLICT_TARGET_APPEARED");
  await writeAndClose(handle, markdown);
}

async function replaceFixture(root: FileSystemDirectoryHandle, plan: ObsidianVaultPreflightPlan, expectedSha256: string, markdown: string) {
  const directory = await resolveDirectory(root, plan.subdirectory.split("/"), false);
  const fileHandle = await directory.getFileHandle(plan.relativePath.split("/").at(-1)!, { create: false });
  const current = await (await fileHandle.getFile()).text();
  const inspection = await inspectObsidianVaultPreflightFile(current, plan);
  if (inspection.sha256 !== expectedSha256) {
    if (inspection.status === "verified") return;
    throw new Error("OBSIDIAN_PREFLIGHT_CONFLICT_CHANGED_BEFORE_REPLACE");
  }
  await writeAndClose(fileHandle, markdown);
}

async function resolveDirectory(root: FileSystemDirectoryHandle, segments: string[], create: boolean) {
  let current = root;
  for (const segment of segments) current = await current.getDirectoryHandle(segment, { create });
  return current;
}

async function writeAndClose(handle: FileSystemFileHandle, markdown: string) {
  const writable = await handle.createWritable({ keepExistingData: false });
  try {
    await writable.write(markdown);
    await writable.close();
  } catch (error) {
    await writable.abort(error).catch(() => undefined);
    throw error;
  }
}

function resultForInspection(status: "missing" | "stage_1" | "verified" | "conflict", sha256: string | null): Result {
  if (status === "missing") return { tone: "ready", title: "目标文件尚不存在", detail: "只读核验未创建目录或文件；输入完整目标后可运行合成写入测试。" };
  if (status === "stage_1") return { tone: "ready", title: "检测到可恢复的 Stage 1 fixture", detail: "内容与确定性测试基线精确一致，可以继续 Stage 2 替换。", sha256 };
  if (status === "verified") return { tone: "verified", title: "现有测试文件已验证", detail: "内容与 Stage 2 fixture 精确一致，本次无需重复写入。", sha256 };
  return { tone: "conflict", title: "目标文件包含非匹配内容", detail: "已停止且未覆盖。请人工检查或选择其他子目录；应用不会删除、改名或吸收现有内容。", sha256 };
}

function friendlyFileSystemError(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError") return "浏览器或文件系统未授予所需权限；未写入文件。";
  if (error instanceof DOMException && error.name === "NotFoundError") return "目标目录或测试文件在操作期间消失；已停止。";
  if (error instanceof Error && error.message.startsWith("OBSIDIAN_PREFLIGHT_CONFLICT")) return "目标测试文件在核验后发生变化或已被其他程序创建；已停止且没有继续覆盖。";
  if (error instanceof Error && error.message === "OBSIDIAN_PREFLIGHT_CREATE_VERIFY_FAILED") return "Stage 1 写入后的 UTF-8/hash 回读不一致；已停止。";
  if (error instanceof Error && error.message === "OBSIDIAN_PREFLIGHT_REPLACE_VERIFY_FAILED") return "Stage 2 替换后的 UTF-8/hash 回读不一致；已停止。";
  return "本地文件系统操作失败；没有启用 Journal 同步。";
}

function shortHash(value: string) { return `${value.slice(0, 12)}…${value.slice(-8)}`; }

function noopSubscribe() { return () => undefined; }
function browserSupportsDirectoryPicker() { return typeof window !== "undefined" && typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function"; }
