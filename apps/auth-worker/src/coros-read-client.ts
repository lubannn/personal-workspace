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
export type CorosReadResult = { format: "structured" | "content"; payload: unknown };

const MAX_TOOL_RESULT_BYTES = 512 * 1024;
const READ_TIMEOUT_MS = 60_000;
const CLEANUP_TIMEOUT_MS = 2_000;

async function bestEffortCleanup(operation: () => Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(operation).catch(() => undefined),
      new Promise<void>(resolve => { timer = setTimeout(resolve, CLEANUP_TIMEOUT_MS); }),
    ]);
  } finally { clearTimeout(timer); }
}

export function isAllowedCorosReadTool(name: string): name is CorosReadTool {
  return (COROS_READ_TOOL_ALLOWLIST as readonly string[]).includes(name);
}

export async function callCorosReadTool(
  resourceUrl: string,
  accessToken: string,
  name: string,
  args: Record<string, unknown>,
): Promise<CorosReadResult> {
  if (!isAllowedCorosReadTool(name)) throw new Error("COROS_TOOL_NOT_ALLOWED");
  if (!accessToken || !isAllowedCorosResourceUrl(resourceUrl)) throw new Error("COROS_MCP_CONNECTION_INVALID");
  const readController = new AbortController();
  let transportSignal = readController.signal;
  const transport = new StreamableHTTPClientTransport(new URL(resourceUrl), {
    authProvider: { token: async () => accessToken },
    onInsufficientScope: "throw",
    fetch: (input, init) => {
      const signals = [transportSignal];
      if (init?.signal) signals.push(init.signal);
      if (input instanceof Request) signals.push(input.signal);
      return fetch(input, { ...init, signal: AbortSignal.any(signals) });
    },
  });
  const client = new Client({ name: "personal-workspace", version: "1.0.0" }, {
    versionNegotiation: { mode: "auto" },
  });
  const requestOptions = { signal: readController.signal, timeout: READ_TIMEOUT_MS,
    maxTotalTimeout: READ_TIMEOUT_MS, resetTimeoutOnProgress: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error("COROS_READ_TIMEOUT");
      reject(error);
      readController.abort(error);
    }, READ_TIMEOUT_MS);
  });
  const read = async (): Promise<CorosReadResult> => {
    await client.connect(transport, requestOptions);
    readController.signal.throwIfAborted();
    const available = await client.listTools(undefined, requestOptions);
    readController.signal.throwIfAborted();
    if (!available.tools.some((tool) => tool.name === name)) throw new Error("COROS_READ_TOOL_UNAVAILABLE");
    const result = await client.callTool({ name, arguments: args }, requestOptions);
    readController.signal.throwIfAborted();
    if (result.isError) throw new Error("COROS_READ_TOOL_FAILED");
    const serialized = JSON.stringify(result);
    if (new TextEncoder().encode(serialized).byteLength > MAX_TOOL_RESULT_BYTES) {
      throw new Error("COROS_READ_RESULT_TOO_LARGE");
    }
    return result.structuredContent === undefined
      ? { format: "content", payload: result.content }
      : { format: "structured", payload: result.structuredContent };
  };
  try {
    // The outer deadline also bounds SDK/transport implementations that ignore
    // request cancellation or stall before installing their own request timer.
    return await Promise.race([read(), deadline]);
  } catch (error) {
    if (readController.signal.aborted) throw readController.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    readController.abort();
    // Session DELETE is best effort; neither it nor SDK close may retain the
    // sync lease indefinitely or replace a validated read with a cleanup error.
    const cleanupController = new AbortController();
    transportSignal = cleanupController.signal;
    await bestEffortCleanup(() => transport.terminateSession());
    cleanupController.abort();
    await bestEffortCleanup(() => client.close());
  }
}
