CREATE TABLE IF NOT EXISTS coros_oauth_attempts (
  state_hash TEXT PRIMARY KEY,
  github_user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  encrypted_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  resource_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_coros_oauth_attempts_user
  ON coros_oauth_attempts (github_user_id, expires_at);

CREATE TABLE IF NOT EXISTS coros_connections (
  github_user_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  resource_url TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  scope TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('paused', 'enabled')),
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_sync_at TEXT,
  last_error_code TEXT
);
