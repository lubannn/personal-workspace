import { describe, expect, it } from "vitest";

import { buildLegacyJournalDateBatches } from "./legacy-journal-batches";
import type { LegacyJournalPreview } from "./legacy-docx-preview";

function entry(day: number, segments: number) {
  return {
    date: `2026-07-${String(day).padStart(2, "0")}`,
    segments: Array.from({ length: segments }, () => ({})),
  } as LegacyJournalPreview["parse"]["entries"][number];
}

describe("Legacy Journal safe date batches", () => {
  it("packs the whole preview into deterministic atomic-safe batches", () => {
    const batches = buildLegacyJournalDateBatches(Array.from({ length: 31 }, (_, index) => entry(index + 1, 14)));
    expect(batches.flatMap((batch) => batch.dates)).toHaveLength(31);
    expect(batches.every((batch) => batch.estimatedFiles <= 250 && batch.dates.length <= 25)).toBe(true);
    expect(batches.length).toBeGreaterThan(1);
  });

  it("blocks a single date that cannot fit atomically", () => {
    expect(() => buildLegacyJournalDateBatches([entry(1, 248)])).toThrow("LEGACY_IMPORT_SINGLE_DATE_FILE_LIMIT_EXCEEDED");
  });
});
