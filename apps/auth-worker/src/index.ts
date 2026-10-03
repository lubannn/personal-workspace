import { handleAuthRequest } from "./auth";
import { handleCorosConnectionRequest, type CorosConnectionEnv } from "./coros-connection";
import { runCorosSync } from "./coros-sync";

const PUBLIC_APP_ORIGIN = "https://personal-workspace-app.pages.dev";
const LEGACY_PUBLIC_APP_BASE_PATH = "/personal-workspace";
const MAX_PUBLIC_APP_REDIRECTS = 5;
const PUBLIC_APP_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const PRIVATE_RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: PRIVATE_RESPONSE_HEADERS,
  });
}

function methodNotAllowed(allowed: string): Response {
  return jsonResponse(
    {
      error: "METHOD_NOT_ALLOWED",
      message: `Only ${allowed} is supported.`,
    },
    405,
  );
}

function publicAppUrl(requestUrl: string): URL | null {
  const incoming = new URL(requestUrl);
  const upstreamPath =
    incoming.pathname === LEGACY_PUBLIC_APP_BASE_PATH
      ? "/"
      : incoming.pathname.startsWith(`${LEGACY_PUBLIC_APP_BASE_PATH}/`)
        ? incoming.pathname.slice(LEGACY_PUBLIC_APP_BASE_PATH.length)
        : incoming.pathname;

  // A leading // is an authority, not a relative path, when passed to new URL.
  // Reject it and assign pathname separately so user input cannot choose a host.
  if (upstreamPath.startsWith("//")) return null;
  const upstream = new URL(PUBLIC_APP_ORIGIN);
  upstream.pathname = upstreamPath;
  upstream.search = incoming.search;
  return upstream;
}

function publicAppRedirect(location: string | null, from: URL): URL | null {
  if (!location) return null;
  try {
    const target = new URL(location, from);
    if (target.protocol !== "https:" || target.origin !== PUBLIC_APP_ORIGIN || target.username || target.password || target.pathname.startsWith("//")) return null;
    target.hash = "";
    return target;
  } catch {
    return null;
  }
}

async function proxyPublicApp(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed("GET and HEAD");
  }

  let upstreamUrl = publicAppUrl(request.url);
  if (!upstreamUrl) {
    return jsonResponse({ error: "INVALID_PROXY_PATH", message: "The workspace path is not allowed." }, 400);
  }

  const upstreamHeaders = new Headers();
  for (const name of ["accept", "accept-language", "if-modified-since", "if-none-match", "range"]) {
    const value = request.headers.get(name);
    if (value) upstreamHeaders.set(name, value);
  }

  let upstreamResponse: Response;
  for (let redirects = 0; ; redirects += 1) {
    upstreamResponse = await fetch(new Request(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      // Automatic following could leave the trusted origin after our first check.
      redirect: "manual",
    }));
    if (upstreamResponse.status < 300 || upstreamResponse.status >= 400 || upstreamResponse.status === 304) break;

    const target = publicAppRedirect(upstreamResponse.headers.get("location"), upstreamUrl);
    await upstreamResponse.body?.cancel();
    if (!PUBLIC_APP_REDIRECT_STATUSES.has(upstreamResponse.status) || !target || redirects >= MAX_PUBLIC_APP_REDIRECTS) {
      return jsonResponse({ error: "INVALID_UPSTREAM_REDIRECT", message: "The workspace origin returned an unsupported redirect." }, 502);
    }
    upstreamUrl = target;
  }
  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.delete("set-cookie");
  responseHeaders.set("referrer-policy", "no-referrer");
  responseHeaders.set("x-content-type-options", "nosniff");
  responseHeaders.set("x-frame-options", "DENY");

  return new Response(request.method === "HEAD" ? null : upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

async function routeRequest(request: Request, env: CorosConnectionEnv): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return methodNotAllowed("GET and HEAD");
    }

    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: PRIVATE_RESPONSE_HEADERS,
      });
    }

    return jsonResponse({
      status: "ok",
      service: "personal-workspace-auth-edge",
      phase: "auth-foundation-ready",
      authConfigured: Boolean(
        env.DB &&
          env.GITHUB_CLIENT_ID &&
          env.GITHUB_CLIENT_SECRET &&
          env.TOKEN_ENCRYPTION_KEY &&
          env.SESSION_HMAC_KEY &&
          env.ALLOWED_GITHUB_LOGIN &&
          env.ALLOWED_REPO_OWNER &&
          env.ALLOWED_REPO_NAME,
      ),
    });
  }

  if (url.pathname.startsWith("/auth/")) {
    return handleAuthRequest(request, env);
  }

  if (url.pathname.startsWith("/coros/")) {
    return handleCorosConnectionRequest(request, env);
  }

  return proxyPublicApp(request);
}

export async function handleRequest(request: Request, env: CorosConnectionEnv = {}): Promise<Response> {
  try {
    return await routeRequest(request, env);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "worker_request_failed",
        method: request.method,
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );

    return jsonResponse(
      {
        error: "INTERNAL_ERROR",
        message: "The workspace edge service could not complete this request.",
      },
      500,
    );
  }
}

const worker = {
  async scheduled(_event: unknown, env: CorosConnectionEnv): Promise<void> {
    await runCorosSync(env);
  },
  fetch(request: Request, env: CorosConnectionEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};

export default worker;
