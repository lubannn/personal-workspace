import type { GitHubDirectoryItem, GitHubStoredFile } from "./github-contents";

export type HealthCachedBlob = { id: string; scope: string; blobSha: string; sizeBytes: number; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer; savedAt: number };
export interface HealthCacheStorage {
  key(scope: string): Promise<CryptoKey>;
  read(ids: string[]): Promise<(HealthCachedBlob | undefined)[]>;
  write(records: HealthCachedBlob[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  clear(scope: string): Promise<void>;
}
export interface HealthBlobCache {
  read(files: readonly Pick<GitHubDirectoryItem, "path" | "blobSha" | "sizeBytes">[]): Promise<GitHubStoredFile[]>;
  remember(files: readonly GitHubStoredFile[]): Promise<void>;
  clear(): Promise<void>;
}
const MAX_AGE = 30 * 86400_000;
const MAX_RECORD_BYTES = 1024 * 1024;
const allowed = (path: string) => /^data\/(sleep-sessions|workouts|health-staging-records)\/[a-zA-Z0-9_-]+\.json$/.test(path);
const context = (scope: string, sha: string, size: number) => new TextEncoder().encode(JSON.stringify([scope, sha, size]));
async function bodySha(body: Uint8Array<ArrayBuffer>) {
  const header = new TextEncoder().encode(`blob ${body.byteLength}\0`);
  const bytes = new Uint8Array(header.byteLength + body.byteLength);
  bytes.set(header); bytes.set(body, header.byteLength);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-1", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Optional encrypted browser cache. Callers must first authenticate and match fresh remote SHAs. */
export class EncryptedHealthBlobCache implements HealthBlobCache {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly scope: string, private readonly storage: HealthCacheStorage = new IndexedHealthCacheStorage()) {}
  private serial<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
    const next = this.queue.then(operation).catch(() => fallback);
    this.queue = next;
    return next;
  }
  read(files: readonly Pick<GitHubDirectoryItem, "path" | "blobSha" | "sizeBytes">[]): Promise<GitHubStoredFile[]> {
    return this.serial(async () => {
      const requested = files.filter(file => allowed(file.path) && file.sizeBytes <= MAX_RECORD_BYTES);
      if (!requested.length) return [];
      const stored = await this.storage.read(requested.map(file => `${this.scope}:${file.blobSha}`));
      if (!stored.some(Boolean)) return [];
      const key = await this.storage.key(this.scope);
      const invalid: string[] = [];
      const records = await Promise.all(requested.map(async (file, index) => {
        const entry = stored[index];
        if (!entry) return null;
        try {
          if (entry.scope !== this.scope || entry.blobSha !== file.blobSha || entry.sizeBytes !== file.sizeBytes
            || !Number.isFinite(entry.savedAt) || entry.savedAt > Date.now() || Date.now() - entry.savedAt > MAX_AGE) throw new Error();
          const body = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: entry.iv, additionalData: context(this.scope, file.blobSha, file.sizeBytes) }, key, entry.ciphertext));
          if (body.byteLength !== file.sizeBytes || await bodySha(body) !== file.blobSha) throw new Error();
          return { ...file, text: new TextDecoder("utf-8", { fatal: true }).decode(body) };
        } catch { invalid.push(`${this.scope}:${file.blobSha}`); return null; }
      }));
      if (invalid.length) await this.storage.remove(invalid);
      return records.filter((record): record is GitHubStoredFile => record !== null);
    }, []);
  }
  remember(files: readonly GitHubStoredFile[]): Promise<void> {
    return this.serial(async () => {
      const candidates = files.filter(file => allowed(file.path) && file.sizeBytes <= MAX_RECORD_BYTES);
      if (!candidates.length) return;
      const key = await this.storage.key(this.scope);
      const records = await Promise.all(candidates.map(async file => {
        const body = new TextEncoder().encode(file.text);
        if (body.byteLength !== file.sizeBytes || await bodySha(body) !== file.blobSha) return null;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: context(this.scope, file.blobSha, file.sizeBytes) }, key, body);
        return { id: `${this.scope}:${file.blobSha}`, scope: this.scope, blobSha: file.blobSha, sizeBytes: file.sizeBytes, iv, ciphertext, savedAt: Date.now() };
      }));
      await this.storage.write(records.filter((record): record is HealthCachedBlob => record !== null));
    }, undefined);
  }
  clear(): Promise<void> {
    const next = this.queue.then(() => this.storage.clear(this.scope));
    this.queue = next.catch(() => undefined);
    return next;
  }
}

