import { authenticatedGitHubUser, validAuthenticatedMutation, type AuthEnv } from "./auth";
import {
  createCorosAuthorization,
  discoverCorosOAuth,
  exchangeCorosCode,
  registerCorosOAuthClient,
} from "./coros-oauth";
import { refreshPausedCorosConnectionForPreview } from "./coros-credentials";
import { summarizeCorosPreview } from "./coros-preview";
import { callCorosReadTool } from "./coros-read-client";
import { decryptRefreshToken, encryptRefreshToken, sha256Base64Url } from "./security";
import { dateOnly, initialSyncProgress, parseSyncProgress, readSyncJob, syncReadiness, todayInTimezone, type CorosSyncEnv } from "./coros-sync-state";
import { readCorosConflictView } from "./coros-sync-conflict-view";

const OAUTH_ATTEMPT_SECONDS = 10 * 60;
const RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

export type CorosConnectionEnv = AuthEnv & CorosSyncEnv & {
  COROS_MCP_RESOURCE_URL?: string;
  COROS_CALLBACK_ORIGIN?: string;
};

type AttemptRow = {
  github_user_id: string;
  client_id: string;
  encrypted_verifier: string;
  redirect_uri: string;
  resource_url: string;
  expires_at: string;
};

type ConnectionRow = {
  state: "paused" | "enabled";
  connected_at: string;
  last_sync_at: string | null;
  last_error_code: string | null;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: RESPONSE_HEADERS });
}

function configured(env: CorosConnectionEnv, request: Request): boolean {
  const origin = new URL(request.url).origin;
  return Boolean(env.DB && env.TOKEN_ENCRYPTION_KEY && env.COROS_MCP_RESOURCE_URL
    && env.COROS_CALLBACK_ORIGIN && (origin === env.COROS_CALLBACK_ORIGIN
      || origin === "https://personal-workspace-app.pages.dev"));
}

function callbackUri(origin: string): string {
  return `${origin}/coros/callback`;
}

