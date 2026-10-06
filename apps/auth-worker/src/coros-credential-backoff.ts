import { parseCorosOAuthFailure } from "./coros-oauth-errors";
import { syncProgressDomains, type DomainProgress, type SyncProgress } from "./coros-sync-state";

function rejectedRefresh(value: Pick<DomainProgress, "lastErrorCode" | "lastErrorStage">) {
  const error = parseCorosOAuthFailure(value.lastErrorCode);
  return value.lastErrorStage === "credentials_refresh" && error?.phase === "REFRESH" && error.status === 400 && error.oauthError === "invalid_grant";
}

/** Only after a new authorization or a proven successful credential refresh. */
export function clearRejectedCredentialBackoff(progress: SyncProgress): boolean {
  let changed = false;
  const sources = syncProgressDomains(progress);
  for (const source of sources) {
    if (!("blockedCode" in source && source.blockedCode) && rejectedRefresh(source)) {
      source.retryAfter = null; source.lastErrorCode = null; source.lastErrorStage = null; changed = true;
      if (source.failureCount !== undefined) source.failureCount = 0;
    }
  }
  if (rejectedRefresh(progress)) {
    progress.lastErrorCode = null; progress.lastErrorStage = null;
    // The shared count may include unrelated source failures; retain it then.
    if (!sources.some(source => source.lastErrorCode || ("blockedCode" in source && source.blockedCode))) progress.failureCount = 0;
    changed = true;
  }
  return changed;
}
