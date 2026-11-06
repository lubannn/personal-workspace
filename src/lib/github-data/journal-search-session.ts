import { GitHubDataError, type GitHubContentsAdapter, type GitHubDirectoryItem } from "./github-contents";
import type { JournalEntryRecord } from "./journal-entries";
import { recordPath } from "./protocol";
import { emptyJournalSearchIndex, journalSearchFile, journalSearchSource, JOURNAL_SEARCH_PATH, packJournalSearch, unpackJournalSearch, verifiedJournalSearch, type JournalSearchIndex } from "./journal-search";

type Source = { record: JournalEntryRecord; path: string; blobSha: string };
type State = { index: JournalSearchIndex; ready: boolean; reading: boolean; running: boolean; syncing: boolean; error: string; syncError: string };
type Reader = Pick<GitHubContentsAdapter, "readText" | "readBlobTexts" | "writeText">;
// Scoped to the authenticated adapter, never browser plaintext storage or a public service.
export class JournalSearchSession {
  state: State;
  private listeners = new Set<() => void>();
  private catalog: GitHubDirectoryItem[] = [];
  private loaded: Source[] = [];
  private controller?: AbortController;
  private request?: Promise<void>;
  private blobSha?: string;
  private dirty = false;
  private busy = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private adapter: Reader, readonly ownerId: string) { this.state = { index: emptyJournalSearchIndex(ownerId), ready: false, reading: false, running: false, syncing: false, error: "", syncError: "" }; }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); if (!this.listeners.size) { this.controller?.abort(); clearTimeout(this.timer); } };
  };
  private publish(patch: Partial<State>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener()); }
  private schedule() {
    clearTimeout(this.timer);
    if (!this.dirty || !this.state.ready || this.state.reading || this.busy || this.state.syncError || this.state.running || this.state.syncing || !this.listeners.size) return;
    this.timer = setTimeout(() => { void this.sync(); }, 2000);
  }
  setSources(catalog: GitHubDirectoryItem[], loaded: Source[]) {
    this.catalog = catalog; this.loaded = loaded;
    if (!this.state.ready) return;
    const verified = verifiedJournalSearch(this.state.index, catalog).index.files;
    let files = Object.keys(verified).length === Object.keys(this.state.index.files).length ? this.state.index.files : verified;
    const versions = new Map(catalog.map((file) => [file.path, file.blobSha]));
    for (const source of loaded) if (versions.get(source.path) === source.blobSha && files[source.path]?.blobSha !== source.blobSha) {
      try {
        if (recordPath("journal_entry", source.record.id) !== source.path) continue;
        files = { ...files, [source.path]: journalSearchFile(source.record, source.blobSha, this.ownerId) };
      } catch { /* Invalid records remain missing, never guessed. */ }
    }
    if (files !== this.state.index.files) { this.dirty = true; this.publish({ index: { ...this.state.index, files } }); }
    this.schedule();
  }
  load(refresh = false): Promise<void> {
    if (this.request) return this.request;
    if (this.state.ready && !refresh) { this.schedule(); return Promise.resolve(); }
    clearTimeout(this.timer);
    this.publish({ reading: true, error: "", syncError: "" });
    this.request = (async () => {
      try {
        let index = emptyJournalSearchIndex(this.ownerId), blobSha: string | undefined;
        try { const stored = await this.adapter.readText(JOURNAL_SEARCH_PATH); index = unpackJournalSearch(stored.text, this.ownerId); blobSha = stored.blobSha; }
        catch (error) { if (!(error instanceof GitHubDataError && error.status === 404)) throw error; }
        const retained = verifiedJournalSearch(this.state.index, this.catalog).index.files;
        const changed = Object.entries(retained).some(([path, file]) => index.files[path]?.blobSha !== file.blobSha);
        index = { ...index, files: { ...index.files, ...retained } };
        this.blobSha = blobSha; this.dirty = changed;
        this.publish({ index, ready: true, error: "", syncError: "" });
        if (this.listeners.size) this.setSources(this.catalog, this.loaded);
      } catch { this.publish({ error: "搜索索引读取失败。可重试读取，不会自动扫描历史或覆盖索引。" }); }
      finally { this.request = undefined; this.publish({ reading: false }); this.schedule(); }
    })();
    return this.request;
  }
  pause() { this.controller?.abort(); }
  setBusy(busy: boolean) { this.busy = busy; if (busy) { clearTimeout(this.timer); this.pause(); } else this.schedule(); }
  async build() {
    if (!this.state.ready || this.state.reading || this.busy || this.state.running || !this.listeners.size) return;
    const controller = new AbortController(); this.controller = controller;
    clearTimeout(this.timer);
    this.publish({ running: true, error: "" });
    try {
      const pending = verifiedJournalSearch(this.state.index, this.catalog).missing;
      let sinceCheckpoint = 0;
      for (let offset = 0; offset < pending.length;) {
        controller.signal.throwIfAborted();
        const batch: GitHubDirectoryItem[] = []; let bytes = 0;
        do { const file = pending[offset++]; batch.push(file); bytes += file.sizeBytes; }
        while (offset < pending.length && batch.length < 40 && bytes + pending[offset].sizeBytes <= 1024 * 1024);
        const stored = await this.adapter.readBlobTexts(batch, () => this.listeners.size > 0 && !controller.signal.aborted, controller.signal, { maxBatchFiles: 40 });
        controller.signal.throwIfAborted();
        const rows = stored.map((file) => {
          const expected = batch.find((candidate) => candidate.path === file.path);
          if (!expected || file.blobSha !== expected.blobSha) throw new Error("JOURNAL_SEARCH_VERSION_CHANGED");
          return [file.path, journalSearchSource(file.text, file.path, file.blobSha, this.ownerId)] as const;
        });
        if (rows.length !== batch.length || new Set(rows.map(([path]) => path)).size !== batch.length) throw new Error("JOURNAL_SEARCH_INCOMPLETE_BATCH");
        this.dirty = true;
        this.publish({ index: { ...this.state.index, files: { ...this.state.index.files, ...Object.fromEntries(rows) } } });
        sinceCheckpoint += rows.length;
        if (sinceCheckpoint >= 200) { await this.sync(); sinceCheckpoint = 0; }
        // Yield between validated batches so pause/navigation stay responsive.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch { if (!controller.signal.aborted) this.publish({ error: "部分日记读取失败。已完成的索引保留，继续时只补读剩余记录。" }); }
    finally { this.controller = undefined; this.publish({ running: false }); if (this.listeners.size) await this.sync(); }
  }
  async sync() {
    if (!this.state.ready || this.state.reading || this.busy || this.state.syncing || this.state.syncError || !this.dirty || !this.listeners.size) return;
    clearTimeout(this.timer);
    const source = this.state.index;
    const index = verifiedJournalSearch(source, this.catalog).index;
    if (!Object.keys(index.files).length) return;
    this.publish({ syncing: true, syncError: "" });
    try {
      const result = await this.adapter.writeText({ path: JOURNAL_SEARCH_PATH, text: packJournalSearch(index), expectedBlobSha: this.blobSha, message: "journal: update private incremental search index" });
      this.blobSha = result.blobSha;
      if (this.state.index === source) { this.dirty = false; this.publish({ index }); }
    } catch { this.publish({ syncError: "索引保留在本次会话，尚未同步。请先重新核对索引，再继续；不会盲目覆盖其他设备的更新。" }); }
    finally { this.publish({ syncing: false }); if (!this.state.syncError) this.schedule(); }
  }
}
const sessions = new WeakMap<GitHubContentsAdapter, Map<string, JournalSearchSession>>();
export function journalSearchSession(adapter: GitHubContentsAdapter, ownerId: string) {
  let owners = sessions.get(adapter); if (!owners) { owners = new Map(); sessions.set(adapter, owners); }
  let session = owners.get(ownerId); if (!session) { session = new JournalSearchSession(adapter, ownerId); owners.set(ownerId, session); }
  return session;
}
