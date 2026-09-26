import { describe, expect, it } from "vitest";
import { decideCorosAutoSync, type CorosSyncCandidate } from "./coros-auto-sync-policy";

const candidate: CorosSyncCandidate = {
  domain: "workout",
  sourceId: "coros:activity:12345",
  fingerprint: "a".repeat(64),
  diagnostics: [],
};

describe("COROS automatic import policy", () => {
  it("creates a new verified record without requiring individual approval", () => {
    expect(decideCorosAutoSync(candidate, null)).toEqual({ action: "create", reason: "new_verified_record" });
  });

  it("skips an identical record on repeated polls", () => {
    expect(decideCorosAutoSync(candidate, { sourceId: candidate.sourceId, fingerprint: candidate.fingerprint }))
      .toEqual({ action: "skip", reason: "already_imported" });
  });

  it("holds a changed source instead of overwriting the canonical record", () => {
    expect(decideCorosAutoSync(candidate, { sourceId: candidate.sourceId, fingerprint: "b".repeat(64) }))
      .toEqual({ action: "hold", reason: "source_changed" });
  });

  it("holds incomplete or ambiguous sleep and heart-rate mappings", () => {
    for (const domain of ["sleep_session", "health_metric"] as const) {
      expect(decideCorosAutoSync({ ...candidate, domain, diagnostics: ["missing_timezone"] }, null))
        .toEqual({ action: "hold", reason: "mapping_uncertain" });
    }
  });

  it("rejects unstable identifiers and fingerprints", () => {
    expect(decideCorosAutoSync({ ...candidate, sourceId: "" }, null))
      .toEqual({ action: "hold", reason: "invalid_source" });
    expect(decideCorosAutoSync({ ...candidate, fingerprint: "not-a-hash" }, null))
      .toEqual({ action: "hold", reason: "invalid_source" });
  });
});
