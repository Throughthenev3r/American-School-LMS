-- LMS Schema for American School
-- Run this in pgAdmin: Tools → Query Tool → paste → Execute (F5)

-- Users (for future login; MVP can work without auth)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'teacher', 'student'))
);

-- Students
CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  grade_level INTEGER NOT NULL
);

-- Teachers
CREATE TABLE IF NOT EXISTS teachers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL
);

-- Courses (e.g. Math 6, English 6)
CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL
);

-- Class sections: a specific class in a school year (e.g. Math 6 Section A 2024-2025)
CREATE TABLE IF NOT EXISTS class_sections (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  school_year VARCHAR(20) NOT NULL,
  section_code VARCHAR(10) NOT NULL
);

-- Enrollments: which students are in which class
CREATE TABLE IF NOT EXISTS enrollments (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id),
  class_section_id INTEGER NOT NULL REFERENCES class_sections(id),
  UNIQUE(student_id, class_section_id)
);

-- Assignments (homework, tests)
CREATE TABLE IF NOT EXISTS assignments (
  id SERIAL PRIMARY KEY,
  class_section_id INTEGER NOT NULL REFERENCES class_sections(id),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  due_date DATE,
  due_at TIMESTAMPTZ,
  max_points INTEGER DEFAULT 100
);

-- Grades
CREATE TABLE IF NOT EXISTS grades (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  score INTEGER NOT NULL,
  graded_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(assignment_id, student_id)
);

-- Attachments for assignments (file uploads)
CREATE TABLE IF NOT EXISTS assignment_attachments (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  size_bytes INTEGER DEFAULT 0
);

-- Syllabus files for classes
CREATE TABLE IF NOT EXISTS class_syllabus (
  id SERIAL PRIMARY KEY,
  class_section_id INTEGER NOT NULL REFERENCES class_sections(id) ON DELETE CASCADE,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  size_bytes INTEGER DEFAULT 0
);

-- Announcements (school-wide notices)
CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title VARCHAR(200) NOT NULL,
  body TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
