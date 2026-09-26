import { describe, expect, it } from "vitest";

import { WORKSPACE_TABS, workspaceTabFromHash } from "./workspace-tab-navigation";

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
    expect(workspaceTabFromHash("#portability-title")).toBe("data");
  });

  it("ignores unrelated or malformed anchors", () => {
    expect(workspaceTabFromHash("")).toBeNull();
    expect(workspaceTabFromHash("#top")).toBeNull();
    expect(workspaceTabFromHash("#%ZZ")).toBeNull();
  });
});
