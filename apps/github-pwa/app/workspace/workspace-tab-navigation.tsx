"use client";

import { type KeyboardEvent, type ReactNode } from "react";

export const WORKSPACE_TABS = [
  { id: "overview", label: "概览" },
  { id: "tasks", label: "待办" },
  { id: "calendar", label: "日程" },
  { id: "ideas", label: "想法" },
  { id: "projects", label: "项目" },
  { id: "reports", label: "报告" },
  { id: "health", label: "健康" },
  { id: "habits", label: "习惯" },
  { id: "learning", label: "学习" },
  { id: "journal", label: "日记" },
] as const;

export type WorkspaceTabId = (typeof WORKSPACE_TABS)[number]["id"] | "data";

const SECTION_HASHES: Record<string, WorkspaceTabId> = {
  "dashboard-title": "overview",
  "recent-title": "overview",
  "ideas-title": "ideas",
  "journal-title": "journal",
  "legacy-import-title": "journal",
  "legacy-commit-title": "journal",
  "legacy-checkpoint-history-title": "journal",
  "obsidian-preflight-title": "journal",
  "obsidian-export-title": "journal",
  "tasks-title": "tasks",
  "time-entries-title": "tasks",
  "calendar-title": "calendar",
  "projects-title": "projects",
  "learning-title": "learning",
  "habits-title": "habits",
  "health-title": "health",
  "health-records-title": "health",
  "coros-connection-title": "health",
  "coros-batch-import-title": "health",
  "coros-file-preflight-title": "health",
  "reports-title": "reports",
  "portability-title": "data",
  "settings-title": "data",
};

export function workspaceTabFromHash(hash: string): WorkspaceTabId | null {
  let anchor: string;
  try { anchor = decodeURIComponent(hash.replace(/^#/, "")); }
  catch { return null; }
  const panel = anchor.startsWith("workspace-panel-") ? anchor.slice("workspace-panel-".length) : "";
  if (panel === "data") return "data"; // Keep existing data-page bookmarks working.
  if (WORKSPACE_TABS.some((tab) => tab.id === panel)) return panel as WorkspaceTabId;
  return SECTION_HASHES[anchor] ?? null;
}

export function WorkspaceTabNavigation({ activeTab, onSelect }: { activeTab: WorkspaceTabId; onSelect: (tab: WorkspaceTabId) => void }) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: WorkspaceTabId) {
    const index = WORKSPACE_TABS.findIndex((tab) => tab.id === current);
    const nextIndex = event.key === "ArrowRight" ? (index + 1) % WORKSPACE_TABS.length
      : event.key === "ArrowLeft" ? (index - 1 + WORKSPACE_TABS.length) % WORKSPACE_TABS.length
      : event.key === "Home" ? 0 : event.key === "End" ? WORKSPACE_TABS.length - 1 : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const next = WORKSPACE_TABS[nextIndex];
    onSelect(next.id);
    document.getElementById(`workspace-tab-${next.id}`)?.focus();
  }

  return <nav id="workspace-navigation" className="workspace-tab-navigation" aria-label="工作台模块">
    <div className="workspace-tab-list" role="tablist" aria-label="工作台模块">
      {WORKSPACE_TABS.map((tab) => <button
        key={tab.id}
        id={`workspace-tab-${tab.id}`}
        className="workspace-tab"
        type="button"
        role="tab"
        aria-selected={activeTab === tab.id}
        aria-controls={`workspace-panel-${tab.id}`}
        tabIndex={(activeTab === "data" ? "overview" : activeTab) === tab.id ? 0 : -1}
        onClick={() => onSelect(tab.id)}
        onKeyDown={(event) => handleKeyDown(event, tab.id)}
      >{tab.label}</button>)}
    </div>
  </nav>;
}

export function WorkspaceTabPanel({ tab, activeTab, mounted = true, children }: { tab: WorkspaceTabId; activeTab: WorkspaceTabId; mounted?: boolean; children?: ReactNode }) {
  return <div id={`workspace-panel-${tab}`} className="workspace-tab-panel" role={tab === "data" ? "region" : "tabpanel"} aria-labelledby={tab === "data" ? "settings-title" : `workspace-tab-${tab}`} tabIndex={0} hidden={activeTab !== tab}>{mounted ? children : null}</div>;
}