/** CryptoKeys are non-extractable and structured-cloned by IndexedDB, never stored as plaintext key strings. */
export class IndexedHealthCacheStorage implements HealthCacheStorage {
  private database?: Promise<IDBDatabase>;
  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open("nexus-health-encrypted-cache-v1", 1);
      let finished = false;
      const timeout = setTimeout(() => { finished = true; reject(new Error("HEALTH_CACHE_UNAVAILABLE")); }, 1500);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("keys");
        request.result.createObjectStore("blobs", { keyPath: "id" }).createIndex("scope", "scope");
      };
      request.onerror = request.onblocked = () => { clearTimeout(timeout); finished = true; reject(new Error("HEALTH_CACHE_UNAVAILABLE")); };
      request.onsuccess = () => {
        clearTimeout(timeout);
        if (finished) { request.result.close(); return; }
        finished = true; request.result.onversionchange = () => request.result.close(); resolve(request.result);
      };
    });
    return this.database;
  }
  async key(scope: string): Promise<CryptoKey> {
    const database = await this.open();
    const candidate = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("keys", "readwrite");
      const store = transaction.objectStore("keys");
      const get = store.get(scope);
      let key: CryptoKey;
      get.onsuccess = () => { key = get.result ?? candidate; if (!get.result) store.add(candidate, scope); };
      transaction.oncomplete = () => resolve(key);
      transaction.onerror = transaction.onabort = () => reject(new Error("HEALTH_CACHE_UNAVAILABLE"));
    });
  }
  async read(ids: string[]) {
    const database = await this.open();
    return new Promise<(HealthCachedBlob | undefined)[]>((resolve, reject) => {
      const transaction = database.transaction("blobs", "readonly");
      const reads = ids.map(id => transaction.objectStore("blobs").get(id));
      transaction.oncomplete = () => resolve(reads.map(request => request.result));
      transaction.onerror = transaction.onabort = () => reject(new Error("HEALTH_CACHE_UNAVAILABLE"));
    });
  }
  async write(records: HealthCachedBlob[]) {
    const database = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("blobs", "readwrite");
      const store = transaction.objectStore("blobs");
      for (const record of records) store.put(record);
      // Keep the cache rebuildable and bounded, including obsolete record versions.
      const request = store.openCursor();
      let count = 0;
      let bytes = 0;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const entry = cursor.value as HealthCachedBlob;
        bytes += entry.ciphertext.byteLength;
        if (Date.now() - entry.savedAt > MAX_AGE || ++count > 2500 || bytes > 16 * 1024 * 1024) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(new Error("HEALTH_CACHE_UNAVAILABLE"));
    });
  }
  async remove(ids: string[]) {
    const database = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("blobs", "readwrite");
      ids.forEach(id => transaction.objectStore("blobs").delete(id));
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(new Error("HEALTH_CACHE_UNAVAILABLE"));
    });
  }
  async clear(scope: string) {
    const database = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(["blobs", "keys"], "readwrite");
      transaction.objectStore("keys").delete(scope);
      const request = transaction.objectStore("blobs").index("scope").openCursor(IDBKeyRange.only(scope));
      request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } };
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(new Error("HEALTH_CACHE_UNAVAILABLE"));
    });
  }
}
