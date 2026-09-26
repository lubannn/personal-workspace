import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { isAllowedCorosResourceUrl } from "./coros-oauth";

/** Explicitly excludes every COROS training-plan, workout, or schedule write tool. */
export const COROS_READ_TOOL_ALLOWLIST = [
  "querySportRecords",
  "getActivityDetail",
  "querySleepData",
  "querySleepOverview",
  "queryAvgHeartRate",
  "queryRestingHeartRate",
  "queryDailyHealthData",
  "querySleepHrv",
  "queryRecoveryStatus",
  "queryStressLevel",
] as const;

export type CorosReadTool = typeof COROS_READ_TOOL_ALLOWLIST[number];

const MAX_TOOL_RESULT_BYTES = 512 * 1024;

export function isAllowedCorosReadTool(name: string): name is CorosReadTool {
  return (COROS_READ_TOOL_ALLOWLIST as readonly string[]).includes(name);
}

export async function callCorosReadTool(
  resourceUrl: string,
  accessToken: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!isAllowedCorosReadTool(name)) throw new Error("COROS_TOOL_NOT_ALLOWED");
  if (!accessToken || !isAllowedCorosResourceUrl(resourceUrl)) throw new Error("COROS_MCP_CONNECTION_INVALID");
  const transport = new StreamableHTTPClientTransport(new URL(resourceUrl), {
    authProvider: { token: async () => accessToken },
    onInsufficientScope: "throw",
  });
  const client = new Client({ name: "personal-workspace", version: "1.0.0" }, {
    versionNegotiation: { mode: "auto" },
  });
  try {
    await client.connect(transport);
    const available = await client.listTools();
    if (!available.tools.some((tool) => tool.name === name)) throw new Error("COROS_READ_TOOL_UNAVAILABLE");
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error("COROS_READ_TOOL_FAILED");
    const serialized = JSON.stringify(result);
    if (new TextEncoder().encode(serialized).byteLength > MAX_TOOL_RESULT_BYTES) {
      throw new Error("COROS_READ_RESULT_TOO_LARGE");
    }
    return result.structuredContent ?? result.content;
  } finally {
    await transport.terminateSession().catch(() => undefined);
    await client.close();
  }
}
