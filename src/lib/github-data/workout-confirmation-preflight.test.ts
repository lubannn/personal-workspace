import { describe, expect, it, vi } from "vitest";

import { mapCorosActivities, type CorosSourceActivity } from "./coros-activity-mapping";
import { planCorosWorkoutStaging } from "./coros-workout-staging-plan";
import { GitHubConflictError, GitHubDataError, type GitHubContentsAdapter } from "./github-contents";
import { createWorkspaceRecord, serializeRecord } from "./protocol";
import { inspectWorkoutConfirmationPreconditions } from "./workout-confirmation-preflight";

const ownerId = "github_lubannn";
const timestamp = "2026-09-19T02:00:00.000Z";
const activity: CorosSourceActivity = {
  sourceIdentity: "activity-1", sport: "Biking", startAt: "2026-09-19T01:00:00.000Z",
  endAt: "2026-09-19T01:30:00.000Z", elapsedSeconds: 1800, movingSeconds: 1750,
  distanceMeters: 12000, calories: 320, averageHeartRate: 138, maximumHeartRate: 166,
  averageCadence: 84, averagePower: 190, trackpoints: 2,
};

async function fixture() {
  const mapping = await mapCorosActivities({ sourceSha256: "a".repeat(64), parserVersion: "1", timezone: "Asia/Shanghai", activities: [activity] });
  const plan = await planCorosWorkoutStaging({ format: "tcx", sourceSha256: "a".repeat(64), parserVersion: "1", mapping });
  const record = createWorkspaceRecord({ entityType: "health_staging_record", id: plan.items[0].stagingRecordId, ownerId, timestamp, data: plan.items[0].proposedData });
  const staging = { record, path: plan.items[0].path, blobSha: "staging-blob" };
  const readBranchSnapshot = vi.fn(async () => ({ branch: "main", headCommitSha: "head-1", rootTreeSha: "tree-1" }));
  const readText = vi.fn(async (path: string) => {
    if (path === staging.path) return { path, text: serializeRecord(record), blobSha: staging.blobSha, sizeBytes: 100 };
    throw new GitHubDataError("Not found", 404, "GITHUB_NOT_FOUND");
  });
  const adapter = { readBranchSnapshot, readText } as unknown as Pick<GitHubContentsAdapter, "readBranchSnapshot" | "readText">;
  return { staging, adapter, readText };
}

describe("Workout confirmation preflight stays read-only", () => {
  it("checks the staging blob and absent canonical path at the same HEAD", async () => {
    const { staging, adapter, readText } = await fixture();
    const result = await inspectWorkoutConfirmationPreconditions({ adapter, staging, ownerId });
    expect(result.canonicalId).toBe(`workout_${staging.record.data.import_key}`);
    expect(result.canonicalPath).toBe(`data/workouts/${result.canonicalId}.json`);
    expect(result.confirmationText).toContain("12000 m");
    expect(readText).toHaveBeenCalledWith(staging.path, "head-1");
    expect(readText).toHaveBeenCalledWith(result.canonicalPath, "head-1");
  });

  it("stops if the staging blob changed after loading", async () => {
    const { staging, adapter } = await fixture();
    await expect(inspectWorkoutConfirmationPreconditions({ adapter, staging: { ...staging, blobSha: "stale" }, ownerId })).rejects.toBeInstanceOf(GitHubConflictError);
  });

  it("stops if the canonical path already exists", async () => {
    const { staging, adapter, readText } = await fixture();
    const original = readText.getMockImplementation()!;
    readText.mockImplementation(async (path) => path === staging.path ? original(path) : { path, text: "{}", blobSha: "existing", sizeBytes: 2 });
    await expect(inspectWorkoutConfirmationPreconditions({ adapter, staging, ownerId })).rejects.toBeInstanceOf(GitHubConflictError);
  });

  it("stops if the latest staging was rejected or belongs to another owner", async () => {
    const { staging, adapter, readText } = await fixture();
    const rejected = { ...staging.record, data: { ...staging.record.data, status: "rejected", reviewed_at: timestamp, review_reason: "duplicate" } };
    readText.mockImplementation(async (path) => ({ path, text: JSON.stringify(rejected), blobSha: staging.blobSha, sizeBytes: 100 }));
    await expect(inspectWorkoutConfirmationPreconditions({ adapter, staging, ownerId })).rejects.toBeInstanceOf(GitHubConflictError);
    await expect(inspectWorkoutConfirmationPreconditions({ adapter, staging, ownerId: "github_other" })).rejects.toBeInstanceOf(GitHubConflictError);
  });
});
