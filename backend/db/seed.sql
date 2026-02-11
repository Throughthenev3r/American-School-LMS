-- Seed data: 3 classes, students, teachers
-- Run once after schema.sql

-- Courses
INSERT INTO courses (name) VALUES
  ('Math 6'),
  ('English 6'),
  ('Science 6');

-- Teachers (3 teachers)
INSERT INTO teachers (first_name, last_name) VALUES
  ('Sarah', 'Johnson'),
  ('Michael', 'Davis'),
  ('Emily', 'Wilson');

-- Class sections (3 classes for 2024-2025)
INSERT INTO class_sections (course_id, teacher_id, school_year, section_code) VALUES
  (1, 1, '2024-2025', 'A'),
  (2, 2, '2024-2025', 'A'),
  (3, 3, '2024-2025', 'A');

-- Students (9 students)
INSERT INTO students (first_name, last_name, grade_level) VALUES
  ('James', 'Smith', 6),
  ('Emma', 'Brown', 6),
  ('Liam', 'Jones', 6),
  ('Olivia', 'Garcia', 6),
  ('Noah', 'Martinez', 6),
  ('Ava', 'Anderson', 6),
  ('Ethan', 'Taylor', 6),
  ('Sophia', 'Thomas', 6),
  ('Mason', 'Moore', 6);

-- Enrollments (3 students per class)
INSERT INTO enrollments (student_id, class_section_id) VALUES
  (1, 1), (2, 1), (3, 1),
  (4, 2), (5, 2), (6, 2),
  (7, 3), (8, 3), (9, 3);

-- Sample assignments
INSERT INTO assignments (class_section_id, title, description, due_date, max_points) VALUES
  (1, 'Chapter 1 Quiz', 'Fractions and decimals', '2024-09-15', 20),
  (1, 'Homework 2', 'Word problems', '2024-09-20', 10),
  (2, 'Reading Response', 'Essay on chapter 1', '2024-09-18', 25),
  (3, 'Lab Report 1', 'Scientific method', '2024-09-22', 30);
