const PUBLIC_APP_ORIGIN = "https://lubannn.github.io";
const PUBLIC_APP_BASE_PATH = "/personal-workspace";

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

function publicAppUrl(requestUrl: string): URL {
  const incoming = new URL(requestUrl);
  const isBasePath =
    incoming.pathname === PUBLIC_APP_BASE_PATH ||
    incoming.pathname.startsWith(`${PUBLIC_APP_BASE_PATH}/`);
  const upstreamPath =
    incoming.pathname === "/"
      ? `${PUBLIC_APP_BASE_PATH}/`
      : isBasePath
        ? incoming.pathname
        : `${PUBLIC_APP_BASE_PATH}${incoming.pathname}`;

  const upstream = new URL(upstreamPath, PUBLIC_APP_ORIGIN);
  upstream.search = incoming.search;
  return upstream;
}

async function proxyPublicApp(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed("GET and HEAD");
  }

  const upstreamHeaders = new Headers();
  for (const name of ["accept", "accept-language", "if-modified-since", "if-none-match", "range"]) {
    const value = request.headers.get(name);
    if (value) upstreamHeaders.set(name, value);
  }

  const upstreamResponse = await fetch(
    new Request(publicAppUrl(request.url), {
      method: request.method,
      headers: upstreamHeaders,
      redirect: "follow",
    }),
  );
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

async function routeRequest(request: Request): Promise<Response> {
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
      phase: "no-secret-feasibility",
      authConfigured: false,
    });
  }

  if (url.pathname === "/auth/status") {
    if (request.method !== "GET") {
      return methodNotAllowed("GET");
    }

    return jsonResponse({
      configured: false,
      phase: "no-secret-feasibility",
      message: "The authentication broker has not been enabled yet.",
    });
  }

  if (url.pathname.startsWith("/auth/")) {
    return jsonResponse(
      {
        error: "AUTH_NOT_CONFIGURED",
        message: "Authentication remains on the existing GitHub token fallback during feasibility testing.",
      },
      503,
    );
  }

  return proxyPublicApp(request);
}

export async function handleRequest(request: Request): Promise<Response> {
  try {
    return await routeRequest(request);
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
  fetch(request: Request): Promise<Response> {
    return handleRequest(request);
  },
};

export default worker;
