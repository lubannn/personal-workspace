import { Encoder, type Encodable, type SessionMesg } from "@garmin/fitsdk";
import { describe, expect, it, vi } from "vitest";

import { confirmCorosBatch, COROS_BATCH_COMMIT_SIZE, COROS_BATCH_MAX_FILES, previewCorosBatch, selectCorosBatchItems, stageCorosBatch } from "./coros-batch-import";
import { GitHubConflictError, GitHubDataError, type GitHubContentsAdapter, type GitHubStoredFile } from "./github-contents";

function file(index: number, distanceOffset = 0) {
  const start = new Date(Date.UTC(2026, 0, index + 1, 1));
  const encoder = new Encoder();
  const session: Encodable<SessionMesg> = {
    mesgNum: 18,
    timestamp: new Date(start.valueOf() + 3_600_000),
    startTime: start,
    sport: "running",
    totalElapsedTime: 3600,
    totalTimerTime: 3500,
    totalDistance: 10000 + index + distanceOffset,
  };
  encoder.writeMesg(session);
  const bytes = encoder.close();
  return { name: `activity-${index}.fit`, size: bytes.byteLength, lastModified: 0, arrayBuffer: async () => bytes.slice().buffer };
}

function memoryRepository() {
  const files = new Map<string, GitHubStoredFile>();
  let revision = 1;
  const readBranchSnapshot = vi.fn(async () => ({ branch: "main", headCommitSha: `head-${revision}`, rootTreeSha: `tree-${revision}` }));
  const readText = vi.fn(async (path: string, ref?: string) => {
    if (ref && ref !== `head-${revision}`) throw new GitHubConflictError("Branch moved");
    const found = files.get(path);
    if (!found) throw new GitHubDataError("Not found", 404, "GITHUB_NOT_FOUND");
    return found;
  });
  const writeAtomicFiles = vi.fn(async (input: { files: Array<{ path: string; text: string }>; expectedHeadCommitSha: string; baseTreeSha: string }) => {
    if (input.expectedHeadCommitSha !== `head-${revision}` || input.baseTreeSha !== `tree-${revision}`) throw new GitHubConflictError("Branch moved");
    revision += 1;
    const written = input.files.map(({ path, text }) => {
      const stored = { path, text, blobSha: `blob-${revision}-${path}`, sizeBytes: text.length };
      files.set(path, stored);
      return { path, blobSha: stored.blobSha };
    });
    return { commitSha: `head-${revision}`, treeSha: `tree-${revision}`, files: written };
  });
  const adapter = { readBranchSnapshot, readText, writeAtomicFiles } as unknown as Pick<GitHubContentsAdapter, "readBranchSnapshot" | "readText" | "writeAtomicFiles">;
  return { adapter, files, writeAtomicFiles };
}

describe("COROS batch import", () => {
  it("previews 110 FIT files and stages and confirms them in bounded atomic chunks", async () => {
    const progress: number[] = [];
    const rows = await previewCorosBatch(Array.from({ length: 110 }, (_, index) => file(index)), "Asia/Shanghai", (done) => progress.push(done));
    const selected = selectCorosBatchItems(rows);
    expect(progress.at(-1)).toBe(110);
    expect(selected).toMatchObject({ acceptedFiles: 110, blockedFiles: 0, repeatedFiles: 0, suspectedDuplicateActivities: 0 });
    expect(selected.items).toHaveLength(110);
    const { adapter, files, writeAtomicFiles } = memoryRepository();
    const staged: Array<Parameters<NonNullable<Parameters<typeof stageCorosBatch>[0]["onCommitted"]>>[0][number]> = [];
    const result = await stageCorosBatch({ adapter, ownerId: "github_lubannn", items: selected.items, onCommitted(created) { staged.push(...created); } });
    expect(result).toEqual({ created: 110, alreadyPresent: 0 });
    expect(files.size).toBe(110);
    expect(writeAtomicFiles).toHaveBeenCalledTimes(Math.ceil(110 / COROS_BATCH_COMMIT_SIZE));
    expect(writeAtomicFiles.mock.calls.every(([input]) => input.files.length <= COROS_BATCH_COMMIT_SIZE)).toBe(true);
    const confirmed = await confirmCorosBatch({ adapter, ownerId: "github_lubannn", staging: staged });
    expect(confirmed.confirmed).toBe(110);
    expect(files.size).toBe(220);
    expect(writeAtomicFiles).toHaveBeenCalledTimes(2 * Math.ceil(110 / COROS_BATCH_COMMIT_SIZE));
    for (const stagedItem of staged) {
      const current = JSON.parse(files.get(stagedItem.path)!.text);
      const workout = JSON.parse(files.get(`data/workouts/workout_${current.data.import_key}.json`)!.text);
      expect(current.data.status).toBe("confirmed");
      expect(workout.data.staging_record_id).toBe(current.id);
    }
  });

  it("skips repeated source files and possible same-activity exports, and reports invalid files", async () => {
    const first = file(0);
    const repeated = { ...first, name: "copy.fit" };
    const sameActivity = { ...file(0, 1), name: "another-export.fit" };
    const invalid = { name: "broken.fit", size: 3, lastModified: 0, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    const rows = await previewCorosBatch([first, repeated, sameActivity, invalid], "Asia/Shanghai");
    expect(selectCorosBatchItems(rows)).toMatchObject({ acceptedFiles: 1, repeatedFiles: 1, suspectedDuplicateActivities: 1, blockedFiles: 1 });
  });

  it("is idempotent across a failed chunk and a retry", async () => {
    const selected = selectCorosBatchItems(await previewCorosBatch(Array.from({ length: COROS_BATCH_COMMIT_SIZE + 2 }, (_, index) => file(index)), "Asia/Shanghai"));
    const { adapter, files, writeAtomicFiles } = memoryRepository();
    writeAtomicFiles.mockImplementationOnce(writeAtomicFiles.getMockImplementation()!);
    writeAtomicFiles.mockRejectedValueOnce(new Error("temporary failure"));
    await expect(stageCorosBatch({ adapter, ownerId: "github_lubannn", items: selected.items })).rejects.toThrow("temporary failure");
    expect(files.size).toBe(COROS_BATCH_COMMIT_SIZE);
    expect(await stageCorosBatch({ adapter, ownerId: "github_lubannn", items: selected.items })).toEqual({ created: 2, alreadyPresent: COROS_BATCH_COMMIT_SIZE });
    expect(await stageCorosBatch({ adapter, ownerId: "github_lubannn", items: selected.items })).toEqual({ created: 0, alreadyPresent: COROS_BATCH_COMMIT_SIZE + 2 });
  });

  it("rejects an oversized selection before reading any file", async () => {
    const read = vi.fn(async () => new ArrayBuffer(0));
    const oversized = Array.from({ length: COROS_BATCH_MAX_FILES + 1 }, () => ({ name: "x.fit", size: 1, lastModified: 0, arrayBuffer: read }));
    await expect(previewCorosBatch(oversized, "Asia/Shanghai")).rejects.toThrow("COROS_BATCH_FILE_COUNT_INVALID");
    expect(read).not.toHaveBeenCalled();
  });
});
