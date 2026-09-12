import type { ObsidianVaultTextAccess } from "../../../../src/lib/github-data/obsidian-journal-export-action";

export function createObsidianVaultTextAccess(root: FileSystemDirectoryHandle): ObsidianVaultTextAccess {
  return {
    readText: (relativePath) => readVaultText(root, relativePath),
    compareAndWrite: (input) => compareAndWriteVaultText(root, input),
  };
}

async function readVaultText(root: FileSystemDirectoryHandle, relativePath: string) {
  const segments = safeSegments(relativePath);
  try {
    const directory = await resolveDirectory(root, segments.slice(0, -1), false);
    const handle = await directory.getFileHandle(segments.at(-1)!, { create: false });
    return await (await handle.getFile()).text();
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return null;
    throw error;
  }
}

async function compareAndWriteVaultText(root: FileSystemDirectoryHandle, input: {
  relativePath: string;
  expectedSha256: string | null;
  text: string;
}) {
  const segments = safeSegments(input.relativePath);
  const parentSegments = segments.slice(0, -1);
  const fileName = segments.at(-1)!;
  const existing = await readVaultText(root, input.relativePath);
  const existingSha256 = existing === null ? null : await sha256Text(existing);
  if (existingSha256 !== input.expectedSha256) throw new Error("OBSIDIAN_EXPORT_COMPARE_FAILED");

  const directory = await resolveDirectory(root, parentSegments, existing === null);
  const handle = await directory.getFileHandle(fileName, { create: existing === null });
  const immediate = await (await handle.getFile()).text();
  const immediateSha256 = immediate.length === 0 && existing === null ? null : await sha256Text(immediate);
  if (immediateSha256 !== input.expectedSha256) throw new Error("OBSIDIAN_EXPORT_COMPARE_FAILED");

  const writable = await handle.createWritable({ keepExistingData: false });
  try {
    await writable.write(input.text);
    await writable.close();
  } catch (error) {
    await writable.abort(error).catch(() => undefined);
    throw error;
  }
}

async function resolveDirectory(root: FileSystemDirectoryHandle, segments: string[], create: boolean) {
  let current = root;
  for (const segment of segments) current = await current.getDirectoryHandle(segment, { create });
  return current;
}

function safeSegments(relativePath: string) {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\\")) throw new Error("INVALID_OBSIDIAN_EXPORT_PATH");
  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw new Error("INVALID_OBSIDIAN_EXPORT_PATH");
  return segments;
}

async function sha256Text(value: string) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
