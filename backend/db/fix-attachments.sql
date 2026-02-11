-- Создать недостающие таблицы (ошибка "отношение отсутствует")
-- Выполнить в pgAdmin: Query Tool → вставить весь текст → F5
-- Или: psql -U postgres -d lms_school -f fix-attachments.sql

-- 1. Вложения к заданиям
CREATE TABLE IF NOT EXISTS assignment_attachments (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  size_bytes INTEGER DEFAULT 0
);

-- 2. Syllabus для классов
CREATE TABLE IF NOT EXISTS class_syllabus (
  id SERIAL PRIMARY KEY,
  class_section_id INTEGER NOT NULL REFERENCES class_sections(id) ON DELETE CASCADE,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  size_bytes INTEGER DEFAULT 0
);

-- 3. Объявления (announcements)
CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title VARCHAR(200) NOT NULL,
  body TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
