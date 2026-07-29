CREATE TABLE IF NOT EXISTS google_sheets_snapshots (
  cache_key TEXT PRIMARY KEY,
  snapshot_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  lesson_count INTEGER NOT NULL DEFAULT 0,
  source_updated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_google_sheets_snapshots_updated_at
  ON google_sheets_snapshots(updated_at);
