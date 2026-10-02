import { describe, expect, it, vi } from "vitest";
import { GitHubConflictError, GitHubContentsAdapter } from "./github-contents";
import { createJournalEntryData, parseJournalEntryRecord } from "./journal-entries";
import { createWorkspaceRecord, recordPath, setWorkspaceRecordDeleted } from "./protocol";
import { createJournalEntrySingleFile, updateJournalEntrySingleFile } from "./journal-single-file-writes";

const timestamp = "2026-10-02T01:00:00.000Z";
const id = "journal_entry_20261002_20261002010000000_abcdef";
const path = recordPath("journal_entry", id);
const current = createWorkspaceRecord({ entityType: "journal_entry", id, ownerId: "owner_1", timestamp,
  data: createJournalEntryData({ journalDate: "2026-10-02", timezone: "Asia/Shanghai", bodyMarkdown: "原文", timestamp, currentRevisionId: "old_revision" }),
});
const createInput = { ownerId: "owner_1", id, journalDate: "2026-10-02", todayDate: "2026-10-02", timezone: "Asia/Shanghai", bodyMarkdown: "正文", timestamp };
const editInput = { ownerId: "owner_1", current, path, expectedBlobSha: "old-sha", todayDate: "2026-10-02", bodyMarkdown: "修改后的正文", timestamp: "2026-10-02T02:00:00.000Z" };

function adapter(status = 201) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(status === 201
    ? { content: { path, sha: "new-sha" }, commit: { sha: "commit-one" } }
    : { message: "conflict" }), { status, headers: { "Content-Type": "application/json" } }));
  return { api: new GitHubContentsAdapter({ owner: "owner", repository: "private-data", token: "test", branch: "main" }, fetcher), fetcher };
}

describe("single-file journal saving", () => {
  it("creates date, time and body with exactly one PUT, with no archive or revision requests", async () => {
    const { api, fetcher } = adapter();
    const saved = await createJournalEntrySingleFile(api, createInput);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toContain(`/contents/${path}`);
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("PUT");
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.sha).toBeUndefined();
    expect(saved.entry.data).toMatchObject({ journal_date: "2026-10-02", first_entry_at: timestamp, body_markdown: "正文", current_revision_id: null });
    expect(saved.file.commitSha).toBe("commit-one");
  });

  it("edits only this file using its SHA and preserves the date and first submission time", async () => {
    const { api, fetcher } = adapter();
    const saved = await updateJournalEntrySingleFile(api, editInput);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.sha).toBe("old-sha");
    expect(saved.entry.version).toBe(2);
    expect(saved.entry.data).toMatchObject({ journal_date: current.data.journal_date, first_entry_at: timestamp, last_entry_at: editInput.timestamp, body_markdown: editInput.bodyMarkdown, current_revision_id: null });
    expect(current.data.current_revision_id).toBe("old_revision");
    expect(parseJournalEntryRecord(JSON.stringify(saved.entry))).toEqual(saved.entry);
  });

  it("rejects concurrent changes without retries or overwriting another device's diary", async () => {
    const { api, fetcher } = adapter(409);
    await expect(updateJournalEntrySingleFile(api, editInput)).rejects.toBeInstanceOf(GitHubConflictError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects creation collisions without overwriting or retrying", async () => {
    const { api, fetcher } = adapter(422);
    await expect(createJournalEntrySingleFile(api, createInput)).rejects.toBeInstanceOf(GitHubConflictError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("enforces today/yesterday and valid content before any network write", async () => {
    const { api, fetcher } = adapter();
    for (const journalDate of ["2026-09-30", "2026-10-03"]) {
      await expect(createJournalEntrySingleFile(api, { ...createInput, journalDate })).rejects.toThrow("JOURNAL_DATE_NOT_WRITABLE");
    }
    await expect(createJournalEntrySingleFile(api, { ...createInput, bodyMarkdown: " " })).rejects.toThrow();
    await expect(updateJournalEntrySingleFile(api, { ...editInput, todayDate: "2026-10-04" })).rejects.toThrow("JOURNAL_DATE_NOT_WRITABLE");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects wrong owners, paths, missing SHAs and deleted records without network requests", async () => {
    const { api, fetcher } = adapter();
    await expect(updateJournalEntrySingleFile(api, { ...editInput, ownerId: "other_owner" })).rejects.toThrow("JOURNAL_OWNER_MISMATCH");
    await expect(updateJournalEntrySingleFile(api, { ...editInput, path: "data/journal-entries/other.json" })).rejects.toThrow("JOURNAL_ENTRY_PATH_MISMATCH");
    await expect(updateJournalEntrySingleFile(api, { ...editInput, expectedBlobSha: "" })).rejects.toThrow("JOURNAL_EXPECTED_BLOB_REQUIRED");
    await expect(updateJournalEntrySingleFile(api, { ...editInput, current: setWorkspaceRecordDeleted(current, editInput.timestamp, editInput.timestamp) })).rejects.toThrow("JOURNAL_ENTRY_NOT_ACTIVE");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
