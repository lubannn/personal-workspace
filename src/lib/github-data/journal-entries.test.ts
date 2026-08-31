import { describe, expect, it } from "vitest";

import { createWorkspaceRecord, serializeRecord, setWorkspaceRecordDeleted, updateWorkspaceRecord } from "./protocol";
import { activeJournalEntries, createJournalEntryData, filterJournalEntries, hasActiveDailyJournalDate, journalEntryMarkdownFileName, parseJournalEntryRecord, recentJournalEntries, renderJournalEntryMarkdown, shiftJournalMonth, trashedJournalEntries, updateJournalEntryData } from "./journal-entries";

function journal(id: string, date: string, timestamp = `${date}T12:00:00.000Z`) {
  return createWorkspaceRecord({ entityType: "journal_entry" as const, id, ownerId: "owner_1", timestamp, data: createJournalEntryData({ journalDate: date, timezone: "Asia/Shanghai", title: "日记", bodyMarkdown: "今天完成了验收。", mood: "平静", timestamp }) });
}

describe("journal entries", () => {
  it("creates and parses a restricted daily canonical record without claiming Obsidian sync", () => {
    const record = journal("journal_1", "2026-08-31");
    expect(parseJournalEntryRecord(serializeRecord(record))).toEqual(record);
    expect(record.data).toMatchObject({ entry_kind: "daily", sensitivity: "restricted", current_revision_id: null, obsidian_document_id: null, sync_status: "not_configured" });
    const versioned = { ...record, data: { ...record.data, current_revision_id: "revision_1" } };
    expect(parseJournalEntryRecord(serializeRecord(versioned)).data.current_revision_id).toBe("revision_1");
    expect(() => parseJournalEntryRecord(serializeRecord({ ...record, data: { ...record.data, current_revision_id: "invalid/revision" } }))).toThrow("INVALID_JOURNAL_ENTRY_RECORD");
  });

  it("updates editable content while preserving the journal date and first entry instant", () => {
    const record = journal("journal_1", "2026-08-31");
    const data = updateJournalEntryData(record, { title: "复盘", bodyMarkdown: "修订后的正文", weather: "晴", timestamp: "2026-08-31T13:00:00.000Z" });
    const updated = updateWorkspaceRecord(record, data, "2026-08-31T13:00:00.000Z");
    expect(updated.version).toBe(2);
    expect(updated.data).toMatchObject({ journal_date: "2026-08-31", first_entry_at: "2026-08-31T12:00:00.000Z", last_entry_at: "2026-08-31T13:00:00.000Z", body_markdown: "修订后的正文" });
  });

  it("enforces valid dates, timezones, content bounds and monotonic entry instants", () => {
    expect(() => createJournalEntryData({ journalDate: "2026-02-31", timezone: "Asia/Shanghai", bodyMarkdown: "x" })).toThrow("INVALID_JOURNAL_ENTRY_DETAILS");
    expect(() => createJournalEntryData({ journalDate: "2026-08-31", timezone: "Mars/Olympus", bodyMarkdown: "x" })).toThrow("INVALID_JOURNAL_ENTRY_DETAILS");
    expect(() => createJournalEntryData({ journalDate: "2026-08-31", timezone: "Asia/Shanghai", bodyMarkdown: "   " })).toThrow("INVALID_JOURNAL_ENTRY_DETAILS");
    const record = journal("journal_1", "2026-08-31");
    expect(() => updateJournalEntryData(record, { bodyMarkdown: "倒流", timestamp: "2026-08-31T11:00:00.000Z" })).toThrow("INVALID_JOURNAL_ENTRY_DETAILS");
  });

  it("sorts active and trashed records deterministically and detects daily collisions", () => {
    const older = journal("journal_a", "2026-08-30");
    const newer = journal("journal_b", "2026-08-31");
    const trashed = setWorkspaceRecordDeleted(journal("journal_c", "2026-08-29"), "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
    expect(activeJournalEntries([older, trashed, newer]).map((record) => record.id)).toEqual(["journal_b", "journal_a"]);
    expect(recentJournalEntries([older, trashed, newer], 1).map((record) => record.id)).toEqual(["journal_b"]);
    expect(trashedJournalEntries([older, trashed, newer]).map((record) => record.id)).toEqual(["journal_c"]);
    expect(hasActiveDailyJournalDate([older, trashed, newer], "2026-08-31")).toBe(true);
    expect(hasActiveDailyJournalDate([older, trashed, newer], "2026-08-29")).toBe(false);
  });

  it("derives month and multi-term search only from necessary canonical fields", () => {
    const august = journal("journal_august", "2026-08-31");
    const september = createWorkspaceRecord({ entityType: "journal_entry", id: "opaque_internal_id", ownerId: "owner_1", timestamp: "2026-09-01T12:00:00.000Z", data: createJournalEntryData({ journalDate: "2026-09-01", timezone: "Asia/Shanghai", title: "发布复盘", bodyMarkdown: "完成 Journal 搜索验收。", mood: "专注", weather: "多云", timestamp: "2026-09-01T12:00:00.000Z" }) });
    expect(filterJournalEntries([august, september], { view: "active", month: "2026-09", query: "ＪＯＵＲＮＡＬ 专注" }).map((record) => record.id)).toEqual(["opaque_internal_id"]);
    expect(filterJournalEntries([august, september], { view: "active", query: "多云 发布" }).map((record) => record.id)).toEqual(["opaque_internal_id"]);
    expect(filterJournalEntries([august, september], { view: "active", query: "opaque_internal_id" })).toEqual([]);
  });

  it("keeps trash search separate and shifts months across year boundaries", () => {
    const active = journal("journal_active", "2026-12-31");
    const trashed = setWorkspaceRecordDeleted(journal("journal_trash", "2027-01-01"), "2027-01-02T00:00:00.000Z", "2027-01-02T00:00:00.000Z");
    expect(filterJournalEntries([active, trashed], { view: "trash", month: "2027-01", query: "验收" }).map((record) => record.id)).toEqual(["journal_trash"]);
    expect(filterJournalEntries([active, trashed], { view: "active", month: "2027-01" })).toEqual([]);
    expect(shiftJournalMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftJournalMonth("2027-01", -1)).toBe("2026-12");
    expect(shiftJournalMonth("0099-12", 1)).toBe("0100-01");
    expect(() => shiftJournalMonth("2026-13", 1)).toThrow("INVALID_JOURNAL_MONTH");
    expect(() => shiftJournalMonth("0001-01", -1)).toThrow("INVALID_JOURNAL_MONTH");
  });

  it("renders portable Markdown with escaped headings and canonical traceability", () => {
    const record = createWorkspaceRecord({ entityType: "journal_entry", id: "journal_md", ownerId: "owner_1", timestamp: "2026-08-31T12:00:00.000Z", data: createJournalEntryData({ journalDate: "2026-08-31", timezone: "Asia/Shanghai", title: "*周日* [复盘]", bodyMarkdown: "## 正文\n\n保留 Markdown。", mood: "平静", weather: "晴", timestamp: "2026-08-31T12:00:00.000Z" }) });
    const markdown = renderJournalEntryMarkdown(record);
    expect(markdown).toContain('journal_id: "journal_md"');
    expect(markdown).toContain("# \\*周日\\* \\[复盘\\]");
    expect(markdown).toContain("## 正文\n\n保留 Markdown。");
    expect(journalEntryMarkdownFileName(record)).toBe("personal-workspace-journal-2026-08-31.md");
  });
});
