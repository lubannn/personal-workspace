import type { GitHubDirectoryItem } from "./github-contents";

const LEGACY_ENTRY_PATH = /^data\/journal-entries\/journal_legacy_[a-zA-Z0-9]+_(\d{4})(\d{2})(\d{2})\.json$/u;

export function legacyJournalDateFromPath(path: string): string | null {
  const match = LEGACY_ENTRY_PATH.exec(path);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

export function journalMonthFileCandidates(files: GitHubDirectoryItem[], month: string) {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(month)) throw new Error("INVALID_JOURNAL_MONTH");
  return files.filter((file) => file.type === "file" && file.name.endsWith(".json") && (
    legacyJournalDateFromPath(file.path)?.startsWith(`${month}-`) ?? true
  ));
}

export function journalCatalogDates(files: GitHubDirectoryItem[]) {
  return new Set(files.map((file) => legacyJournalDateFromPath(file.path)).filter((date): date is string => Boolean(date)));
}
