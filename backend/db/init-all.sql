-- Full database init: run this once if tables are missing or broken.
-- Requires: PostgreSQL database (e.g. lms_school) already created.
-- Order: Run schema.sql and seed.sql first, then this file in pgAdmin Query Tool.
-- Or: psql -d lms_school -f schema.sql && psql -d lms_school -f seed.sql && psql -d lms_school -f init-all.sql

-- Additional columns and tables (idempotent)
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_classes_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_assignments_at TIMESTAMPTZ;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'homework';
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;
ALTER TABLE class_sections ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
UPDATE class_sections SET created_at = NOW() - interval '1 year' WHERE created_at IS NULL;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
UPDATE assignments SET created_at = NOW() - interval '1 year' WHERE created_at IS NULL;
ALTER TABLE grades ADD COLUMN IF NOT EXISTS feedback TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS inactive BOOLEAN DEFAULT false;

-- 3. Submissions
CREATE TABLE IF NOT EXISTS submissions (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  body_text TEXT,
  UNIQUE(assignment_id, student_id)
);
CREATE TABLE IF NOT EXISTS submission_files (
  id SERIAL PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  size_bytes INTEGER DEFAULT 0
);

-- 4. Category weights
CREATE TABLE IF NOT EXISTS class_category_weights (
  class_section_id INTEGER NOT NULL REFERENCES class_sections(id) ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL,
  weight_percent NUMERIC(5,2) NOT NULL CHECK (weight_percent >= 0 AND weight_percent <= 100),
  PRIMARY KEY (class_section_id, category)
);

-- 5. Attendance
CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  class_section_id INTEGER NOT NULL REFERENCES class_sections(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'absent', 'tardy', 'excused')),
  noted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(class_section_id, student_id, date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_class_date ON attendance(class_section_id, date);
