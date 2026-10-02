/**
 * A fail-closed decision boundary shared by scheduled and user-triggered COROS imports.
 * It deliberately does not perform network calls or Git writes.
 */
export type CorosSyncDomain = "workout" | "sleep_session" | "health_metric";

export type CorosSyncCandidate = {
  domain: CorosSyncDomain;
  /** Stable COROS record identity, namespaced by domain. Never a display label. */
  sourceId: string;
  /** SHA-256 of the normalized, source-specific fields used to create the record. */
  fingerprint: string;
  /** Nonempty when a source field cannot be mapped without guessing. */
  diagnostics: readonly string[];
};

export type ExistingCorosRecord = {
  sourceId: string;
  fingerprint: string;
};

export type CorosSyncDecision =
  | { action: "create"; reason: "new_verified_record" }
  | { action: "skip"; reason: "already_imported" }
  | { action: "hold"; reason: "invalid_source" | "mapping_uncertain" | "source_changed" };

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const SOURCE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_:.\-]{0,191}$/u;

/** Never replace an existing canonical record as a side effect of polling. */
export function decideCorosAutoSync(
  candidate: CorosSyncCandidate,
  existing: ExistingCorosRecord | null,
): CorosSyncDecision {
  if (!SOURCE_ID.test(candidate.sourceId) || !SHA256_HEX.test(candidate.fingerprint)) {
    return { action: "hold", reason: "invalid_source" };
  }
  if (candidate.diagnostics.length > 0) {
    return { action: "hold", reason: "mapping_uncertain" };
  }
  if (!existing) return { action: "create", reason: "new_verified_record" };
  if (existing.sourceId !== candidate.sourceId || !SHA256_HEX.test(existing.fingerprint)) {
    return { action: "hold", reason: "invalid_source" };
  }
  if (existing.fingerprint === candidate.fingerprint) {
    return { action: "skip", reason: "already_imported" };
  }
  return { action: "hold", reason: "source_changed" };
}
