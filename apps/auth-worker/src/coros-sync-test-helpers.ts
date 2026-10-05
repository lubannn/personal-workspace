import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import type { D1DatabaseLike } from "./auth";
import type { CorosConnectionEnv } from "./coros-connection";
import { initialSyncProgress, parseSyncProgress, type SyncProgress } from "./coros-sync-state";

export const SYNC_TEST_NOW = "2024-02-01T04:00:00.000Z";
export const SYNC_TEST_ORIGIN = "https://workspace.example";
export const SYNC_TEST_USER = "42";

/** Executes the production SQL on SQLite rather than mocking SQL strings. */
export function syncTestDatabase(snapshot?: Buffer) {
  const sqlite = new Database(snapshot ?? ":memory:");
  for (const filename of snapshot ? [] : ["0002_coros_connections.sql", "0003_coros_sync_jobs.sql", "0004_coros_daily_requests.sql"]) {
    sqlite.exec(readFileSync(new URL(`../migrations/${filename}`, import.meta.url), "utf8"));
  }
  const db: D1DatabaseLike = { prepare(query) {
    const statement = sqlite.prepare(query); let bindings: Record<string, unknown> = {};
    return {
      bind(...values) { bindings = Object.fromEntries(values.map((value, index) => [String(index + 1), value])); return this; },
      async first<T>() { return (statement.get(bindings) as T | undefined) ?? null; },
      async run() { const result = statement.run(bindings); return { success: true, meta: { changes: result.changes } }; },
    };
  } };
  const env: CorosConnectionEnv = { DB: db, TOKEN_ENCRYPTION_KEY: "test-encryption-key", SESSION_HMAC_KEY: "test-hmac-key",
    GITHUB_CLIENT_ID: "test-client", GITHUB_CLIENT_SECRET: "test-client-secret", GITHUB_APP_ID: "123",
    GITHUB_APP_INSTALLATION_ID: "456", GITHUB_APP_PRIVATE_KEY: "test-private-key", COROS_GITHUB_USER_ID: SYNC_TEST_USER,
    COROS_SYNC_TIMEZONE: "Asia/Shanghai", COROS_WORKSPACE_OWNER_ID: "test-owner", ALLOWED_GITHUB_LOGIN: "example-owner", ALLOWED_REPO_OWNER: "example-owner", ALLOWED_REPO_NAME: "private-data",
    COROS_MCP_RESOURCE_URL: "https://mcpcn.coros.com/mcp", COROS_CALLBACK_ORIGIN: SYNC_TEST_ORIGIN };
  function connection(state: "enabled" | "paused" = "enabled") {
    sqlite.prepare(`INSERT INTO coros_connections (github_user_id, client_id, redirect_uri, resource_url, encrypted_refresh_token,
      scope, state, connected_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(SYNC_TEST_USER,
      "test-client", `${SYNC_TEST_ORIGIN}/coros/callback`, "https://mcpcn.coros.com/mcp", "encrypted-test-only", "mcp.tools", state, SYNC_TEST_NOW, SYNC_TEST_NOW);
  }
  function job(progress = initialSyncProgress("2024-01-01", "Asia/Shanghai")) {
    progress.request ??= { sequence: 1, through: "2024-02-01" };
    progress.backfillEnd ??= "2024-02-01";
    for (const domain of ["sleep", "workout"] as const) {
      if (progress.domains[domain].lastRecentAt && !progress.domains[domain].recentNext) progress.domains[domain].recentRequestSequence ??= 1;
    }
    sqlite.prepare("INSERT INTO coros_sync_jobs (github_user_id, progress_json, next_run_at, updated_at, request_seq, requested_through) VALUES (?, ?, ?, ?, 1, '2024-02-01')")
      .run(SYNC_TEST_USER, JSON.stringify(progress), SYNC_TEST_NOW, SYNC_TEST_NOW);
  }
  function saved() {
    const row = sqlite.prepare("SELECT * FROM coros_sync_jobs WHERE github_user_id = ?").get(SYNC_TEST_USER) as {
      progress_json: string; next_run_at: string; lease_token: string | null; lease_until: string | null; request_seq: number; requested_through: string | null; daily_requested_date: string | null;
    } | undefined;
    return row ? { ...row, progress: parseSyncProgress(row.progress_json) } : null;
  }
  function saveProgress(progress: SyncProgress) {
    sqlite.prepare("UPDATE coros_sync_jobs SET progress_json = ? WHERE github_user_id = ?").run(JSON.stringify(progress), SYNC_TEST_USER);
  }
  return { sqlite, db, env, connection, job, saved, saveProgress };
}
