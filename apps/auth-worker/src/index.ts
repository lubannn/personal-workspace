interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: AssetsBinding;
}

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

async function routeRequest(request: Request, env: Env): Promise<Response> {
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

  return env.ASSETS.fetch(request);
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
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
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};

export default worker;
