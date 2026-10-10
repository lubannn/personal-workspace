import { describe, expect, it, vi } from "vitest";

import { WORKSPACE_MODULE_COLLECTIONS, WorkspaceModuleLoader, type WorkspaceCollectionLoaders } from "./workspace-module-loading";

function createLoaders() {
  const names = new Set(Object.values(WORKSPACE_MODULE_COLLECTIONS).flat());
  return Object.fromEntries([...names].map((name) => [name, vi.fn(async () => {})])) as unknown as WorkspaceCollectionLoaders<object>;
}

describe("workspace module data loading", () => {
  it("opens a health deep link without loading unrelated collections", async () => {
    const loaders = createLoaders();
    await new WorkspaceModuleLoader<object>().load({}, "health", loaders);
    expect(loaders.health).toHaveBeenCalledOnce();
    for (const [name, loader] of Object.entries(loaders)) {
      if (name !== "health") expect(loader).not.toHaveBeenCalled();
    }
  });

  it("loads notices only once without reading other collections", async () => {
    const loaders = createLoaders(), adapter = {};
    const coordinator = new WorkspaceModuleLoader<object>();
    await coordinator.load(adapter, "notices", loaders);
    await coordinator.load(adapter, "notices", loaders);
    expect(loaders.notices).toHaveBeenCalledOnce();
    for (const [name, loader] of Object.entries(loaders)) if (name !== "notices") expect(loader).not.toHaveBeenCalled();
  });

  it("opens tasks without reading historical time entries, which remain available to reports", async () => {
    const coordinator = new WorkspaceModuleLoader<object>();
    const adapter = {};
    const loaders = createLoaders();
    await coordinator.load(adapter, "tasks", loaders);
    expect(loaders.tasks).toHaveBeenCalledOnce();
    expect(loaders.projects).toHaveBeenCalledOnce();
    expect(loaders.timeEntries).not.toHaveBeenCalled();
    await coordinator.load(adapter, "reports", loaders);
    expect(loaders.timeEntries).toHaveBeenCalledOnce();
  });

  it("shares pending and completed dependencies when switching tabs", async () => {
    const coordinator = new WorkspaceModuleLoader<object>();
    const adapter = {};
    const loaders = createLoaders();
    let finishTasks!: () => void;
    loaders.tasks = vi.fn(() => new Promise<void>((resolve) => { finishTasks = resolve; }));
    const tasks = coordinator.load(adapter, "tasks", loaders);
    const reports = coordinator.load(adapter, "reports", loaders);
    await Promise.resolve();
    expect(loaders.tasks).toHaveBeenCalledOnce();
    expect(loaders.projects).toHaveBeenCalledOnce();
    finishTasks();
    await Promise.all([tasks, reports]);
    await coordinator.load(adapter, "tasks", loaders);
    expect(loaders.tasks).toHaveBeenCalledOnce();
    expect(loaders.timeEntries).toHaveBeenCalledOnce();
    expect(loaders.health).not.toHaveBeenCalled();
  });

  it("loads collection dependencies needed by linked forms and reports", () => {
    expect(WORKSPACE_MODULE_COLLECTIONS.calendar).toContain("tasks");
    expect(WORKSPACE_MODULE_COLLECTIONS.projects).toContain("tasks");
    expect(WORKSPACE_MODULE_COLLECTIONS.tasks).toEqual(["tasks", "projects"]);
    expect(WORKSPACE_MODULE_COLLECTIONS.habits).toEqual(["habits", "health"]);
    expect(WORKSPACE_MODULE_COLLECTIONS.overview).toEqual(["dashboard", "captures", "tasks", "calendar", "todayHealth"]);
    expect(WORKSPACE_MODULE_COLLECTIONS.reports).toEqual(["tasks", "timeEntries", "projects", "milestones", "calendar", "activity", "reports"]);
  });

  it("does not preload the full export or legacy journal audit history", async () => {
    const coordinator = new WorkspaceModuleLoader<object>();
    const loaders = createLoaders();
    const adapter = {};
    await coordinator.load(adapter, "data", loaders);
    for (const loader of Object.values(loaders)) expect(loader).not.toHaveBeenCalled();
    await coordinator.load(adapter, "overview", loaders);
    expect(loaders.todayHealth).toHaveBeenCalledOnce();
    expect(loaders.health).not.toHaveBeenCalled();
    expect(loaders.projects).not.toHaveBeenCalled();
    expect(loaders.milestones).not.toHaveBeenCalled();
    expect(loaders.journal).not.toHaveBeenCalled();
    await coordinator.load(adapter, "journal", loaders);
    expect(loaders.journal).toHaveBeenCalledOnce();
    const called = Object.entries(loaders).filter(([, loader]) => vi.mocked(loader).mock.calls.length).map(([name]) => name);
    expect(called.sort()).toEqual(["calendar", "captures", "dashboard", "journal", "tasks", "todayHealth"]);
  });

  it("starts fresh after disconnect or a different repository connection", async () => {
    const coordinator = new WorkspaceModuleLoader<object>();
    const loaders = createLoaders();
    const adapter = {};
    await coordinator.load(adapter, "health", loaders);
    coordinator.reset();
    await coordinator.load(adapter, "health", loaders);
    await coordinator.load({}, "health", loaders);
    expect(loaders.health).toHaveBeenCalledTimes(3);
  });

  it("allows a rejected loader to retry without reloading successful dependencies", async () => {
    const coordinator = new WorkspaceModuleLoader<object>();
    const adapter = {};
    const loaders = createLoaders();
    loaders.health = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    await expect(coordinator.load(adapter, "habits", loaders)).rejects.toThrow("offline");
    await coordinator.load(adapter, "habits", loaders);
    expect(loaders.health).toHaveBeenCalledTimes(2);
    expect(loaders.habits).toHaveBeenCalledOnce();
  });

  it("retries a handled health failure only on the next module load", async () => {
    const coordinator = new WorkspaceModuleLoader<object>();
    const adapter = {};
    const loaders = createLoaders();
    loaders.health = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    await coordinator.load(adapter, "habits", loaders);
    // Handling the failure must not spin or restart a network request itself.
    await Promise.resolve();
    expect(loaders.health).toHaveBeenCalledOnce();
    await coordinator.load(adapter, "health", loaders);
    expect(loaders.health).toHaveBeenCalledTimes(2);
    await coordinator.load(adapter, "habits", loaders);
    expect(loaders.health).toHaveBeenCalledTimes(2);
    expect(loaders.habits).toHaveBeenCalledOnce();
  });

  it("keeps old connection failures from invalidating the new connection cache", async () => {
    const coordinator = new WorkspaceModuleLoader<object>();
    const loaders = createLoaders();
    let failOldRequest!: (reason: Error) => void;
    loaders.health = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { failOldRequest = reject; })).mockResolvedValue(undefined);
    const oldRequest = coordinator.load({}, "health", loaders);
    const newAdapter = {};
    await coordinator.load(newAdapter, "health", loaders);
    failOldRequest(new Error("expired connection"));
    await expect(oldRequest).rejects.toThrow("expired connection");
    await coordinator.load(newAdapter, "health", loaders);
    expect(loaders.health).toHaveBeenCalledTimes(2);
  });
});
