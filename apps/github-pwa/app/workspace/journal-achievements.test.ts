import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JournalAchievements } from "./journal-achievements";

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
});
