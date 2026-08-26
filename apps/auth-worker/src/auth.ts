import {
  decryptRefreshToken,
  encryptRefreshToken,
  hmacSha256Base64Url,
  randomToken,
  sha256Base64Url,
} from "./security";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";
const OAUTH_COOKIE_MAX_AGE_SECONDS = 10 * 60;
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const SESSION_COOKIE = "__Host-pw_session";
const CSRF_COOKIE = "__Host-pw_csrf";
const STATE_COOKIE = "__Host-pw_oauth_state";
const VERIFIER_COOKIE = "__Host-pw_pkce_verifier";

type D1RunResult = {
  success: boolean;
  meta?: { changes?: number };
};

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1RunResult>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

export interface AuthEnv {
  DB?: D1DatabaseLike;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  SESSION_HMAC_KEY?: string;
  ALLOWED_GITHUB_LOGIN?: string;
  ALLOWED_REPO_OWNER?: string;
  ALLOWED_REPO_NAME?: string;
}

type CompleteAuthEnv = Required<AuthEnv>;

type SessionRow = {
  session_id_hash: string;
  github_user_id: string;
  github_login: string;
  encrypted_refresh_token: string;
  access_token_expires_at: string | null;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  revoked_at: string | null;
};

type GitHubTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type?: string;
  error?: string;
};

type GitHubUser = {
  id?: number;
  login?: string;
};

type GitHubRepository = {
  name?: string;
  private?: boolean;
  owner?: { login?: string };
};

const AUTH_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

function requiredValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function completeEnv(env: AuthEnv): CompleteAuthEnv | null {
  const clientId = requiredValue(env.GITHUB_CLIENT_ID);
  const clientSecret = requiredValue(env.GITHUB_CLIENT_SECRET);
  const encryptionKey = requiredValue(env.TOKEN_ENCRYPTION_KEY);
  const sessionHmacKey = requiredValue(env.SESSION_HMAC_KEY);
  const allowedLogin = requiredValue(env.ALLOWED_GITHUB_LOGIN);
  const owner = requiredValue(env.ALLOWED_REPO_OWNER);
  const repository = requiredValue(env.ALLOWED_REPO_NAME);

  if (
    !env.DB ||
    !clientId ||
    !clientSecret ||
    !encryptionKey ||
    !sessionHmacKey ||
    !allowedLogin ||
    !owner ||
    !repository
  ) {
    return null;
  }

  return {
    DB: env.DB,
    GITHUB_CLIENT_ID: clientId,
    GITHUB_CLIENT_SECRET: clientSecret,
    TOKEN_ENCRYPTION_KEY: encryptionKey,
    SESSION_HMAC_KEY: sessionHmacKey,
    ALLOWED_GITHUB_LOGIN: allowedLogin,
    ALLOWED_REPO_OWNER: owner,
    ALLOWED_REPO_NAME: repository,
  };
}

function json(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(AUTH_HEADERS);
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, name) => headers.set(name, value));
  }
  return Response.json(body, { status, headers });
}

