import { describe, expect, it, vi } from "vitest";
import { GitHubContentsAdapter, GitHubDataError, type GitHubDirectoryItem, type GitHubStoredFile } from "./github-contents";
import { JournalArchiveReader, type JournalArchiveEntry } from "./journal-archive-reader";
import { createJournalEntryData } from "./journal-entries";
import { createWorkspaceRecord, recordPath } from "./protocol";
import { recentJournalFileCandidates } from "./journal-archive-catalog";

function fixture(date: string, index = 1, sizeBytes = 700) {
  const timestamp = `${date}T12:00:00.000Z`;
  const record = createWorkspaceRecord({
    entityType: "journal_entry", id: `journal_legacy_fake${index}_${date.replaceAll("-", "")}`, ownerId: "fake_owner",
    timestamp, data: createJournalEntryData({ journalDate: date, timezone: "UTC", bodyMarkdown: `Fake journal ${index}`, timestamp }),
  });
  const entry: JournalArchiveEntry = { record, path: recordPath("journal_entry", record.id), blobSha: String(index).padStart(40, "0") };
  const item: GitHubDirectoryItem = { type: "file", path: entry.path, name: `${record.id}.json`, blobSha: entry.blobSha, sizeBytes };
  const stored: GitHubStoredFile = { path: entry.path, blobSha: entry.blobSha, sizeBytes, text: JSON.stringify(record) };
  return { entry, item, stored };
}

type Fixture = ReturnType<typeof fixture>;
function newest(fixtures: Fixture[]) {
  return recentJournalFileCandidates(fixtures.map((file) => file.item), fixtures.length).map((item) => fixtures.find((file) => file.item.path === item.path)!);
}

function monthFiles(month: string, count: number, sizeBytes = 700) {
  return Array.from({ length: count }, (_, index) => fixture(`${month}-${String(index % 30 + 1).padStart(2, "0")}`, index + 1, sizeBytes));
}

