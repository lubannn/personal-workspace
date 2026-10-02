// One-time operator setup. The key is read from disk, never printed or added to Git.
import { readFile } from "node:fs/promises";
import { createPrivateKey, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const keyPath = process.argv[2];
if (!keyPath || process.argv.length !== 3) {
  console.error("Usage: node scripts/configure-coros-background-key.mjs /absolute/path/to/app.private-key.pem");
  process.exit(1);
}
try {
  const pem = await readFile(keyPath, "utf8");
  const privateKey = createPrivateKey(pem);
  if (privateKey.asymmetricKeyType !== "rsa") throw new Error("RSA_KEY_REQUIRED");
  const issuer = "Iv23liMKCWS5z7czUAyl";
  const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const content = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: issuer, iat: now - 60, exp: now + 300 })}`;
  const token = `${content}.${sign("RSA-SHA256", Buffer.from(content), privateKey).toString("base64url")}`;
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "PersonalWorkspace-CorosSetup/1.0", "x-github-api-version": "2026-03-10" };
  const app = await fetch("https://api.github.com/app", { headers, signal: AbortSignal.timeout(20000) });
  if (!app.ok || (await app.json()).client_id !== issuer) throw new Error("APP_KEY_DOES_NOT_MATCH");
  const installation = await fetch("https://api.github.com/app/installations/156819288", { headers, signal: AbortSignal.timeout(20000) });
  if (!installation.ok) throw new Error("INSTALLATION_UNAVAILABLE");
  const installed = await installation.json();
  if (installed.account?.login !== "lubannn" || installed.permissions?.contents !== "write") throw new Error("INSTALLATION_SCOPE_MISMATCH");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)),
    "secret", "put", "GITHUB_APP_PRIVATE_KEY", "--config", "apps/auth-worker/wrangler.jsonc"], {
    cwd: root, input: pem, stdio: ["pipe", "inherit", "inherit"], env: process.env,
  });
  if (result.status !== 0) throw new Error("WORKER_SECRET_UPLOAD_FAILED");
  console.log("Background key configured. No health records were written by this setup command.");
} catch (error) {
  const known = new Set(["RSA_KEY_REQUIRED", "APP_KEY_DOES_NOT_MATCH", "INSTALLATION_UNAVAILABLE", "INSTALLATION_SCOPE_MISMATCH", "WORKER_SECRET_UPLOAD_FAILED"]);
  console.error(known.has(error?.message) ? error.message : "SETUP_FAILED_CHECK_KEY_PATH_AND_NETWORK");
  process.exitCode = 1;
}
