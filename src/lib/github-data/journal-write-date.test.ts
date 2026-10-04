import { describe, expect, it } from "vitest";
import { journalLocalDate, resolveJournalCreateDate } from "./journal-entries";

const input = { journalDate: "2026-10-04", timezone: "Asia/Shanghai", timestamp: "2026-10-04T16:00:22.631Z" };
describe("journal date at the submission instant", () => {
  it("corrects a stale rendered today immediately after Shanghai midnight", () => {
    expect(resolveJournalCreateDate({ ...input, dateChoice: "today" })).toEqual({ journalDate: "2026-10-05", todayDate: "2026-10-05" });
    expect(journalLocalDate(input.timezone, "2026-10-04T15:59:59.999Z")).toBe("2026-10-04");
    expect(journalLocalDate(input.timezone, "2026-10-04T16:00:00.000Z")).toBe("2026-10-05");
  });
  it("keeps choosing today relative rather than pinning the day the form opened", () => {
    expect(resolveJournalCreateDate({ ...input, journalDate: "2026-10-01", dateChoice: "today" }).journalDate).toBe("2026-10-05");
  });
  it("keeps deliberate yesterday and absolute dates rather than moving all midnight entries", () => {
    expect(resolveJournalCreateDate({ ...input, dateChoice: "yesterday" }).journalDate).toBe("2026-10-04");
    expect(resolveJournalCreateDate(input).journalDate).toBe("2026-10-04");
    expect(() => resolveJournalCreateDate({ ...input, journalDate: "2026-10-03" })).toThrow("JOURNAL_DATE_NOT_WRITABLE");
  });
  it.each([
    ["2026-10-31T16:00:00.000Z", "2026-11-01", "2026-10-31"],
    ["2026-12-31T16:00:00.000Z", "2027-01-01", "2026-12-31"],
    ["2028-02-29T16:00:00.000Z", "2028-03-01", "2028-02-29"],
  ])("handles midnight across month/year/leap boundaries at %s", (timestamp, today, yesterday) => {
    expect(resolveJournalCreateDate({ ...input, timestamp, dateChoice: "today" }).journalDate).toBe(today);
    expect(resolveJournalCreateDate({ ...input, timestamp, dateChoice: "yesterday" }).journalDate).toBe(yesterday);
  });
  it("uses the workspace timezone, not UTC or the device timezone", () => {
    expect(resolveJournalCreateDate({ ...input, timezone: "America/Los_Angeles", dateChoice: "today" }).journalDate).toBe("2026-10-04");
    expect(resolveJournalCreateDate({ ...input, timezone: "Pacific/Kiritimati", dateChoice: "today" }).journalDate).toBe("2026-10-05");
  });
});
