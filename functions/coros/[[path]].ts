type Context = { request: Request; env: { AUTH?: { fetch(request: Request): Promise<Response> } } };

export async function onRequest({ request, env }: Context): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== "https://personal-workspace-app.pages.dev" || !url.pathname.startsWith("/coros/")) {
    return new Response(null, { status: 404 });
  }
  const headers = { "cache-control": "no-store" };
  if (!env.AUTH) return Response.json({ error: "AUTH_UNAVAILABLE" }, { status: 503, headers });
  try { return await env.AUTH.fetch(request); }
  catch { return Response.json({ error: "AUTH_UPSTREAM_UNAVAILABLE" }, { status: 502, headers }); }
}
