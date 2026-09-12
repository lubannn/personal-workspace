"use client";

import { useMemo, useState, useSyncExternalStore } from "react";

import type { GitHubContentsAdapter } from "../../../../src/lib/github-data/github-contents";
import { createObsidianDocumentData, expectedObsidianJournalRelativePath, updateObsidianDocumentRecord } from "../../../../src/lib/github-data/obsidian-documents";
import { buildObsidianJournalExportPlan, type ObsidianJournalExportBaseline, type ObsidianJournalExportPlan } from "../../../../src/lib/github-data/obsidian-journal-export";
import { executeObsidianJournalExportAction, obsidianDocumentId, obsidianVaultMappingId, syncConflictDataFromObsidianExportPlan } from "../../../../src/lib/github-data/obsidian-journal-export-action";
import { createWorkspaceRecord, recordPath, serializeRecord } from "../../../../src/lib/github-data/protocol";
import { createSyncConflictRecord } from "../../../../src/lib/github-data/sync-conflicts";
import type { Connection, SyncedJournalEntry, SyncedJournalRevision, SyncedObsidianDocument } from "./page-model";
import { createObsidianVaultTextAccess } from "./obsidian-vault-text-access";

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
};

type Props = {
  connection: Connection | null;
  adapter: GitHubContentsAdapter | null;
  online: boolean | null;
  entries: SyncedJournalEntry[];
  revisions: SyncedJournalRevision[];
  documents: SyncedObsidianDocument[];
  onCanonicalChanged: () => Promise<void>;
};

type Result = { tone: "ready" | "verified" | "conflict" | "error"; title: string; detail: string };

