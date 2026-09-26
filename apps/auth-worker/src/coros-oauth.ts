import { randomToken, sha256Base64Url } from "./security";

const ALLOWED_RESOURCE_ORIGINS = new Set([
  "https://mcpcn.coros.com",
  "https://mcpeu.coros.com",
  "https://mcpus.coros.com",
]);
const MAX_JSON_BYTES = 64 * 1024;

export function isAllowedCorosResourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ALLOWED_RESOURCE_ORIGINS.has(url.origin) && url.pathname === "/mcp"
      && !url.search && !url.hash && !url.username && !url.password
      && url.toString() === value;
  } catch {
    return false;
  }
}

type OAuthMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  code_challenge_methods_supported: string[];
  grant_types_supported: string[];
  token_endpoint_auth_methods_supported: string[];
};

export type CorosOAuthEndpoints = {
  resource: string;
  issuer: string;
  authorize: string;
  token: string;
  register: string;
};

export type CorosOAuthClient = {
  clientId: string;
  redirectUri: string;
};

export type CorosOAuthToken = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
};

async function boundedJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_JSON_BYTES) throw new Error("COROS_RESPONSE_TOO_LARGE");
  if (!response.ok || !response.body) throw new Error("COROS_OAUTH_REQUEST_FAILED");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_BYTES) throw new Error("COROS_RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function exactOriginUrl(value: string, origin: string): string {
  const url = new URL(value);
  if (url.origin !== origin || url.username || url.password || url.hash) throw new Error("COROS_OAUTH_ORIGIN_MISMATCH");
  return url.toString();
}

export async function discoverCorosOAuth(
  resourceUrl: string,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<CorosOAuthEndpoints> {
  if (!isAllowedCorosResourceUrl(resourceUrl)) {
    throw new Error("COROS_RESOURCE_NOT_ALLOWED");
  }
  const resource = new URL(resourceUrl);
  const protectedResponse = await fetcher(`${resource.origin}/.well-known/oauth-protected-resource/mcp`, { cache: "no-store" });
  const protectedMetadata = await boundedJson(protectedResponse) as { resource?: string; authorization_servers?: string[]; scopes_supported?: string[] };
  if (protectedMetadata.resource !== resourceUrl || protectedMetadata.authorization_servers?.length !== 1
    || protectedMetadata.authorization_servers[0] !== resource.origin
    || !protectedMetadata.scopes_supported?.includes("mcp.tools")
    || !protectedMetadata.scopes_supported?.includes("offline_access")) {
    throw new Error("COROS_RESOURCE_METADATA_INVALID");
  }
  const authResponse = await fetcher(`${resource.origin}/.well-known/oauth-authorization-server`, { cache: "no-store" });
  const metadata = await boundedJson(authResponse) as OAuthMetadata;
  if (metadata.issuer !== resource.origin || !metadata.code_challenge_methods_supported?.includes("S256")
    || !metadata.grant_types_supported?.includes("authorization_code")
    || !metadata.grant_types_supported?.includes("refresh_token")
    || !metadata.token_endpoint_auth_methods_supported?.includes("none")) {
    throw new Error("COROS_AUTH_METADATA_INVALID");
  }
  return {
    resource: resourceUrl,
    issuer: resource.origin,
    authorize: exactOriginUrl(metadata.authorization_endpoint, resource.origin),
    token: exactOriginUrl(metadata.token_endpoint, resource.origin),
    register: exactOriginUrl(metadata.registration_endpoint, resource.origin),
  };
}

export async function registerCorosOAuthClient(
  endpoints: CorosOAuthEndpoints,
  redirectUri: string,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<CorosOAuthClient> {
  const redirect = new URL(redirectUri);
  if (redirect.protocol !== "https:" || redirect.pathname !== "/coros/callback" || redirect.search || redirect.hash) {
    throw new Error("COROS_REDIRECT_INVALID");
  }
  const response = await fetcher(endpoints.register, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Personal Workspace",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const registered = await boundedJson(response) as { client_id?: string; client_secret?: string; redirect_uris?: string[]; token_endpoint_auth_method?: string };
  if (!registered.client_id || registered.client_id.length > 512 || registered.client_secret
    || registered.token_endpoint_auth_method !== "none" || !registered.redirect_uris?.includes(redirectUri)) {
    throw new Error("COROS_CLIENT_REGISTRATION_INVALID");
  }
  return { clientId: registered.client_id, redirectUri };
}

export async function createCorosAuthorization(
  endpoints: CorosOAuthEndpoints,
  client: CorosOAuthClient,
): Promise<{ url: string; state: string; verifier: string }> {
  const state = randomToken();
  const verifier = randomToken();
  const url = new URL(endpoints.authorize);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", client.redirectUri);
  url.searchParams.set("scope", "openid mcp.tools offline_access");
  url.searchParams.set("resource", endpoints.resource);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await sha256Base64Url(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), state, verifier };
}

async function tokenRequest(
  endpoints: CorosOAuthEndpoints,
  fields: Record<string, string>,
  fetcher: typeof fetch,
  previousScope?: string,
): Promise<CorosOAuthToken> {
  const response = await fetcher(endpoints.token, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  const token = await boundedJson(response) as { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string; scope?: string };
  const scope = token.scope ?? previousScope;
  if (!token.access_token || !token.refresh_token || token.token_type?.toLowerCase() !== "bearer"
    || !Number.isFinite(token.expires_in) || (token.expires_in ?? 0) <= 0
    || !scope?.split(" ").includes("mcp.tools")) {
    throw new Error("COROS_TOKEN_INVALID");
  }
  return { accessToken: token.access_token, refreshToken: token.refresh_token, expiresIn: token.expires_in!, scope };
}

export function exchangeCorosCode(
  endpoints: CorosOAuthEndpoints,
  client: CorosOAuthClient,
  code: string,
  verifier: string,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<CorosOAuthToken> {
  return tokenRequest(endpoints, { grant_type: "authorization_code", client_id: client.clientId,
    code, code_verifier: verifier, redirect_uri: client.redirectUri, resource: endpoints.resource }, fetcher);
}

export function refreshCorosToken(
  endpoints: CorosOAuthEndpoints,
  client: CorosOAuthClient,
  refreshToken: string,
  previousScope: string,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<CorosOAuthToken> {
  return tokenRequest(endpoints, { grant_type: "refresh_token", client_id: client.clientId,
    refresh_token: refreshToken, resource: endpoints.resource }, fetcher, previousScope);
}
