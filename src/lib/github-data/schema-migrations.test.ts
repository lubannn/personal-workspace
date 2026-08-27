import { describe, expect, it } from "vitest";

import { buildPortableWorkspaceExport } from "./portable-export";
import { createWorkspaceRecord, serializeRecord } from "./protocol";
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
    });
    const before = JSON.stringify(exported);
    const dryRun = await dryRunPortableWorkspaceMigrations(exported);

    expect(dryRun).toMatchObject({
      valid: true,
      registryVersion: 1,
      counts: { files: 2, current: 2, migratable: 0, blocked: 0, steps: 0 },
      errors: [],
    });
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
