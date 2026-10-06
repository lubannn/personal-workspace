import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { mapCorosSleep } from "../../../auth-worker/src/coros-sync-mapping";
import { createWorkspaceRecord, recordPath, serializeRecord } from "../../../../src/lib/github-data/protocol";
import { createAutomaticSleepSessionData, parseSleepSessionRecord } from "../../../../src/lib/github-data/sleep-sessions";
import { buildHealthRecordRows } from "./health-records";
import { buildSleepCalendarDays, formatSleepCalendarDuration, summarizeSleepDays } from "./sleep-calendar";
import { SleepCalendarSection } from "./sleep-calendar-section";
import { buildHealthBaseline, buildHealthStatusDays, classifyHealthDay } from "./health-status";

// Synthetic values, preserving the legacy response and archived schema shape.
// Main Sleep matches its elapsed window; neither net asleep nor daily total is reported.
const legacy = `Sleep Overview
========================
Note: each record below is dated by its wake-up day.

2024-03-01
Sleep Score: 82
Main Sleep: 8h 0min
Awake Time: 20 min
Main Sleep Window: 2024-02-29 23:00 - 2024-03-01 07:00
Naps Total: 45 min (includes legacy reported durations)
Nap Window: 2024-03-01 13:00 - 2024-03-01 13:45`;

function archivedRows(text = legacy, endDate = "2024-03-01") {
  const mapped = mapCorosSleep({ format: "content", payload: [{ type: "text", text }] },
    { startDate: "2024-03-01", endDate, timezone: "Asia/Shanghai" });
  const timestamp = "2024-04-01T00:00:00.000Z";
  const sessions = mapped.items.map((item, index) => {
    const record = createWorkspaceRecord({ entityType: "sleep_session", id: `synthetic_legacy_${index}`, ownerId: "synthetic_owner", timestamp,
      data: createAutomaticSleepSessionData(item.candidate, { kind: "coros_mcp", source_id: item.sourceId,
        source_sha256: "a".repeat(64), mapping_version: 1, retrieved_at: timestamp }, item.metrics) });
    return { record: parseSleepSessionRecord(serializeRecord(record)), path: recordPath(record.entity_type, record.id), blobSha: "a".repeat(40) };
  });
  return buildHealthRecordRows(sessions, [], []).sleepRows;
}

describe("legacy sleep archive display regression", () => {
  it("restores all 31 synthetic March cells while preserving onset and using available historical scores", () => {
    const prefixEnd = legacy.indexOf("\n\n") + 2;
    const prefix = legacy.slice(0, prefixEnd), section = legacy.slice(prefixEnd);
    const body = prefix + Array.from({ length: 31 }, (_, index) => {
      const date = `2024-03-${String(index + 1).padStart(2, "0")}`;
      const previous = new Date(Date.parse(date) - 86400_000).toISOString().slice(0, 10);
      return section.replaceAll("2024-03-01", date).replaceAll("2024-02-29", previous)
        .replace("Sleep Score: 82", `Sleep Score: ${index < 13 ? 62 : 82}`);
    }).join("\n\n");
    const rows = archivedRows(body, "2024-03-31");
    const days = buildSleepCalendarDays(rows);
    expect(days).toHaveLength(31);
    expect(summarizeSleepDays(days)).toMatchObject({ completeDays: 0, averageSeconds: null, recordedPeriodDays: 31, averageRecordedPeriodSeconds: 525 * 60 });
    const html = renderToStaticMarkup(createElement(SleepCalendarSection, { rows, timezone: "Asia/Shanghai", selectedMonth: "2024-03" }));
    expect(html.match(/class="sleep-calendar-onset">入睡23:00<\/span>/gu)).toHaveLength(31);
    expect(html.match(/class="sleep-calendar-duration">时段8:45†<\/span>/gu)).toHaveLength(31);
    expect(html.match(/需休息<\/strong>/gu)).toHaveLength(13);
    expect(html.match(/平稳<\/strong>/gu)).toHaveLength(18);
    expect(html).not.toContain("总计—</span>");
    expect(html).not.toContain("总计8:45");
    expect(html).toContain("31 天睡眠 · 平均时段 8时45分†");
  });

  it("retains elapsed windows through archived body round-trips and row conversion without inventing net or daily sleep", () => {
    const rows = archivedRows();
    expect(rows.map(row => row.durationSeconds).sort((a, b) => a - b)).toEqual([45 * 60, 480 * 60]);
    expect(rows.every(row => row.asleepSeconds === null && row.dailySleepSeconds === null)).toBe(true);
    const [day] = buildSleepCalendarDays(rows);
    expect(day).toMatchObject({ asleepSeconds: null, mainSeconds: null, napSeconds: null, recordedPeriodSeconds: 525 * 60,
      usesCorosDailyTotal: false, hasOverlappingEpisodes: false });
    expect(formatSleepCalendarDuration(day)).toBe("时段8:45†");
    expect(summarizeSleepDays([day])).toMatchObject({ averageSeconds: null, completeDays: 0 });
    const html = renderToStaticMarkup(createElement(SleepCalendarSection, { rows, timezone: "Asia/Shanghai" }));
    expect(html).toContain("入睡23:00");
    expect(html).toContain("时段8:45†");
    expect(html).not.toContain("总计8:45");
    expect(html).toContain("不代表已确认的每日总睡眠");
    const [statusDay] = buildHealthStatusDays([day], [], "2024-04-01");
    expect(classifyHealthDay(statusDay, buildHealthBaseline([]))).toMatchObject({ status: "insufficient",
      missing: ["恢复", "HRV", "静息心率"], unavailable: ["步数", "运动分钟", "活动热量", "爬升", "训练负荷"], partial: false });
  });

  it("keeps a main-only legacy period separate from a confirmed total and does not fill unknown naps with zero", () => {
    const rows = archivedRows(legacy.replace("Naps Total: 45 min (includes legacy reported durations)\nNap Window: 2024-03-01 13:00 - 2024-03-01 13:45", "Naps Total: 0 min"));
    const [day] = buildSleepCalendarDays(rows);
    expect(day).toMatchObject({ asleepSeconds: null, mainSeconds: null, napSeconds: null, napCount: 0 });
    expect(formatSleepCalendarDuration(day)).toBe("时段8:00†");
    expect(formatSleepCalendarDuration({ ...day, hasOverlappingEpisodes: true })).toBe("总计—");
    expect(formatSleepCalendarDuration({ ...day, hasConflictingDailyTotals: true })).toBe("总计—");
  });

  it("uses an explicit legacy daily total without turning it into main or nap asleep values", () => {
    const rows = archivedRows(legacy.replace("Sleep Score: 82", "Sleep Score: 82\nDaily Sleep: 8h 10min (incl. naps)"));
    const [day] = buildSleepCalendarDays(rows);
    expect(day).toMatchObject({ asleepSeconds: 490 * 60, mainSeconds: null, napSeconds: null, usesCorosDailyTotal: true });
    expect(formatSleepCalendarDuration(day)).toBe("总计8:10");
    expect(summarizeSleepDays([day])).toMatchObject({ averageSeconds: 490 * 60, completeDays: 1 });
  });
});
