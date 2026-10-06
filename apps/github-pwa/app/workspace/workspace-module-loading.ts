import type { WorkspaceTabId } from "./workspace-tab-navigation";

// Include the collections used by each module's forms and mutations as well as
// its visible records. For example, calendar edits validate linked task IDs.
export const WORKSPACE_MODULE_COLLECTIONS = {
  overview: ["dashboard", "captures", "tasks", "calendar"],
  journal: ["journal"],
  travel: ["travel"],
  ideas: ["captures"],
  tasks: ["tasks", "projects", "timeEntries"],
  calendar: ["calendar", "tasks"],
  projects: ["projects", "projectPhases", "milestones", "projectNotes", "projectFiles", "activity", "tasks"],
  learning: ["learning"],
  habits: ["habits", "health"],
  health: ["health"],
  reports: ["tasks", "timeEntries", "projects", "milestones", "calendar", "activity", "reports"],
  // Export reads its own complete snapshot only after the user requests it.
  data: [],
} as const satisfies Record<WorkspaceTabId, readonly string[]>;

export type WorkspaceCollectionId = (typeof WORKSPACE_MODULE_COLLECTIONS)[WorkspaceTabId][number];
// A loader that handles its own errors can report false to allow a later retry.
// Legacy void loaders retain their existing explicit-refresh behavior.
export type WorkspaceCollectionLoaders<Adapter> = Record<WorkspaceCollectionId, (adapter: Adapter) => Promise<void | boolean>>;

/** Share completed and pending reads across tabs, scoped to the current connection. */
export class WorkspaceModuleLoader<Adapter> {
  private adapter: Adapter | null = null;
  private loads = new Map<WorkspaceCollectionId, Promise<void>>();

  reset() {
    this.adapter = null;
    this.loads = new Map();
  }

  async load(adapter: Adapter, tab: WorkspaceTabId, loaders: WorkspaceCollectionLoaders<Adapter>) {
    if (this.adapter !== adapter) {
      this.reset();
      this.adapter = adapter;
    }
    const loads = this.loads;
    await Promise.all(WORKSPACE_MODULE_COLLECTIONS[tab].map((collection) => {
      const existing = loads.get(collection);
      if (existing) return existing;
      const request = Promise.resolve()
        .then(() => loaders[collection](adapter))
        .then((loaded) => {
          if (loaded === false && loads.get(collection) === request) loads.delete(collection);
        })
        .catch((error: unknown) => {
          if (loads.get(collection) === request) loads.delete(collection);
          throw error;
        });
      loads.set(collection, request);
      return request;
    }));
  }
}
