import { describe, expect, it } from "vitest";
import type { GitHubDirectoryItem } from "./github-contents";
import { journalCatalogDates, journalDateFromPath, journalMonthFileCandidates, legacyJournalDateFromPath, recentJournalFileCandidates } from "./journal-archive-catalog";

const file = (name: string): GitHubDirectoryItem => ({ type: "file", name, path: `data/journal-entries/${name}`, blobSha: "a".repeat(40), sizeBytes: 123 });

describe("lazy journal archive catalog", () => {
  it("derives legacy dates without downloading private diary bodies", () => {
    expect(legacyJournalDateFromPath(file("journal_legacy_abcdef_20260812.json").path)).toBe("2026-08-12");
    expect(legacyJournalDateFromPath(file("journal_legacy_abcdef_20260230.json").path)).toBeNull();
    expect(legacyJournalDateFromPath(file("journal_entry_20260929010100000_1234.json").path)).toBeNull();
  });

  it("selects one month without reading unrelated ordinary entries", () => {
    const august = file("journal_legacy_abcdef_20260812.json");
    const july = file("journal_legacy_abcdef_20260701.json");
    const ordinary = file("journal_entry_20260929010100000_1234.json");
    expect(journalMonthFileCandidates([august, july, ordinary], "2026-08")).toEqual([august]);
    expect([...journalCatalogDates([august, july, ordinary])]).toEqual(["2026-08-12", "2026-07-01"]);
    expect(() => journalMonthFileCandidates([august], "2026-13")).toThrow("INVALID_JOURNAL_MONTH");
  });

  it("limits startup to three recent candidates even with thousands of historical files", () => {
    const history = Array.from({ length: 3000 }, (_, index) => file(`journal_legacy_${index}_20130607.json`));
    const september = file("journal_legacy_abc_20260930.json");
    const today = file("journal_entry_20261001_20261001010000000_1234.json");
    const yesterday = file("journal_entry_20260930_20261001020000000_1234.json");
    expect(recentJournalFileCandidates([...history, september, today, yesterday])).toEqual([today, yesterday, september]);
    expect(recentJournalFileCandidates(history, 0)).toEqual([]);
  });

  it("uses exact journal dates in new IDs and keeps old month-boundary entries discoverable", () => {
    const backdated = file("journal_entry_20260930_20261001020000000_1234.json");
    const oldBoundary = file("journal_entry_20261001020000000_1234.json");
    const oldSeptember = file("journal_entry_20260915020000000_1234.json");
    expect(journalDateFromPath(backdated.path)).toBe("2026-09-30");
    expect(journalMonthFileCandidates([backdated, oldBoundary, oldSeptember], "2026-09")).toEqual([backdated, oldBoundary, oldSeptember]);
    expect(journalMonthFileCandidates([backdated, oldBoundary, oldSeptember], "2026-10")).toEqual([oldBoundary]);
    expect([...journalCatalogDates([backdated])]).toEqual(["2026-09-30"]);
  });

  it("does not silently hide older or unfamiliar IDs", () => {
    const unknown = file("journal_entry_old.json");
    expect(journalMonthFileCandidates([unknown], "2026-09")).toEqual([unknown]);
  });
});
