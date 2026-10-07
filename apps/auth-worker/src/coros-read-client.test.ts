import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SdkError, SdkErrorCode, SdkHttpError, ProtocolError } from "@modelcontextprotocol/client";
import { COROS_READ_TOOL_ALLOWLIST, callCorosReadTool, createCorosReadSession, isAllowedCorosReadTool } from "./coros-read-client";

const mcp = vi.hoisted(() => ({ connect: vi.fn(), listTools: vi.fn(), callTool: vi.fn(), close: vi.fn(), terminateSession: vi.fn(), transportOptions: vi.fn() }));
vi.mock("@modelcontextprotocol/client", async importOriginal => ({
  ...await importOriginal<typeof import("@modelcontextprotocol/client")>(),
  Client: class {
    connect = mcp.connect;
    listTools = mcp.listTools;
    callTool = mcp.callTool;
    close = mcp.close;
  },
  StreamableHTTPClientTransport: class {
    constructor(_url: URL, options: unknown) { mcp.transportOptions(options); }
    terminateSession = mcp.terminateSession;
  },
}));

describe("COROS read-only tool boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mcp.connect.mockResolvedValue(undefined);
    mcp.listTools.mockResolvedValue({ tools: [{ name: "querySleepOverview" }] });
    mcp.callTool.mockResolvedValue({ content: [{ type: "text", text: "synthetic result" }] });
    mcp.terminateSession.mockResolvedValue(undefined);
    mcp.close.mockResolvedValue(undefined);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("reuses one connection and discovery for serial reads, including an unavailable-tool fallback", async () => {
    mcp.listTools.mockResolvedValue({ tools: [{ name: "querySleepHrv" }, { name: "queryRecoveryStatus" }] });
    const session = createCorosReadSession("https://mcpcn.coros.com/mcp", "synthetic-token");
    await expect(session.read("querySleepOverview", {})).rejects.toThrow("COROS_READ_TOOL_UNAVAILABLE");
    await session.read("queryRecoveryStatus", {});
    await session.read("querySleepHrv", { startDate: "20261001" });
    expect(mcp.connect).toHaveBeenCalledTimes(1);
    expect(mcp.listTools).toHaveBeenCalledTimes(1);
    expect(mcp.callTool).toHaveBeenCalledTimes(2);
    expect(mcp.close).not.toHaveBeenCalled();
    expect(mcp.connect.mock.calls[0][1].signal.aborted).toBe(false);
    await session.close(); await session.close();
    expect(mcp.connect.mock.calls[0][1].signal.aborted).toBe(true);
    expect(mcp.terminateSession).toHaveBeenCalledTimes(1);
    expect(mcp.close).toHaveBeenCalledTimes(1);
    await expect(session.read("querySleepHrv", {})).rejects.toThrow("COROS_READ_TRANSPORT_FAILED");
  });

  it("applies a fresh bounded deadline to a later read on the shared connection", async () => {
    vi.useFakeTimers();
    const session = createCorosReadSession("https://mcpcn.coros.com/mcp", "synthetic-token");
    await session.read("querySleepOverview", {});
    mcp.callTool.mockImplementation(() => new Promise(() => {}));
    const failed = expect(session.read("querySleepOverview", {})).rejects.toThrow("COROS_READ_TIMEOUT");
    await vi.advanceTimersByTimeAsync(60_000); await failed;
    await session.close();
    expect(mcp.connect).toHaveBeenCalledTimes(1);
    expect(mcp.callTool.mock.calls[1][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("allows only the planned activity, sleep and daily metric reads", () => {
    expect(COROS_READ_TOOL_ALLOWLIST).toContain("querySportRecords");
    expect(COROS_READ_TOOL_ALLOWLIST).toContain("querySleepData");
    expect(COROS_READ_TOOL_ALLOWLIST).toContain("queryRestingHeartRate");
    expect(COROS_READ_TOOL_ALLOWLIST).toContain("queryRecoveryStatus");
    expect(isAllowedCorosReadTool("createTrainingPlan")).toBe(false);
    expect(isAllowedCorosReadTool("updateWorkoutDetails")).toBe(false);
    expect(isAllowedCorosReadTool("queryMenstruationCycles")).toBe(false);
    expect(isAllowedCorosReadTool("downloadActivityFitFiles")).toBe(false);
  });

  it("rejects a write tool before initiating network access", async () => {
    await expect(callCorosReadTool("https://mcpcn.coros.com/mcp", "test-token", "createSingleWorkout", {}))
      .rejects.toThrow("COROS_TOOL_NOT_ALLOWED");
  });

  it("uses the invocation-scoped fetcher for MCP transport requests", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("synthetic"));
    mcp.connect.mockImplementation(() => mcp.transportOptions.mock.calls[0][0].fetch("https://mcpcn.coros.com/mcp", {}));
    await callCorosReadTool("https://mcpcn.coros.com/mcp", "test-token", "querySleepOverview", {}, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects an oversized response before a collector can parse or write it", async () => {
    mcp.callTool.mockResolvedValueOnce({ content: [{ type: "text", text: "x".repeat(512 * 1024) }] });
    await expect(callCorosReadTool("https://mcpcn.coros.com/mcp", "synthetic-token", "querySleepOverview", {})).rejects.toThrow("COROS_READ_RESULT_TOO_LARGE");
    expect(mcp.close).toHaveBeenCalledTimes(1);
  });

  it.each([[401, "COROS_READ_UNAUTHORIZED"], [403, "COROS_READ_FORBIDDEN"], [429, "COROS_READ_RATE_LIMITED"],
    [500, "COROS_READ_UPSTREAM_UNAVAILABLE"], [404, "COROS_READ_HTTP_FAILED"]] as const)
  ("classifies typed HTTP status %s without leaking the SDK payload", async (status, code) => {
    mcp.callTool.mockRejectedValue(new SdkHttpError(SdkErrorCode.SendFailed, "synthetic-private-body-and-token", { status }));
    await expect(callCorosReadTool("https://mcpcn.coros.com/mcp", "synthetic-token", "querySleepOverview", {})).rejects.toMatchObject({ message: code });
    expect(mcp.terminateSession).toHaveBeenCalledTimes(1);
  });

  it.each([[SdkErrorCode.RequestTimeout, "COROS_READ_TIMEOUT"], [SdkErrorCode.SendFailed, "COROS_READ_TRANSPORT_FAILED"],
    [SdkErrorCode.InvalidResult, "COROS_READ_RESPONSE_INVALID"]] as const)
  ("classifies typed SDK code %s even before the outer deadline", async (sdkCode, code) => {
    mcp.callTool.mockRejectedValue(new SdkError(sdkCode, "synthetic-private-sdk-body", { healthBody: "synthetic-canary" }));
    await expect(callCorosReadTool("https://mcpcn.coros.com/mcp", "synthetic-token", "querySleepOverview", {})).rejects.toMatchObject({ message: code });
  });

  it("discards protocol error messages and data", async () => {
    mcp.callTool.mockRejectedValue(new ProtocolError(-32603, "synthetic-private-protocol-body", { healthBody: "synthetic-canary" }));
    await expect(callCorosReadTool("https://mcpcn.coros.com/mcp", "synthetic-token", "querySleepOverview", {})).rejects.toMatchObject({ message: "COROS_READ_PROTOCOL_FAILED" });
  });

  it.each([
    { content: [{ type: "text", text: "No sleep overview data found." }] },
    { structuredContent: { text: "No sleep overview data found." }, content: [] },
  ])("rejects an MCP error even when its payload resembles a valid empty response", async payload => {
    mcp.callTool.mockResolvedValueOnce({ ...payload, isError: true });
    mcp.terminateSession.mockResolvedValue(undefined);
    mcp.close.mockResolvedValue(undefined);
    await expect(callCorosReadTool("https://mcpcn.coros.com/mcp", "synthetic-token", "querySleepOverview", {}))
      .rejects.toThrow("COROS_READ_TOOL_FAILED");
    expect(mcp.terminateSession).toHaveBeenCalled();
    expect(mcp.close).toHaveBeenCalled();
  });

  it.each([
    "https://example.com/mcp",
    "https://mcpcn.coros.com.evil.example/mcp",
    "https://mcpcn.coros.com/mcp?redirect=https://example.com",
    "https://mcpcn.coros.com/other",
    "not a URL",
  ])("rejects a non-COROS resource before initiating network access: %s", async (resourceUrl) => {
    await expect(callCorosReadTool(resourceUrl, "test-token", "querySportRecords", {}))
      .rejects.toThrow("COROS_MCP_CONNECTION_INVALID");
  });

  it.each(["connect", "listTools", "callTool"] as const)("bounds a never-settling %s and aborts the shared read signal", async stage => {
    vi.useFakeTimers();
    mcp[stage].mockImplementation(() => new Promise(() => {}));
    const run = callCorosReadTool("https://mcpcn.coros.com/mcp", "synthetic-token", "querySleepOverview", {});
    const failed = expect(run).rejects.toThrow("COROS_READ_TIMEOUT");
    await vi.advanceTimersByTimeAsync(60_000);
    await failed;
    expect(mcp.connect.mock.calls[0][1].signal.aborted).toBe(true);
    expect(mcp.terminateSession).toHaveBeenCalledTimes(1);
    expect(mcp.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses one deadline across connection, discovery and tool execution", async () => {
    vi.useFakeTimers();
    mcp.connect.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 40_000)));
    mcp.listTools.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ tools: [{ name: "querySleepOverview" }] }), 15_000)));
    mcp.callTool.mockImplementation(() => new Promise(() => {}));
    const run = callCorosReadTool("https://mcpcn.coros.com/mcp", "synthetic-token", "querySleepOverview", {});
    const failed = expect(run).rejects.toThrow("COROS_READ_TIMEOUT");
    await vi.advanceTimersByTimeAsync(60_000);
    await failed;
    expect(mcp.callTool).toHaveBeenCalledTimes(1);
    expect(mcp.callTool.mock.calls[0][1].signal).toBe(mcp.connect.mock.calls[0][1].signal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start a later stage when an ignored cancellation settles after the deadline", async () => {
    vi.useFakeTimers();
    let resolveConnect!: () => void;
    mcp.connect.mockImplementation(() => new Promise<void>(resolve => { resolveConnect = resolve; }));
    const run = callCorosReadTool("https://mcpcn.coros.com/mcp", "synthetic-token", "querySleepOverview", {});
    const failed = expect(run).rejects.toThrow("COROS_READ_TIMEOUT");
    await vi.advanceTimersByTimeAsync(60_000); await failed;
    resolveConnect(); await Promise.resolve();
    expect(mcp.listTools).not.toHaveBeenCalled();
    expect(mcp.callTool).not.toHaveBeenCalled();
  });

  it("bounds both session termination and close while preserving the validated read", async () => {
    vi.useFakeTimers();
    mcp.terminateSession.mockImplementation(() => new Promise(() => {}));
    mcp.close.mockImplementation(() => new Promise(() => {}));
    const run = callCorosReadTool("https://mcpcn.coros.com/mcp", "synthetic-token", "querySleepOverview", {});
    await vi.advanceTimersByTimeAsync(4_000);
    await expect(run).resolves.toMatchObject({ format: "content", payload: [{ text: "synthetic result" }] });
    expect(mcp.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not replace a controlled read error when cleanup throws or stalls", async () => {
    vi.useFakeTimers();
    mcp.callTool.mockResolvedValue({ isError: true, content: [] });
    mcp.terminateSession.mockRejectedValue(new Error("private cleanup details"));
    mcp.close.mockImplementation(() => new Promise(() => {}));
    const run = callCorosReadTool("https://mcpcn.coros.com/mcp", "synthetic-token", "querySleepOverview", {});
    const failed = expect(run).rejects.toThrow("COROS_READ_TOOL_FAILED");
    await vi.advanceTimersByTimeAsync(2_000); await failed;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates the deadline to underlying HTTP fetches", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {})); vi.stubGlobal("fetch", fetcher);
    mcp.connect.mockImplementation(() => mcp.transportOptions.mock.calls[0][0].fetch("https://mcpcn.coros.com/mcp", {}));
    const run = callCorosReadTool("https://mcpcn.coros.com/mcp", "synthetic-token", "querySleepOverview", {});
    const failed = expect(run).rejects.toThrow("COROS_READ_TIMEOUT");
    await vi.advanceTimersByTimeAsync(60_000); await failed;
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});
