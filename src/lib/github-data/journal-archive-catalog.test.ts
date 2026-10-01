import { describe, expect, it } from "vitest";
import type { GitHubDirectoryItem } from "./github-contents";
import { journalCatalogDates, journalMonthFileCandidates, legacyJournalDateFromPath } from "./journal-archive-catalog";

const file = (name: string): GitHubDirectoryItem => ({ type: "file", name, path: `data/journal-entries/${name}`, blobSha: "a".repeat(40), sizeBytes: 123 });

describe("lazy journal archive catalog", () => {
  it("derives legacy dates without downloading private diary bodies", () => {
    expect(legacyJournalDateFromPath(file("journal_legacy_abcdef_20260812.json").path)).toBe("2026-08-12");
    expect(legacyJournalDateFromPath(file("journal_legacy_abcdef_20260230.json").path)).toBeNull();
    expect(legacyJournalDateFromPath(file("journal_entry_20260929010100000_1234.json").path)).toBeNull();
  });

  it("selects only one month of legacy entries plus ordinary entries whose date requires reading", () => {
    const august = file("journal_legacy_abcdef_20260812.json");
    const july = file("journal_legacy_abcdef_20260701.json");
    const ordinary = file("journal_entry_20260929010100000_1234.json");
    expect(journalMonthFileCandidates([august, july, ordinary], "2026-08")).toEqual([august, ordinary]);
    expect([...journalCatalogDates([august, july, ordinary])]).toEqual(["2026-08-12", "2026-07-01"]);
    expect(() => journalMonthFileCandidates([august], "2026-13")).toThrow("INVALID_JOURNAL_MONTH");
  });
});
