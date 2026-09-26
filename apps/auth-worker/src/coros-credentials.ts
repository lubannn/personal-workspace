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
};

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
  const connection = await db.prepare(
    `SELECT github_user_id, client_id, redirect_uri, resource_url, encrypted_refresh_token, scope, state
       FROM coros_connections WHERE github_user_id = ?1`,
  ).bind(githubUserId).first<StoredConnection>();
  if (!connection || connection.state !== "enabled" || connection.github_user_id !== githubUserId) return null;
  const endpoints = await discoverCorosOAuth(connection.resource_url, fetcher);
  const oldRefreshToken = await decryptRefreshToken(connection.encrypted_refresh_token, encryptionKey);
  const renewed = await refreshCorosToken(endpoints, {
    clientId: connection.client_id,
    redirectUri: connection.redirect_uri,
  }, oldRefreshToken, connection.scope, fetcher);
  const encryptedNext = await encryptRefreshToken(renewed.refreshToken, encryptionKey);
  const result = await db.prepare(
    `UPDATE coros_connections SET encrypted_refresh_token = ?1, scope = ?2, updated_at = ?3
      WHERE github_user_id = ?4 AND encrypted_refresh_token = ?5 AND state = 'enabled'`,
  ).bind(encryptedNext, renewed.scope, new Date().toISOString(), githubUserId,
    connection.encrypted_refresh_token).run();
  if (!result.success || result.meta?.changes !== 1) throw new Error("COROS_TOKEN_ROTATION_CONFLICT");
  return { resourceUrl: endpoints.resource, accessToken: renewed.accessToken, githubUserId };
}
