import { describe, expect, it } from "vitest";

import {
  decryptRefreshToken,
  encryptRefreshToken,
  hmacSha256Base64Url,
  randomToken,
  sha256Base64Url,
} from "./security";

describe("auth security primitives", () => {
  it("generates independent high-entropy tokens", () => {
    const first = randomToken();
    const second = randomToken();

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it("hashes session identifiers before persistence", async () => {
    const digest = await sha256Base64Url("session-secret");

    expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(digest).not.toContain("session-secret");
  });

  it("keys persisted session identifiers with HMAC", async () => {
    const digest = await hmacSha256Base64Url("session-secret", randomToken(32));

    expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(digest).not.toContain("session-secret");
  });

  it("round-trips an encrypted refresh token", async () => {
    const key = randomToken(32);
    const encrypted = await encryptRefreshToken("github-refresh-token", key);

    expect(encrypted).not.toContain("github-refresh-token");
    await expect(decryptRefreshToken(encrypted, key)).resolves.toBe("github-refresh-token");
  });
});
