const TOKEN_VERSION = "v1";
const AES_GCM_IV_BYTES = 12;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function randomToken(byteLength = 32): string {
  if (!Number.isSafeInteger(byteLength) || byteLength < 16) {
    throw new Error("Security tokens must contain at least 16 random bytes.");
  }

  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function hmacSha256Base64Url(value: string, keyBase64Url: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base64UrlToBytes(keyBase64Url),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function encryptRefreshToken(token: string, keyBase64Url: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base64UrlToBytes(keyBase64Url),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(token),
  );

  return [TOKEN_VERSION, bytesToBase64Url(iv), bytesToBase64Url(new Uint8Array(encrypted))].join(".");
}

export async function decryptRefreshToken(payload: string, keyBase64Url: string): Promise<string> {
  const [version, encodedIv, encodedCiphertext, extra] = payload.split(".");
  if (version !== TOKEN_VERSION || !encodedIv || !encodedCiphertext || extra !== undefined) {
    throw new Error("Encrypted refresh token has an unsupported format.");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    base64UrlToBytes(keyBase64Url),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(encodedIv) },
    key,
    base64UrlToBytes(encodedCiphertext),
  );

  return new TextDecoder().decode(decrypted);
}
