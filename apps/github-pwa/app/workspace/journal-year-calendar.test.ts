import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { JournalYearCalendar } from "./journal-year-calendar";
import { JournalGlobalSearch } from "./journal-global-search";
import { GitHubContentsAdapter } from "../../../../src/lib/github-data/github-contents";
const stats = [{ blobSha: "a", date: "2026-11-06", entries: 8, words: 1000, deleted: false }, { blobSha: "b", date: "2013-06-07", entries: 2, words: 2000, deleted: false }];
describe("annual journal calendar presentation", () => {
  it("shows all 12 months, all historical years and this year's unique-day count without body reads", () => {
    const html = renderToStaticMarkup(createElement(JournalYearCalendar, { statistics: stats, complete: true, knownDates: new Set<string>(), todayDate: "2026-11-06", onMonth: vi.fn(), onDay: vi.fn(), onClose: vi.fn() }));
    expect(html).toContain("累计 2 天 · 本年 1 天"); expect(html).toContain("2013"); expect(html).toContain("2025");
    expect(html.match(/class="journal-year-month"/g)).toHaveLength(12); expect(html.match(/class="journal-year-heading"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="2026-11-06，有日记"'); expect(html).toContain('aria-label="2026-11-05，无日记"');
    expect(html).not.toContain("正在核对历史记录");
  });
  it("labels incomplete statistics instead of claiming provisional hints are final counts", () => {
    const html = renderToStaticMarkup(createElement(JournalYearCalendar, { statistics: [], complete: false, knownDates: new Set(["2013-06-07"]), todayDate: "2026-11-06", onMonth: vi.fn(), onDay: vi.fn(), onClose: vi.fn() }));
    expect(html).toContain("当前为已知记录"); expect(html).toContain("2013");
  });
  it("does not initiate private index or historical reads during server rendering", () => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = new GitHubContentsAdapter({ owner: "synthetic", repository: "test", token: "synthetic", branch: "main" }, fetcher);
    const html = renderToStaticMarkup(createElement(JournalGlobalSearch, { adapter, ownerId: "synthetic", catalog: [], loaded: [], query: "游泳", busy: false, onDay: vi.fn() }));
    expect(fetcher).not.toHaveBeenCalled(); expect(html).toContain("尚非完整结果"); expect(html).not.toContain("全部日记中没有匹配记录");
  });
});
