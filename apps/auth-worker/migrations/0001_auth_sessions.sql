CREATE TABLE auth_sessions (
  session_id_hash TEXT PRIMARY KEY,
  github_user_id TEXT NOT NULL,
  github_login TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  access_token_expires_at TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  device_name TEXT
);

CREATE INDEX auth_sessions_user_active_idx
  ON auth_sessions (github_user_id, revoked_at, expires_at);

CREATE INDEX auth_sessions_expiry_idx
  ON auth_sessions (expires_at);
