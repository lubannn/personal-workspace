import type { CorosReadResult } from "./coros-read-client";

const SAFE_FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;
const MAX_FIELDS = 80;

/** Returns schema hints only; never serializes a health measurement or MCP text body. */
export function summarizeCorosPreview(result: CorosReadResult): {
  machineReadable: boolean;
  format: CorosReadResult["format"];
  fields: string[];
  blockTypes: string[];
} {
  if (result.format === "content") {
    const blocks = Array.isArray(result.payload) ? result.payload : [];
    const blockTypes = blocks.slice(0, 8).map((item) => {
      const type = item && typeof item === "object" && "type" in item ? item.type : null;
      return type === "text" || type === "image" || type === "resource" ? type : "other";
    });
    // Some MCP servers wrap JSON in a single text block instead of structuredContent.
    // Accept only a complete JSON object, never prose, Markdown, or mixed blocks.
    if (blocks.length === 1 && blockTypes[0] === "text" && typeof blocks[0].text === "string") {
      try {
        const parsed: unknown = JSON.parse(blocks[0].text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const fields = collectFields(parsed);
          return { machineReadable: fields.length > 0, format: "content", fields, blockTypes };
        }
      } catch {
        // Display text is not a machine-readable contract.
      }
    }
    return { machineReadable: false, format: "content", fields: [], blockTypes };
  }
  const fields = collectFields(result.payload);
  return { machineReadable: fields.length > 0, format: "structured", fields, blockTypes: [] };
}

function collectFields(payload: unknown): string[] {
  const fields: string[] = [];
  const visit = (value: unknown, prefix: string, depth: number) => {
    if (fields.length >= MAX_FIELDS || depth > 4 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      if (value.length > 0) visit(value[0], `${prefix}[]`, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (fields.length >= MAX_FIELDS) break;
      const safeKey = SAFE_FIELD.test(key) ? key : "[dynamic]";
      const path = prefix ? `${prefix}.${safeKey}` : safeKey;
      fields.push(path);
      visit(child, path, depth + 1);
    }
  };
  visit(payload, "", 0);
  return fields;
}
