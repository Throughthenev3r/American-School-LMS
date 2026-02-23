-- Calendar events (teacher-created)
CREATE TABLE IF NOT EXISTS calendar_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  event_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Event -> Class(s) (many-to-many)
CREATE TABLE IF NOT EXISTS calendar_event_classes (
  event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  class_section_id INTEGER NOT NULL REFERENCES class_sections(id),
  PRIMARY KEY (event_id, class_section_id)
);

-- Event attachments
CREATE TABLE IF NOT EXISTS calendar_event_attachments (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  size_bytes INTEGER DEFAULT 0
);
