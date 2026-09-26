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
});
