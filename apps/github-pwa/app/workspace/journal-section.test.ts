import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { JournalSection } from "./journal-section";
import { createJournalEntryData } from "../../../../src/lib/github-data/journal-entries";
import { createWorkspaceRecord, recordPath } from "../../../../src/lib/github-data/protocol";
import { createJournalSegmentSnapshot, renderJournalSegmentsMarkdown } from "../../../../src/lib/github-data/journal-segment-codec";

type JournalProps = ComponentProps<typeof JournalSection>;

function savedEntry(id: string, date: string, timestamp: string, bodyMarkdown: string) {
  const record = createWorkspaceRecord({ entityType: "journal_entry", id, ownerId: "example-owner", timestamp,
    data: createJournalEntryData({ journalDate: date, timezone: "Asia/Shanghai", timestamp, bodyMarkdown }) });
  return { record, path: recordPath("journal_entry", id), blobSha: `${id}-sha` };
}

function readingList(markup: string) { return markup.match(/<ol class="journal-list">([\s\S]*?)<\/ol>/)?.[1] ?? ""; }

describe("journal reading chronology", () => {
  it("renders yesterday's next-day morning backfill before yesterday's evening diary", () => {
    const evening = savedEntry("evening", "2026-10-27", "2026-10-27T14:08:00Z", "晚上记录");
    const morning = savedEntry("backfill", "2026-10-27", "2026-10-28T01:21:00Z", "补写早晨");
    const noon = savedEntry("noon", "2026-10-27", "2026-10-27T04:00:00Z", "中午记录");
    const list = readingList(renderJournal({ todayDate: "2026-10-28", journalEntryFiles: [evening, morning, noon] }));
    expect(list.indexOf("补写早晨")).toBeLessThan(list.indexOf("中午记录"));
    expect(list.indexOf("中午记录")).toBeLessThan(list.indexOf("晚上记录"));
    expect(list.match(/<time>(.*?)<\/time>/g)).toEqual(["<time>09:21</time>", "<time>12:00</time>", "<time>22:08</time>"]);
    expect(list.match(/class="journal-day-heading"/g)).toHaveLength(1);
    expect(list.match(/>编辑<\/button>/g)).toHaveLength(3);
  });
  it("interleaves imported time segments and keeps one day heading per day", () => {
    const body = renderJournalSegmentsMarkdown("imported", [
      createJournalSegmentSnapshot({ id: "early", journalEntryId: "imported", localTime: "07:00", occurredAt: "2026-10-27T07:00:00+08:00", bodyMarkdown: "历史清晨", sortOrder: 0 }),
      createJournalSegmentSnapshot({ id: "late", journalEntryId: "imported", localTime: "22:08", occurredAt: "2026-10-27T22:08:00+08:00", bodyMarkdown: "历史晚上", sortOrder: 1 }),
    ]);
    const entries = [savedEntry("imported", "2026-10-27", "2026-10-28T04:00:00Z", body), savedEntry("morning", "2026-10-27", "2026-10-28T01:21:00Z", "补写早晨"), savedEntry("today", "2026-10-28", "2026-10-28T00:00:00Z", "今天记录")];
    const list = readingList(renderJournal({ todayDate: "2026-10-28", journalEntryFiles: entries }));
    const positions = ["今天记录", "历史清晨", "补写早晨", "历史晚上"].map((text) => list.indexOf(text));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(list.match(/class="journal-day-heading"/g)).toHaveLength(2);
    expect(list).not.toContain("pw-journal");
  });
  it("keeps the latest-three selection bounded before ordering it for reading", () => {
    const entries = [savedEntry("older", "2026-10-26", "2026-10-26T02:00:00Z", "不应多加载或多显示"), ...[1, 2, 3].map((hour) => savedEntry(`entry_${hour}`, "2026-10-27", `2026-10-27T0${hour}:00:00Z`, `正文${hour}`))];
    const markup = renderJournal({ todayDate: "2026-10-28", journalEntryFiles: entries });
    const list = readingList(markup);
    expect(list).not.toContain("不应多加载或多显示");
    expect(list.match(/<time>/g)).toHaveLength(3);
    expect(list.indexOf("正文1")).toBeLessThan(list.indexOf("正文2"));
    expect(list.indexOf("正文2")).toBeLessThan(list.indexOf("正文3"));
  });
});

