import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createJournalEntryData } from "../../../../src/lib/github-data/journal-entries";
import { createWorkspaceRecord } from "../../../../src/lib/github-data/protocol";
import { JournalStatistics } from "./journal-statistics";

const record = createWorkspaceRecord({ entityType: "journal_entry", id: "one", ownerId: "owner", timestamp: "2026-10-03T06:00:00Z",
  data: createJournalEntryData({ journalDate: "2026-10-03", timezone: "UTC", timestamp: "2026-10-03T06:00:00Z", bodyMarkdown: "正文。" }) });
const entry = { record, path: "data/journal-entries/one.json", blobSha: "one-sha" };
const catalog = [{ type: "file" as const, name: "one.json", path: entry.path, blobSha: entry.blobSha, sizeBytes: 100 }];

function renderStatistics(overrides: Partial<ComponentProps<typeof JournalStatistics>> = {}) {
  return renderToStaticMarkup(createElement(JournalStatistics, {
    connection: { repository: "owner/data", ownerId: "owner", ownerLogin: "owner", timezone: "UTC" },
    adapter: null,
    catalog: [],
    catalogReady: false,
    loaded: [],
    busy: true,
    ...overrides,
  }));
}

describe("journal statistics loading states", () => {
  it("uses placeholders before the directory or usable statistics arrive", () => {
    const html = renderStatistics();
    expect(html).toContain("日记天数 —");
    expect(html).toContain("日记数量 —");
    expect(html).toContain("日记字数 —");
    expect(html).not.toContain("日记数量 0");
    expect(html).not.toContain("继续统计");
    expect(html).not.toContain("已同步到 GitHub");
  });

  it("labels counts shown ahead of directory verification as a previous snapshot", () => {
    const html = renderStatistics({ loaded: [entry] });
    expect(html).toContain("日记数量 1（已统计）");
    expect(html).toContain("上次已统计，正在核对目录。");
    expect(html).not.toContain("继续统计");
  });

  it.each([true, false])("shows verified counts independently of body loading or failure (busy=%s)", (busy) => {
    const html = renderStatistics({ catalog, catalogReady: true, loaded: [entry], busy });
    expect(html).toContain("日记天数 1");
    expect(html).toContain("日记数量 1");
    expect(html).toContain("日记字数 3");
    expect(html).not.toContain("（已统计）");
  });

  it("does not count an old loaded body when the ready catalog has deleted it", () => {
    const html = renderStatistics({ catalogReady: true, loaded: [entry], busy: false });
    expect(html).toContain("日记数量 0");
    expect(html).toContain("日记字数 0");
    expect(html).not.toContain("（已统计）");
  });

  it("keeps statistics unverified without a connection even if readiness was not yet reset", () => {
    const html = renderStatistics({ connection: null, catalogReady: true, busy: false });
    expect(html).toContain("日记数量 —");
    expect(html).toContain("连接后显示日记统计。");
    expect(html).not.toContain("已同步到 GitHub");
  });
});
