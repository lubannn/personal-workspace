import { describe, expect, it, vi } from "vitest";

import { mapCorosActivities, type CorosSourceActivity } from "./coros-activity-mapping";
import { planCorosWorkoutStaging } from "./coros-workout-staging-plan";
import { commitCorosWorkoutStagingWrite, prepareCorosWorkoutStagingWrite } from "./coros-workout-staging-write";
import { GitHubConflictError, GitHubDataError, type GitHubContentsAdapter } from "./github-contents";
import { parseHealthStagingRecord } from "./health-staging-records";

const ownerId = "github_lubannn";
const timestamp = "2026-09-19T02:00:00.000Z";
const activity: CorosSourceActivity = {
  sourceIdentity: "activity-1", sport: "Biking", startAt: "2026-09-19T01:00:00.000Z",
  endAt: "2026-09-19T01:30:00.000Z", elapsedSeconds: 1800, movingSeconds: 1750,
  distanceMeters: 12000, calories: 320, averageHeartRate: 138, maximumHeartRate: 166,
  averageCadence: 84, averagePower: 190, trackpoints: 2,
};

async function plan(activities = [activity]) {
  const mapping = await mapCorosActivities({ sourceSha256: "a".repeat(64), parserVersion: "1", timezone: "Asia/Shanghai", activities });
  return planCorosWorkoutStaging({ format: "tcx", sourceSha256: "a".repeat(64), parserVersion: "1", mapping });
}

function adapter() {
  const readBranchSnapshot = vi.fn(async () => ({ branch: "main", headCommitSha: "head-1", rootTreeSha: "tree-1" }));
  const readText = vi.fn(async () => { throw new GitHubDataError("Not found", 404, "GITHUB_NOT_FOUND"); });
  const writeAtomicFiles = vi.fn(async (input: { files: Array<{ path: string; text: string }> }) => ({
    commitSha: "commit-2", treeSha: "tree-2", files: input.files.map((file) => ({ path: file.path, blobSha: `blob-${file.path}` })),
  }));
  return { readBranchSnapshot, readText, writeAtomicFiles } as unknown as Pick<GitHubContentsAdapter, "readBranchSnapshot" | "readText" | "writeAtomicFiles">;
}

describe("COROS Workout staging write", () => {
  it("prepares exact confirmation and commits only new records against the checked HEAD", async () => {
    const remote = adapter();
    const prepared = await prepareCorosWorkoutStagingWrite({ adapter: remote, ownerId, plan: await plan(), timestamp });
    expect(prepared.files).toHaveLength(1);
    expect(prepared.confirmationText).toContain(prepared.files[0].path);
    expect(prepared.confirmationText).toContain("12000 m");
    expect(prepared.confirmationText).toContain("不保存原始文件");
    expect(parseHealthStagingRecord(prepared.files[0].text).data.status).toBe("pending");
    expect(remote.readText).toHaveBeenCalledWith(prepared.files[0].path, "head-1");

    const result = await commitCorosWorkoutStagingWrite(remote, prepared);
    expect(remote.writeAtomicFiles).toHaveBeenCalledWith(expect.objectContaining({
      files: [{ path: prepared.files[0].path, text: prepared.files[0].text }],
      expectedHeadCommitSha: "head-1", baseTreeSha: "tree-1",
    }));
    expect(result).toMatchObject({ commitSha: "commit-2", alreadyPresent: 0, created: [{ path: prepared.files[0].path }] });
  });

  it("treats an identical existing record as idempotent and makes no commit", async () => {
    const remote = adapter();
    const proposed = await prepareCorosWorkoutStagingWrite({ adapter: remote, ownerId, plan: await plan(), timestamp });
    const existingText = proposed.files[0].text;
    vi.mocked(remote.readText).mockImplementation(async (path) => ({ path, text: existingText, blobSha: "old-blob", sizeBytes: existingText.length }));

    const prepared = await prepareCorosWorkoutStagingWrite({ adapter: remote, ownerId, plan: await plan(), timestamp });
    expect(prepared).toMatchObject({ files: [], alreadyPresent: 1 });
    expect(await commitCorosWorkoutStagingWrite(remote, prepared)).toEqual({ created: [], alreadyPresent: 1, commitSha: null });
    expect(remote.writeAtomicFiles).not.toHaveBeenCalled();
  });

  it("never overwrites a conflicting existing path", async () => {
    const remote = adapter();
    const proposed = await prepareCorosWorkoutStagingWrite({ adapter: remote, ownerId, plan: await plan(), timestamp });
    const different = JSON.parse(proposed.files[0].text);
    different.owner_id = "github_other";
    vi.mocked(remote.readText).mockImplementation(async (path) => ({ path, text: `${JSON.stringify(different)}\n`, blobSha: "old-blob", sizeBytes: proposed.files[0].text.length }));

    await expect(prepareCorosWorkoutStagingWrite({ adapter: remote, ownerId, plan: await plan(), timestamp })).rejects.toBeInstanceOf(GitHubConflictError);
    expect(remote.writeAtomicFiles).not.toHaveBeenCalled();
  });

  it("writes only missing records when a batch is partly present", async () => {
    const remote = adapter();
    const batch = await plan([activity, { ...activity, sourceIdentity: "activity-2", startAt: "2026-09-20T01:00:00.000Z", endAt: "2026-09-20T01:30:00.000Z" }]);
    const initial = await prepareCorosWorkoutStagingWrite({ adapter: remote, ownerId, plan: batch, timestamp });
    vi.mocked(remote.readText).mockImplementation(async (path) => {
      if (path === initial.files[0].path) return { path, text: initial.files[0].text, blobSha: "old-blob", sizeBytes: initial.files[0].text.length };
      throw new GitHubDataError("Not found", 404, "GITHUB_NOT_FOUND");
    });

    const prepared = await prepareCorosWorkoutStagingWrite({ adapter: remote, ownerId, plan: batch, timestamp });
    expect(prepared).toMatchObject({ alreadyPresent: 1, files: [{ path: initial.files[1].path }] });
    await commitCorosWorkoutStagingWrite(remote, prepared);
    expect(vi.mocked(remote.writeAtomicFiles).mock.calls[0][0].files).toHaveLength(1);
  });

  it("aborts when the branch moves between confirmation and commit", async () => {
    const remote = adapter();
    const prepared = await prepareCorosWorkoutStagingWrite({ adapter: remote, ownerId, plan: await plan(), timestamp });
    vi.mocked(remote.writeAtomicFiles).mockRejectedValueOnce(new GitHubConflictError("Branch moved"));
    await expect(commitCorosWorkoutStagingWrite(remote, prepared)).rejects.toBeInstanceOf(GitHubConflictError);
  });

  it("rejects a changed local plan before writing", async () => {
    const remote = adapter();
    const changed = await plan();
    changed.items[0].proposedData.normalized_json.distance = 42;
    await expect(prepareCorosWorkoutStagingWrite({ adapter: remote, ownerId, plan: changed, timestamp })).rejects.toThrow("COROS_STAGING_PLAN_CHANGED");
    expect(remote.writeAtomicFiles).not.toHaveBeenCalled();
  });
});
