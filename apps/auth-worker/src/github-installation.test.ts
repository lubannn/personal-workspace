import { describe, expect, it, vi } from "vitest";
import { createPrivateKey } from "node:crypto";
import { createPrivateDataInstallationAdapter, signGitHubAppJwt } from "./github-installation";

async function fixturePrivateKey(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ["sign", "verify"]);
  const bytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  return `-----BEGIN PRIVATE KEY-----\n${Buffer.from(bytes).toString("base64")}\n-----END PRIVATE KEY-----`;
}

describe("background GitHub installation identity", () => {
  it("signs a short-lived app JWT", async () => {
    const token = await signGitHubAppJwt({ appId: "123", privateKeyPem: await fixturePrivateKey() }, 1_800_000_000);
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    expect(claims).toEqual({ iat: 1_799_999_940, exp: 1_800_000_540, iss: "123" });
  });

  it("accepts the PKCS#1 PEM format GitHub commonly provides", async () => {
    const pkcs1 = createPrivateKey(await fixturePrivateKey()).export({ format: "pem", type: "pkcs1" }).toString();
    const token = await signGitHubAppJwt({ appId: "123", privateKeyPem: pkcs1 });
    expect(token.split(".")).toHaveLength(3);
  });

  it("requests only Contents write for the selected repository", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/access_tokens")) {
        expect(JSON.parse(String(init?.body))).toEqual({ repositories: ["personal-workspace-data"], permissions: { contents: "write" } });
        return Response.json({ token: "test-token", expires_at: "2099-01-01T00:00:00Z" }, { status: 201 });
      }
      expect(url).toBe("https://api.github.com/repos/lubannn/personal-workspace-data");
      return Response.json({ full_name: "lubannn/personal-workspace-data", private: true, visibility: "private", default_branch: "main" });
    });
    await createPrivateDataInstallationAdapter({ appId: "123", installationId: "456", privateKeyPem: await fixturePrivateKey(), owner: "lubannn", repository: "personal-workspace-data" }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
