import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COROS_READ_TOOL_ALLOWLIST, callCorosReadTool, isAllowedCorosReadTool } from "./coros-read-client";

const mcp = vi.hoisted(() => ({ connect: vi.fn(), listTools: vi.fn(), callTool: vi.fn(), close: vi.fn(), terminateSession: vi.fn(), transportOptions: vi.fn() }));
vi.mock("@modelcontextprotocol/client", () => ({
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
