import { describe, expect, it } from "vitest";

import { formatWorkspaceDate } from "./workspace-date";

describe("workspace date label", () => {
  it("shows the date and weekday in Chinese", () => {
    expect(formatWorkspaceDate("2026-09-26")).toBe("2026年9月26日 · 星期六");
    expect(formatWorkspaceDate("2026-09-27")).toBe("2026年9月27日 · 星期日");
  });

  it("keeps server and first client render neutral before the date loads", () => {
    expect(formatWorkspaceDate("")).toBe("正在读取日期…");
  });
});
