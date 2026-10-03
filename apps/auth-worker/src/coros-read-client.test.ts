import { describe, expect, it, vi } from "vitest";
import { COROS_READ_TOOL_ALLOWLIST, callCorosReadTool, isAllowedCorosReadTool } from "./coros-read-client";

const mcp = vi.hoisted(() => ({ callTool: vi.fn(), close: vi.fn(), terminateSession: vi.fn() }));
vi.mock("@modelcontextprotocol/client", () => ({
  Client: class {
    async connect() {}
    async listTools() { return { tools: [{ name: "querySleepOverview" }] }; }
    callTool = mcp.callTool;
    close = mcp.close;
  },
  StreamableHTTPClientTransport: class { terminateSession = mcp.terminateSession; },
}));

describe("COROS read-only tool boundary", () => {
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
});
