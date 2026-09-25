import { describe, expect, it, vi } from "vitest";

import { previewCorosActivityFile } from "./coros-file-preflight";
import { commitCorosWorkoutStagingWrite, prepareCorosWorkoutStagingWrite } from "./coros-workout-staging-write";
import { GitHubConflictError, GitHubDataError, type GitHubContentsAdapter, type GitHubStoredFile } from "./github-contents";
import { buildPortableWorkspaceExport, inspectPortableWorkspaceExport } from "./portable-export";
import { createPortableRestorePlan } from "./portable-restore";
import { commitWorkoutConfirmationTransaction, prepareWorkoutConfirmationTransaction } from "./workout-confirmation-transaction";

function memoryRepository() {
  const files = new Map<string, GitHubStoredFile>();
  let revision = 1;
  const readBranchSnapshot = vi.fn(async () => ({ branch: "main", headCommitSha: `head-${revision}`, rootTreeSha: `tree-${revision}` }));
  const readText = vi.fn(async (path: string, refOverride?: string) => {
    if (refOverride && refOverride !== `head-${revision}`) throw new GitHubConflictError("The branch moved.");
    const file = files.get(path);
    if (!file) throw new GitHubDataError("Not found", 404, "GITHUB_NOT_FOUND");
    return file;
  });
  const writeAtomicFiles = vi.fn(async (input: { files: Array<{ path: string; text: string }>; expectedHeadCommitSha: string; baseTreeSha: string }) => {
    if (input.expectedHeadCommitSha !== `head-${revision}` || input.baseTreeSha !== `tree-${revision}`) throw new GitHubConflictError("The branch moved.");
    revision += 1;
    const written = input.files.map(({ path, text }) => {
      const file = { path, text, blobSha: `blob-${revision}-${path}`, sizeBytes: new TextEncoder().encode(text).byteLength };
      files.set(path, file);
      return { path, blobSha: file.blobSha };
    });
    return { commitSha: `head-${revision}`, treeSha: `tree-${revision}`, files: written };
  });
  const adapter = { readBranchSnapshot, readText, writeAtomicFiles } as unknown as Pick<GitHubContentsAdapter, "readBranchSnapshot" | "readText" | "writeAtomicFiles">;
  return { adapter, files, writeAtomicFiles };
}

describe("COROS Workout offline lifecycle", () => {
  it("previews, stages once, confirms atomically, and survives portable inspection and restore planning", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities><Activity Sport="Running"><Id>2026-09-19T01:00:00Z</Id>
    <Lap StartTime="2026-09-19T01:00:00Z"><Track>
      <Trackpoint><Time>2026-09-19T01:00:00Z</Time><Position><LatitudeDegrees>31.2</LatitudeDegrees><LongitudeDegrees>121.5</LongitudeDegrees></Position></Trackpoint>
      <Trackpoint><Time>2026-09-19T01:30:00Z</Time></Trackpoint>
    </Track></Lap>
  </Activity></Activities>
</TrainingCenterDatabase>`;
    const bytes = new TextEncoder().encode(xml);
    const preview = await previewCorosActivityFile({ name: "private-run-name.tcx", size: bytes.byteLength, lastModified: 0, arrayBuffer: async () => bytes.slice().buffer });
    expect(preview.readyForMapping).toBe(true);
    const { adapter, files, writeAtomicFiles } = memoryRepository();
    const ownerId = "github_lubannn";
    const timestamp = "2026-09-19T02:00:00.000Z";

    const stage = await prepareCorosWorkoutStagingWrite({ adapter, ownerId, plan: preview.stagingPlan, timestamp });
    expect(stage.files).toHaveLength(1);
    expect(writeAtomicFiles).not.toHaveBeenCalled();
    expect(stage.files[0].text).not.toMatch(/private-run-name|31\.2|121\.5|LatitudeDegrees|LongitudeDegrees/u);
    const staged = await commitCorosWorkoutStagingWrite(adapter, stage);
    expect(staged.created).toHaveLength(1);
    expect(files.size).toBe(1);

    const duplicate = await prepareCorosWorkoutStagingWrite({ adapter, ownerId, plan: preview.stagingPlan, timestamp });
    expect(duplicate).toMatchObject({ files: [], alreadyPresent: 1 });
    expect(writeAtomicFiles).toHaveBeenCalledTimes(1);

    const confirmation = await prepareWorkoutConfirmationTransaction({ adapter, staging: staged.created[0], ownerId, timestamp });
    expect(confirmation.confirmationText).toContain(confirmation.workout.path);
    expect(writeAtomicFiles).toHaveBeenCalledTimes(1);
    const confirmed = await commitWorkoutConfirmationTransaction(adapter, confirmation);
    expect(confirmed.staging.record.data.status).toBe("confirmed");
    expect(confirmed.workout.record.data.staging_record_id).toBe(confirmed.staging.record.id);
    expect(writeAtomicFiles).toHaveBeenCalledTimes(2);
    expect(writeAtomicFiles.mock.calls[1][0].files).toHaveLength(2);
    expect(files.size).toBe(2);

    const workspaceText = `${JSON.stringify({ schema_version: 1, workspace_id: "personal-workspace", owner_id: ownerId, owner_login: "lubannn", locale: "zh-CN", timezone: "Asia/Shanghai" })}\n`;
    const workspaceFile = { path: "workspace.json", text: workspaceText, blobSha: "workspace-blob", sizeBytes: new TextEncoder().encode(workspaceText).byteLength };
    const exported = await buildPortableWorkspaceExport({
      repository: "lubannn/personal-workspace-data", branch: "main", workspaceFile, captureFiles: [],
      healthStagingFiles: [files.get(confirmed.staging.path)!], workoutFiles: [files.get(confirmed.workout.path)!],
    });
    expect(await inspectPortableWorkspaceExport(exported)).toMatchObject({ valid: true, counts: { workouts: 1, healthStagingRecords: 1 } });
    const restore = await createPortableRestorePlan(exported, {
      repository: { fullName: "lubannn/personal-workspace-restore-test", private: true, visibility: "private", defaultBranch: "main" },
      branch: { branch: "main", headCommitSha: "empty-head", rootTreeSha: "empty-tree" }, rootEntries: [],
    });
    expect(restore).toMatchObject({ ready: true, counts: { workouts: 1, healthStagingRecords: 1 } });
    expect(restore.files.map((file) => file.path)).toEqual(expect.arrayContaining([confirmed.staging.path, confirmed.workout.path]));
  });
});
