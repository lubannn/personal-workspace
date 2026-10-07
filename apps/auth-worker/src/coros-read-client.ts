import { Client, StreamableHTTPClientTransport, SdkError, SdkErrorCode, SdkHttpError, ProtocolError } from "@modelcontextprotocol/client";
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

/** One serial batch shares discovery and transport; tokens never outlive the invocation. */
export function createCorosReadSession(
  resourceUrl: string,
  accessToken: string,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
) {
  if (!accessToken || !isAllowedCorosResourceUrl(resourceUrl)) throw new Error("COROS_MCP_CONNECTION_INVALID");
  const controllers: AbortController[] = [];
  let transportSignal = new AbortController().signal;
  const transport = new StreamableHTTPClientTransport(new URL(resourceUrl), {
    authProvider: { token: async () => accessToken },
    onInsufficientScope: "throw",
    fetch: (input, init) => {
      const signals = [transportSignal];
      if (init?.signal) signals.push(init.signal);
      if (input instanceof Request) signals.push(input.signal);
      return fetcher(input, { ...init, signal: AbortSignal.any(signals) });
    },
  });
  const client = new Client({ name: "personal-workspace", version: "1.0.0" }, {
    versionNegotiation: { mode: "auto" },
  });
  let available: Set<string> | undefined;
  let connected = false;
  let closed = false;
  let reading = false;
  async function read(name: string, args: Record<string, unknown>): Promise<CorosReadResult> {
    if (!isAllowedCorosReadTool(name)) throw new Error("COROS_TOOL_NOT_ALLOWED");
    if (closed || reading) throw new Error("COROS_READ_TRANSPORT_FAILED");
    reading = true;
    const readController = new AbortController(); controllers.push(readController);
    transportSignal = readController.signal;
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
    const execute = async (): Promise<CorosReadResult> => {
      if (!connected) { await client.connect(transport, requestOptions); connected = true; }
      readController.signal.throwIfAborted();
      if (!available) available = new Set((await client.listTools(undefined, requestOptions)).tools.map(tool => tool.name));
      readController.signal.throwIfAborted();
      if (!available.has(name)) throw new Error("COROS_READ_TOOL_UNAVAILABLE");
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
      return await Promise.race([execute(), deadline]);
    } catch (error) {
      if (readController.signal.aborted) { closed = true; throw readController.signal.reason; }
      // Missing tools can fall back on the same validated inventory. Other
      // failures cancel active HTTP reads and cannot reuse a broken transport.
      if (!(error instanceof Error && error.message === "COROS_READ_TOOL_UNAVAILABLE")) {
        closed = true; readController.abort();
      }
      // SDK messages may contain HTTP bodies. Persist only classifications derived
      // from its typed status/code, never those messages, data or causes.
      if (error instanceof SdkHttpError) {
        const code = error.status === 429 ? "COROS_READ_RATE_LIMITED"
          : error.status === 401 ? "COROS_READ_UNAUTHORIZED"
            : error.status === 403 ? "COROS_READ_FORBIDDEN"
              : error.status >= 500 && error.status <= 599 ? "COROS_READ_UPSTREAM_UNAVAILABLE" : "COROS_READ_HTTP_FAILED";
        throw new Error(code);
      }
      if (error instanceof SdkError) {
        const code = error.code === SdkErrorCode.RequestTimeout ? "COROS_READ_TIMEOUT"
          : [SdkErrorCode.ConnectionClosed, SdkErrorCode.SendFailed, SdkErrorCode.NotConnected].includes(error.code) ? "COROS_READ_TRANSPORT_FAILED"
            : error.code === SdkErrorCode.InvalidResult ? "COROS_READ_RESPONSE_INVALID" : "COROS_READ_SDK_FAILED";
        throw new Error(code);
      }
      if (error instanceof ProtocolError) throw new Error("COROS_READ_PROTOCOL_FAILED");
      throw error;
    } finally {
      clearTimeout(timer);
      // Keep a successful connection's background transport alive for the next
      // serial tool. Every retained signal is cancelled when the batch closes.
      reading = false;
    }
  }
  let cleanup: Promise<void> | undefined;
  function close(): Promise<void> {
    return cleanup ??= (async () => {
      closed = true;
      for (const controller of controllers) controller.abort();
      // Session DELETE is best effort; neither it nor SDK close may retain the
      // sync lease indefinitely or replace a validated read with a cleanup error.
      const cleanupController = new AbortController();
      transportSignal = cleanupController.signal;
      await bestEffortCleanup(() => transport.terminateSession());
      cleanupController.abort();
      await bestEffortCleanup(() => client.close());
    })();
  }
  return { read, close };
}

export async function callCorosReadTool(
  resourceUrl: string, accessToken: string, name: string, args: Record<string, unknown>,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<CorosReadResult> {
  if (!isAllowedCorosReadTool(name)) throw new Error("COROS_TOOL_NOT_ALLOWED");
  const session = createCorosReadSession(resourceUrl, accessToken, fetcher);
  try { return await session.read(name, args); }
  finally { await session.close(); }
}
