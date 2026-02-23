-- Extended seed: more classes, students, assignments with dates for calendar.
-- Run after schema.sql, seed.sql, and attendance.sql (and due-at.sql if you use due_at).
-- Safe to run multiple times: uses INSERT that may conflict on serials; adjust if needed.

-- More courses
INSERT INTO courses (name) VALUES
  ('History 6'),
  ('Art 6')
ON CONFLICT DO NOTHING;

-- More class sections (use existing teachers; course_id 4,5 if above inserted as 4,5)
INSERT INTO class_sections (course_id, teacher_id, school_year, section_code)
SELECT 4, 2, '2024-2025', 'A' WHERE EXISTS (SELECT 1 FROM courses WHERE id = 4);
INSERT INTO class_sections (course_id, teacher_id, school_year, section_code)
SELECT 5, 3, '2024-2025', 'A' WHERE EXISTS (SELECT 1 FROM courses WHERE id = 5);

-- More students (10–24)
INSERT INTO students (first_name, last_name, grade_level) VALUES
  ('Isabella', 'Jackson', 6),
  ('Lucas', 'White', 6),
  ('Mia', 'Harris', 6),
  ('Oliver', 'Clark', 6),
  ('Charlotte', 'Lewis', 6),
  ('Elijah', 'Robinson', 6),
  ('Amelia', 'Walker', 6),
  ('Benjamin', 'Hall', 6),
  ('Harper', 'Allen', 6),
  ('Henry', 'Young', 6),
  ('Evelyn', 'King', 6),
  ('Alexander', 'Wright', 6),
  ('Abigail', 'Scott', 6),
  ('Sebastian', 'Green', 6),
  ('Ella', 'Baker', 6);

-- Enrollments: spread students across classes (class_section_id 1–5 if all exist)
-- Math 6 (1): 1,2,3 + 10,11,12
INSERT INTO enrollments (student_id, class_section_id) VALUES (10, 1), (11, 1), (12, 1) ON CONFLICT (student_id, class_section_id) DO NOTHING;
-- English 6 (2): 4,5,6 + 13,14
INSERT INTO enrollments (student_id, class_section_id) VALUES (13, 2), (14, 2) ON CONFLICT (student_id, class_section_id) DO NOTHING;
-- Science 6 (3): 7,8,9 + 15,16
INSERT INTO enrollments (student_id, class_section_id) VALUES (15, 3), (16, 3) ON CONFLICT (student_id, class_section_id) DO NOTHING;
-- History 6 (4): 10,11,13,15
INSERT INTO enrollments (student_id, class_section_id) VALUES (10, 4), (11, 4), (13, 4), (15, 4) ON CONFLICT (student_id, class_section_id) DO NOTHING;
-- Art 6 (5): 12,14,16
INSERT INTO enrollments (student_id, class_section_id) VALUES (12, 5), (14, 5), (16, 5) ON CONFLICT (student_id, class_section_id) DO NOTHING;

-- Assignments with due dates in 2025 for calendar (events)
-- Class 1 (Math 6)
INSERT INTO assignments (class_section_id, title, description, due_date, due_at, max_points, category) VALUES
  (1, 'Quiz Ch.2', 'Decimals', '2025-01-10', '2025-01-10T23:59:00Z', 20, 'quiz'),
  (1, 'Homework 5', 'Fractions', '2025-01-15', '2025-01-15T23:59:00Z', 10, 'homework'),
  (1, 'Midterm', 'Ch 1–3', '2025-01-25', '2025-01-25T23:59:00Z', 50, 'exam'),
  (1, 'Homework 6', 'Word problems', '2025-02-05', '2025-02-05T23:59:00Z', 10, 'homework'),
  (1, 'Quiz Ch.4', 'Percent', '2025-02-14', '2025-02-14T23:59:00Z', 20, 'quiz'),
  (1, 'Project 1', 'Report', '2025-02-28', '2025-02-28T23:59:00Z', 30, 'project');
-- Class 2 (English 6)
INSERT INTO assignments (class_section_id, title, description, due_date, due_at, max_points, category) VALUES
  (2, 'Essay 1', 'Narrative', '2025-01-12', '2025-01-12T23:59:00Z', 25, 'essay'),
  (2, 'Reading Log', 'Week 2', '2025-01-20', '2025-01-20T23:59:00Z', 10, 'homework'),
  (2, 'Essay 2', 'Argument', '2025-02-10', '2025-02-10T23:59:00Z', 30, 'essay'),
  (2, 'Presentation', 'Book talk', '2025-02-20', '2025-02-20T23:59:00Z', 25, 'project');
-- Class 3 (Science 6)
INSERT INTO assignments (class_section_id, title, description, due_date, due_at, max_points, category) VALUES
  (3, 'Lab 2', 'Cells', '2025-01-14', '2025-01-14T23:59:00Z', 25, 'lab'),
  (3, 'Quiz Ecology', 'Ecosystems', '2025-01-22', '2025-01-22T23:59:00Z', 15, 'quiz'),
  (3, 'Lab 3', 'Dissection', '2025-02-07', '2025-02-07T23:59:00Z', 30, 'lab'),
  (3, 'Test Unit 2', 'Ch 4–6', '2025-02-18', '2025-02-18T23:59:00Z', 40, 'exam');
-- Class 4 (History 6) – only if section exists
INSERT INTO assignments (class_section_id, title, description, due_date, due_at, max_points, category)
SELECT 4, 'Map Project', 'Ancient Rome', '2025-01-18', '2025-01-18T23:59:00Z', 20, 'project'
WHERE EXISTS (SELECT 1 FROM class_sections WHERE id = 4);
INSERT INTO assignments (class_section_id, title, description, due_date, due_at, max_points, category)
SELECT 4, 'Essay Rome', 'Fall of Rome', '2025-02-12', '2025-02-12T23:59:00Z', 25, 'essay'
WHERE EXISTS (SELECT 1 FROM class_sections WHERE id = 4);
-- Class 5 (Art 6)
INSERT INTO assignments (class_section_id, title, description, due_date, due_at, max_points, category)
SELECT 5, 'Sketchbook 1', 'Portraits', '2025-01-25', '2025-01-25T23:59:00Z', 15, 'project'
WHERE EXISTS (SELECT 1 FROM class_sections WHERE id = 5);
INSERT INTO assignments (class_section_id, title, description, due_date, due_at, max_points, category)
SELECT 5, 'Final Piece', 'Theme', '2025-02-25', '2025-02-25T23:59:00Z', 40, 'project'
WHERE EXISTS (SELECT 1 FROM class_sections WHERE id = 5);
