import { describe, expect, it } from "vitest";
import { parseCaptureDraft } from "./use-capture-draft";

describe("restored capture drafts", () => {
  it("keeps manually cleared date/time distinct from automatic suggestions", () => {
    expect(parseCaptureDraft(JSON.stringify({ text: "明天开会", kind: "idea", date: "", time: "" }))).toEqual({ text: "明天开会", kind: "idea", date: "", time: "", endTime: null });
  });
  it.each(["{", "null", JSON.stringify({ text: "example", kind: "unknown", date: null, time: null }), JSON.stringify({ text: "example", kind: "auto", date: "2026-02-30", time: null })])("safely ignores corrupt or invalid local data", (value) => {
    expect(parseCaptureDraft(value)).toEqual({ text: "", kind: "auto", date: null, time: null, endTime: null });
  });
});
