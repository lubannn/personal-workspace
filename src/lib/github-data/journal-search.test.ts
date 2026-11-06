import { describe, expect, it } from "vitest";
import { createJournalEntryData } from "./journal-entries";
import { createWorkspaceRecord, recordPath, serializeRecord } from "./protocol";
import { createJournalSegmentSnapshot, renderJournalSegmentsMarkdown } from "./journal-segment-codec";
import { emptyJournalSearchIndex, journalSearchFile, journalSearchSource, packJournalSearch, prepareJournalSearch, searchAllJournals, unpackJournalSearch, verifiedJournalSearch } from "./journal-search";
const owner = "synthetic";
const blobSha = "a".repeat(40);
function record(id = "one", date = "2013-06-07", body = "今天去游泳。 Hello WORLD！") {
  return createWorkspaceRecord({ entityType: "journal_entry", id, ownerId: owner, timestamp: `${date}T01:00:00Z`, data: createJournalEntryData({ journalDate: date, timezone: "Asia/Shanghai", bodyMarkdown: body, timestamp: `${date}T01:00:00Z` }) });
}
const path = recordPath("journal_entry", "one");
const index = () => ({ ...emptyJournalSearchIndex(owner), files: { [path]: journalSearchFile(record(), blobSha, owner) } });
const candidate = (sha = blobSha) => ({ type: "file" as const, name: "one.json", path, blobSha: sha, sizeBytes: 100 });

describe("private full journal search", () => {
  it("roundtrips a compressed shared index without changing canonical records", () => {
    const source = index(); const snapshot = JSON.stringify(source);
    const packed = packJournalSearch(source);
    expect(packed).not.toContain("今天去游泳");
    expect(unpackJournalSearch(packed, owner)).toEqual(source);
    expect(JSON.stringify(source)).toBe(snapshot);
  });
  it("searches all years with NFKC, case normalization and AND terms", () => {
    const rows = prepareJournalSearch(index());
    expect(searchAllJournals(rows, "游泳 ｈｅｌｌｏ WORLD").total).toBe(1);
    expect(searchAllJournals(rows, "没有发生").total).toBe(0);
    expect(searchAllJournals(rows, "   ").total).toBe(0);
    expect(searchAllJournals(rows, "2013-06-07").total).toBe(0);
  });
  it("matches a single imported segment, not its entire date or encoded metadata", () => {
    const body = renderJournalSegmentsMarkdown("one", [
      createJournalSegmentSnapshot({ id: "one_early", journalEntryId: "one", localTime: "09:00", occurredAt: "2013-06-07T09:00:00+08:00", bodyMarkdown: "今天去游泳", sortOrder: 0 }),
      createJournalSegmentSnapshot({ id: "one_late", journalEntryId: "one", localTime: "22:00", occurredAt: "2013-06-07T22:00:00+08:00", bodyMarkdown: "晚上看电影", sortOrder: 1 }),
    ]);
    const rows = prepareJournalSearch({ ...index(), files: { [path]: journalSearchFile(record("one", "2013-06-07", body), blobSha, owner) } });
    expect(searchAllJournals(rows, "游泳").rows.map((row) => row.body)).toEqual(["今天去游泳"]);
    expect(searchAllJournals(rows, "游泳 电影").total).toBe(0);
    expect(searchAllJournals(rows, "pw-journal").total).toBe(0);
    expect(rows.map((row) => row.time)).toEqual(["22:00", "09:00"]);
  });
  it("invalidates modified/removed source SHAs and never includes deleted entries", () => {
    expect(verifiedJournalSearch(index(), [candidate()]).missing).toEqual([]);
    expect(verifiedJournalSearch(index(), [candidate("b".repeat(40))]).missing).toHaveLength(1);
    expect(prepareJournalSearch(verifiedJournalSearch(index(), []).index)).toEqual([]);
    const source = record(); source.deleted_at = source.updated_at;
    expect(prepareJournalSearch({ ...index(), files: { [path]: journalSearchFile(source, blobSha, owner) } })).toEqual([]);
  });
  it("rejects other owners, mismatched paths, corrupt and oversized payloads", () => {
    expect(() => unpackJournalSearch(packJournalSearch(index()), "other")).toThrow();
    expect(() => journalSearchFile(record(), blobSha, "other")).toThrow();
    expect(() => journalSearchSource(serializeRecord(record()), "data/journal-entries/wrong.json", blobSha, owner)).toThrow();
    expect(() => unpackJournalSearch('{"format":"bad"}', owner)).toThrow();
    expect(() => unpackJournalSearch('{"format":"journal-search-gzip-v1","bytes":9999999999,"payload":""}', owner)).toThrow();
    expect(() => unpackJournalSearch(packJournalSearch(index()).replace(/"bytes":\d+/, '"bytes":1'), owner)).toThrow();
    expect(() => packJournalSearch({ ...index(), files: { "../../private.json": index().files[path] } })).toThrow();
  });
  it("returns a bounded page but an accurate matching count", () => {
    const row = prepareJournalSearch(index())[0];
    const rows = Array.from({ length: 200 }, () => row);
    expect(searchAllJournals(rows, "游泳", 30)).toMatchObject({ total: 200, rows: Array(30).fill(row) });
    expect(() => searchAllJournals(rows, "游泳", 1001)).toThrow();
  });
});
