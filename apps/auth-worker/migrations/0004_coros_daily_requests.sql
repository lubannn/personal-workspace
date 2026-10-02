-- Request queue is separate from progress_json: login never overwrites a worker's lease/progress.
ALTER TABLE coros_sync_jobs ADD COLUMN request_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coros_sync_jobs ADD COLUMN requested_through TEXT;
ALTER TABLE coros_sync_jobs ADD COLUMN daily_requested_date TEXT;
-- Existing jobs wait for the next authenticated login or explicit refresh to start a daily cycle.