function renderJournal(overrides: Partial<JournalProps> = {}) {
  return renderToStaticMarkup(createElement(JournalSection, {
    connection: { repository: "example/journal-test", ownerId: "example-owner", ownerLogin: "example", timezone: "UTC" },
    adapter: null,
    online: true,
    todayDate: "2026-10-03",
    journalEntryFiles: [],
    journalEntryCatalog: [],
    catalogReady: true,
    loadedMonths: [],
    loadError: "",
    loading: false,
    saving: false,
    savingId: null,
    onCreate: async () => true,
    onEdit: async () => true,
    onRefresh: () => undefined,
    onBrowseMonth: () => undefined,
    onBrowseRecent: () => undefined,
    ...overrides,
  }));
}

function journalForm(markup: string) {
  const form = markup.match(/<form class="journal-form">([\s\S]*?)<\/form>/)?.[1];
  expect(form).toBeDefined();
  return form!;
}

describe("compact journal form", () => {
  it("places the save submit button in the same metadata row as the date selector", () => {
    const form = journalForm(renderJournal());
    const row = form.match(/<div class="journal-form-meta">(<label>[\s\S]*?<\/label>)<div class="journal-form-actions">([\s\S]*?)<\/div><\/div>/);
    expect(row).not.toBeNull();
    expect(row?.[1]).toContain("写入日期");
    expect(row?.[1]).toContain('<option value="2026-10-03" selected="">今天 · 2026-10-03</option>');
    expect(row?.[2]).toMatch(/<button\b[^>]*type="submit"[^>]*>保存日记<\/button>/);
    expect(form.match(/type="submit"/g)).toHaveLength(1);
    expect(form.indexOf("保存日记")).toBeLessThan(form.indexOf('class="journal-body"'));
  });

  it("removes the footer row and the three redundant helper texts", () => {
    const markup = renderJournal();
    expect(journalForm(markup)).not.toContain("<footer");
    for (const text of [
      "随时回看；仅今天和昨天可以写入或修改。日期按工作台时区计算。",
      "同一天可以写多篇；每篇自动记录提交时间。",
      "圈出的日期有日记。点日期看当天，点标题选择年月并看整月。",
    ]) expect(markup).not.toContain(text);
  });

  it("keeps submission disabled until the connected user enters body text", () => {
    const form = journalForm(renderJournal());
    expect(form).toMatch(/<button\b[^>]*type="submit"[^>]*disabled=""[^>]*>保存日记<\/button>/);
    expect(form).toMatch(/<textarea\b[^>]*><\/textarea>/);
    expect(form.match(/<select\b[^>]*>/)?.[0]).not.toContain("disabled");
    expect(form.match(/<textarea\b[^>]*>/)?.[0]).not.toContain("disabled");
  });

  it("disables the date, body and submit controls while disconnected", () => {
    const form = journalForm(renderJournal({ connection: null }));
    expect(form).toMatch(/<select\b[^>]*disabled=""/);
    expect(form).toMatch(/<textarea\b[^>]*disabled=""/);
    expect(form).toMatch(/<button\b[^>]*type="submit"[^>]*disabled=""[^>]*>保存日记<\/button>/);
  });

  it("keeps the busy label and disabled form controls in the date row while saving", () => {
    const form = journalForm(renderJournal({ saving: true }));
    expect(form).toMatch(/<select\b[^>]*disabled=""/);
    expect(form).toMatch(/<textarea\b[^>]*disabled=""/);
    expect(form).toMatch(/<div class="journal-form-actions"><button\b[^>]*type="submit"[^>]*disabled=""[^>]*>保存中…<\/button><\/div>/);
  });
});
