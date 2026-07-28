CREATE TABLE IF NOT EXISTS cloud_profiles (
  profile_id TEXT PRIMARY KEY,
  progress_json TEXT NOT NULL DEFAULT '{}',
  voice_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cloud_profiles_updated_at
  ON cloud_profiles(updated_at);
