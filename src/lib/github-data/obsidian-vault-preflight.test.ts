import { describe, expect, it } from "vitest";

import {
  OBSIDIAN_PREFLIGHT_FILE_NAME,
  buildObsidianVaultPreflightPlan,
  inspectObsidianVaultPreflightFile,
  normalizeObsidianSubdirectory,
} from "./obsidian-vault-preflight";

describe("Obsidian Vault preflight", () => {
  it("builds a deterministic no-private-content two-stage plan", async () => {
    const plan = await buildObsidianVaultPreflightPlan({ vaultName: "My Vault", subdirectory: "Personal Workspace" });
    const repeated = await buildObsidianVaultPreflightPlan({ vaultName: "My Vault", subdirectory: "Personal Workspace" });

    expect(plan).toEqual(repeated);
    expect(plan.relativePath).toBe(`Personal Workspace/${OBSIDIAN_PREFLIGHT_FILE_NAME}`);
    expect(plan.confirmation).toBe("My Vault/Personal Workspace");
    expect(plan.stages[0].markdown).toContain('content_class: "synthetic-no-private-data"');
    expect(plan.stages[0].markdown).toContain("UTF-8 check: 中文 · café · ✓");
    expect(plan.stages[0].markdown).not.toContain("journal_id");
    expect(plan.stages[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.stages[1].sha256).not.toBe(plan.stages[0].sha256);
  });

  it("normalizes safe nested paths and rejects traversal or unsafe names", () => {
    expect(normalizeObsidianSubdirectory(" Personal Workspace//Journal Export ")).toBe("Personal Workspace/Journal Export");
    for (const value of ["", "/absolute", "../escape", "safe/../escape", "trailing/", "bad\\path", "bad:name", ".obsidian/plugins", "NUL", "trailing."]) {
      expect(() => normalizeObsidianSubdirectory(value)).toThrow("INVALID_OBSIDIAN_SUBDIRECTORY");
    }
  });

  it("classifies only exact fixtures as resumable or verified", async () => {
    const plan = await buildObsidianVaultPreflightPlan({ vaultName: "Vault", subdirectory: "Personal Workspace" });

    await expect(inspectObsidianVaultPreflightFile(null, plan)).resolves.toMatchObject({ status: "missing", sha256: null });
    await expect(inspectObsidianVaultPreflightFile(plan.stages[0].markdown, plan)).resolves.toMatchObject({ status: "stage_1", sha256: plan.stages[0].sha256 });
    await expect(inspectObsidianVaultPreflightFile(plan.stages[1].markdown, plan)).resolves.toMatchObject({ status: "verified", sha256: plan.stages[1].sha256 });
    await expect(inspectObsidianVaultPreflightFile("external edit\n", plan)).resolves.toMatchObject({ status: "conflict" });
  });
});
