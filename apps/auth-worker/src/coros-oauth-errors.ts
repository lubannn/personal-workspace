/** Pure, bounded codes shared by the Worker and client; no URLs or payloads. */
export const COROS_OAUTH_PHASES = ["RESOURCE_METADATA", "AUTH_METADATA", "REFRESH", "REGISTRATION", "EXCHANGE"] as const;
export type CorosOAuthPhase = typeof COROS_OAUTH_PHASES[number];
export const COROS_OAUTH_ERROR_VALUES = ["invalid_request", "invalid_client", "invalid_grant", "unauthorized_client",
  "unsupported_grant_type", "invalid_scope", "access_denied", "unsupported_response_type", "temporarily_unavailable", "server_error"] as const;
const RESPONSE_REASONS = ["BODY_MISSING", "BODY_READ_FAILED", "JSON_INVALID", "RESPONSE_TOO_LARGE", "TIMEOUT"];
const TRANSPORT_REASONS = ["TIMEOUT", "TRANSPORT_FAILED", "RESPONSE_INVALID"];

export function parseCorosOAuthFailure(code: unknown) {
  if (typeof code !== "string" || code.length > 100) return null;
  const match = /^COROS_OAUTH_(RESOURCE_METADATA|AUTH_METADATA|REFRESH|REGISTRATION|EXCHANGE)_(?:HTTP_([1-5]\d{2})(?:_([A-Z_]+))?|([A-Z_]+))$/u.exec(code);
  if (!match || match[0] !== code) return null;
  const phase = match[1] as CorosOAuthPhase, status = match[2] ? Number(match[2]) : null;
  const reason = match[3] ?? match[4] ?? null;
  const oauthError = COROS_OAUTH_ERROR_VALUES.find(value => value.toUpperCase() === reason) ?? null;
  if (status === null) {
    if (!reason || !TRANSPORT_REASONS.includes(reason)) return null;
  } else if (reason !== null && !RESPONSE_REASONS.includes(reason)
    && !(status >= 300 && oauthError && phase !== "RESOURCE_METADATA" && phase !== "AUTH_METADATA")) return null;
  return { phase, status, reason, oauthError };
}

export class CorosOAuthRequestError extends Error {
  constructor(code: string) {
    super(parseCorosOAuthFailure(code) ? code : "COROS_OAUTH_RESPONSE_INVALID");
    this.name = "CorosOAuthRequestError";
  }
}
