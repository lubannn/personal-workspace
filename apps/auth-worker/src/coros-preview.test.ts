import { describe, expect, it } from "vitest";
import { summarizeCorosPreview } from "./coros-preview";

describe("COROS privacy-safe preview", () => {
  it("reports only shape and never health values from structured content", () => {
    const summary = summarizeCorosPreview({ format: "structured", payload: {
      days: [{ date: "2026-09-25", averageHeartRate: 61, nested: { secretNote: "personal detail" } }],
      "2026-09-25": { steps: 12000 },
    } });
    expect(summary).toMatchObject({ machineReadable: true, format: "structured" });
    expect(summary.fields).toContain("days[].averageHeartRate");
    expect(JSON.stringify(summary)).not.toMatch(/2026-09-25|12000|personal detail|61/u);
  });

  it("does not echo formatted text or binary content", () => {
    const summary = summarizeCorosPreview({ format: "content", payload: [
      { type: "text", text: "Private heart rate 61 bpm" },
      { type: "image", data: "private-binary" },
    ] });
    expect(summary).toEqual({ machineReadable: false, format: "content", fields: [], blockTypes: ["text", "image"] });
  });

  it("reports keys from a single JSON text block without exposing values", () => {
    const summary = summarizeCorosPreview({ format: "content", payload: [
      { type: "text", text: JSON.stringify({ days: [{ date: "2026-09-25", averageHeartRate: 61 }] }) },
    ] });
    expect(summary).toEqual({ machineReadable: true, format: "content",
      fields: ["days", "days[].date", "days[].averageHeartRate"], blockTypes: ["text"] });
    expect(JSON.stringify(summary)).not.toMatch(/2026-09-25|61/u);
  });

  it("rejects Markdown, arrays and mixed blocks even when they contain JSON", () => {
    for (const payload of [
      [{ type: "text", text: "```json\n{\"heartRate\":61}\n```" }],
      [{ type: "text", text: "[{\"heartRate\":61}]" }],
      [{ type: "text", text: "{\"heartRate\":61}" }, { type: "text", text: "more" }],
    ]) {
      expect(summarizeCorosPreview({ format: "content", payload }).machineReadable).toBe(false);
    }
  });
});
