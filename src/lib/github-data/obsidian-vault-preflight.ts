export const OBSIDIAN_PREFLIGHT_FORMAT_VERSION = 1;
export const OBSIDIAN_PREFLIGHT_FILE_NAME = "personal-workspace-vault-test.md";

export type ObsidianVaultPreflightPlan = {
  vaultName: string;
  subdirectory: string;
  relativePath: string;
  confirmation: string;
  stages: [ObsidianVaultPreflightStage, ObsidianVaultPreflightStage];
};

export type ObsidianVaultPreflightStage = {
  stage: 1 | 2;
  markdown: string;
  sha256: string;
  utf8Bytes: number;
};

export type ObsidianVaultPreflightInspection = {
  status: "missing" | "stage_1" | "verified" | "conflict";
  sha256: string | null;
  utf8Bytes: number;
};

const UNSAFE_SEGMENT = /[<>:"|?*\\\u0000-\u001f]/;
const WINDOWS_RESERVED_SEGMENT = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export async function buildObsidianVaultPreflightPlan(input: {
  vaultName: string;
  subdirectory: string;
}): Promise<ObsidianVaultPreflightPlan> {
  const vaultName = normalizeVaultName(input.vaultName);
  const subdirectory = normalizeObsidianSubdirectory(input.subdirectory);
  const relativePath = `${subdirectory}/${OBSIDIAN_PREFLIGHT_FILE_NAME}`;
  const first = await stage(1);
  const second = await stage(2);
  return {
    vaultName,
    subdirectory,
    relativePath,
    confirmation: `${vaultName}/${subdirectory}`,
    stages: [first, second],
  };
}

export function normalizeObsidianSubdirectory(value: string) {
  const normalized = value.normalize("NFC").trim().replaceAll(/\/{2,}/g, "/");
  const segments = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || normalized.endsWith("/") || segments.length > 8) {
    throw new Error("INVALID_OBSIDIAN_SUBDIRECTORY");
  }
  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." || segment.toLowerCase() === ".obsidian" || segment.endsWith(".")
      || segment.length > 80 || segment.trim() !== segment || UNSAFE_SEGMENT.test(segment) || WINDOWS_RESERVED_SEGMENT.test(segment)) {
      throw new Error("INVALID_OBSIDIAN_SUBDIRECTORY");
    }
  }
  if (normalized.length > 240) throw new Error("INVALID_OBSIDIAN_SUBDIRECTORY");
  return segments.join("/");
}

export async function inspectObsidianVaultPreflightFile(
  currentMarkdown: string | null,
  plan: ObsidianVaultPreflightPlan,
): Promise<ObsidianVaultPreflightInspection> {
  if (currentMarkdown === null) return { status: "missing", sha256: null, utf8Bytes: 0 };
  const sha256 = await sha256Text(currentMarkdown);
  const utf8Bytes = new TextEncoder().encode(currentMarkdown).byteLength;
  if (sha256 === plan.stages[0].sha256) return { status: "stage_1", sha256, utf8Bytes };
  if (sha256 === plan.stages[1].sha256) return { status: "verified", sha256, utf8Bytes };
  return { status: "conflict", sha256, utf8Bytes };
}

async function stage(stageNumber: 1 | 2): Promise<ObsidianVaultPreflightStage> {
  const markdown = renderFixture(stageNumber);
  return {
    stage: stageNumber,
    markdown,
    sha256: await sha256Text(markdown),
    utf8Bytes: new TextEncoder().encode(markdown).byteLength,
  };
}

function renderFixture(stageNumber: 1 | 2) {
  return [
    "---",
    `personal_workspace_vault_test: ${OBSIDIAN_PREFLIGHT_FORMAT_VERSION}`,
    `replacement_stage: ${stageNumber}`,
    'content_class: "synthetic-no-private-data"',
    "---",
    "",
    "# Personal Workspace Vault compatibility test",
    "",
    "This synthetic file contains no Journal or other Private workspace content.",
    "",
    "UTF-8 check: 中文 · café · ✓",
    `Commit-on-close replacement stage: ${stageNumber}`,
    "",
  ].join("\n");
}

function normalizeVaultName(value: string) {
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > 120 || normalized.includes("/") || UNSAFE_SEGMENT.test(normalized) || normalized === "." || normalized === "..") {
    throw new Error("INVALID_OBSIDIAN_VAULT_NAME");
  }
  return normalized;
}

async function sha256Text(value: string) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
