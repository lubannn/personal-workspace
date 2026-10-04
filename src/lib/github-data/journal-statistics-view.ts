import type { GitHubDirectoryItem } from "./github-contents";
import { cachedJournalStatistics, sumJournalStatistics, type JournalFileStatistics } from "./journal-statistics";

type StatisticsCache = Record<string, JournalFileStatistics>;
type StatisticsFile = { path: string; blobSha: string; statistics: JournalFileStatistics | undefined };

export function journalStatisticsView({ catalog, catalogReady, loaded, cache, shared }: {
  catalog: GitHubDirectoryItem[];
  catalogReady: boolean;
  loaded: StatisticsCache;
  cache: StatisticsCache;
  shared: StatisticsCache | null;
}) {
  const files: StatisticsFile[] = catalogReady ? catalog
    .filter((item) => item.type === "file" && item.name.endsWith(".json"))
    .map(({ path, blobSha }) => ({ path, blobSha, statistics: cachedJournalStatistics(loaded, path, blobSha)
      ?? cachedJournalStatistics(cache, path, blobSha) ?? cachedJournalStatistics(shared ?? {}, path, blobSha) })) : [];
  const missing = files.filter((file) => !file.statistics);
  // Before the directory arrives, a shared summary is only the last saved
  // snapshot. Do not promote unverified browser-cache paths into that snapshot.
  const statistics = catalogReady
    ? files.flatMap((file) => file.statistics ? [file.statistics] : [])
    : Object.entries({ ...shared, ...loaded })
      .filter(([path]) => /^data\/journal-entries\/[^/]+\.json$/u.test(path))
      .map(([, value]) => value);
  const complete = catalogReady && missing.length === 0;
  const phase = complete ? "complete" : statistics.length === 0 ? "waiting" : catalogReady ? "partial" : "snapshot";
  return { files, missing, phase, statistics, totals: complete || statistics.length > 0 ? sumJournalStatistics(statistics) : null };
}
