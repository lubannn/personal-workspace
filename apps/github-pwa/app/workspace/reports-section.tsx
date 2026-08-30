"use client";

import { useMemo, useState } from "react";

import {
  buildDeterministicReport,
  deterministicReportFileName,
  deterministicReportMarkdownFileName,
  renderDeterministicReportMarkdown,
  serializeDeterministicReportCsv,
  type DeterministicReportAudience,
  type DeterministicReportType,
} from "../../../../src/lib/github-data/deterministic-reports";
import type { Connection, SyncedActivityEvent, SyncedCalendarEvent, SyncedMilestone, SyncedProject, SyncedTask } from "./page-model";

type Props = {
  connection: Connection | null;
  todayDate: string;
  taskFiles: SyncedTask[];
  projectFiles: SyncedProject[];
  milestoneFiles: SyncedMilestone[];
  calendarEventFiles: SyncedCalendarEvent[];
  activityEventFiles: SyncedActivityEvent[];
  loading: boolean;
  onRefresh: () => void;
};

export function ReportsSection({ connection, todayDate, taskFiles, projectFiles, milestoneFiles, calendarEventFiles, activityEventFiles, loading, onRefresh }: Props) {
  const [reportType, setReportType] = useState<DeterministicReportType>("weekly");
  const [audience, setAudience] = useState<DeterministicReportAudience>("personal");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [anchorDateOverride, setAnchorDate] = useState<string | null>(null);
  const anchorDate = anchorDateOverride ?? todayDate;
  const timezone = connection?.timezone ?? "Asia/Shanghai";
  const report = useMemo(() => buildDeterministicReport({
    reportType,
    anchorDate: anchorDate || "1970-01-01",
    timezone,
    tasks: taskFiles.map((item) => item.record),
    projects: projectFiles.map((item) => item.record),
    milestones: milestoneFiles.map((item) => item.record),
    calendarEvents: calendarEventFiles.map((item) => item.record),
    activityEvents: activityEventFiles.map((item) => item.record),
  }), [activityEventFiles, anchorDate, calendarEventFiles, milestoneFiles, projectFiles, reportType, taskFiles, timezone]);
  const factCount = report.completedTasks.length + report.completedMilestones.length + report.calendarEvents.length + report.activityEvents.length;
  const markdown = useMemo(() => renderDeterministicReportMarkdown(report, audience), [audience, report]);

  function downloadCsv() {
    if (!connection) return;
    const url = URL.createObjectURL(new Blob([serializeDeterministicReportCsv(report)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = deterministicReportFileName(report);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function downloadMarkdown() {
    if (!connection) return;
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = deterministicReportMarkdownFileName(report, audience);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function copyMarkdown() {
    if (!connection) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
    window.setTimeout(() => setCopyStatus("idle"), 2500);
  }

  return (
    <section className="reports-card" aria-labelledby="reports-title">
      <div className="card-heading reports-heading">
        <div>
          <p className="eyebrow">Phase 2 · Deterministic Reports</p>
          <h2 id="reports-title">周报与月报事实</h2>
          <p className="reports-subtitle">直接从 Private canonical 记录生成可追溯事实；不调用 AI、不保存草稿，也不写回 GitHub。</p>
        </div>
        <div className="reports-header-actions">
          <label>定位日期<input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} onInput={(event) => setAnchorDate(event.currentTarget.value)} disabled={!connection || loading} /></label>
          <button className="secondary-button" type="button" onClick={onRefresh} disabled={!connection || loading}>{loading ? "刷新中…" : "刷新事实"}</button>
        </div>
      </div>

      <div className="reports-toolbar">
        <div className="reports-type-actions" aria-label="报告周期">
          <button className="secondary-button" type="button" aria-pressed={reportType === "weekly"} onClick={() => setReportType("weekly")}>周报</button>
          <button className="secondary-button" type="button" aria-pressed={reportType === "monthly"} onClick={() => setReportType("monthly")}>月报</button>
        </div>
        <span>{report.periodStart} → {report.periodEnd} · {report.timezone}</span>
      </div>

      {!connection ? <p className="empty-note reports-empty">连接后在当前浏览器中生成 Private 事实汇总。</p> : <>
        <div className="reports-metrics" aria-label="报告事实摘要">
          <article><strong>{report.completedTasks.length}</strong><span>完成任务</span></article>
          <article><strong>{report.completedMilestones.length}</strong><span>完成里程碑</span></article>
          <article><strong>{formatMinutes(report.actualTaskMinutes)}</strong><span>手工实际耗时</span></article>
          <article><strong>{formatMinutes(report.scheduledMinutes)}</strong><span>日程安排</span></article>
          <article><strong>{report.activityEvents.length}</strong><span>项目活动</span></article>
        </div>

        <div className="reports-grid">
          <ReportGroup title="已完成任务" empty="本周期没有完成任务。" items={report.completedTasks.map((record) => ({ id: record.id, title: record.data.title, meta: `${localTimestamp(record.data.completed_at, report.timezone)}${record.data.actual_duration_minutes === null ? "" : ` · ${formatMinutes(record.data.actual_duration_minutes)}`}` }))} />
          <ReportGroup title="项目进度快照" empty="当前没有进行中或本周期完成的项目。" items={report.projectSnapshots.map((snapshot) => ({ id: snapshot.record.id, title: snapshot.record.data.name, meta: `${snapshot.percent}% · ${progressLabel(snapshot.progressSource, snapshot.completed, snapshot.total)}` }))} />
          <ReportGroup title="已完成里程碑" empty="本周期没有完成里程碑。" items={report.completedMilestones.map((record) => ({ id: record.id, title: record.data.title, meta: `${localTimestamp(record.data.completed_at, report.timezone)} · 权重 ${record.data.weight}` }))} />
          <ReportGroup title="日程与时间块" empty="本周期没有已确认日程。" items={report.calendarEvents.map((record) => ({ id: record.id, title: record.data.title, meta: `${record.data.local_start_date} · ${record.data.event_type === "time_block" ? "时间块" : "日程"}` }))} />
          <ReportGroup title="Project Activity" empty="本周期没有 Project Activity。" items={report.activityEvents.map((record) => ({ id: record.id, title: record.data.event_type, meta: `${localTimestamp(record.data.occurred_at, report.timezone)} · Project ${record.data.entity_id}` }))} />
        </div>

        <article className="reports-draft">
          <header>
            <div><strong>Markdown 事实草稿</strong><span>即时生成 · 发送前人工复核</span></div>
            <div className="reports-audience-actions" aria-label="报告草稿模板">
              <button className="secondary-button" type="button" aria-pressed={audience === "personal"} onClick={() => { setAudience("personal"); setCopyStatus("idle"); }}>个人复盘版</button>
              <button className="secondary-button" type="button" aria-pressed={audience === "manager"} onClick={() => { setAudience("manager"); setCopyStatus("idle"); }}>汇报版</button>
            </div>
          </header>
          <pre>{markdown}</pre>
          <footer>
            <span role="status">{copyStatus === "copied" ? "已复制到剪贴板。" : copyStatus === "failed" ? "浏览器未允许剪贴板访问，请下载 Markdown。" : "草稿不会自动保存或发送。"}</span>
            <div>
              <button className="secondary-button" type="button" onClick={() => void copyMarkdown()}>复制 Markdown</button>
              <button className="primary-button" type="button" onClick={downloadMarkdown}>下载 Markdown</button>
            </div>
          </footer>
        </article>

        <div className="reports-export">
          <p><strong>CSV 边界</strong>：导出 {factCount} 条周期事实和 {report.projectSnapshots.length} 条项目快照，保留 source entity、ID 与 canonical path；公式前缀会被转义。文件只在当前浏览器生成。</p>
          <button className="primary-button" type="button" onClick={downloadCsv}>下载事实 CSV</button>
        </div>
      </>}
    </section>
  );
}

function ReportGroup({ title, empty, items }: { title: string; empty: string; items: Array<{ id: string; title: string; meta: string }> }) {
  return <article className="report-fact-group"><header><strong>{title}</strong><span>{items.length}</span></header>{items.length === 0 ? <p>{empty}</p> : <ol>{items.map((item) => <li key={item.id}><span><strong>{item.title}</strong><small>{item.meta}</small></span><code>{item.id}</code></li>)}</ol>}</article>;
}

function localTimestamp(value: string | null, timezone: string) {
  if (!value) return "无时间";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function progressLabel(source: "manual" | "tasks" | "milestones", completed: number | null, total: number | null) {
  if (source === "manual") return "手工进度";
  return `${source === "tasks" ? "任务事实" : "里程碑权重"} ${completed ?? 0}/${total ?? 0}`;
}