export function ObsidianJournalExport({ connection, adapter, online, entries, revisions, documents, onCanonicalChanged }: Props) {
  const [directory, setDirectory] = useState<FileSystemDirectoryHandle | null>(null);
  const [subdirectory, setSubdirectory] = useState("Personal Workspace");
  const [entryId, setEntryId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [plan, setPlan] = useState<ObsidianJournalExportPlan | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = useSyncExternalStore(noopSubscribe, browserSupportsDirectoryPicker, () => false);
  const activeEntries = useMemo(() => entries.filter((item) => item.record.deleted_at === null).sort((left, right) => right.record.data.journal_date.localeCompare(left.record.data.journal_date)), [entries]);

  function resetPlan() { setPlan(null); setConfirmation(""); setResult(null); }

  async function selectVault() {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker || busy) return;
    setBusy(true); resetPlan();
    try {
      const selected = await picker({ id: "personal-workspace-journal-export", mode: "readwrite" });
      setDirectory(selected);
      setResult({ tone: "ready", title: "Vault 已选择", detail: "目录权限只保留在当前页面内存；尚未读取或写入日记目标。" });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setResult({ tone: "error", title: "未能选择 Vault", detail: friendlyError(error) });
    } finally { setBusy(false); }
  }

  async function buildCurrentPlan() {
    if (!directory || !entryId) throw new Error("OBSIDIAN_EXPORT_SELECTION_REQUIRED");
    const entry = entries.find((item) => item.record.id === entryId)?.record;
    if (!entry) throw new Error("OBSIDIAN_EXPORT_ENTRY_NOT_FOUND");
    const revision = revisions.find((item) => item.record.id === entry.data.current_revision_id)?.record;
    if (!revision) throw new Error("OBSIDIAN_EXPORT_REVISION_NOT_FOUND");
    const mappingId = await obsidianVaultMappingId(directory.name, subdirectory);
    const document = documents.find((item) => item.record.deleted_at === null && item.record.data.vault_mapping_id === mappingId && item.record.data.journal_entry_id === entry.id) ?? null;
    const relativePath = expectedObsidianJournalRelativePath(subdirectory, entry.data.journal_date);
    const currentMarkdown = await createObsidianVaultTextAccess(directory).readText(relativePath);
    const baseline = document ? baselineFromDocument(document) : null;
    const nextPlan = await buildObsidianJournalExportPlan({ vaultName: directory.name, subdirectory, entry, revision, currentMarkdown, baseline });
    return { plan: nextPlan, mappingId, document };
  }

  async function prepare() {
    if (busy) return;
    setBusy(true); setResult(null); setConfirmation("");
    try {
      const prepared = await buildCurrentPlan();
      setPlan(prepared.plan);
      setResult(prepared.plan.disposition === "conflict"
        ? { tone: "conflict", title: "检测到冲突，Vault 不会被覆盖", detail: "可在确认后只向 Private GitHub 写入一条不含正文的冲突事实。" }
        : { tone: "ready", title: "单篇导出计划已生成", detail: "目标文件与 canonical Revision 已只读核对；执行前还会重新读取并比较。" });
    } catch (error) { setPlan(null); setResult({ tone: "error", title: "无法生成导出计划", detail: friendlyError(error) }); }
    finally { setBusy(false); }
  }

  async function execute() {
    if (!plan || !directory || !connection || !adapter || confirmation !== plan.confirmation || busy || online === false) return;
    const action = plan.disposition === "conflict" ? "只记录冲突事实，不写 Vault" : "写入这一篇 Journal、更新 Vault manifest，并保存 GitHub baseline";
    if (!window.confirm(["确认现在执行一次 Obsidian 单篇导出？", "", `动作：${action}`, `Vault：${plan.vaultName}`, `目标：${plan.relativePath}`, `SHA-256：${plan.documentSha256}`, `Payload：${plan.utf8Bytes} UTF-8 bytes`, "", "执行前会重新比较目标；任何变化都会停止，不自动重试。"].join("\n"))) return;
    setBusy(true); setResult(null);
    try {
      const fresh = await buildCurrentPlan();
      if (!samePlan(plan, fresh.plan)) throw new Error("OBSIDIAN_EXPORT_PLAN_CHANGED");
      const timestamp = new Date().toISOString();
      if (fresh.plan.disposition === "conflict") {
        const id = `sync_conflict_${timestamp.replaceAll(/\D/g, "").slice(0, 17)}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
        const conflict = createSyncConflictRecord({
          id,
          ownerId: connection.ownerId,
          detectedAt: timestamp,
          data: syncConflictDataFromObsidianExportPlan({ plan: fresh.plan, vaultMappingId: fresh.mappingId, obsidianDocumentId: fresh.document?.record.id ?? null, baselineDocumentSha256: fresh.document?.record.data.document_sha256 ?? null }),
        });
        await adapter.writeText({ path: recordPath("sync_conflict", id), text: serializeRecord(conflict), message: `obsidian: record conflict ${id}` });
        await onCanonicalChanged();
        setConfirmation("");
        setResult({ tone: "conflict", title: "冲突事实已保存，Vault 未改动", detail: "Private GitHub 只保存路径、引用与 hashes，不包含 Vault 中观察到的正文。" });
        return;
      }

      const completed = await executeObsidianJournalExportAction({ plan: fresh.plan, confirmation, vaultMappingId: fresh.mappingId, generatedAt: timestamp, access: createObsidianVaultTextAccess(directory) });
      const current = fresh.document;
      const record = current
        ? updateObsidianDocumentRecord(current.record, { sourceRevisionId: completed.baseline.revisionId, sourceRecordVersion: completed.baseline.recordVersion, sourceContentSha256: completed.baseline.sourceContentSha256, documentSha256: completed.baseline.documentSha256, exportedAt: timestamp })
        : createWorkspaceRecord({
          entityType: "obsidian_document",
          id: await obsidianDocumentId(fresh.mappingId, fresh.plan.source.journalEntryId),
          ownerId: connection.ownerId,
          timestamp,
          data: createObsidianDocumentData({ vault_mapping_id: fresh.mappingId, journal_entry_id: fresh.plan.source.journalEntryId, relative_path: fresh.plan.relativePath, source_revision_id: completed.baseline.revisionId, source_record_version: completed.baseline.recordVersion, source_content_sha256: completed.baseline.sourceContentSha256, document_sha256: completed.baseline.documentSha256, exported_at: timestamp }),
        });
      await adapter.writeText({ path: recordPath("obsidian_document", record.id), text: serializeRecord(record), message: `obsidian: baseline ${record.id}`, expectedBlobSha: current?.blobSha });
      await onCanonicalChanged();
      setPlan(null); setConfirmation("");
      setResult({ tone: "verified", title: "单篇 Journal 已完成导出", detail: `目标文件与 manifest 已逐字回读，Private GitHub baseline 已保存。${completed.wroteDocument ? "本次写入了 Markdown。" : "Markdown 已是目标版本，本次只完成核对与元数据收敛。"}` });
    } catch (error) {
      setPlan(null); setConfirmation("");
      setResult({ tone: "error", title: "导出未完整完成", detail: friendlyError(error) });
    } finally { setBusy(false); }
  }

  return <section className="obsidian-preflight" aria-labelledby="obsidian-export-title">
    <div className="obsidian-preflight-heading"><div><p className="eyebrow">Phase 3B · One-way export</p><h3 id="obsidian-export-title">Journal → Obsidian 单篇导出</h3></div><span className={supported ? "available" : "unavailable"}>{supported ? "显式确认" : "当前浏览器不支持"}</span></div>
    <p>Private GitHub 始终是 canonical。每次只处理你选择的一篇日记和两个精确目标：Markdown 与 metadata-only manifest；不扫描 Vault、不导入 Obsidian 修改。</p>
    <div className="obsidian-preflight-controls"><button className="secondary-button" type="button" onClick={selectVault} disabled={!supported || busy}>{directory ? "重新选择 Vault" : "选择 Vault"}</button><label>目标子目录<input value={subdirectory} onChange={(event) => { setSubdirectory(event.target.value); resetPlan(); }} maxLength={240} disabled={!directory || busy} /></label></div>
    <div className="obsidian-preflight-controls"><label>单篇 Journal<select value={entryId} onChange={(event) => { setEntryId(event.target.value); resetPlan(); }} disabled={!connection || !directory || busy}><option value="">请选择</option>{activeEntries.map((item) => <option key={item.record.id} value={item.record.id}>{item.record.data.journal_date} · {item.record.data.title || "未命名日记"}</option>)}</select></label><button className="secondary-button" type="button" onClick={prepare} disabled={!connection || !directory || !entryId || busy}>生成只读计划</button></div>
    {plan ? <><dl className="obsidian-preflight-plan"><div><dt>动作</dt><dd>{dispositionLabel(plan.disposition)}</dd></div><div><dt>唯一 Journal 目标</dt><dd><code>{plan.relativePath}</code></dd></div><div><dt>Revision</dt><dd><code>{plan.source.revisionId}</code></dd></div><div><dt>输出</dt><dd>{plan.utf8Bytes} bytes · <code>{shortHash(plan.documentSha256)}</code></dd></div></dl><div className="obsidian-preflight-confirmation"><label>输入完整目标以允许本次动作 <code>{plan.confirmation}</code><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} disabled={busy} /></label><div><button className="primary-button" type="button" onClick={execute} disabled={busy || online === false || confirmation !== plan.confirmation}>{plan.disposition === "conflict" ? "只记录冲突" : "导出这一篇"}</button></div></div></> : null}
    {!supported ? <p className="empty-note">请使用支持 File System Access API 的桌面 Chromium；其他设备仍可查看 GitHub canonical Journal。</p> : null}
    {result ? <div className={`obsidian-preflight-result ${result.tone}`} role="status" aria-live="polite"><strong>{result.title}</strong><p>{result.detail}</p></div> : null}
    <div className="obsidian-preflight-boundary"><strong>严格单向、单篇、动作时授权</strong><p>目录 handle 不持久化；文件与 manifest 均在 commit-on-close 后逐字回读。GitHub baseline 失败时不会宣称全部成功；重新生成计划可保守收敛。后台同步、批量导出和 Obsidian → Workspace 覆盖继续关闭。</p></div>
  </section>;
}

function baselineFromDocument(item: SyncedObsidianDocument): ObsidianJournalExportBaseline {
  return { formatVersion: item.record.data.export_format_version, relativePath: item.record.data.relative_path, journalEntryId: item.record.data.journal_entry_id, revisionId: item.record.data.source_revision_id, recordVersion: item.record.data.source_record_version, sourceContentSha256: item.record.data.source_content_sha256, documentSha256: item.record.data.document_sha256 };
}
function samePlan(left: ObsidianJournalExportPlan, right: ObsidianJournalExportPlan) { return left.confirmation === right.confirmation && left.documentSha256 === right.documentSha256 && left.currentDocumentSha256 === right.currentDocumentSha256 && left.source.revisionId === right.source.revisionId && left.source.recordVersion === right.source.recordVersion && left.disposition === right.disposition; }
function dispositionLabel(value: ObsidianJournalExportPlan["disposition"]) { return value === "create" ? "创建新文件" : value === "update" ? "更新受管文件" : value === "unchanged" ? "内容已一致，仅核对基线" : "冲突：不写 Vault"; }
function shortHash(value: string) { return `${value.slice(0, 12)}…${value.slice(-8)}`; }
function noopSubscribe() { return () => undefined; }
function browserSupportsDirectoryPicker() { return typeof window !== "undefined" && typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function"; }
function friendlyError(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError") return "浏览器或文件系统未授予权限；没有继续写入。";
  if (error instanceof Error && ["OBSIDIAN_EXPORT_TARGET_CHANGED", "OBSIDIAN_EXPORT_COMPARE_FAILED", "OBSIDIAN_EXPORT_PLAN_CHANGED"].includes(error.message)) return "目标或 canonical 数据在确认期间发生变化；已停止，请重新生成计划。";
  if (error instanceof Error && error.message === "OBSIDIAN_EXPORT_REVISION_NOT_FOUND") return "当前 Journal Revision 尚未加载；请先从 GitHub 刷新。";
  if (error instanceof Error && error.message.includes("MANIFEST")) return "Vault manifest 无法安全核对或更新；若 Markdown 已写入，请不要编辑它，重新生成计划以保守收敛。";
  return "操作没有被确认完整完成。若 Vault 文件已经出现，请重新生成只读计划；系统不会盲目重试或覆盖。";
}
