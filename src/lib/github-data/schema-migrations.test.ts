import { describe, expect, it } from "vitest";

import { buildPortableWorkspaceExport } from "./portable-export";
import { createDefaultDashboardLayout, serializeDashboardLayout } from "./dashboard-layout";
import { createWorkspaceRecord, serializeRecord } from "./protocol";
import { createJournalImportCheckpointRecord } from "./journal-import-checkpoints";
import {
  dryRunPortableWorkspaceMigrations,
  planSchemaMigration,
  planSchemaMigrationTo,
  validateSchemaMigrationRegistry,
  type SchemaMigrationStep,
} from "./schema-migrations";

const workspaceText = `${JSON.stringify({
  schema_version: 1,
  workspace_id: "personal-workspace",
  owner_id: "github_lubannn",
  owner_login: "lubannn",
  locale: "zh-CN",
  timezone: "Asia/Shanghai",
}, null, 2)}\n`;

function storedFile(path: string, text: string, blobSha: string) {
  return { path, text, blobSha, sizeBytes: new TextEncoder().encode(text).byteLength };
}

describe("schema migration registry", () => {
  it("reports current canonical files without modifying them", async () => {
    const record = createWorkspaceRecord({
      entityType: "capture",
      id: "capture_20260827010000000_schema",
      ownerId: "github_lubannn",
      timestamp: "2026-08-27T01:00:00.000Z",
      data: { raw_text: "schema dry run", status: "inbox" as const },
    });
    const exported = await buildPortableWorkspaceExport({
      repository: "lubannn/personal-workspace-data",
      branch: "main",
      generatedAt: "2026-08-27T02:00:00.000Z",
      workspaceFile: storedFile("workspace.json", workspaceText, "workspace-blob"),
      captureFiles: [storedFile("data/captures/capture_20260827010000000_schema.json", serializeRecord(record), "capture-blob")],
      dashboardLayoutFile: storedFile(
        "config/dashboard-layout.json",
        serializeDashboardLayout(createDefaultDashboardLayout("github_lubannn", "2026-08-27T01:30:00.000Z")),
        "dashboard-blob",
      ),
      journalImportCheckpointFiles: [storedFile(
        `data/journal-import-checkpoints/journal_import_checkpoint_${"a".repeat(32)}.json`,
        serializeRecord(createJournalImportCheckpointRecord({
          id: `journal_import_checkpoint_${"a".repeat(32)}`,
          ownerId: "github_lubannn",
          importBatchId: `legacy_import_${"b".repeat(32)}`,
          dryRunId: `legacy-journal:${"c".repeat(64)}:parser-v1:mapping-v1:${"d".repeat(64)}`,
          sourceSha256: "c".repeat(64),
          correctionSetSha256: "d".repeat(64),
          expectedParentCommitSha: "e".repeat(40),
          planSha256: "a".repeat(64),
          committedAt: "2026-08-27T01:45:00.000Z",
          items: [{ date: "2012-03-05", entry_id: "entry_1", revision_id: "revision_1", segment_ids: ["segment_1"], content_sha256: "1".repeat(64) }],
          plannedFiles: [
            { path: "data/journal-entries/entry_1.json", sha256: "2".repeat(64) },
            { path: "data/journal-revisions/revision_1.json", sha256: "3".repeat(64) },
            { path: "data/journal-segments/segment_1.json", sha256: "4".repeat(64) },
          ],
        })),
        "checkpoint-blob",
      )],
    });
    const before = JSON.stringify(exported);
    const dryRun = await dryRunPortableWorkspaceMigrations(exported);

    expect(dryRun).toMatchObject({
      valid: true,
      registryVersion: 1,
      counts: { files: 4, current: 4, migratable: 0, blocked: 0, steps: 0 },
      errors: [],
    });
    expect(dryRun.files.find((file) => file.path === "config/dashboard-layout.json")?.kind).toBe("dashboard_layout");
    expect(dryRun.files.find((file) => file.path.includes("journal-import-checkpoints"))?.kind).toBe("record");
    expect(JSON.stringify(exported)).toBe(before);
  });

  it("builds the only registered forward path without mutating the document", () => {
    const registry: SchemaMigrationStep[] = [{
      id: "record-v1-to-v2",
      kind: "record",
      fromVersion: 1,
      toVersion: 2,
      description: "Add the second record envelope.",
    }];
    const document = { schema_version: 1, id: "capture_one" };
    const before = JSON.stringify(document);
    expect(planSchemaMigrationTo(document, "record", 2, registry)).toMatchObject({
      status: "migratable",
      fromVersion: 1,
      targetVersion: 2,
      steps: [{ id: "record-v1-to-v2" }],
      issues: [],
    });
    expect(JSON.stringify(document)).toBe(before);
  });

  it("rejects ambiguous or invalid registry entries", () => {
    const registry: SchemaMigrationStep[] = [
      { id: "duplicate", kind: "record", fromVersion: 1, toVersion: 2, description: "First route." },
      { id: "duplicate", kind: "record", fromVersion: 1, toVersion: 3, description: "Ambiguous route." },
    ];
    expect(validateSchemaMigrationRegistry(registry).map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "SCHEMA_MIGRATION_ID_DUPLICATE",
      "SCHEMA_MIGRATION_ROUTE_DUPLICATE",
    ]));
  });

  it("blocks missing, future and unregistered schema versions", () => {
    expect(planSchemaMigration({}, "workspace")).toMatchObject({
      status: "blocked",
      issues: [{ code: "SCHEMA_VERSION_MISSING" }],
    });
    expect(planSchemaMigration({ schema_version: 2 }, "workspace")).toMatchObject({
      status: "blocked",
      issues: [{ code: "SCHEMA_VERSION_FROM_FUTURE" }],
    });
    expect(planSchemaMigrationTo({ schema_version: 1 }, "workspace", 2)).toMatchObject({
      status: "blocked",
      issues: [{ code: "SCHEMA_MIGRATION_PATH_MISSING" }],
    });
  });
});
