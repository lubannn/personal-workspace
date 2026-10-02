import { GitHubDataError, type GitHubContentsAdapter } from "../../../../src/lib/github-data/github-contents";

type HealthReader = Pick<GitHubContentsAdapter, "listDirectory" | "readText">;

export async function loadHealthDirectory<T>(adapter: HealthReader, directory: string, parse: (text: string) => T, isCurrent: () => boolean) {
  let items;
  try { items = await adapter.listDirectory(directory); }
  catch (error) {
    if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return [];
    throw error;
  }
  // Contents directory responses stop at 1,000 entries and do not expose pagination.
  if (items.length >= 1_000) throw new Error("HEALTH_DIRECTORY_LIMIT");
  const candidates = items.filter((item) => item.type === "file" && item.name.endsWith(".json"));
  const records: Array<{ record: T; path: string; blobSha: string }> = [];
  for (let index = 0; index < candidates.length; index += 6) {
    if (!isCurrent()) throw new Error("HEALTH_LOAD_CANCELLED");
    records.push(...await Promise.all(candidates.slice(index, index + 6).map(async (item) => {
      const file = await adapter.readText(item.path);
      let record: T;
      try { record = parse(file.text); }
      catch { throw new Error("HEALTH_RECORD_INVALID"); }
      return { record, path: file.path, blobSha: file.blobSha };
    })));
  }
  return records;
}
