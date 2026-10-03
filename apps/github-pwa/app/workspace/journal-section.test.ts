import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { JournalSection } from "./journal-section";

type JournalProps = ComponentProps<typeof JournalSection>;

function renderJournal(overrides: Partial<JournalProps> = {}) {
  return renderToStaticMarkup(createElement(JournalSection, {
    connection: { repository: "example/journal-test", ownerId: "example-owner", ownerLogin: "example", timezone: "UTC" },
    adapter: null,
    online: true,
    todayDate: "2026-10-03",
    journalEntryFiles: [],
    journalEntryCatalog: [],
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
