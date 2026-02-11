-- Attachments for assignments
-- Run in pgAdmin after schema.sql

CREATE TABLE IF NOT EXISTS assignment_attachments (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  size_bytes INTEGER DEFAULT 0
);
