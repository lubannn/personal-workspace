import { GitHubDataError, type GitHubContentsAdapter } from "../../../../src/lib/github-data/github-contents";

type HealthReader = Pick<GitHubContentsAdapter, "listDirectory" | "readBlobTexts">;

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
  if (!isCurrent()) throw new Error("HEALTH_LOAD_CANCELLED");
  const files = await adapter.readBlobTexts(candidates, isCurrent);
  if (!isCurrent()) throw new Error("HEALTH_LOAD_CANCELLED");
  return files.map((file) => {
    let record: T;
    try { record = parse(file.text); }
    catch { throw new Error("HEALTH_RECORD_INVALID"); }
    return { record, path: file.path, blobSha: file.blobSha };
  });
}
