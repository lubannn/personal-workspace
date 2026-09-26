const PAGES_AUTH_ORIGIN = "https://personal-workspace-app.pages.dev";

type AuthService = { fetch(request: Request): Promise<Response> };
type PagesAuthContext = {
  request: Request;
  env: { AUTH?: AuthService };
};

export async function onRequest(context: PagesAuthContext): Promise<Response> {
  const url = new URL(context.request.url);
  if (url.origin !== PAGES_AUTH_ORIGIN || !url.pathname.startsWith("/auth/")) {
    return new Response(null, { status: 404 });
  }

  if (!context.env.AUTH) {
    return Response.json({ error: "AUTH_UNAVAILABLE" }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  try {
    return await context.env.AUTH.fetch(context.request);
  } catch {
    return Response.json({ error: "AUTH_UPSTREAM_UNAVAILABLE" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
