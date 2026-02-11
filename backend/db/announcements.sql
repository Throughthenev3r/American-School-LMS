-- Announcements for school-wide notices
-- Run in pgAdmin after schema.sql

CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title VARCHAR(200) NOT NULL,
  body TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
