import { describe, expect, it } from "vitest";
import { COROS_READ_TOOL_ALLOWLIST, callCorosReadTool, isAllowedCorosReadTool } from "./coros-read-client";

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
