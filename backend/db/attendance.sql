-- Attendance: teacher marks present/absent/tardy per class per date.
-- Run once in pgAdmin after schema.sql.

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
