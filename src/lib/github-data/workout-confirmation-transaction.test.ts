import { describe, expect, it, vi } from "vitest";

import { createCorosWorkoutStagingData } from "./health-staging-records";
import { GitHubConflictError, GitHubDataError, type GitHubContentsAdapter } from "./github-contents";
import { createWorkspaceRecord, serializeRecord } from "./protocol";
import { commitWorkoutConfirmationTransaction, prepareWorkoutConfirmationTransaction } from "./workout-confirmation-transaction";

const timestamp = "2026-09-19T02:00:00.000Z";

function fixture() {
  const importKey = "c".repeat(64);
  const record = createWorkspaceRecord({
    entityType: "health_staging_record", id: `coros_workout_${importKey}`, ownerId: "github_lubannn", timestamp,
    data: createCorosWorkoutStagingData({
      source: { kind: "coros_file", label: "COROS TCX file", format: "tcx", source_sha256: "a".repeat(64), parser_version: "1", mapping_version: "1", batch_identity: "b".repeat(64) },
      import_key: importKey,
      normalized_json: { activity_type: "ride", start_at: "2026-09-19T01:00:00.000Z", end_at: "2026-09-19T01:30:00.000Z", timezone: "Asia/Shanghai", duration_seconds: 1800, distance: 12000, distance_unit: "m", training_load: null, metrics_json: { elapsed_seconds: 1800, moving_seconds: 1750, calories: 320, average_heart_rate_bpm: 138, maximum_heart_rate_bpm: 166, average_cadence_rpm: 84, average_power_watts: 190, trackpoints: 2 } },
      diagnostics_json: [],
    }),
  });
  const staging = { record, path: `data/health-staging-records/${record.id}.json`, blobSha: "old-staging-blob" };
  const readBranchSnapshot = vi.fn(async () => ({ branch: "main", headCommitSha: "head-1", rootTreeSha: "tree-1" }));
  const readText = vi.fn(async (path: string) => {
    if (path === staging.path) return { path, text: serializeRecord(record), blobSha: staging.blobSha, sizeBytes: 100 };
    throw new GitHubDataError("Not found", 404, "GITHUB_NOT_FOUND");
  });
  const writeAtomicFiles = vi.fn(async (input: { files: Array<{ path: string; text: string }> }) => ({
    commitSha: "commit-2", treeSha: "tree-2", files: input.files.map((file) => ({ path: file.path, blobSha: `blob-${file.path}` })),
  }));
  const adapter = { readBranchSnapshot, readText, writeAtomicFiles } as unknown as Pick<GitHubContentsAdapter, "readBranchSnapshot" | "readText" | "writeAtomicFiles">;
  return { staging, adapter, readText, writeAtomicFiles };
}

describe("Workout atomic confirmation transaction", () => {
  it("writes the reviewed staging and canonical Workout in one non-forced commit", async () => {
    const { staging, adapter, writeAtomicFiles } = fixture();
    const prepared = await prepareWorkoutConfirmationTransaction({ adapter, staging, ownerId: staging.record.owner_id, timestamp });
    expect(prepared.staging.record.data).toMatchObject({ status: "confirmed", canonical_record_id: prepared.workout.record.id });
    expect(prepared.workout.record.data).toMatchObject({ staging_record_id: staging.record.id, confirmation_status: "confirmed" });
    expect(prepared.confirmationText).toContain(prepared.workout.path);
    expect(writeAtomicFiles).not.toHaveBeenCalled();

    const result = await commitWorkoutConfirmationTransaction(adapter, prepared);
    expect(writeAtomicFiles).toHaveBeenCalledWith(expect.objectContaining({
      files: [{ path: prepared.staging.path, text: prepared.staging.text }, { path: prepared.workout.path, text: prepared.workout.text }],
      expectedHeadCommitSha: "head-1", baseTreeSha: "tree-1",
    }));
    expect(result).toMatchObject({ commitSha: "commit-2", workout: { path: prepared.workout.path } });
  });

  it("does not write when the staging changed or the Workout path exists", async () => {
    const { staging, adapter, readText, writeAtomicFiles } = fixture();
    await expect(prepareWorkoutConfirmationTransaction({ adapter, staging: { ...staging, blobSha: "stale" }, ownerId: staging.record.owner_id, timestamp })).rejects.toBeInstanceOf(GitHubConflictError);
    const original = readText.getMockImplementation()!;
    readText.mockImplementation(async (path) => path === staging.path ? original(path) : { path, text: "{}", blobSha: "existing", sizeBytes: 2 });
    await expect(prepareWorkoutConfirmationTransaction({ adapter, staging, ownerId: staging.record.owner_id, timestamp })).rejects.toBeInstanceOf(GitHubConflictError);
    expect(writeAtomicFiles).not.toHaveBeenCalled();
  });

  it("propagates a branch race without reporting partial success", async () => {
    const { staging, adapter, writeAtomicFiles } = fixture();
    const prepared = await prepareWorkoutConfirmationTransaction({ adapter, staging, ownerId: staging.record.owner_id, timestamp });
    writeAtomicFiles.mockRejectedValueOnce(new GitHubConflictError("Branch moved"));
    await expect(commitWorkoutConfirmationTransaction(adapter, prepared)).rejects.toBeInstanceOf(GitHubConflictError);
  });
});
