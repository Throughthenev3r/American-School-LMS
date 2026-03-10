-- AI assistant: log of student questions for analytics
-- Run after document-chunks.sql
CREATE TABLE IF NOT EXISTS ai_ask_log (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id),
  question TEXT NOT NULL,
  answer_summary TEXT,
  chunk_ids INTEGER[],
  topics TEXT[],
  intent VARCHAR(32) DEFAULT 'question_about_material',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_ask_log_student ON ai_ask_log(student_id);
CREATE INDEX IF NOT EXISTS idx_ai_ask_log_created ON ai_ask_log(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_ask_log_intent ON ai_ask_log(intent);
