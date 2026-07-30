CREATE TABLE IF NOT EXISTS tts_audio (
  audio_key TEXT PRIMARY KEY,
  audio_data BLOB NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'audio/mpeg',
  byte_length INTEGER NOT NULL DEFAULT 0,
  voice TEXT NOT NULL,
  lesson_date TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tts_audio_lesson
  ON tts_audio(lesson_date, lesson_id, voice);

CREATE INDEX IF NOT EXISTS idx_tts_audio_updated_at
  ON tts_audio(updated_at);
