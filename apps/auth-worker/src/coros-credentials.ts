import type { D1DatabaseLike } from "./auth";
import { discoverCorosOAuth, refreshCorosToken } from "./coros-oauth";
import { decryptRefreshToken, encryptRefreshToken } from "./security";

type StoredConnection = {
  github_user_id: string;
  client_id: string;
  redirect_uri: string;
  resource_url: string;
  encrypted_refresh_token: string;
  scope: string;
  state: "paused" | "enabled";
  connected_at?: string;
  last_error_code?: string | null;
};

// Best-effort isolate cache only: encrypted token, unchanged grant, <= 5 minutes
// and never beyond the server's expiry minus a one-minute safety margin.
const accessCache = new Map<string, { binding: string; encryptedAccess: string; expiresAt: number }>();
export function invalidateCorosAccessCache(githubUserId: string) { accessCache.delete(githubUserId); }
function grantBinding(connection: StoredConnection) {
  return JSON.stringify([connection.github_user_id, connection.resource_url, connection.client_id,
    connection.redirect_uri, connection.scope, connection.connected_at, connection.encrypted_refresh_token]);
}

export type ReadyCorosConnection = {
  resourceUrl: string;
  accessToken: string;
  githubUserId: string;
};

/** Refresh-token rotation is compare-and-swap; a losing concurrent poll must not use its access token. */
export async function refreshEnabledCorosConnection(
  db: D1DatabaseLike,
  githubUserId: string,
  encryptionKey: string,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<ReadyCorosConnection | null> {
  return refreshCorosConnectionInState(db, githubUserId, encryptionKey, "enabled", fetcher);
}

/** Only an authenticated, explicit preview can refresh a paused connection. */
export async function refreshPausedCorosConnectionForPreview(
  db: D1DatabaseLike,
  githubUserId: string,
  encryptionKey: string,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<ReadyCorosConnection | null> {
  return refreshCorosConnectionInState(db, githubUserId, encryptionKey, "paused", fetcher);
}

async function refreshCorosConnectionInState(
  db: D1DatabaseLike,
  githubUserId: string,
  encryptionKey: string,
  requiredState: "paused" | "enabled",
  fetcher: typeof fetch,
): Promise<ReadyCorosConnection | null> {
  const connection = await db.prepare(
    `SELECT github_user_id, client_id, redirect_uri, resource_url, encrypted_refresh_token, scope, state, connected_at, last_error_code
       FROM coros_connections WHERE github_user_id = ?1`,
  ).bind(githubUserId).first<StoredConnection>();
  if (!connection || connection.state !== requiredState || connection.github_user_id !== githubUserId) {
    invalidateCorosAccessCache(githubUserId); return null;
  }
  for (const [id, cached] of accessCache) if (cached.expiresAt <= Date.now()) accessCache.delete(id);
  const cached = accessCache.get(githubUserId);
  if (requiredState === "enabled" && !connection.last_error_code && cached?.binding === grantBinding(connection)) {
    return { resourceUrl: connection.resource_url, accessToken: await decryptRefreshToken(cached.encryptedAccess, encryptionKey), githubUserId };
  }
  invalidateCorosAccessCache(githubUserId);
  const startedAt = Date.now();
  const endpoints = await discoverCorosOAuth(connection.resource_url, fetcher);
  const oldRefreshToken = await decryptRefreshToken(connection.encrypted_refresh_token, encryptionKey);
  const renewed = await refreshCorosToken(endpoints, {
    clientId: connection.client_id,
    redirectUri: connection.redirect_uri,
  }, oldRefreshToken, connection.scope, fetcher);
  const encryptedNext = await encryptRefreshToken(renewed.refreshToken, encryptionKey);
  const result = await db.prepare(
    `UPDATE coros_connections SET encrypted_refresh_token = ?1, scope = ?2, updated_at = ?3
      WHERE github_user_id = ?4 AND encrypted_refresh_token = ?5`,
  ).bind(encryptedNext, renewed.scope, new Date().toISOString(), githubUserId,
    connection.encrypted_refresh_token).run();
  if (!result.success || result.meta?.changes !== 1) throw new Error("COROS_TOKEN_ROTATION_CONFLICT");
  // Preserve a successful remote rotation even when paused during the request.
  // The token may be retained encrypted, but cannot be used after permission changes.
  const current = await db.prepare("SELECT state FROM coros_connections WHERE github_user_id = ?1")
    .bind(githubUserId).first<{ state: string }>();
  if (current?.state !== requiredState) return null;
  const expiresAt = startedAt + Math.min(5 * 60_000, Math.max(0, renewed.expiresIn * 1_000 - 60_000));
  if (requiredState === "enabled" && expiresAt > Date.now()) {
    if (accessCache.size >= 2) accessCache.delete(accessCache.keys().next().value!);
    accessCache.set(githubUserId, { binding: grantBinding({ ...connection, encrypted_refresh_token: encryptedNext, scope: renewed.scope }),
      encryptedAccess: await encryptRefreshToken(renewed.accessToken, encryptionKey), expiresAt });
  }
  return { resourceUrl: endpoints.resource, accessToken: renewed.accessToken, githubUserId };
}