function fakeAdapter(fixtures: Fixture[]) {
  const blobs = new Map(fixtures.map((file) => [`${file.item.path}:${file.item.blobSha}`, file.stored]));
  return {
    listDirectory: vi.fn(async () => fixtures.map((file) => file.item)),
    readBlobTexts: vi.fn(async (files: readonly Pick<GitHubDirectoryItem, "path" | "blobSha" | "sizeBytes">[], isCurrent: () => boolean = () => true, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      if (!isCurrent()) throw new DOMException("Fake cancelled batch", "AbortError");
      return files.map((file) => {
        const stored = blobs.get(`${file.path}:${file.blobSha}`);
        if (!stored) throw new Error("Unexpected fake blob request");
        return stored;
      });
    }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function edited(file: Fixture): Fixture {
  const record = { ...file.entry.record, version: 2, data: { ...file.entry.record.data, body_markdown: "Fake newer body" } };
  const blobSha = "f".repeat(40);
  return { entry: { ...file.entry, record, blobSha }, item: { ...file.item, blobSha }, stored: { ...file.stored, blobSha, text: JSON.stringify(record) } };
}

describe("session journal archive reader", () => {
  it("loads a cold 30-day month in one adapter call without requesting unrelated bodies", async () => {
    const september = monthFiles("2026-09", 30);
    const adapter = fakeAdapter([...september, ...monthFiles("2026-10", 4)]);
    const reader = new JournalArchiveReader(adapter);
    const result = await reader.load("2026-09");
    expect(adapter.listDirectory).toHaveBeenCalledExactlyOnceWith("data/journal-entries");
    expect(adapter.readBlobTexts).toHaveBeenCalledExactlyOnceWith(
      newest(september).map(({ item }) => ({ path: item.path, blobSha: item.blobSha, sizeBytes: item.sizeBytes })),
      expect.any(Function), undefined, { maxBatchFiles: 40, onBatch: expect.any(Function) },
    );
    expect(result.entries).toHaveLength(30);
    expect(result.loadedMonths).toEqual(["2026-09"]);
    expect(reader.isMonthLoaded("2026-09")).toBe(true);
  });

  it("integrates with the shared adapter using one cold-month HTTP query and none on a warm revisit", async () => {
    const september = monthFiles("2026-09", 30);
    const fixtures = [...september, fixture("2026-10-01", 101), fixture("2026-10-02", 102)];
    const catalog = fixtures.map(({ item, stored }) => ({ ...item, sizeBytes: new TextEncoder().encode(stored.text).byteLength }));
    const targetBlobs = new Map(september.map(({ stored }) => [stored.blobSha, stored.text]));
    const requestedShas: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe("https://api.github.com/graphql");
      const { variables } = JSON.parse(String(init?.body)) as { variables: Record<string, string> };
      const repository = Object.fromEntries(Object.entries(variables).filter(([key]) => key.startsWith("oid")).map(([key, oid]) => {
        requestedShas.push(oid);
        const text = targetBlobs.get(oid);
        if (text === undefined) throw new Error("Requested a blob outside the fake target month");
        return [`blob${key.slice(3)}`, { __typename: "Blob", oid, byteSize: new TextEncoder().encode(text).byteLength, isTruncated: false, text }];
      }));
      return new Response(JSON.stringify({ data: { repository } }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const adapter = new GitHubContentsAdapter({ owner: "fake-owner", repository: "fake-journals", token: "fake-token" }, fetcher);
    const listing = vi.spyOn(adapter, "listJournalDirectory").mockResolvedValue(catalog);
    const reader = new JournalArchiveReader(adapter);
    expect((await reader.load("2026-09")).entries).toHaveLength(30);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(requestedShas.sort()).toEqual([...targetBlobs.keys()].sort());
    await reader.load("2026-08");
    expect((await reader.load("2026-09")).entries).toHaveLength(30);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(listing).toHaveBeenCalledTimes(1);
  });

  it("loads a large fresh catalog through two metadata reads before one recent-body query", async () => {
    const recent = [fixture("2026-10-01", 10_001), fixture("2026-10-02", 10_002), fixture("2026-10-03", 10_003)];
    const fixtures = [...monthFiles("2026-09", 2313), ...recent];
    const catalog = fixtures.map(({ item, stored }) => ({ ...item, sizeBytes: new TextEncoder().encode(stored.text).byteLength }));
    const recentBlobs = new Map(recent.map(({ stored }) => [stored.blobSha, stored.text]));
    const requestedShas: string[] = [];
    const treeRoot = "https://api.github.com/repos/fake-owner/fake-journals/git/trees/";
    const journalSha = "b".repeat(40);
    const treeResponses = new Map<string, unknown>([
      ["https://api.github.com/repos/fake-owner/fake-journals/contents/data?ref=main", [{ path: "data/journal-entries", name: "journal-entries", type: "dir", sha: journalSha, size: 0 }]],
      [`${treeRoot}${journalSha}`, { truncated: false, tree: catalog.map((file) => ({ path: file.name, type: "blob", sha: file.blobSha, size: file.sizeBytes })) }],
    ]);
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const tree = treeResponses.get(String(url));
      if (tree) {
        return new Response(JSON.stringify(tree), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      expect(url).toBe("https://api.github.com/graphql");
      const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, string> };
      expect(query).toContain("ReadWorkspaceBlobs");
      const repository = Object.fromEntries(Object.entries(variables).filter(([key]) => key.startsWith("oid")).map(([key, oid]) => {
        requestedShas.push(oid);
        const text = recentBlobs.get(oid);
        if (text === undefined) throw new Error("Requested a historical fake journal body");
        return [`blob${key.slice(3)}`, { __typename: "Blob", oid, byteSize: new TextEncoder().encode(text).byteLength, isTruncated: false, text }];
      }));
      return new Response(JSON.stringify({ data: { repository } }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const adapter = new GitHubContentsAdapter({ owner: "fake-owner", repository: "fake-journals", branch: "main", token: "fake-token" }, fetcher);
    const onCatalog = vi.fn(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const reader = new JournalArchiveReader(adapter);
    const snapshot = await reader.load(undefined, { onCatalog });
    expect(onCatalog).toHaveBeenCalledExactlyOnceWith({ catalog, catalogReady: true, entries: [], loadedMonths: [] });
    expect(snapshot.catalog).toHaveLength(2316);
    expect(snapshot.entries).toHaveLength(3);
    expect(requestedShas.sort()).toEqual([...recentBlobs.keys()].sort());
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([...treeResponses.keys(), "https://api.github.com/graphql"]);
    expect(await reader.load()).toEqual(snapshot);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("reuses a warm month and retains entries from every visited month", async () => {
    const adapter = fakeAdapter([...monthFiles("2026-09", 30), ...monthFiles("2026-10", 4)]);
    const reader = new JournalArchiveReader(adapter);
    await reader.load("2026-09");
    await reader.load("2026-10");
    const result = await reader.load("2026-09");
    expect(adapter.listDirectory).toHaveBeenCalledTimes(1);
    expect(adapter.readBlobTexts).toHaveBeenCalledTimes(2);
    expect(result.entries).toHaveLength(34);
    expect(result.loadedMonths).toEqual(["2026-09", "2026-10"]);
    expect(reader.snapshot()).toEqual(result);
  });

  it("limits recent reads to three candidates and navigates without relisting", async () => {
    const adapter = fakeAdapter([...monthFiles("2026-09", 30), ...monthFiles("2026-10", 4)]);
    const reader = new JournalArchiveReader(adapter);
    expect((await reader.load()).entries).toHaveLength(3);
    expect(adapter.readBlobTexts.mock.calls[0]?.[0]).toHaveLength(3);
    expect(adapter.readBlobTexts.mock.calls[0]?.[0].every((file) => file.path.includes("202610"))).toBe(true);
    await reader.load("2026-09");
    await reader.load();
    expect(adapter.listDirectory).toHaveBeenCalledTimes(1);
    expect(adapter.readBlobTexts).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])("caches an empty catalog, including a missing directory (%s)", async (notFound) => {
    const adapter = fakeAdapter([]);
    if (notFound) adapter.listDirectory.mockRejectedValue(new GitHubDataError("Missing fake directory", 404, "GITHUB_NOT_FOUND"));
    const reader = new JournalArchiveReader(adapter);
    const onCatalog = vi.fn();
    expect(reader.snapshot().catalogReady).toBe(false);
    await reader.load(undefined, { onCatalog });
    expect(onCatalog).toHaveBeenCalledExactlyOnceWith({ catalog: [], catalogReady: true, entries: [], loadedMonths: [] });
    await reader.load("2026-09");
    expect(await reader.load()).toEqual({ catalog: [], catalogReady: true, entries: [], loadedMonths: ["2026-09"] });
    expect(adapter.listDirectory).toHaveBeenCalledTimes(1);
    expect(adapter.readBlobTexts).not.toHaveBeenCalled();
  });

  it("publishes a ready catalog before deferred bodies and retains it after a body failure", async () => {
    const fixture = monthFiles("2026-09", 1)[0];
    const adapter = fakeAdapter([fixture]);
    const body = deferred<GitHubStoredFile[]>();
    adapter.readBlobTexts.mockReturnValue(body.promise);
    const onCatalog = vi.fn(() => expect(adapter.readBlobTexts).not.toHaveBeenCalled());
    const reader = new JournalArchiveReader(adapter);
    const load = reader.load(undefined, { onCatalog });
    await vi.waitFor(() => expect(adapter.readBlobTexts).toHaveBeenCalledTimes(1));
    const ready = { catalog: [fixture.item], catalogReady: true, entries: [], loadedMonths: [] };
    expect(onCatalog).toHaveBeenCalledExactlyOnceWith(ready);
    expect(reader.snapshot()).toEqual(ready);
    body.reject(new Error("Fake body unavailable"));
    await expect(load).rejects.toThrow("Fake body unavailable");
    expect(reader.snapshot()).toEqual(ready);
    expect(onCatalog).toHaveBeenCalledTimes(1);
  });

  it("publishes verified rows before the month's remaining bodies and retains them if a later chunk fails", async () => {
    const fixtures = monthFiles("2026-09", 8);
    const adapter = fakeAdapter(fixtures);
    const body = deferred<GitHubStoredFile[]>();
    const pending = vi.fn<GitHubContentsAdapter["readBlobTexts"]>().mockReturnValueOnce(body.promise).mockImplementation(adapter.readBlobTexts);
    const reader = new JournalArchiveReader({ ...adapter, readBlobTexts: pending });
    const onProgress = vi.fn();
    const load = reader.load("2026-09", { onProgress });
    const failed = expect(load).rejects.toThrow("Later chunk unavailable");
    await vi.waitFor(() => expect(pending).toHaveBeenCalledTimes(1));
    pending.mock.calls[0][3]?.onBatch?.(fixtures.slice(4).map((file) => file.stored));
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress.mock.lastCall?.[0].entries).toHaveLength(4);
    expect(reader.isMonthLoaded("2026-09")).toBe(false);
    body.reject(new Error("Later chunk unavailable"));
    await failed;
    expect(reader.snapshot().entries).toHaveLength(4);
    await reader.load("2026-09");
    expect(pending.mock.calls[1][0]).toHaveLength(4);
  });

  it("rejects obsolete progress after navigation cancellation instead of publishing old rows", async () => {
    const fixtures = monthFiles("2026-09", 1);
    const pending = vi.fn<GitHubContentsAdapter["readBlobTexts"]>();
    const body = deferred<GitHubStoredFile[]>();
    pending.mockReturnValue(body.promise);
    const reader = new JournalArchiveReader({ ...fakeAdapter(fixtures), readBlobTexts: pending });
    const controller = new AbortController();
    const onProgress = vi.fn();
    const load = reader.load("2026-09", { signal: controller.signal, onProgress });
    const rejected = expect(load).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(pending).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(() => pending.mock.calls[0][3]?.onBatch?.([fixtures[0].stored])).toThrow();
    body.resolve([fixtures[0].stored]);
    await rejected;
    expect(onProgress).not.toHaveBeenCalled();
    expect(reader.snapshot().entries).toEqual([]);
  });

  it("does not publish or mark a failed directory read ready", async () => {
    const adapter = fakeAdapter([]);
    adapter.listDirectory.mockRejectedValue(new Error("Fake directory unavailable"));
    const onCatalog = vi.fn();
    const reader = new JournalArchiveReader(adapter);
    await expect(reader.load(undefined, { onCatalog })).rejects.toThrow("Fake directory unavailable");
    expect(onCatalog).not.toHaveBeenCalled();
    expect(reader.snapshot()).toEqual({ catalog: [], catalogReady: false, entries: [], loadedMonths: [] });
    expect(adapter.readBlobTexts).not.toHaveBeenCalled();
  });

  it("publishes only the current catalog when a refresh overtakes an earlier listing", async () => {
    const old = fixture("2026-09-01");
    const changed = edited(old);
    const adapter = fakeAdapter([old]);
    const directory = deferred<GitHubDirectoryItem[]>();
    adapter.listDirectory.mockReturnValueOnce(directory.promise).mockResolvedValueOnce([changed.item]);
    adapter.readBlobTexts.mockResolvedValue([changed.stored]);
    const firstCatalog = vi.fn();
    const refreshedCatalog = vi.fn();
    const reader = new JournalArchiveReader(adapter);
    const first = reader.load(undefined, { onCatalog: firstCatalog });
    await reader.load(undefined, { refresh: true, onCatalog: refreshedCatalog });
    directory.resolve([old.item]);
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(firstCatalog).not.toHaveBeenCalled();
    expect(refreshedCatalog).toHaveBeenCalledExactlyOnceWith({ catalog: [changed.item], catalogReady: true, entries: [], loadedMonths: [] });
    expect(reader.snapshot().entries).toEqual([changed.entry]);
  });

  it("coalesces concurrent initial directory requests", async () => {
    const fixtures = [...monthFiles("2026-09", 2), ...monthFiles("2026-10", 2)];
    const adapter = fakeAdapter(fixtures);
    const directory = deferred<GitHubDirectoryItem[]>();
    adapter.listDirectory.mockReturnValue(directory.promise);
    const reader = new JournalArchiveReader(adapter);
    const september = reader.load("2026-09");
    const october = reader.load("2026-10");
    directory.resolve(fixtures.map((file) => file.item));
    await Promise.all([september, october]);
    expect(adapter.listDirectory).toHaveBeenCalledTimes(1);
    expect(reader.snapshot().loadedMonths).toEqual(["2026-09", "2026-10"]);
  });

  it("refreshes changed SHAs only and preserves unchanged cached months", async () => {
    const fixtures = [...monthFiles("2026-09", 2), ...monthFiles("2026-10", 1)];
    const adapter = fakeAdapter(fixtures);
    const reader = new JournalArchiveReader(adapter);
    await reader.load("2026-09");
    await reader.load("2026-10");
    const changed = edited(fixtures[0]);
    adapter.listDirectory.mockResolvedValue([changed.item, fixtures[1].item, fixtures[2].item]);
    adapter.readBlobTexts.mockResolvedValueOnce([changed.stored]);
    const result = await reader.load("2026-09", { refresh: true });
    expect(adapter.listDirectory).toHaveBeenCalledTimes(2);
    expect(adapter.readBlobTexts.mock.calls[2]?.[0]).toEqual([{ path: changed.entry.path, blobSha: changed.entry.blobSha, sizeBytes: changed.item.sizeBytes }]);
    expect(result.entries).toHaveLength(3);
    expect(result.entries.find((entry) => entry.path === changed.entry.path)).toEqual(changed.entry);
    expect(result.entries).toContainEqual(fixtures[2].entry);
    expect(result.loadedMonths).toEqual(["2026-09"]);
    await reader.load("2026-10");
    expect(adapter.readBlobTexts).toHaveBeenCalledTimes(3);
  });

  it("drops removed and changed cached bodies without downloading unrelated months on refresh", async () => {
    const fixtures = [...monthFiles("2026-09", 2), ...monthFiles("2026-10", 1)];
    const adapter = fakeAdapter(fixtures);
    const reader = new JournalArchiveReader(adapter);
    await reader.load("2026-09");
    const changed = edited(fixtures[0]);
    adapter.listDirectory.mockResolvedValue([changed.item, fixtures[2].item]);
    const onCatalog = vi.fn();
    const result = await reader.load("2026-10", { refresh: true, onCatalog });
    expect(onCatalog).toHaveBeenCalledExactlyOnceWith({ catalog: [changed.item, fixtures[2].item], catalogReady: true, entries: [], loadedMonths: [] });
    expect(result.entries).toEqual([fixtures[2].entry]);
    expect(adapter.readBlobTexts).toHaveBeenCalledTimes(2);
    expect(adapter.readBlobTexts.mock.calls[1]?.[0]).toEqual([{ path: fixtures[2].item.path, blobSha: fixtures[2].item.blobSha, sizeBytes: fixtures[2].item.sizeBytes }]);
  });

  it("keeps completed batches after a later failure and retries only missing bodies", async () => {
    const fixtures = newest(monthFiles("2026-09", 81));
    const adapter = fakeAdapter(fixtures);
    adapter.readBlobTexts.mockResolvedValueOnce(fixtures.slice(0, 40).map((file) => file.stored)).mockRejectedValueOnce(new Error("Fake network failure"));
    const reader = new JournalArchiveReader(adapter);
    await expect(reader.load("2026-09")).rejects.toThrow("Fake network failure");
    expect(reader.snapshot().entries).toHaveLength(40);
    expect(reader.isMonthLoaded("2026-09")).toBe(false);
    expect((await reader.load("2026-09")).entries).toHaveLength(81);
    expect(adapter.readBlobTexts.mock.calls.map(([files]) => files.length)).toEqual([40, 40, 40, 1]);
    expect(adapter.readBlobTexts.mock.calls[2]?.[0]).not.toContainEqual({ path: fixtures[0].item.path, blobSha: fixtures[0].item.blobSha, sizeBytes: fixtures[0].item.sizeBytes });
    expect(adapter.listDirectory).toHaveBeenCalledTimes(1);
  });

  it("bounds batches by one MiB while allowing one oversized file", async () => {
    const fixtures = [fixture("2026-09-01", 1, 600_000), fixture("2026-09-02", 2, 600_000), fixture("2026-09-03", 3, 2_000_000), fixture("2026-09-04", 4, 10)];
    const adapter = fakeAdapter(fixtures);
    await new JournalArchiveReader(adapter).load("2026-09");
    expect(adapter.readBlobTexts.mock.calls.map(([files]) => files.length)).toEqual([1, 1, 1, 1]);
  });

  it("does not start an already-cancelled load or publish a cancelled directory response", async () => {
    const adapter = fakeAdapter(monthFiles("2026-09", 1));
    const reader = new JournalArchiveReader(adapter);
    const onCatalog = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(reader.load("2026-09", { signal: controller.signal, onCatalog })).rejects.toMatchObject({ name: "AbortError" });
    expect(adapter.listDirectory).not.toHaveBeenCalled();

    const directory = deferred<GitHubDirectoryItem[]>();
    adapter.listDirectory.mockReturnValue(directory.promise);
    const active = new AbortController();
    const load = reader.load("2026-09", { signal: active.signal, onCatalog });
    active.abort();
    directory.resolve(monthFiles("2026-09", 1).map((file) => file.item));
    await expect(load).rejects.toMatchObject({ name: "AbortError" });
    expect(reader.snapshot()).toEqual({ catalog: [], catalogReady: false, entries: [], loadedMonths: [] });
    expect(onCatalog).not.toHaveBeenCalled();
    expect(adapter.readBlobTexts).not.toHaveBeenCalled();
    expect((await reader.load("2026-09")).entries).toHaveLength(1);
    expect(adapter.listDirectory).toHaveBeenCalledTimes(1);
  });

  it("retains completed batches but never publishes bodies received after cancellation", async () => {
    const fixtures = newest(monthFiles("2026-09", 41));
    const adapter = fakeAdapter(fixtures);
    const pending = deferred<GitHubStoredFile[]>();
    adapter.readBlobTexts.mockResolvedValueOnce(fixtures.slice(0, 40).map((file) => file.stored)).mockReturnValueOnce(pending.promise);
    const reader = new JournalArchiveReader(adapter);
    const controller = new AbortController();
    const load = reader.load("2026-09", { signal: controller.signal });
    await vi.waitFor(() => expect(adapter.readBlobTexts).toHaveBeenCalledTimes(2));
    controller.abort();
    pending.resolve([fixtures[40].stored]);
    await expect(load).rejects.toMatchObject({ name: "AbortError" });
    expect(reader.snapshot().entries).toHaveLength(40);
    expect(reader.isMonthLoaded("2026-09")).toBe(false);
    expect(adapter.readBlobTexts.mock.calls.every(([, isCurrent, signal]) => !isCurrent?.() && signal === controller.signal)).toBe(true);
  });

  it("keeps a newly saved revision when an older body request completes", async () => {
    const old = fixture("2026-09-01");
    const saved = edited(old);
    const adapter = fakeAdapter([old]);
    const pending = deferred<GitHubStoredFile[]>();
    adapter.readBlobTexts.mockReturnValue(pending.promise);
    const reader = new JournalArchiveReader(adapter);
    const load = reader.load("2026-09");
    await vi.waitFor(() => expect(adapter.readBlobTexts).toHaveBeenCalledTimes(1));
    reader.remember(saved.entry);
    pending.resolve([old.stored]);
    expect((await load).entries).toEqual([saved.entry]);
    reader.remember(old.entry);
    expect(reader.snapshot().entries).toEqual([saved.entry]);
    expect(reader.snapshot().catalog[0].blobSha).toBe(saved.entry.blobSha);
  });

  it("merges edits and newly saved files into an older in-flight directory listing", async () => {
    const old = fixture("2026-09-01");
    const saved = edited(old);
    const added = fixture("2026-09-02", 2);
    const adapter = fakeAdapter([old]);
    const directory = deferred<GitHubDirectoryItem[]>();
    adapter.listDirectory.mockReturnValue(directory.promise);
    const reader = new JournalArchiveReader(adapter);
    const onCatalog = vi.fn();
    const load = reader.load("2026-09", { onCatalog });
    reader.remember(saved.entry);
    reader.remember(added.entry);
    expect(reader.snapshot().catalogReady).toBe(false);
    directory.resolve([old.item]);
    const result = await load;
    expect(onCatalog).toHaveBeenCalledExactlyOnceWith({ catalog: result.catalog, catalogReady: true, entries: [saved.entry, added.entry], loadedMonths: [] });
    expect(result.entries).toEqual([saved.entry, added.entry]);
    expect(result.catalog.map((file) => file.blobSha)).toEqual([saved.entry.blobSha, added.entry.blobSha]);
    expect(adapter.readBlobTexts).not.toHaveBeenCalled();
  });

  it("does not resurrect an older body when a refresh finishes first", async () => {
    const old = fixture("2026-09-01");
    const changed = edited(old);
    const adapter = fakeAdapter([old]);
    const oldBody = deferred<GitHubStoredFile[]>();
    adapter.readBlobTexts.mockReturnValueOnce(oldBody.promise).mockResolvedValueOnce([changed.stored]);
    const reader = new JournalArchiveReader(adapter);
    const first = reader.load("2026-09");
    await vi.waitFor(() => expect(adapter.readBlobTexts).toHaveBeenCalledTimes(1));
    adapter.listDirectory.mockResolvedValue([changed.item]);
    await reader.load("2026-09", { refresh: true });
    oldBody.resolve([old.stored]);
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(reader.snapshot().entries).toEqual([changed.entry]);
  });

  it("keeps the record's actual date for older submission-date filenames", async () => {
    const file = fixture("2026-09-30");
    const path = "data/journal-entries/journal_entry_20261001020000000_abcd.json";
    file.entry.path = path;
    file.item = { ...file.item, path, name: path.split("/").at(-1)! };
    file.stored.path = path;
    const reader = new JournalArchiveReader(fakeAdapter([file]));
    const result = await reader.load("2026-09");
    expect(result.entries[0].record.data.journal_date).toBe("2026-09-30");
    expect(result.entries[0].path).toBe(path);
  });
});
