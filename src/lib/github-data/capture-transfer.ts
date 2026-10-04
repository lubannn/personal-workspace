import { createCaptureData, updateCaptureDetails, type CaptureFields } from "./capture-details";
import { prepareCaptureSubmission, type CaptureSubmission } from "./capture-routing";
import { parseCaptureRecord, type CaptureRecord } from "./workspace";
import { parseTaskRecord } from "./tasks";
import { parseCalendarEventRecord } from "./calendar-events";
import { parseJournalEntryRecord } from "./journal-entries";
import { serializeRecord, updateWorkspaceRecord } from "./protocol";
import { GitHubConflictError, GitHubDataError, type GitHubContentsAdapter } from "./github-contents";

export type CaptureSource = { record: CaptureRecord; path: string; blobSha: string };
type TransferAdapter = Pick<GitHubContentsAdapter, "readBranchSnapshot" | "readText" | "writeAtomicFiles">;

function readDestination(text: string, tab: string) {
  if (tab === "tasks") return parseTaskRecord(text);
  if (tab === "calendar") return parseCalendarEventRecord(text);
  if (tab === "journal") return parseJournalEntryRecord(text);
  throw new Error("CAPTURE_DESTINATION_REQUIRED");
}

export async function transferCapture(adapter: TransferAdapter, source: CaptureSource, fields: CaptureFields, context: { ownerId: string; timestamp: string; today: string }) {
  if (!["todo", "deadline", "schedule", "journal"].includes(fields.kind)) throw new Error("CAPTURE_DESTINATION_REQUIRED");
  const normalized = createCaptureData(fields);
  const snapshot = await adapter.readBranchSnapshot();
  const currentFile = await adapter.readText(source.path, snapshot.headCommitSha);
  const current = parseCaptureRecord(currentFile.text);
  if (current.id !== source.record.id || current.owner_id !== context.ownerId || current.deleted_at) throw new GitHubConflictError("The capture is no longer available; your edits are preserved.");
  if (current.data.routed_to) {
    // A lost response must not create another entry. A destination subsequently edited in its own module stays intact.
    if (current.data.raw_text !== normalized.raw_text || current.data.kind !== fields.kind || current.data.noted_date !== fields.date || current.data.noted_time !== fields.time || current.data.timezone !== fields.timezone || (current.data.routed_to.end_time ?? null) !== (fields.endTime ?? null)) throw new GitHubConflictError("This capture was already transferred with different content.");
    const link = current.data.routed_to;
    const file = await adapter.readText(link.path, snapshot.headCommitSha);
    const destination: CaptureSubmission = { record: readDestination(file.text, link.tab), path: link.path, tab: link.tab, label: link.label };
    return { source: { record: current, path: source.path, blobSha: currentFile.blobSha }, destination, destinationBlobSha: file.blobSha, commitSha: snapshot.headCommitSha };
  }
  if (currentFile.blobSha !== source.blobSha) throw new GitHubConflictError("The capture changed on another device; your edits are preserved.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source.path));
  const suffix = `from_capture_${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
  const destination = prepareCaptureSubmission(fields, { ...context, suffix });
  try {
    await adapter.readText(destination.path, snapshot.headCommitSha);
    throw new GitHubConflictError("The destination already exists; no records were overwritten.");
  } catch (error) {
    if (!(error instanceof GitHubDataError && error.code === "GITHUB_NOT_FOUND")) throw error;
  }
  if (!["tasks", "calendar", "journal"].includes(destination.tab)) throw new Error("CAPTURE_DESTINATION_REQUIRED");
  const edited = updateCaptureDetails(current, fields, context.timestamp);
  // One version increment, one atomic commit: source archive and real module entry succeed together.
  const archived = updateWorkspaceRecord(current, { ...edited.data, status: "archived" as const, routed_to: { path: destination.path, tab: destination.tab as "tasks" | "calendar" | "journal", label: destination.label, end_time: fields.endTime ?? null } }, context.timestamp);
  const result = await adapter.writeAtomicFiles({ files: [{ path: source.path, text: serializeRecord(archived) }, { path: destination.path, text: serializeRecord(destination.record) }], message: `capture: transfer ${current.id}`, expectedHeadCommitSha: snapshot.headCommitSha, baseTreeSha: snapshot.rootTreeSha });
  return { source: { record: archived, path: source.path, blobSha: result.files.find((file) => file.path === source.path)!.blobSha }, destination, destinationBlobSha: result.files.find((file) => file.path === destination.path)!.blobSha, commitSha: result.commitSha };
}
