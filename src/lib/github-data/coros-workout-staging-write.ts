import { GitHubConflictError, GitHubDataError, type GitHubContentsAdapter } from "./github-contents";
import { parseHealthStagingRecord, type HealthStagingRecord } from "./health-staging-records";
import { createWorkspaceRecord, recordPath, serializeRecord } from "./protocol";
import type { CorosWorkoutStagingPlan } from "./coros-workout-staging-plan";

type StagingWriteAdapter = Pick<GitHubContentsAdapter, "readBranchSnapshot" | "readText" | "writeAtomicFiles">;

export type PreparedCorosWorkoutStagingWrite = {
  snapshot: Awaited<ReturnType<StagingWriteAdapter["readBranchSnapshot"]>>;
  files: Array<{ path: string; text: string; record: HealthStagingRecord }>;
  alreadyPresent: number;
  confirmationText: string;
};

export async function prepareCorosWorkoutStagingWrite(input: {
  adapter: StagingWriteAdapter;
  ownerId: string;
  plan: CorosWorkoutStagingPlan;
  timestamp?: string;
}): Promise<PreparedCorosWorkoutStagingWrite> {
  const { adapter, ownerId, plan } = input;
  if (!plan.protocolAccepted || !plan.readyForProtocolActivation || plan.items.length === 0) throw new Error("COROS_STAGING_PLAN_NOT_READY");
  const snapshot = await adapter.readBranchSnapshot();
  const timestamp = input.timestamp ?? new Date().toISOString();
  const seenPaths = new Set<string>();
  const files: PreparedCorosWorkoutStagingWrite["files"] = [];
  let alreadyPresent = 0;

  for (const item of plan.items) {
    if (item.writeMode !== "create_only" || item.expectedBlobSha !== null ||
      item.stagingRecordId !== `coros_workout_${item.proposedData.import_key}` ||
      item.path !== recordPath("health_staging_record", item.stagingRecordId) || seenPaths.has(item.path)) {
      throw new Error("COROS_STAGING_PLAN_INVALID");
    }
    seenPaths.add(item.path);
    const payloadHash = await sha256Hex(`${JSON.stringify(item.proposedData)}\n`);
    if (payloadHash !== item.payloadSha256) throw new Error("COROS_STAGING_PLAN_CHANGED");
    const record = createWorkspaceRecord({ entityType: "health_staging_record", id: item.stagingRecordId, ownerId, timestamp, data: item.proposedData });
    const text = serializeRecord(record);
    parseHealthStagingRecord(text);
    try {
      const existing = await adapter.readText(item.path, snapshot.headCommitSha);
      let current: HealthStagingRecord;
      try { current = parseHealthStagingRecord(existing.text); }
      catch { throw new GitHubConflictError("Existing Workout staging record is invalid."); }
      if (current.id !== record.id || current.owner_id !== ownerId || current.data.health_type !== "workout" ||
        current.data.import_key !== record.data.import_key ||
        stableJson(current.data.source) !== stableJson(record.data.source) ||
        current.data.classifier_version !== record.data.classifier_version ||
        stableJson(current.data.normalized_json) !== stableJson(record.data.normalized_json) ||
        stableJson(current.data.diagnostics_json) !== stableJson(record.data.diagnostics_json)) {
        throw new GitHubConflictError("Workout staging path already contains different data.");
      }
      alreadyPresent += 1;
    } catch (error) {
      if (error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND") files.push({ path: item.path, text, record });
      else throw error;
    }
  }

  const details = files.map(({ record, path }) => {
    if (record.data.health_type !== "workout") throw new Error("COROS_STAGING_PLAN_INVALID");
    const workout = record.data.normalized_json;
    return `${path}\n  ${workout.activity_type} · ${workout.start_at} · ${workout.duration_seconds} 秒 · ${workout.distance === null ? "无距离" : `${workout.distance} m`}`;
  }).join("\n");
  const confirmationText = files.length
    ? `将向 Private 数据仓库创建 ${files.length} 条 pending Workout 暂存记录（已存在 ${alreadyPresent} 条会跳过）：\n${details}\n来源 SHA-256：${plan.items[0]!.proposedData.source.source_sha256}\n仅保存活动摘要，不保存原始文件、文件名或 GPS 轨迹。确认写入暂存区吗？`
    : `这批 Workout 暂存记录已全部存在（${alreadyPresent} 条），没有新文件需要写入。`;
  return { snapshot, files, alreadyPresent, confirmationText };
}

export async function commitCorosWorkoutStagingWrite(adapter: StagingWriteAdapter, prepared: PreparedCorosWorkoutStagingWrite) {
  if (prepared.files.length === 0) return { created: [], alreadyPresent: prepared.alreadyPresent, commitSha: null };
  const result = await adapter.writeAtomicFiles({
    files: prepared.files.map(({ path, text }) => ({ path, text })),
    message: `coros: stage ${prepared.files.length} workout${prepared.files.length === 1 ? "" : "s"}`,
    expectedHeadCommitSha: prepared.snapshot.headCommitSha,
    baseTreeSha: prepared.snapshot.rootTreeSha,
  });
  return {
    created: prepared.files.map(({ record, path }) => ({ record, path, blobSha: result.files.find((file) => file.path === path)!.blobSha })),
    alreadyPresent: prepared.alreadyPresent,
    commitSha: result.commitSha,
  };
}

async function sha256Hex(value: string) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
