import { parseCorosSyncConflictRecord } from "../../../src/lib/github-data/coros-sync-conflicts";
import { recordPath } from "../../../src/lib/github-data/protocol";
import { parseWorkspaceDescriptor } from "../../../src/lib/github-data/workspace";
import { createPrivateDataInstallationAdapter } from "./github-installation";
import { syncReadiness, type CorosSyncEnv } from "./coros-sync-state";

export async function readCorosConflictView(env: CorosSyncEnv) {
  if (!syncReadiness(env).ready) throw new Error("COROS_SYNC_NOT_CONFIGURED");
  const adapter = await createPrivateDataInstallationAdapter({ appId: env.GITHUB_APP_ID!,
    installationId: env.GITHUB_APP_INSTALLATION_ID!, privateKeyPem: env.GITHUB_APP_PRIVATE_KEY!,
    owner: env.ALLOWED_REPO_OWNER!, repository: env.ALLOWED_REPO_NAME! });
  const snapshot = await adapter.readBranchSnapshot();
  const descriptor = parseWorkspaceDescriptor((await adapter.readText("workspace.json", snapshot.headCommitSha)).text);
  if (descriptor.owner_login !== env.ALLOWED_GITHUB_LOGIN) throw new Error("COROS_SYNC_WORKSPACE_MISMATCH");
  const tree = await adapter.listTreeFiles(snapshot.rootTreeSha);
  const files = tree.filter(file => /^data\/coros-sync-conflicts\/[^/]+\.json$/u.test(file.path));
  const records = (await adapter.readBlobTexts(files.slice(0, 50))).map(file => {
    const record = parseCorosSyncConflictRecord(file.text);
    if (record.owner_id !== descriptor.owner_id || recordPath("coros_sync_conflict", record.id) !== file.path) {
      throw new Error("COROS_SYNC_RECORD_IDENTITY_MISMATCH");
    }
    return record;
  });
  return { total: files.length, items: records.map(record => {
    const data = record.data; const candidate = data.candidate.candidate;
    return { id: record.id, kind: data.record_kind, reason: data.reason,
      startAt: candidate.start_at, endAt: candidate.end_at, detectedAt: data.detected_at,
      existingRecordUrl: `https://github.com/${env.ALLOWED_REPO_OWNER}/${env.ALLOWED_REPO_NAME}/blob/${snapshot.branch}/${recordPath(data.record_kind === "sleep" ? "sleep_session" : "workout", data.existing_record_id)}`,
      detailUrl: `https://github.com/${env.ALLOWED_REPO_OWNER}/${env.ALLOWED_REPO_NAME}/blob/${snapshot.branch}/${recordPath("coros_sync_conflict", record.id)}` };
  }) };
}
