import { describe, expect, it } from "vitest";
import { JournalAchievementNoticeTracker } from "./journal-achievement-notices";
import { journalAchievements } from "./journal-achievements";

describe("session-only new medal detection", () => {
  it("silently establishes a verified baseline after any partial snapshots", () => {
    const tracker = new JournalAchievementNoticeTracker();
    expect(tracker.observe(null)).toEqual([]);
    expect(tracker.observe(["daily-1", "words-1", "calendar-1"])).toEqual([]);
    expect(tracker.observe(["calendar-1", "words-1", "daily-1"])).toEqual([]);
  });
  it("announces a first medal after an empty baseline and groups simultaneous new medals", () => {
    const tracker = new JournalAchievementNoticeTracker();
    expect(tracker.observe([])).toEqual([]);
    expect(tracker.observe(["words-1", "words-2", "words-2", "daily-1"])).toEqual(["words-1", "words-2", "daily-1"]);
    expect(tracker.observe(["words-1", "words-2", "daily-1"])).toEqual([]);
  });
  it("ignores incomplete refreshes and does not reannounce revoked then regained medals", () => {
    const tracker = new JournalAchievementNoticeTracker();
    tracker.observe(["daily-1"]);
    expect(tracker.observe(null)).toEqual([]);
    expect(tracker.observe(["daily-1", "daily-2"])).toEqual(["daily-2"]);
    tracker.observe([]);
    expect(tracker.observe(["daily-1", "daily-2"])).toEqual([]);
    expect(tracker.observe(["daily-2", "words-1"])).toEqual(["words-1"]);
  });
  it("resets on disconnect so another login does not celebrate historical awards", () => {
    const tracker = new JournalAchievementNoticeTracker();
    tracker.observe([]);
    tracker.observe(["words-1"]);
    tracker.reset();
    expect(tracker.observe(null)).toEqual([]);
    expect(tracker.observe(["words-1", "words-2", "monthly-1"])).toEqual([]);
    expect(tracker.observe(["words-1", "words-2", "monthly-1", "monthly-2"])).toEqual(["monthly-2"]);
  });
  it("detects a threshold crossing from existing summary counts without reading prose", () => {
    const tracker = new JournalAchievementNoticeTracker();
    const file = { blobSha: "synthetic", date: "2026-10-04", words: 999_999, entries: 1, deleted: false };
    tracker.observe(journalAchievements([file], "2026-10-04")!.earned.map((badge) => badge.id));
    const next = journalAchievements([{ ...file, words: 1_000_000 }], "2026-10-04")!;
    expect(tracker.observe(next.earned.map((badge) => badge.id))).toEqual(["words-1"]);
    expect(tracker.observe(next.earned.map((badge) => badge.id))).toEqual([]);
  });
});
