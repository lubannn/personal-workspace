import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JournalAchievementNotice, JournalAchievements } from "./journal-achievements";
import { journalAchievements } from "../../../../src/lib/github-data/journal-achievements";

const statistics = [{ blobSha: "one", date: "2026-10-04", words: 1_000_000, entries: 3, deleted: false }];
const render = (complete = true, connected = true) => renderToStaticMarkup(createElement(JournalAchievements, { statistics, complete, connected, todayDate: "2026-10-04" }));

describe("journal achievement display", () => {
  it("does not announce unverified badges or false zero streaks from a partial summary", () => {
    const html = render(false);
    expect(html).toContain("勋章待核对");
    expect(html).not.toContain("当前连续");
    expect(html).not.toContain("已获得 0");
    expect(html).not.toContain("journal-medal earned");
  });
  it("uses verified statistics independently of body loading, with the full collection collapsed", () => {
    const html = render();
    expect(html).toContain("已获得 1 / 40 枚");
    expect(html).toContain("百万字笺");
    expect(html).toContain("10 个系列");
    expect(html).toContain('<details class="journal-badge-collection">');
    expect(html).not.toContain('<details class="journal-badge-collection" open');
    expect(html).toContain('aria-label="百万字笺进度"');
  });
  it("hides verified private achievements when disconnected", () => {
    const html = render(true, false);
    expect(html).toContain("连接后查看你的记录与勋章。");
    expect(html).not.toContain("百万字笺");
  });
  it("displays the new year/day requirements, medal names and matching progress targets", () => {
    const html = render();
    for (const text of ["四年不辍", "连续 4 年（1,460 天）", "五年同行", "十年如约", "连续 10 年（520 周）", "十年留痕", "连续 10 年（120 个月）", "万日长藏", "累计记录 10,000 天", "四季相逢", "十年长藏", "至少 10 个不同年份", 'max="1460"', 'max="520"', 'max="120"', 'max="10000"']) expect(html).toContain(text);
    for (const removed of ["两百日长续", "千五日记", "两千五百日", "四季重逢"]) expect(html).not.toContain(removed);
  });
  it("has no initial celebration for existing medals", () => {
    expect(render()).not.toContain('aria-label="新勋章提醒"');
    expect(render(false)).not.toContain('aria-label="新勋章提醒"');
    expect(render(true, false)).not.toContain('aria-label="新勋章提醒"');
  });
  it("renders a compact polite, dismissible grouped notice without a modal or focus capture", () => {
    const badges = journalAchievements([{ ...statistics[0], words: 2_000_000 }], "2026-10-04")!.earned;
    const html = renderToStaticMarkup(createElement(JournalAchievementNotice, { badges, onDismiss: () => undefined }));
    expect(html).toContain("获得新勋章 · 2 枚");
    expect(html).toContain("百万字笺");
    expect(html).toContain("两百万字集");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="关闭新勋章提示"');
    expect(html).not.toMatch(/role="dialog"|aria-modal|autofocus/iu);
    expect(renderToStaticMarkup(createElement(JournalAchievementNotice, { badges: [], onDismiss: () => undefined }))).toBe("");
  });
});
