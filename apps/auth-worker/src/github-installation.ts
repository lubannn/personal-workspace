import { GitHubContentsAdapter } from "../../../src/lib/github-data/github-contents";

const GITHUB_API_ORIGIN = "https://api.github.com";
const API_VERSION = "2026-03-10";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function der(tag: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const length = payload.length < 128 ? [payload.length] : (() => {
    const bytes: number[] = [];
    let remaining = payload.length;
    while (remaining > 0) { bytes.unshift(remaining & 0xff); remaining = Math.floor(remaining / 256); }
    return [0x80 | bytes.length, ...bytes];
  })();
  return Uint8Array.from([tag, ...length, ...payload]);
}

function pemBytes(privateKeyPem: string): Uint8Array<ArrayBuffer> {
  const isPkcs1 = privateKeyPem.includes("-----BEGIN RSA PRIVATE KEY-----")
    && privateKeyPem.includes("-----END RSA PRIVATE KEY-----");
  const isPkcs8 = privateKeyPem.includes("-----BEGIN PRIVATE KEY-----")
    && privateKeyPem.includes("-----END PRIVATE KEY-----");
  if (!isPkcs1 && !isPkcs8) throw new Error("INVALID_GITHUB_APP_PRIVATE_KEY");
  const base64 = privateKeyPem
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----|-----END (?:RSA )?PRIVATE KEY-----|\s/gu, "");
  if (!base64 || !/^[A-Za-z0-9+/=]+$/u.test(base64)) throw new Error("INVALID_GITHUB_APP_PRIVATE_KEY");
  const key = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  if (!isPkcs1) return key;
  // GitHub-generated App keys are commonly PKCS#1; Web Crypto imports PKCS#8.
  const rsaAlgorithm = Uint8Array.from([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
    0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
  return der(0x30, Uint8Array.from([...der(0x02, Uint8Array.of(0)), ...rsaAlgorithm, ...der(0x04, key)]));
}

export type GitHubInstallationConfig = {
  appId: string;
  installationId: string;
  privateKeyPem: string;
  owner: string;
  repository: string;
};

export async function signGitHubAppJwt(
  config: Pick<GitHubInstallationConfig, "appId" | "privateKeyPem">,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  if (!/^[1-9]\d*$/u.test(config.appId)) throw new Error("INVALID_GITHUB_APP_ID");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(config.privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: config.appId,
  })));
  const content = `${header}.${payload}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(content));
  return `${content}.${base64Url(new Uint8Array(signature))}`;
}

/** Tokens are created per run and constrained to one private repository and Contents only. */
export async function createPrivateDataInstallationAdapter(
  config: GitHubInstallationConfig,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<GitHubContentsAdapter> {
  if (!/^[1-9]\d*$/u.test(config.installationId)) throw new Error("INVALID_GITHUB_INSTALLATION_ID");
  if (!/^[A-Za-z0-9_.-]+$/u.test(config.owner) || !/^[A-Za-z0-9_.-]+$/u.test(config.repository)) {
    throw new Error("INVALID_GITHUB_REPOSITORY");
  }
  const jwt = await signGitHubAppJwt(config);
  const response = await fetcher(`${GITHUB_API_ORIGIN}/app/installations/${config.installationId}/access_tokens`, {
    method: "POST",
    cache: "no-store",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
      "x-github-api-version": API_VERSION,
    },
    body: JSON.stringify({
      repositories: [config.repository],
      permissions: { contents: "write" },
    }),
  });
  if (response.status !== 201) throw new Error("GITHUB_INSTALLATION_TOKEN_FAILED");
  const payload = await response.json() as { token?: string; expires_at?: string; repository_selection?: string };
  if (!payload.token || !payload.expires_at || Date.parse(payload.expires_at) <= Date.now()) {
    throw new Error("GITHUB_INSTALLATION_TOKEN_INVALID");
  }
  const adapter = new GitHubContentsAdapter({
    owner: config.owner,
    repository: config.repository,
    token: payload.token,
  }, fetcher);
  const repository = await adapter.verifyPrivateRepository();
  if (repository.fullName.toLowerCase() !== `${config.owner}/${config.repository}`.toLowerCase()) {
    throw new Error("GITHUB_INSTALLATION_REPOSITORY_MISMATCH");
  }
  return adapter;
}