function cookie(name: string, value: string, options: { httpOnly: boolean; maxAge: number }): string {
  const attributes = [
    `${name}=${value}`,
    "Path=/",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${options.maxAge}`,
  ];
  if (options.httpOnly) attributes.push("HttpOnly");
  return attributes.join("; ");
}

function clearCookie(name: string, httpOnly: boolean): string {
  return cookie(name, "", { httpOnly, maxAge: 0 });
}

function cookies(request: Request): Map<string, string> {
  const result = new Map<string, string>();
  for (const entry of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 1) continue;
    result.set(entry.slice(0, separator).trim(), entry.slice(separator + 1).trim());
  }
  return result;
}

function appendCookies(response: Response, values: string[]): Response {
  const headers = new Headers(response.headers);
  for (const value of values) headers.append("set-cookie", value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function redirect(location: string, cookieValues: string[] = []): Response {
  const response = new Response(null, {
    status: 302,
    headers: { ...AUTH_HEADERS, location },
  });
  return appendCookies(response, cookieValues);
}

function callbackUrl(request: Request): string {
  return new URL("/auth/callback", request.url).toString();
}

function appRedirect(request: Request, result: "connected" | "denied" | "failed"): string {
  const url = new URL("/", request.url);
  url.searchParams.set("auth", result);
  return url.toString();
}

function sameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin;
}

function csrfValid(request: Request): boolean {
  if (!sameOriginMutation(request)) return false;
  const requestCookies = cookies(request);
  const cookieToken = requestCookies.get(CSRF_COOKIE);
  const headerToken = request.headers.get("x-pw-csrf");
  return Boolean(cookieToken && headerToken && cookieToken === headerToken);
}

async function githubTokenRequest(body: Record<string, string>): Promise<GitHubTokenResponse> {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as GitHubTokenResponse;
  if (!response.ok || payload.error) throw new Error("GitHubTokenExchangeError");
  return payload;
}

async function githubApi<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${GITHUB_API_ORIGIN}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": "Personal-Workspace-Auth",
      "x-github-api-version": GITHUB_API_VERSION,
    },
  });
  if (!response.ok) throw new Error("GitHubAuthorizationBoundaryError");
  return (await response.json()) as T;
}

function validTokenPayload(payload: GitHubTokenResponse): payload is Required<
  Pick<
    GitHubTokenResponse,
    "access_token" | "expires_in" | "refresh_token" | "refresh_token_expires_in"
  >
> &
  GitHubTokenResponse {
  return Boolean(
    payload.access_token &&
      payload.refresh_token &&
      Number.isFinite(payload.expires_in) &&
      Number.isFinite(payload.refresh_token_expires_in),
  );
}

function isoAfter(now: Date, seconds: number): string {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

function sessionExpiry(now: Date, refreshExpiresIn: number): string {
  return isoAfter(now, Math.min(SESSION_MAX_AGE_SECONDS, refreshExpiresIn));
}

async function sessionHash(rawSessionId: string, env: CompleteAuthEnv): Promise<string> {
  return hmacSha256Base64Url(rawSessionId, env.SESSION_HMAC_KEY);
}

async function findSession(request: Request, env: CompleteAuthEnv): Promise<SessionRow | null> {
  const rawSessionId = cookies(request).get(SESSION_COOKIE);
  if (!rawSessionId) return null;
  const hash = await sessionHash(rawSessionId, env);
  const now = new Date().toISOString();
  return env.DB.prepare(
    `SELECT session_id_hash, github_user_id, github_login, encrypted_refresh_token,
            access_token_expires_at, created_at, last_used_at, expires_at, revoked_at
       FROM auth_sessions
      WHERE session_id_hash = ?1 AND revoked_at IS NULL AND expires_at > ?2`,
  )
    .bind(hash, now)
    .first<SessionRow>();
}

async function login(request: Request, env: CompleteAuthEnv): Promise<Response> {
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const state = randomToken();
  const verifier = randomToken();
  const challenge = await sha256Base64Url(verifier);
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", callbackUrl(request));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("allow_signup", "false");

  return redirect(url.toString(), [
    cookie(STATE_COOKIE, state, { httpOnly: true, maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS }),
    cookie(VERIFIER_COOKIE, verifier, { httpOnly: true, maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS }),
  ]);
}

async function callback(request: Request, env: CompleteAuthEnv): Promise<Response> {
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const url = new URL(request.url);
  const requestCookies = cookies(request);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const expectedState = requestCookies.get(STATE_COOKIE);
  const verifier = requestCookies.get(VERIFIER_COOKIE);
  const clearOAuthCookies = [clearCookie(STATE_COOKIE, true), clearCookie(VERIFIER_COOKIE, true)];

  if (url.searchParams.get("error") || !state || !code || !expectedState || !verifier) {
    return redirect(appRedirect(request, "denied"), clearOAuthCookies);
  }
  if (state !== expectedState) {
    return redirect(appRedirect(request, "failed"), clearOAuthCookies);
  }

  const token = await githubTokenRequest({
    client_id: env.GITHUB_CLIENT_ID,
    client_secret: env.GITHUB_CLIENT_SECRET,
    code,
    redirect_uri: callbackUrl(request),
    code_verifier: verifier,
  });
  if (!validTokenPayload(token)) throw new Error("GitHubExpiringTokenRequired");

  const user = await githubApi<GitHubUser>("/user", token.access_token);
  if (
    !user.id ||
    !user.login ||
    user.login.toLocaleLowerCase("en-US") !== env.ALLOWED_GITHUB_LOGIN.toLocaleLowerCase("en-US")
  ) {
    throw new Error("GitHubUserNotAllowed");
  }

  const repositoryPath = `/repos/${encodeURIComponent(env.ALLOWED_REPO_OWNER)}/${encodeURIComponent(env.ALLOWED_REPO_NAME)}`;
  const repository = await githubApi<GitHubRepository>(repositoryPath, token.access_token);
  if (
    repository.private !== true ||
    repository.name?.toLocaleLowerCase("en-US") !== env.ALLOWED_REPO_NAME.toLocaleLowerCase("en-US") ||
    repository.owner?.login?.toLocaleLowerCase("en-US") !==
      env.ALLOWED_REPO_OWNER.toLocaleLowerCase("en-US")
  ) {
    throw new Error("GitHubRepositoryNotAllowed");
  }

  const now = new Date();
  const rawSessionId = randomToken();
  const hash = await sessionHash(rawSessionId, env);
  const encryptedRefreshToken = await encryptRefreshToken(
    token.refresh_token,
    env.TOKEN_ENCRYPTION_KEY,
  );
  const expiresAt = sessionExpiry(now, token.refresh_token_expires_in);
  const insert = await env.DB.prepare(
    `INSERT INTO auth_sessions (
       session_id_hash, github_user_id, github_login, encrypted_refresh_token,
       access_token_expires_at, created_at, last_used_at, expires_at, revoked_at, device_name
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, NULL, NULL)`,
  )
    .bind(
      hash,
      String(user.id),
      user.login,
      encryptedRefreshToken,
      isoAfter(now, token.expires_in),
      now.toISOString(),
      expiresAt,
    )
    .run();
  if (!insert.success) throw new Error("SessionPersistenceError");

  const csrf = randomToken();
  return redirect(appRedirect(request, "connected"), [
    ...clearOAuthCookies,
    cookie(SESSION_COOKIE, rawSessionId, { httpOnly: true, maxAge: SESSION_MAX_AGE_SECONDS }),
    cookie(CSRF_COOKIE, csrf, { httpOnly: false, maxAge: SESSION_MAX_AGE_SECONDS }),
  ]);
}

async function status(request: Request, env: CompleteAuthEnv): Promise<Response> {
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const session = await findSession(request, env);
  return json({
    configured: true,
    authenticated: Boolean(session),
    login: session?.github_login ?? null,
  });
}

async function issueToken(request: Request, env: CompleteAuthEnv): Promise<Response> {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!csrfValid(request)) return json({ error: "CSRF_VALIDATION_FAILED" }, 403);
  const session = await findSession(request, env);
  if (!session) return json({ error: "AUTHENTICATION_REQUIRED" }, 401);

  const refreshToken = await decryptRefreshToken(
    session.encrypted_refresh_token,
    env.TOKEN_ENCRYPTION_KEY,
  );
  const token = await githubTokenRequest({
    client_id: env.GITHUB_CLIENT_ID,
    client_secret: env.GITHUB_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  if (!validTokenPayload(token)) throw new Error("GitHubExpiringTokenRequired");

  const now = new Date();
  const encryptedRefreshToken = await encryptRefreshToken(
    token.refresh_token,
    env.TOKEN_ENCRYPTION_KEY,
  );
  const expiresAt = sessionExpiry(now, token.refresh_token_expires_in);
  const update = await env.DB.prepare(
    `UPDATE auth_sessions
        SET encrypted_refresh_token = ?1,
            access_token_expires_at = ?2,
            last_used_at = ?3,
            expires_at = ?4
      WHERE session_id_hash = ?5
        AND encrypted_refresh_token = ?6
        AND revoked_at IS NULL`,
  )
    .bind(
      encryptedRefreshToken,
      isoAfter(now, token.expires_in),
      now.toISOString(),
      expiresAt,
      session.session_id_hash,
      session.encrypted_refresh_token,
    )
    .run();
  if (!update.success || update.meta?.changes !== 1) throw new Error("SessionRotationConflict");

  return json({ accessToken: token.access_token, expiresAt: isoAfter(now, token.expires_in) });
}

async function logout(request: Request, env: CompleteAuthEnv, allDevices: boolean): Promise<Response> {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!csrfValid(request)) return json({ error: "CSRF_VALIDATION_FAILED" }, 403);
  const session = await findSession(request, env);
  const now = new Date().toISOString();

  if (session) {
    const statement = allDevices
      ? env.DB.prepare(
          "UPDATE auth_sessions SET revoked_at = ?1 WHERE github_user_id = ?2 AND revoked_at IS NULL",
        ).bind(now, session.github_user_id)
      : env.DB.prepare(
          "UPDATE auth_sessions SET revoked_at = ?1 WHERE session_id_hash = ?2 AND revoked_at IS NULL",
        ).bind(now, session.session_id_hash);
    await statement.run();
  }

  return appendCookies(json({ ok: true }), [
    clearCookie(SESSION_COOKIE, true),
    clearCookie(CSRF_COOKIE, false),
  ]);
}

export async function handleAuthRequest(request: Request, env: AuthEnv): Promise<Response> {
  const configured = completeEnv(env);
  const path = new URL(request.url).pathname;

  if (!configured) {
    if (path === "/auth/status" && request.method === "GET") {
      return json({
        configured: false,
        authenticated: false,
        phase: "awaiting-github-app-secrets",
      });
    }
    return json(
      {
        error: "AUTH_NOT_CONFIGURED",
        message: "GitHub App authentication has not been enabled yet.",
      },
      503,
    );
  }

  switch (path) {
    case "/auth/login":
      return login(request, configured);
    case "/auth/callback":
      return callback(request, configured);
    case "/auth/status":
      return status(request, configured);
    case "/auth/token":
      return issueToken(request, configured);
    case "/auth/logout":
      return logout(request, configured, false);
    case "/auth/logout-all":
      return logout(request, configured, true);
    default:
      return json({ error: "AUTH_ROUTE_NOT_FOUND" }, 404);
  }
}
