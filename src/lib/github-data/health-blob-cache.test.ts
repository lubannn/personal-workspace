import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHealthCacheRetention, EncryptedHealthBlobCache, type HealthCacheStorage, type HealthCachedBlob } from "./health-blob-cache";
function storage() {
  const records = new Map<string, HealthCachedBlob>(); const keys = new Map<string, CryptoKey>();
  const api: HealthCacheStorage = {
    async key(scope) { if (!keys.has(scope)) keys.set(scope, await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])); return keys.get(scope)!; },
    async read(ids) { return ids.map(id => records.get(id)); },
    async write(entries) { entries.forEach(entry => records.set(entry.id, entry)); },
    async remove(ids) { ids.forEach(id => records.delete(id)); },
    async clear(scope) { keys.delete(scope); for (const [id, entry] of records) if (entry.scope === scope) records.delete(id); },
  };
  return { api, records, keys };
}
const text = JSON.stringify({ synthetic: true, score: 84, duration_minutes: 480 });
const sizeBytes = Buffer.byteLength(text);
const file = { path: "data/sleep-sessions/synthetic.json", blobSha: createHash("sha1").update(`blob ${sizeBytes}\0`).update(text).digest("hex"), sizeBytes, text };
afterEach(() => vi.restoreAllMocks());

describe("encrypted persistent health bodies", () => {
  it("encrypts physiological metric bodies under the same scoped SHA cache and clears them", async () => {
    const s = storage(); const cache = new EncryptedHealthBlobCache("repoA", s.api);
    const metric = { ...file, path: "data/health-metrics/synthetic.json" };
    await cache.remember([metric]);
    expect(s.records.size).toBe(1);
    expect(new TextDecoder().decode([...s.records.values()][0].ciphertext)).not.toContain("score");
    expect(await new EncryptedHealthBlobCache("repoA", s.api).read([metric])).toEqual([metric]);
    await cache.clear(); expect(await cache.read([metric])).toEqual([]);
  });
  it("restores content across cache instances with encrypted bytes and a non-extractable key", async () => {
    const s = storage(); const first = new EncryptedHealthBlobCache("repoA", s.api);
    await first.remember([file]);
    const record = [...s.records.values()][0];
    expect(Object.keys(record)).not.toContain("text");
    expect(new TextDecoder().decode(record.ciphertext)).not.toContain("duration_minutes");
    await expect(crypto.subtle.exportKey("raw", s.keys.get("repoA")!)).rejects.toThrow();
    expect(await new EncryptedHealthBlobCache("repoA", s.api).read([file])).toEqual([file]);
    expect(await new EncryptedHealthBlobCache("repoB", s.api).read([file])).toEqual([]);
  });
  it("rejects changed versions, tampered ciphertext and invalid bytes without surfacing private cache errors", async () => {
    const s = storage(); const cache = new EncryptedHealthBlobCache("repoA", s.api);
    await cache.remember([file]);
    expect(await cache.read([{ ...file, blobSha: "f".repeat(40) }])).toEqual([]);
    const record = [...s.records.values()][0]; new Uint8Array(record.ciphertext)[0] ^= 1;
    expect(await cache.read([file])).toEqual([]);
    expect(s.records.size).toBe(0);
    await cache.remember([{ ...file, text: text.replace("84", "95") }]);
    expect(s.records.size).toBe(0);
  });
  it("expires old cached health content and clears only the selected repository's records and key", async () => {
    const s = storage(); const first = new EncryptedHealthBlobCache("repoA", s.api); const second = new EncryptedHealthBlobCache("repoB", s.api);
    await first.remember([file]); await second.remember([file]);
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 31 * 86400_000);
    expect(await first.read([file])).toEqual([]);
    expect(s.records.size).toBe(1);
    await second.clear(); expect(s.records.size).toBe(0); expect(s.keys.has("repoB")).toBe(false);
  });
  it("keeps cache failures optional and excludes credentials or non-health paths", async () => {
    const s = storage(); const cache = new EncryptedHealthBlobCache("repoA", s.api);
    await cache.remember([{ ...file, path: "workspace.json" }, { ...file, path: "data/journal-entries/synthetic.json" }]);
    expect(s.records.size).toBe(0);
    const unavailable = { ...s.api, read: async () => { throw new Error("storage disabled"); }, key: async () => { throw new Error("storage disabled"); } };
    const optional = new EncryptedHealthBlobCache("repoA", unavailable);
    expect(await optional.read([file])).toEqual([]);
    await expect(optional.remember([file])).resolves.toBeUndefined();
    const cannotClear = new EncryptedHealthBlobCache("repoA", { ...s.api, clear: async () => { throw new Error("storage disabled"); } });
    await expect(cannotClear.clear()).rejects.toThrow("storage disabled");
  });
});

it("retains a complete multi-year metric archive and evicts older versions by age and quota", () => {
  const now = Date.now(); const retain = createHealthCacheRetention(now);
  const ciphertext = new ArrayBuffer(1024);
  const kept = Array.from({ length: 12_010 }, (_, index) => retain({ ciphertext, savedAt: now - index }));
  expect(kept.slice(0, 12_000).every(Boolean)).toBe(true);
  expect(kept.slice(12_000).every(value => !value)).toBe(true);
  const sizeLimited = createHealthCacheRetention(now);
  expect(sizeLimited({ savedAt: now, ciphertext: new ArrayBuffer(48 * 1024 * 1024) })).toBe(true);
  expect(sizeLimited({ savedAt: now - 1, ciphertext })).toBe(false);
  const ageLimited = createHealthCacheRetention(now);
  expect(ageLimited({ savedAt: now - 31 * 86400_000, ciphertext })).toBe(false);
  expect(ageLimited({ savedAt: now + 1, ciphertext })).toBe(false);
  expect(ageLimited({ savedAt: now, ciphertext })).toBe(true);
});
