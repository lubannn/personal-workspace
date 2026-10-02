-- Operational cursors only. Canonical health records remain in the private Git repository.
CREATE TABLE IF NOT EXISTS coros_sync_jobs (
  github_user_id TEXT PRIMARY KEY,
  progress_json TEXT NOT NULL,
  lease_token TEXT,
  lease_until TEXT,
  next_run_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