async function start(request: Request, env: CorosConnectionEnv, userId: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!validAuthenticatedMutation(request)) return json({ error: "CSRF_VALIDATION_FAILED" }, 403);
  const endpoints = await discoverCorosOAuth(env.COROS_MCP_RESOURCE_URL!);
  const client = await registerCorosOAuthClient(endpoints, callbackUri(new URL(request.url).origin));
  const authorization = await createCorosAuthorization(endpoints, client);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OAUTH_ATTEMPT_SECONDS * 1000).toISOString();
  await env.DB!.prepare("DELETE FROM coros_oauth_attempts WHERE github_user_id = ?1 OR expires_at <= ?2")
    .bind(userId, now.toISOString()).run();
  const saved = await env.DB!.prepare(
    `INSERT INTO coros_oauth_attempts
      (state_hash, github_user_id, client_id, encrypted_verifier, redirect_uri,
       resource_url, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  ).bind(
    await sha256Base64Url(authorization.state), userId, client.clientId,
    await encryptRefreshToken(authorization.verifier, env.TOKEN_ENCRYPTION_KEY!),
    client.redirectUri, endpoints.resource, now.toISOString(), expiresAt,
  ).run();
  if (!saved.success) throw new Error("COROS_OAUTH_ATTEMPT_SAVE_FAILED");
  return json({ authorizationUrl: authorization.url, expiresAt });
}

async function callback(request: Request, env: CorosConnectionEnv, userId: string): Promise<Response> {
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code || url.searchParams.has("error") || state.length > 512 || code.length > 4096) {
    return json({ error: "COROS_AUTHORIZATION_DENIED" }, 400);
  }
  const hash = await sha256Base64Url(state);
  const attempt = await env.DB!.prepare(
    `SELECT github_user_id, client_id, encrypted_verifier, redirect_uri, resource_url, expires_at
       FROM coros_oauth_attempts WHERE state_hash = ?1`,
  ).bind(hash).first<AttemptRow>();
  if (!attempt || attempt.github_user_id !== userId || attempt.expires_at <= new Date().toISOString()
    || attempt.redirect_uri !== callbackUri(url.origin)) {
    return json({ error: "COROS_AUTHORIZATION_STATE_INVALID" }, 400);
  }
  const consumed = await env.DB!.prepare("DELETE FROM coros_oauth_attempts WHERE state_hash = ?1 AND github_user_id = ?2")
    .bind(hash, userId).run();
  if (!consumed.success || consumed.meta?.changes !== 1) return json({ error: "COROS_AUTHORIZATION_REPLAYED" }, 409);
  const endpoints = await discoverCorosOAuth(attempt.resource_url);
  const verifier = await decryptRefreshToken(attempt.encrypted_verifier, env.TOKEN_ENCRYPTION_KEY!);
  const token = await exchangeCorosCode(endpoints, { clientId: attempt.client_id, redirectUri: attempt.redirect_uri }, code, verifier);
  const now = new Date().toISOString();
  const saved = await env.DB!.prepare(
    `INSERT INTO coros_connections
      (github_user_id, client_id, redirect_uri, resource_url, encrypted_refresh_token,
       scope, state, connected_at, updated_at, last_sync_at, last_error_code)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'paused', ?7, ?7, NULL, NULL)
     ON CONFLICT(github_user_id) DO UPDATE SET
       client_id = excluded.client_id, redirect_uri = excluded.redirect_uri,
       resource_url = excluded.resource_url, encrypted_refresh_token = excluded.encrypted_refresh_token,
       scope = excluded.scope, state = 'paused', connected_at = excluded.connected_at,
       updated_at = excluded.updated_at, last_sync_at = NULL, last_error_code = NULL`,
  ).bind(
    userId, attempt.client_id, attempt.redirect_uri, attempt.resource_url,
    await encryptRefreshToken(token.refreshToken, env.TOKEN_ENCRYPTION_KEY!),
    token.scope, now,
  ).run();
  if (!saved.success) throw new Error("COROS_CONNECTION_SAVE_FAILED");
  await env.DB!.prepare("UPDATE coros_sync_jobs SET lease_token = NULL, lease_until = NULL WHERE github_user_id = ?1")
    .bind(userId).run();
  return new Response(null, { status: 303, headers: { ...RESPONSE_HEADERS,
    location: `${url.origin}/?coros=connected` } });
}

async function status(request: Request, env: CorosConnectionEnv, userId: string): Promise<Response> {
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const row = await env.DB!.prepare(
    "SELECT state, connected_at, last_sync_at, last_error_code FROM coros_connections WHERE github_user_id = ?1",
  ).bind(userId).first<ConnectionRow>();
  const job = await readSyncJob(env.DB!, userId);
  return json({ connected: Boolean(row), state: row?.state ?? null,
    connectedAt: row?.connected_at ?? null, lastSyncAt: row?.last_sync_at ?? null,
    lastErrorCode: row?.last_error_code ?? null, sync: { readiness: syncReadiness(env),
      progress: job ? parseSyncProgress(job.progress_json) : null,
      running: Boolean(job?.lease_until && job.lease_until > new Date().toISOString()),
      nextRunAt: job?.next_run_at ?? null } });
}

async function disconnect(request: Request, env: CorosConnectionEnv, userId: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!validAuthenticatedMutation(request)) return json({ error: "CSRF_VALIDATION_FAILED" }, 403);
  const removed = await env.DB!.prepare("DELETE FROM coros_connections WHERE github_user_id = ?1")
    .bind(userId).run();
  if (!removed.success) throw new Error("COROS_DISCONNECT_FAILED");
  await env.DB!.prepare("DELETE FROM coros_oauth_attempts WHERE github_user_id = ?1").bind(userId).run();
  await env.DB!.prepare("DELETE FROM coros_sync_jobs WHERE github_user_id = ?1").bind(userId).run();
  // This stops local access. COROS's public-client revocation support must be checked separately.
  return json({ disconnected: true, remoteAuthorizationRevoked: false });
}

async function controlSync(request: Request, env: CorosConnectionEnv, userId: string, action: "enable" | "pause" | "sync"): Promise<Response> {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!validAuthenticatedMutation(request)) return json({ error: "CSRF_VALIDATION_FAILED" }, 403);
  if (userId !== env.COROS_GITHUB_USER_ID) return json({ error: "COROS_SYNC_ACCOUNT_NOT_CONFIGURED" }, 409);
  const row = await env.DB!.prepare("SELECT state FROM coros_connections WHERE github_user_id = ?1")
    .bind(userId).first<{ state: string }>();
  if (!row) return json({ error: "COROS_CONNECTION_REQUIRED" }, 409);
  if (action === "pause") {
    await env.DB!.prepare("UPDATE coros_connections SET state = 'paused' WHERE github_user_id = ?1").bind(userId).run();
    // Invalidate the worker lease so an in-flight read cannot write its result later.
    await env.DB!.prepare("UPDATE coros_sync_jobs SET lease_token = NULL, lease_until = NULL WHERE github_user_id = ?1").bind(userId).run();
    return json({ state: "paused" });
  }
  const readiness = syncReadiness(env);
  if (!readiness.ready) return json({ error: "COROS_SYNC_NOT_CONFIGURED", missing: readiness.missing }, 409);
  const now = new Date();
  if (action === "enable") {
    if (Number(request.headers.get("content-length")) > 1024) return json({ error: "COROS_SYNC_INVALID_DATE" }, 400);
    const body = await request.json().catch(() => null) as { startDate?: unknown } | null;
    const timezone = env.COROS_SYNC_TIMEZONE ?? "Asia/Shanghai";
    if (!dateOnly(body?.startDate) || body.startDate < "2000-01-01" || body.startDate > todayInTimezone(now, timezone)) {
      return json({ error: "COROS_SYNC_INVALID_DATE" }, 400);
    }
    const existing = await readSyncJob(env.DB!, userId);
    if (existing) {
      const progress = parseSyncProgress(existing.progress_json);
      if (progress.startDate !== body.startDate) return json({ error: "COROS_SYNC_START_DATE_LOCKED" }, 409);
    } else {
      const progress = initialSyncProgress(body.startDate, timezone);
      await env.DB!.prepare(`INSERT OR IGNORE INTO coros_sync_jobs
        (github_user_id, progress_json, next_run_at, updated_at) VALUES (?1, ?2, ?3, ?3)`)
        .bind(userId, JSON.stringify(progress), now.toISOString()).run();
    }
    await env.DB!.prepare("UPDATE coros_connections SET state = 'enabled', last_error_code = NULL WHERE github_user_id = ?1")
      .bind(userId).run();
  } else {
    if (row.state !== "enabled") return json({ error: "COROS_SYNC_PAUSED" }, 409);
    const job = await readSyncJob(env.DB!, userId);
    if (!job) return json({ error: "COROS_SYNC_NOT_CONFIGURED" }, 409);
    if (job.lease_until && job.lease_until > now.toISOString()) return json({ error: "COROS_SYNC_BUSY" }, 409);
    const progress = parseSyncProgress(job.progress_json);
    for (const domain of ["sleep", "workout"] as const) {
      progress.domains[domain].lastRecentAt = null; progress.domains[domain].recentNext = null;
      progress.domains[domain].retryAfter = null;
    }
    const queued = await env.DB!.prepare("UPDATE coros_sync_jobs SET progress_json = ?1, next_run_at = ?3 WHERE github_user_id = ?2 AND (lease_until IS NULL OR lease_until <= ?3)")
      .bind(JSON.stringify(progress), userId, now.toISOString()).run();
    if (!queued.success || queued.meta?.changes !== 1) return json({ error: "COROS_SYNC_BUSY" }, 409);
    return json({ state: "enabled", queued: true });
  }
  await env.DB!.prepare("UPDATE coros_sync_jobs SET next_run_at = ?1 WHERE github_user_id = ?2")
    .bind(now.toISOString(), userId).run();
  return json({ state: "enabled", queued: true });
}

async function preview(request: Request, env: CorosConnectionEnv, userId: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!validAuthenticatedMutation(request)) return json({ error: "CSRF_VALIDATION_FAILED" }, 403);
  const connection = await refreshPausedCorosConnectionForPreview(env.DB!, userId, env.TOKEN_ENCRYPTION_KEY!);
  if (!connection) return json({ error: "COROS_PAUSED_CONNECTION_REQUIRED" }, 409);
  try {
    const result = await callCorosReadTool(connection.resourceUrl, connection.accessToken,
      "queryDailyHealthData", { days: 1 });
    return json({ tool: "queryDailyHealthData", interval: "latest_day", ...summarizeCorosPreview(result) });
  } catch {
    return json({ error: "COROS_PREVIEW_UNAVAILABLE" }, 502);
  }
}

export async function handleCorosConnectionRequest(request: Request, env: CorosConnectionEnv): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!configured(env, request)) return json({ error: "COROS_CONNECTOR_NOT_CONFIGURED" }, 503);
  const user = await authenticatedGitHubUser(request, env);
  if (!user) return json({ error: "AUTHENTICATION_REQUIRED" }, 401);
  switch (path) {
    case "/coros/conflicts": {
      if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
      if (user.id !== env.COROS_GITHUB_USER_ID) return json({ error: "COROS_SYNC_ACCOUNT_NOT_CONFIGURED" }, 409);
      if (!syncReadiness(env).ready) return json({ error: "COROS_SYNC_NOT_CONFIGURED" }, 409);
      return json(await readCorosConflictView(env));
    }
    case "/coros/start": return start(request, env, user.id);
    case "/coros/callback": return callback(request, env, user.id);
    case "/coros/status": return status(request, env, user.id);
    case "/coros/preview": return preview(request, env, user.id);
    case "/coros/disconnect": return disconnect(request, env, user.id);
    case "/coros/enable": return controlSync(request, env, user.id, "enable");
    case "/coros/pause": return controlSync(request, env, user.id, "pause");
    case "/coros/sync": return controlSync(request, env, user.id, "sync");
    default: return json({ error: "COROS_ROUTE_NOT_FOUND" }, 404);
  }
}
