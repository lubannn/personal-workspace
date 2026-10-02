import { GitHubDataError, type GitHubContentsAdapter } from "../../../../src/lib/github-data/github-contents";

type HealthReader = Pick<GitHubContentsAdapter, "listDirectory" | "readBlobTexts"> & Partial<Pick<GitHubContentsAdapter, "readBranchSnapshot" | "listTreeFiles">>;

export async function listCompleteHealthDirectory(adapter: HealthReader, directory: string, isCurrent: () => boolean = () => true) {
  let items;
  try { items = await adapter.listDirectory(directory); }
  catch (error) {
    if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") return [];
    throw error;
  }
  if (!isCurrent()) throw new Error("HEALTH_LOAD_CANCELLED");
  // Contents stops at 1,000 entries. A complete, commit-pinned tree preserves
  // historical coverage while blob SHA reads remain safe across concurrent syncs.
  if (items.length >= 1_000) {
    if (!adapter.readBranchSnapshot || !adapter.listTreeFiles) throw new Error("HEALTH_DIRECTORY_LIMIT");
    const snapshot = await adapter.readBranchSnapshot();
    if (!isCurrent()) throw new Error("HEALTH_LOAD_CANCELLED");
    const files = await adapter.listTreeFiles(snapshot.rootTreeSha);
    if (!isCurrent()) throw new Error("HEALTH_LOAD_CANCELLED");
    const prefix = `${directory}/`;
    items = files.filter((file) => file.path.startsWith(prefix) && !file.path.slice(prefix.length).includes("/"));
  }
  return items;
}

export async function loadHealthDirectory<T>(adapter: HealthReader, directory: string, parse: (text: string) => T, isCurrent: () => boolean) {
  const items = await listCompleteHealthDirectory(adapter, directory, isCurrent);
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
