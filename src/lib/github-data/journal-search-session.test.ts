import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubDataError } from "./github-contents";
import { JournalSearchSession } from "./journal-search-session";
import { emptyJournalSearchIndex, JOURNAL_SEARCH_PATH, packJournalSearch, unpackJournalSearch } from "./journal-search";
import { createJournalEntryData } from "./journal-entries";
import { createWorkspaceRecord, recordPath, serializeRecord } from "./protocol";
const owner = "synthetic";
function source(n: number, bodyMarkdown = `合成日记 ${n}`) {
  const id = `entry_${n}`; const timestamp = "2026-11-06T01:00:00Z";
  const record = createWorkspaceRecord({ entityType: "journal_entry", id, ownerId: owner, timestamp, data: createJournalEntryData({ journalDate: "2026-11-06", timezone: "Asia/Shanghai", timestamp, bodyMarkdown }) });
  return { record, path: recordPath("journal_entry", id), blobSha: n.toString(16).padStart(40, "0") };
}
const candidates = (sources: ReturnType<typeof source>[]) => sources.map((file) => ({ ...file, type: "file" as const, name: file.path.split("/").at(-1)!, sizeBytes: new TextEncoder().encode(serializeRecord(file.record)).length }));
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((stop) => stop()); });
function fixture(count = 41) {
  const sources = Array.from({ length: count }, (_, n) => source(n + 1));
  let stored: { text: string; blobSha: string } | null = null;
  const api = {
    readText: vi.fn(async () => { if (!stored) throw new GitHubDataError("missing", 404, "GITHUB_NOT_FOUND"); return { ...stored, path: JOURNAL_SEARCH_PATH, sizeBytes: stored.text.length }; }),
    readBlobTexts: vi.fn(async (files: { path: string; blobSha: string; sizeBytes: number }[]) => files.map((file) => ({ ...file, text: serializeRecord(sources.find((source) => source.path === file.path)!.record) }))),
    writeText: vi.fn(async (input: { path: string; text: string; expectedBlobSha?: string }) => { stored = { text: input.text, blobSha: "f".repeat(40) }; return { path: input.path, blobSha: stored.blobSha, commitSha: "c".repeat(40) }; }),
  };
  const session = new JournalSearchSession(api, owner); cleanups.push(session.subscribe(() => {})); session.setSources(candidates(sources), []);
  return { session, api, sources, stored: () => stored };
}
describe("incremental journal search sessions", () => {
  it("does no historical reads until explicitly built and batches only missing sources", async () => {
    const { session, api, sources } = fixture();
    await session.load();
    expect(api.readText).toHaveBeenCalledTimes(1); expect(api.readBlobTexts).not.toHaveBeenCalled(); expect(api.writeText).not.toHaveBeenCalled();
    await session.build();
    expect(api.readBlobTexts.mock.calls.map(([files]) => files.length)).toEqual([40, 1]);
    expect(api.readBlobTexts).toHaveBeenCalledWith(expect.any(Array), expect.any(Function), expect.any(AbortSignal), { maxBatchFiles: 40 });
    expect(Object.keys(session.state.index.files)).toHaveLength(41);
    expect(api.writeText).toHaveBeenCalledTimes(1); expect(api.writeText.mock.calls[0][0].path).toBe(JOURNAL_SEARCH_PATH);
    await session.build(); expect(api.readBlobTexts).toHaveBeenCalledTimes(2); expect(api.writeText).toHaveBeenCalledTimes(1);
    session.setSources(candidates(sources), sources); await session.sync(); expect(api.writeText).toHaveBeenCalledTimes(1);
  });
  it("reuses a shared compressed index on another device without reading canonical diaries", async () => {
    const { session, api, sources } = fixture(3); await session.load(); await session.build();
    const another = new JournalSearchSession(api, owner); cleanups.push(another.subscribe(() => {})); another.setSources(candidates(sources), []);
    api.readBlobTexts.mockClear(); api.writeText.mockClear(); await another.load(); await another.build();
    expect(Object.keys(another.state.index.files)).toHaveLength(3); expect(api.readBlobTexts).not.toHaveBeenCalled(); expect(api.writeText).not.toHaveBeenCalled();
  });
  it("updates an already loaded new revision without extra body requests or modifying other counts/data", async () => {
    const { session, api, sources } = fixture(2); await session.load(); await session.build(); api.readBlobTexts.mockClear(); api.writeText.mockClear();
    const changed = { ...sources[0], blobSha: "e".repeat(40), record: { ...sources[0].record, data: { ...sources[0].record.data, body_markdown: "修改后的正文" } } };
    session.setSources(candidates([changed, sources[1]]), [changed]); await session.sync();
    expect(api.readBlobTexts).not.toHaveBeenCalled(); expect(api.writeText).toHaveBeenCalledTimes(1);
    const index = unpackJournalSearch(api.writeText.mock.calls[0][0].text, owner);
    expect(index.files[changed.path].segments[0].body).toBe("修改后的正文"); expect(index.files[sources[1].path].segments[0].body).toBe(sources[1].record.data.body_markdown);
  });
  it("keeps completed batches on failure and resumes only the missing batch", async () => {
    const { session, api } = fixture(); await session.load(); const read = api.readBlobTexts.getMockImplementation()!;
    api.readBlobTexts.mockImplementationOnce(read).mockRejectedValueOnce(new Error("network")); await session.build();
    expect(Object.keys(session.state.index.files)).toHaveLength(40); expect(session.state.error).toContain("已完成");
    api.readBlobTexts.mockImplementation(read); await session.build(); expect(api.readBlobTexts.mock.lastCall?.[0]).toHaveLength(1); expect(Object.keys(session.state.index.files)).toHaveLength(41);
  });
  it("blocks writes after unknown sync outcomes until re-reading the remote index", async () => {
    const { session, api } = fixture(1); await session.load(); api.writeText.mockRejectedValueOnce(new Error("unknown write result"));
    await session.build(); expect(session.state.syncError).not.toBe(""); await session.sync(); await session.build(); expect(api.writeText).toHaveBeenCalledTimes(1);
    await session.load(true); await session.sync(); expect(api.writeText).toHaveBeenCalledTimes(2);
  });
  it("does not write after logout/unsubscribe or while a journal is being saved", async () => {
    const { session, api, sources } = fixture(1); await session.load(); session.setBusy(true); session.setSources(candidates(sources), sources); await session.sync(); await session.build();
    expect(api.readBlobTexts).not.toHaveBeenCalled(); expect(api.writeText).not.toHaveBeenCalled(); session.setBusy(false);
    cleanups.splice(0).forEach((stop) => stop()); await session.sync(); expect(api.writeText).not.toHaveBeenCalled();
  });
  it("does not overwrite corrupt or foreign-owner indexes", async () => {
    const { session, api } = fixture(1); api.readText.mockResolvedValueOnce({ path: JOURNAL_SEARCH_PATH, blobSha: "a".repeat(40), sizeBytes: 1, text: packJournalSearch(emptyJournalSearchIndex("other")) });
    await session.load(); await session.build(); expect(session.state.ready).toBe(false); expect(session.state.error).not.toBe(""); expect(api.writeText).not.toHaveBeenCalled();
  });
  it("pauses after a verified batch and preserves a resumable private checkpoint", async () => {
    const { session, api } = fixture(); await session.load();
    const stop = session.subscribe(() => { if (session.state.running && Object.keys(session.state.index.files).length === 40) session.pause(); }); cleanups.push(stop);
    await session.build(); expect(Object.keys(session.state.index.files)).toHaveLength(40); expect(api.writeText).toHaveBeenCalledTimes(1); stop();
    await session.build(); expect(api.readBlobTexts.mock.lastCall?.[0]).toHaveLength(1); expect(Object.keys(session.state.index.files)).toHaveLength(41);
  });
  it("does not treat an unchanged shared-index recheck as a new write", async () => {
    const { session, api } = fixture(1); await session.load(); await session.build(); api.writeText.mockClear(); await session.load(true); await session.sync();
    expect(api.writeText).not.toHaveBeenCalled();
  });
  it("checkpoints a large first build every 200 files and once on completion", async () => {
    const { session, api } = fixture(201); await session.load(); await session.build();
    expect(api.writeText).toHaveBeenCalledTimes(2);
    expect(Object.keys(unpackJournalSearch(api.writeText.mock.calls[0][0].text, owner).files)).toHaveLength(200);
    expect(Object.keys(unpackJournalSearch(api.writeText.mock.calls[1][0].text, owner).files)).toHaveLength(201);
  });
  it("caps each source batch by bytes as well as file count", async () => {
    const { session, api, sources } = fixture(2);
    sources[0] = source(1, "x".repeat(600_000)); sources[1] = source(2, "y".repeat(600_000));
    session.setSources(candidates(sources), []); await session.load(); await session.build();
    expect(api.readBlobTexts.mock.calls.map(([files]) => files.length)).toEqual([1, 1]);
  });
  it("rechecks the active session after asynchronous compression before any upload", async () => {
    const { session, api, sources } = fixture(1); await session.load(); session.setSources(candidates(sources), sources);
    const pending = session.sync(); cleanups.splice(0).forEach((stop) => stop()); await pending;
    expect(api.writeText).not.toHaveBeenCalled();
  });
});
