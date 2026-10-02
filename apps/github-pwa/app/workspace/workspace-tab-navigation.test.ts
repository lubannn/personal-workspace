import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WORKSPACE_TABS, WorkspaceTabPanel, workspaceTabFromHash } from "./workspace-tab-navigation";

describe("workspace tab deep links", () => {
  it("keeps each tab addressable", () => {
    for (const tab of WORKSPACE_TABS) expect(workspaceTabFromHash(`#workspace-panel-${tab.id}`)).toBe(tab.id);
  });

  it("opens the right tab for existing section links", () => {
    expect(workspaceTabFromHash("#journal-title")).toBe("journal");
    expect(workspaceTabFromHash("#tasks-title")).toBe("tasks");
    expect(workspaceTabFromHash("#time-entries-title")).toBe("tasks");
    expect(workspaceTabFromHash("#coros-batch-import-title")).toBe("health");
    expect(workspaceTabFromHash("#coros-file-preflight-title")).toBe("health");
    expect(workspaceTabFromHash("#health-records-title")).toBe("health");
    expect(workspaceTabFromHash("#portability-title")).toBe("data");
  });

  it("ignores unrelated or malformed anchors", () => {
    expect(workspaceTabFromHash("")).toBeNull();
    expect(workspaceTabFromHash("#top")).toBeNull();
    expect(workspaceTabFromHash("#%ZZ")).toBeNull();
  });

  it("does not render unvisited module children and retains visited hidden panels", () => {
    let rendered = 0;
    function Child() { rendered++; return createElement("span", null, "module form"); }
    const unvisited = renderToStaticMarkup(createElement(WorkspaceTabPanel, { tab: "journal", activeTab: "health", mounted: false }, createElement(Child)));
    expect(rendered).toBe(0);
    expect(unvisited).toContain('id="workspace-panel-journal"');
    const visited = renderToStaticMarkup(createElement(WorkspaceTabPanel, { tab: "journal", activeTab: "health", mounted: true }, createElement(Child)));
    expect(rendered).toBe(1);
    expect(visited).toContain("module form");
    expect(visited).toContain('hidden=""');
  });
});
