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
    journalDateFromPath(file.path)?.startsWith(`${month}-`) ?? ordinaryEntryMayBelongToMonth(file.path, month)
  ));
}

export function journalDateFromPath(path: string): string | null {
  const legacy = legacyJournalDateFromPath(path);
  if (legacy) return legacy;
  const match = /^data\/journal-entries\/journal_entry_(\d{4})(\d{2})(\d{2})_\d{17}_[a-zA-Z0-9]+\.json$/u.exec(path);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

// Older ordinary IDs contain a UTC submission time rather than the journal date.
// Allow timezone shifts and yesterday's entries at month boundaries; do not guess
// a single date or silently omit unfamiliar filenames.
function ordinaryEntryMayBelongToMonth(path: string, month: string) {
  const match = /^data\/journal-entries\/journal_entry_(\d{4})(\d{2})(\d{2})\d{9}_[a-zA-Z0-9]+\.json$/u.exec(path);
  if (!match) return true;
  const submitted = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  if (Number.isNaN(submitted.valueOf())) return true;
  return [-2, -1, 0, 1].some((offset) => new Date(submitted.valueOf() + offset * 86400000).toISOString().startsWith(month));
}

export function recentJournalFileCandidates(files: GitHubDirectoryItem[], limit = 3) {
  if (!Number.isInteger(limit) || limit < 0) throw new Error("INVALID_JOURNAL_LIMIT");
  const dateKey = (file: GitHubDirectoryItem) => {
    const date = journalDateFromPath(file.path)?.replaceAll("-", "");
    const timestamp = /^journal_entry_(?:\d{8}_)?(\d{17})_/u.exec(file.name)?.[1];
    return date ? `${date}_${timestamp ?? ""}` : timestamp ? `${timestamp.slice(0, 8)}_${timestamp}` : "";
  };
  return files.filter((file) => file.type === "file" && file.name.endsWith(".json"))
    .sort((left, right) => dateKey(right).localeCompare(dateKey(left)) || right.name.localeCompare(left.name)).slice(0, limit);
}

export function journalCatalogDates(files: GitHubDirectoryItem[]) {
  return new Set(files.map((file) => journalDateFromPath(file.path)).filter((date): date is string => Boolean(date)));
}
