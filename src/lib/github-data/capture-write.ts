import type { GitHubContentsAdapter } from "./github-contents";
import { serializeRecord } from "./protocol";
import type { CaptureRecord } from "./workspace";

type CaptureFile = { record: CaptureRecord; path: string; blobSha: string };
type Options = {
  adapter: Pick<GitHubContentsAdapter, "writeText">;
  source: CaptureFile;
  updated: CaptureRecord;
  operation: string;
  optimistic?: boolean;
  isCurrent: () => boolean;
  onChange: (update: (current: CaptureFile[]) => CaptureFile[]) => void;
};

/** One conditional write; lifecycle changes appear immediately and roll back on failure. */
export async function writeCaptureChange({ adapter, source, updated, operation, optimistic = false, isCurrent, onChange }: Options): Promise<boolean> {
  const projected = { ...source, record: updated };
  const replace = (expected: CaptureFile, replacement: CaptureFile) => {
    const matches = (item: CaptureFile) => expected === source
      ? item.path === source.path && item.blobSha === source.blobSha && item.record.version === source.record.version
      : item === expected;
    if (isCurrent()) onChange((current) => isCurrent() ? current.map((item) => matches(item) ? replacement : item) : current);
  };
  if (optimistic) replace(source, projected);
  try {
    const result = await adapter.writeText({
      path: source.path, text: serializeRecord(updated),
      message: `capture: ${operation} ${source.record.id}`, expectedBlobSha: source.blobSha,
    });
    if (!isCurrent()) return false;
    replace(optimistic ? projected : source, { record: updated, path: result.path, blobSha: result.blobSha });
    return true;
  } catch (error) {
    // Never replace a newer refresh or a different connection's collection.
    if (optimistic) replace(projected, source);
    throw error;
  }
}
