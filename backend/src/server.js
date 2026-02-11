import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, true),
});

const { Pool } = pkg;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@localhost:5432/lms_school',
});

// --- US school grading: letter grade from percentage ---
const LETTER_GRADES = [
  [90, 'A'], [80, 'B'], [70, 'C'], [60, 'D'], [0, 'F'],
];
function percentToLetter(percent) {
  if (percent == null || Number.isNaN(percent)) return null;
  const p = Number(percent);
  for (const [min, letter] of LETTER_GRADES) {
    if (p >= min) return letter;
  }
  return 'F';
}

// Compute final percent for one student: assignments (id, category, max_points), gradeMap { 'studentId-assignmentId': score }, weights { category: weightPercent }
function computeFinalPercent(assignments, gradeMap, weights, studentId) {
  if (!assignments.length) return null;
  const hasWeights = weights && Object.keys(weights).length > 0 && Object.values(weights).some(w => Number(w) > 0);
  if (hasWeights) {
    const byCategory = {};
    assignments.forEach(a => {
      const cat = (a.category || 'homework').toLowerCase();
      if (!byCategory[cat]) byCategory[cat] = { earned: 0, possible: 0 };
      const score = gradeMap[`${studentId}-${a.id}`];
      const max = Number(a.max_points) || 100;
      byCategory[cat].possible += max;
      if (score != null && !Number.isNaN(Number(score))) byCategory[cat].earned += Number(score);
    });
    let weightedSum = 0;
    let totalWeight = 0;
    for (const [cat, w] of Object.entries(weights)) {
      const wNum = Number(w);
      if (wNum <= 0) continue;
      totalWeight += wNum;
      const c = byCategory[cat.toLowerCase()];
      const pct = c && c.possible > 0 ? (100 * c.earned / c.possible) : null;
      weightedSum += pct != null ? (pct * wNum / 100) : 0;
    }
    if (totalWeight > 0) return totalWeight >= 99 ? weightedSum : (weightedSum / totalWeight * 100);
  }
  let earned = 0, possible = 0;
  assignments.forEach(a => {
    const score = gradeMap[`${studentId}-${a.id}`];
    const max = Number(a.max_points) || 100;
    possible += max;
    if (score != null && !Number.isNaN(Number(score))) earned += Number(score);
  });
  if (possible <= 0) return null;
  return (100 * earned / possible);
}

// Проверка, что сервер живой (БД не нужна)
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', msg: 'Server is running' });
});

// --- Auth: middleware (читает токен из заголовка Authorization) ---
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// --- Auth: login ---
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    const { rows } = await pool.query(
      'SELECT id, email, password_hash, role FROM users WHERE email = $1',
      [email]
    );
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    // teacher/student: достаём id из таблиц teachers/students
    let teacherId = null;
    let studentId = null;
    if (user.role === 'teacher') {
      const t = await pool.query('SELECT id FROM teachers WHERE user_id = $1', [user.id]);
      teacherId = t.rows[0]?.id ?? null;
    }
    if (user.role === 'student') {
      const s = await pool.query('SELECT id FROM students WHERE user_id = $1', [user.id]);
      studentId = s.rows[0]?.id ?? null;
    }
    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
      teacherId,
      studentId,
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: payload });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- Auth: текущий пользователь (нужен заголовок Authorization) ---
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json(req.user);
});

// --- Auth: смена пароля ---
app.put('/api/auth/change-password', authMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'current_password and new_password required' });
    }
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const ok = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is wrong' });
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- Auth: регистрация нового пользователя (admin only) ---
app.post('/api/auth/register', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { email, password, role } = req.body || {};
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'email, password, role required' });
    }
    if (!['admin', 'teacher', 'student'].includes(role)) {
      return res.status(400).json({ error: 'role must be admin, teacher, or student' });
    }
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role',
      [email, hash, role]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Email already exists' });
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- Role check: разрешает только указанные роли ---
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Forbidden: insufficient role' });
  };
}

// --- API: Dashboard stats (includes new_classes / new_assignments for nav badges) ---
app.get('/api/stats', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const [userRow] = (await pool.query(
      'SELECT last_seen_classes_at, last_seen_assignments_at FROM users WHERE id = $1',
      [userId]
    )).rows;
    const lastSeenClasses = userRow?.last_seen_classes_at || null;
    const lastSeenAssignments = userRow?.last_seen_assignments_at || null;

    if (req.user.role === 'admin') {
      const [c, s, a, newC, newA] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS n FROM class_sections'),
        pool.query('SELECT COUNT(*)::int AS n FROM students'),
        pool.query('SELECT COUNT(*)::int AS n FROM assignments'),
        lastSeenClasses
          ? pool.query('SELECT COUNT(*)::int AS n FROM class_sections WHERE created_at > $1', [lastSeenClasses])
          : Promise.resolve({ rows: [{ n: 0 }] }),
        lastSeenAssignments
          ? pool.query('SELECT COUNT(*)::int AS n FROM assignments WHERE created_at > $1', [lastSeenAssignments])
          : Promise.resolve({ rows: [{ n: 0 }] }),
      ]);
      return res.json({
        classes: c.rows[0].n,
        students: s.rows[0].n,
        assignments: a.rows[0].n,
        new_classes: newC.rows[0].n,
        new_assignments: newA.rows[0].n,
      });
    }
    if (req.user.role === 'teacher') {
      const [c, a, newC, newA] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS n FROM class_sections WHERE teacher_id = $1', [req.user.teacherId]),
        pool.query(`SELECT COUNT(*)::int AS n FROM assignments WHERE class_section_id IN (SELECT id FROM class_sections WHERE teacher_id = $1)`, [req.user.teacherId]),
        lastSeenClasses
          ? pool.query('SELECT COUNT(*)::int AS n FROM class_sections WHERE teacher_id = $1 AND created_at > $2', [req.user.teacherId, lastSeenClasses])
          : Promise.resolve({ rows: [{ n: 0 }] }),
        lastSeenAssignments
          ? pool.query(`SELECT COUNT(*)::int AS n FROM assignments WHERE class_section_id IN (SELECT id FROM class_sections WHERE teacher_id = $1) AND created_at > $2`, [req.user.teacherId, lastSeenAssignments])
          : Promise.resolve({ rows: [{ n: 0 }] }),
      ]);
      return res.json({
        classes: c.rows[0].n,
        assignments: a.rows[0].n,
        students: 0,
        new_classes: newC.rows[0].n,
        new_assignments: newA.rows[0].n,
      });
    }
    if (req.user.role === 'student') {
      const [c, a, newC, newA] = await Promise.all([
        pool.query('SELECT COUNT(DISTINCT class_section_id)::int AS n FROM enrollments WHERE student_id = $1', [req.user.studentId]),
        pool.query(`SELECT COUNT(*)::int AS n FROM assignments WHERE class_section_id IN (SELECT class_section_id FROM enrollments WHERE student_id = $1)`, [req.user.studentId]),
        lastSeenClasses
          ? pool.query(`
              SELECT COUNT(*)::int AS n FROM class_sections cs
              WHERE cs.id IN (SELECT class_section_id FROM enrollments WHERE student_id = $1)
              AND cs.created_at > $2
            `, [req.user.studentId, lastSeenClasses])
          : Promise.resolve({ rows: [{ n: 0 }] }),
        lastSeenAssignments
          ? pool.query(`
              SELECT COUNT(*)::int AS n FROM assignments a
              WHERE a.class_section_id IN (SELECT class_section_id FROM enrollments WHERE student_id = $1)
              AND a.created_at > $2
            `, [req.user.studentId, lastSeenAssignments])
          : Promise.resolve({ rows: [{ n: 0 }] }),
      ]);
      return res.json({
        classes: c.rows[0].n,
        assignments: a.rows[0].n,
        students: 0,
        new_classes: newC.rows[0].n,
        new_assignments: newA.rows[0].n,
      });
    }
    res.json({ classes: 0, students: 0, assignments: 0, new_classes: 0, new_assignments: 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- Mark "Classes" as seen (clears new_classes badge) ---
app.post('/api/me/seen-classes', authMiddleware, async (req, res) => {
  try {
    await pool.query('UPDATE users SET last_seen_classes_at = NOW() WHERE id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- Mark "Assignments" as seen (clears new_assignments badge) ---
app.post('/api/me/seen-assignments', authMiddleware, async (req, res) => {
  try {
    await pool.query('UPDATE users SET last_seen_assignments_at = NOW() WHERE id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Проверка подключения к PostgreSQL
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (e) {
    console.error('PostgreSQL error:', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// --- API: Teachers & Courses (для форм создания классов) ---
app.get('/api/teachers', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, first_name, last_name FROM teachers ORDER BY last_name');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/courses', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name FROM courses ORDER BY name');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- API: Classes (с фильтром по роли) ---
app.get('/api/classes', authMiddleware, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'admin') {
      const r = await pool.query(`
        SELECT cs.id, cs.school_year, cs.section_code, cs.teacher_id,
               c.name AS course_name, c.id AS course_id,
               t.first_name AS teacher_first, t.last_name AS teacher_last
        FROM class_sections cs
        JOIN courses c ON cs.course_id = c.id
        JOIN teachers t ON cs.teacher_id = t.id
        ORDER BY c.name
      `);
      rows = r.rows;
    } else if (req.user.role === 'teacher' && req.user.teacherId) {
      const r = await pool.query(
        `SELECT cs.id, cs.school_year, cs.section_code, cs.teacher_id,
                c.name AS course_name, c.id AS course_id,
                t.first_name AS teacher_first, t.last_name AS teacher_last
         FROM class_sections cs
         JOIN courses c ON cs.course_id = c.id
         JOIN teachers t ON cs.teacher_id = t.id
         WHERE cs.teacher_id = $1 ORDER BY c.name`,
        [req.user.teacherId]
      );
      rows = r.rows;
    } else if (req.user.role === 'student' && req.user.studentId) {
      const r = await pool.query(
        `SELECT cs.id, cs.school_year, cs.section_code,
                c.name AS course_name,
                t.first_name AS teacher_first, t.last_name AS teacher_last
         FROM class_sections cs
         JOIN courses c ON cs.course_id = c.id
         JOIN teachers t ON cs.teacher_id = t.id
         JOIN enrollments e ON e.class_section_id = cs.id AND e.student_id = $1
         ORDER BY c.name`,
        [req.user.studentId]
      );
      rows = r.rows;
    } else {
      rows = [];
    }
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- API: Update class (admin only) ---
app.put('/api/classes/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { course_id, teacher_id, school_year, section_code } = req.body || {};
    await pool.query(
      `UPDATE class_sections SET
        course_id = COALESCE($1, course_id),
        teacher_id = COALESCE($2, teacher_id),
        school_year = COALESCE($3, school_year),
        section_code = COALESCE($4, section_code)
       WHERE id = $5`,
      [course_id, teacher_id, school_year, section_code, id]
    );
    const { rows } = await pool.query('SELECT id FROM class_sections WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- API: Delete class (admin only) ---
app.delete('/api/classes/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const syllabusFiles = await pool.query('SELECT stored_filename FROM class_syllabus WHERE class_section_id = $1', [id]);
    for (const f of syllabusFiles.rows) {
      const fp = path.join(UPLOAD_DIR, f.stored_filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    await pool.query('DELETE FROM grades WHERE assignment_id IN (SELECT id FROM assignments WHERE class_section_id = $1)', [id]);
    await pool.query('DELETE FROM assignments WHERE class_section_id = $1', [id]);
    await pool.query('DELETE FROM enrollments WHERE class_section_id = $1', [id]);
    await pool.query('DELETE FROM class_syllabus WHERE class_section_id = $1', [id]);
    const r = await pool.query('DELETE FROM class_sections WHERE id = $1 RETURNING id', [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- API: Create class (admin only) ---
app.post('/api/classes', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { course_id, teacher_id, school_year, section_code } = req.body || {};
    if (!course_id || !teacher_id || !school_year || !section_code) {
      return res.status(400).json({ error: 'course_id, teacher_id, school_year, section_code required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO class_sections (course_id, teacher_id, school_year, section_code)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [course_id, teacher_id, school_year, section_code]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- API: Students in a class (teacher видит только свои классы, student — только свои) ---
app.get('/api/classes/:id/students', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    if (user.role === 'teacher' && user.teacherId) {
      const ok = await pool.query(
        'SELECT 1 FROM class_sections WHERE id = $1 AND teacher_id = $2',
        [id, user.teacherId]
      );
      if (ok.rows.length === 0) return res.status(403).json({ error: 'Not your class' });
    } else if (user.role === 'student' && user.studentId) {
      const ok = await pool.query(
        'SELECT 1 FROM enrollments WHERE class_section_id = $1 AND student_id = $2',
        [id, user.studentId]
      );
      if (ok.rows.length === 0) return res.status(403).json({ error: 'Not enrolled' });
    }
    const { rows } = await pool.query(
      `SELECT s.id, s.first_name, s.last_name, s.grade_level
       FROM students s
       JOIN enrollments e ON s.id = e.student_id
       WHERE e.class_section_id = $1
       ORDER BY s.last_name, s.first_name`,
      [id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- API: All students (admin — все, teacher — только в своих классах) ---
app.get('/api/students', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'admin') {
      const r = await pool.query(
        'SELECT id, first_name, last_name, grade_level FROM students ORDER BY last_name, first_name'
      );
      rows = r.rows;
    } else {
      const r = await pool.query(
        `SELECT DISTINCT s.id, s.first_name, s.last_name, s.grade_level
         FROM students s
         JOIN enrollments e ON s.id = e.student_id
         JOIN class_sections cs ON e.class_section_id = cs.id
         WHERE cs.teacher_id = $1
         ORDER BY s.last_name, s.first_name`,
        [req.user.teacherId]
      );
      rows = r.rows;
    }
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- API: CRUD Students (admin only) ---
app.post('/api/students', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { first_name, last_name, grade_level } = req.body || {};
    if (!first_name || !last_name || grade_level == null) {
      return res.status(400).json({ error: 'first_name, last_name, grade_level required' });
    }
    const { rows } = await pool.query(
      'INSERT INTO students (first_name, last_name, grade_level) VALUES ($1, $2, $3) RETURNING id, first_name, last_name, grade_level',
      [first_name, last_name, grade_level]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/students/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, grade_level } = req.body || {};
    await pool.query(
      'UPDATE students SET first_name = COALESCE($1, first_name), last_name = COALESCE($2, last_name), grade_level = COALESCE($3, grade_level) WHERE id = $4',
      [first_name, last_name, grade_level, id]
    );
    const { rows } = await pool.query('SELECT id, first_name, last_name, grade_level FROM students WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/students/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM enrollments WHERE student_id = $1', [id]);
    await pool.query('DELETE FROM grades WHERE student_id = $1', [id]);
    const r = await pool.query('DELETE FROM students WHERE id = $1 RETURNING id', [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- API: Assignments for a class ---
app.get('/api/classes/:id/assignments', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    if (user.role === 'teacher' && user.teacherId) {
      const ok = await pool.query('SELECT 1 FROM class_sections WHERE id = $1 AND teacher_id = $2', [id, user.teacherId]);
      if (ok.rows.length === 0) return res.status(403).json({ error: 'Not your class' });
    } else if (user.role === 'student' && user.studentId) {
      const ok = await pool.query('SELECT 1 FROM enrollments WHERE class_section_id = $1 AND student_id = $2', [id, user.studentId]);
      if (ok.rows.length === 0) return res.status(403).json({ error: 'Not enrolled' });
    }
    const { rows } = await pool.query(
      `SELECT id, title, description, due_date, due_at, max_points, COALESCE(category, 'homework') AS category
       FROM assignments WHERE class_section_id = $1
       ORDER BY COALESCE(due_at, (due_date::date + time '23:59:59') AT TIME ZONE 'UTC')`,
      [id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- API: Create assignment (teacher своего класса или admin) ---
app.post('/api/classes/:id/assignments', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, due_date, due_at, max_points, category } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title required' });
    if (req.user.role === 'teacher') {
      const ok = await pool.query('SELECT 1 FROM class_sections WHERE id = $1 AND teacher_id = $2', [id, req.user.teacherId]);
      if (ok.rows.length === 0) return res.status(403).json({ error: 'Not your class' });
    }
    const dueAt = due_at || (due_date ? (due_date + 'T23:59:00.000Z') : null);
    const dueDateOnly = due_date || (dueAt ? dueAt.slice(0, 10) : null);
    const cat = (category && ['homework', 'quiz', 'test', 'project', 'participation'].includes(String(category).toLowerCase()))
      ? String(category).toLowerCase() : 'homework';
    const { rows } = await pool.query(
      `INSERT INTO assignments (class_section_id, title, description, due_date, due_at, max_points, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, title, description, due_date, due_at, max_points, category`,
      [id, title, description || null, dueDateOnly, dueAt, max_points ?? 100, cat]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- API: Update assignment (teacher своего класса или admin) ---
app.put('/api/assignments/:id', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, due_date, due_at, max_points, category } = req.body || {};
    if (req.user.role === 'teacher') {
      const cls = await pool.query('SELECT class_section_id FROM assignments WHERE id = $1', [id]);
      if (cls.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      const ok = await pool.query('SELECT 1 FROM class_sections WHERE id = $1 AND teacher_id = $2', [cls.rows[0].class_section_id, req.user.teacherId]);
      if (ok.rows.length === 0) return res.status(403).json({ error: 'Not your assignment' });
    }
    let dueAt = due_at;
    if (dueAt === undefined && due_date !== undefined)
      dueAt = due_date ? due_date + 'T23:59:00.000Z' : null;
    if (dueAt === undefined) {
      const cur = await pool.query('SELECT due_at FROM assignments WHERE id = $1', [id]);
      dueAt = cur.rows[0]?.due_at ?? null;
    }
    const cat = category !== undefined
      ? (['homework', 'quiz', 'test', 'project', 'participation'].includes(String(category).toLowerCase()) ? String(category).toLowerCase() : null)
      : null;
    await pool.query(
      `UPDATE assignments SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        due_date = COALESCE($3, due_date),
        due_at = $6::timestamptz,
        max_points = COALESCE($4, max_points),
        category = COALESCE($7, category)
       WHERE id = $5`,
      [title, description, due_date, max_points, id, dueAt, cat]
    );
    const { rows } = await pool.query('SELECT id, title, description, due_date, due_at, max_points, COALESCE(category, \'homework\') AS category FROM assignments WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- API: Enroll student in class (admin only) ---
app.post('/api/classes/:id/enrollments', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { student_id } = req.body || {};
    if (!student_id) return res.status(400).json({ error: 'student_id required' });
    await pool.query(
      'INSERT INTO enrollments (student_id, class_section_id) VALUES ($1, $2) ON CONFLICT (student_id, class_section_id) DO NOTHING',
      [student_id, id]
    );
    res.status(201).json({ enrolled: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/classes/:classId/enrollments/:studentId', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { classId, studentId } = req.params;
    await pool.query('DELETE FROM grades WHERE student_id = $1 AND assignment_id IN (SELECT id FROM assignments WHERE class_section_id = $2)', [studentId, classId]);
    const r = await pool.query('DELETE FROM enrollments WHERE student_id = $1 AND class_section_id = $2 RETURNING id', [studentId, classId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ removed: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- API: Class syllabus (admin/teacher upload, all can view) ---
async function checkClassAccess(req, classId) {
  if (req.user.role === 'admin') return { ok: true };
  if (req.user.role === 'teacher' && req.user.teacherId) {
    const ok = await pool.query('SELECT 1 FROM class_sections WHERE id = $1 AND teacher_id = $2', [classId, req.user.teacherId]);
    if (ok.rows.length === 0) return { ok: false, status: 403 };
    return { ok: true };
  }
  if (req.user.role === 'student' && req.user.studentId) {
    const ok = await pool.query('SELECT 1 FROM enrollments WHERE class_section_id = $1 AND student_id = $2', [classId, req.user.studentId]);
    if (ok.rows.length === 0) return { ok: false, status: 403 };
    return { ok: true };
  }
  return { ok: false, status: 403 };
}

app.get('/api/classes/:id/syllabus', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const access = await checkClassAccess(req, id);
    if (!access.ok) return res.status(access.status).json({ error: access.status === 404 ? 'Not found' : 'Forbidden' });
    const { rows } = await pool.query(
      'SELECT id, original_filename, mime_type, size_bytes FROM class_syllabus WHERE class_section_id = $1 ORDER BY id',
      [id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/classes/:id/syllabus', authMiddleware, requireRole('admin', 'teacher'), upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user.role === 'teacher') {
      const ok = await pool.query('SELECT 1 FROM class_sections WHERE id = $1 AND teacher_id = $2', [id, req.user.teacherId]);
      if (ok.rows.length === 0) return res.status(403).json({ error: 'Not your class' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { rows } = await pool.query(
      'INSERT INTO class_syllabus (class_section_id, original_filename, stored_filename, mime_type, size_bytes) VALUES ($1, $2, $3, $4, $5) RETURNING id, original_filename, mime_type, size_bytes',
      [id, req.file.originalname, req.file.filename, req.file.mimetype || null, req.file.size || 0]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/classes/:classId/syllabus/:fileId/download', authMiddleware, async (req, res) => {
  try {
    const { classId, fileId } = req.params;
    const access = await checkClassAccess(req, classId);
    if (!access.ok) return res.status(access.status).json({ error: access.status === 404 ? 'Not found' : 'Forbidden' });
    const { rows } = await pool.query(
      'SELECT cs.* FROM class_syllabus cs WHERE cs.id = $1 AND cs.class_section_id = $2',
      [fileId, classId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const att = rows[0];
    const filePath = path.join(UPLOAD_DIR, att.stored_filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(att.original_filename)}"`);
    if (att.mime_type) res.setHeader('Content-Type', att.mime_type);
    res.sendFile(path.resolve(filePath));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/classes/:classId/syllabus/:fileId', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { classId, fileId } = req.params;
    if (req.user.role === 'teacher') {
      const ok = await pool.query('SELECT 1 FROM class_sections WHERE id = $1 AND teacher_id = $2', [classId, req.user.teacherId]);
      if (ok.rows.length === 0) return res.status(403).json({ error: 'Not your class' });
    }
    const { rows } = await pool.query('SELECT stored_filename FROM class_syllabus WHERE id = $1 AND class_section_id = $2', [fileId, classId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const fp = path.join(UPLOAD_DIR, rows[0].stored_filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    await pool.query('DELETE FROM class_syllabus WHERE id = $1', [fileId]);
    res.json({ deleted: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- API: Grades for assignment (teacher/admin) ---
app.get('/api/assignments/:id/grades', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    const asn = await pool.query('SELECT a.*, cs.teacher_id FROM assignments a JOIN class_sections cs ON a.class_section_id = cs.id WHERE a.id = $1', [id]);
    if (asn.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'teacher' && asn.rows[0].teacher_id !== req.user.teacherId) {
      return res.status(403).json({ error: 'Not your assignment' });
    }
    const { rows } = await pool.query(
      `SELECT s.id AS student_id, g.score, s.first_name, s.last_name
       FROM enrollments e
       JOIN students s ON e.student_id = s.id
       LEFT JOIN grades g ON g.student_id = s.id AND g.assignment_id = $1
       WHERE e.class_section_id = (SELECT class_section_id FROM assignments WHERE id = $1)
       ORDER BY s.last_name, s.first_name`,
      [id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- API: Set grade (teacher/admin) ---
app.put('/api/grades', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const body = req.body || {};
    const assignment_id = body.assignment_id != null ? Number(body.assignment_id) : null;
    const student_id = body.student_id != null ? Number(body.student_id) : null;
    const score = body.score != null ? Number(body.score) : null;
    if (!assignment_id || !student_id || score == null || isNaN(assignment_id) || isNaN(student_id) || isNaN(score)) {
      return res.status(400).json({
        error: 'assignment_id, student_id, score required',
        received: { assignment_id: body.assignment_id, student_id: body.student_id, score: body.score },
      });
    }
    const asn = await pool.query('SELECT class_section_id FROM assignments WHERE id = $1', [assignment_id]);
    if (asn.rows.length === 0) return res.status(404).json({ error: 'Assignment not found' });
    const cs = await pool.query('SELECT teacher_id FROM class_sections WHERE id = $1', [asn.rows[0].class_section_id]);
    if (req.user.role === 'teacher' && cs.rows[0].teacher_id !== req.user.teacherId) {
      return res.status(403).json({ error: 'Not your class' });
    }
    await pool.query(
      `INSERT INTO grades (assignment_id, student_id, score) VALUES ($1, $2, $3)
       ON CONFLICT (assignment_id, student_id) DO UPDATE SET score = $3, graded_at = NOW()`,
      [assignment_id, student_id, Number(score)]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- API: Category weights for class (admin/teacher) ---
app.get('/api/classes/:id/category-weights', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user.role === 'teacher') {
      const ok = await pool.query('SELECT 1 FROM class_sections WHERE id = $1 AND teacher_id = $2', [id, req.user.teacherId]);
      if (ok.rows.length === 0) return res.status(403).json({ error: 'Not your class' });
    }
    const { rows } = await pool.query(
      'SELECT category, weight_percent FROM class_category_weights WHERE class_section_id = $1',
      [id]
    );
    const weights = {};
    rows.forEach((r) => { weights[r.category] = Number(r.weight_percent); });
    res.json(weights);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/classes/:id/category-weights', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    const weights = req.body || {};
    if (req.user.role === 'teacher') {
      const ok = await pool.query('SELECT 1 FROM class_sections WHERE id = $1 AND teacher_id = $2', [id, req.user.teacherId]);
      if (ok.rows.length === 0) return res.status(403).json({ error: 'Not your class' });
    }
    await pool.query('DELETE FROM class_category_weights WHERE class_section_id = $1', [id]);
    const cats = ['homework', 'quiz', 'test', 'project', 'participation'];
    for (const cat of cats) {
      const w = weights[cat];
      if (w != null && !Number.isNaN(Number(w)) && Number(w) > 0) {
        await pool.query(
          'INSERT INTO class_category_weights (class_section_id, category, weight_percent) VALUES ($1, $2, $3)',
          [id, cat, Math.min(100, Math.max(0, Number(w)))]
        );
      }
    }
    const { rows } = await pool.query('SELECT category, weight_percent FROM class_category_weights WHERE class_section_id = $1', [id]);
    const out = {};
    rows.forEach((r) => { out[r.category] = Number(r.weight_percent); });
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- API: Full gradebook for class (admin/teacher) ---
app.get('/api/classes/:id/gradebook', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user.role === 'teacher') {
      const ok = await pool.query('SELECT 1 FROM class_sections WHERE id = $1 AND teacher_id = $2', [id, req.user.teacherId]);
      if (ok.rows.length === 0) return res.status(403).json({ error: 'Not your class' });
    }
    const [studentsRes, assignmentsRes, gradesRes, weightsRes] = await Promise.all([
      pool.query(
        `SELECT s.id, s.first_name, s.last_name FROM enrollments e JOIN students s ON e.student_id = s.id WHERE e.class_section_id = $1 ORDER BY s.last_name, s.first_name`,
        [id]
      ),
      pool.query(
        `SELECT id, title, max_points, COALESCE(category, 'homework') AS category FROM assignments WHERE class_section_id = $1 ORDER BY due_date`,
        [id]
      ),
      pool.query(
        `SELECT student_id, assignment_id, score FROM grades WHERE assignment_id IN (SELECT id FROM assignments WHERE class_section_id = $1)`,
        [id]
      ),
      pool.query('SELECT category, weight_percent FROM class_category_weights WHERE class_section_id = $1', [id]),
    ]);
    const gradeMap = {};
    gradesRes.rows.forEach((g) => { gradeMap[`${g.student_id}-${g.assignment_id}`] = g.score; });
    const weights = {};
    weightsRes.rows.forEach((r) => { weights[r.category] = Number(r.weight_percent); });
    const students = studentsRes.rows.map((s) => {
      const percent = computeFinalPercent(assignmentsRes.rows, gradeMap, weights, s.id);
      return {
        ...s,
        final_percent: percent != null ? Math.round(percent * 10) / 10 : null,
        letter_grade: percentToLetter(percent),
      };
    });
    res.json({
      students,
      assignments: assignmentsRes.rows,
      gradeMap,
      category_weights: weights,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- API: Class report (averages per assignment) ---
app.get('/api/classes/:id/report', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user.role === 'teacher') {
      const ok = await pool.query('SELECT 1 FROM class_sections WHERE id = $1 AND teacher_id = $2', [id, req.user.teacherId]);
      if (ok.rows.length === 0) return res.status(403).json({ error: 'Not your class' });
    }
    const { rows } = await pool.query(
      `SELECT a.id, a.title, a.max_points, COALESCE(a.category, 'homework') AS category,
              ROUND(AVG(g.score)::numeric, 1) AS avg_score, COUNT(g.id) AS graded_count
       FROM assignments a
       LEFT JOIN grades g ON g.assignment_id = a.id
       WHERE a.class_section_id = $1
       GROUP BY a.id, a.title, a.max_points, a.category, a.due_date
       ORDER BY a.due_date`,
      [id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- Announcements ---
app.get('/api/announcements', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.title, a.body, a.created_at, u.email AS author_email
       FROM announcements a
       JOIN users u ON a.user_id = u.id
       ORDER BY a.created_at DESC
       LIMIT 20`,
      []
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/announcements', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { title, body } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title required' });
    const { rows } = await pool.query(
      'INSERT INTO announcements (user_id, title, body) VALUES ($1, $2, $3) RETURNING id, title, body, created_at',
      [req.user.id, title, body || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/announcements/:id', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user.role === 'teacher') {
      const r = await pool.query('SELECT user_id FROM announcements WHERE id = $1', [id]);
      if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      if (r.rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Can only delete your own' });
    }
    const r = await pool.query('DELETE FROM announcements WHERE id = $1 RETURNING id', [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- API: My assignments (all user's assignments with due dates) ---
app.get('/api/me/assignments', authMiddleware, async (req, res) => {
  try {
    let rows;
    const orderDue = `ORDER BY COALESCE(a.due_at, (a.due_date::date + time '23:59:59') AT TIME ZONE 'UTC')`;
    if (req.user.role === 'admin') {
      const r = await pool.query(
        `SELECT a.id, a.title, a.due_date, a.due_at, a.max_points, a.class_section_id,
                c.name AS course_name, cs.section_code
         FROM assignments a
         JOIN class_sections cs ON a.class_section_id = cs.id
         JOIN courses c ON cs.course_id = c.id
         ${orderDue}`,
        []
      );
      rows = r.rows;
    } else if (req.user.role === 'teacher') {
      const r = await pool.query(
        `SELECT a.id, a.title, a.due_date, a.due_at, a.max_points, a.class_section_id,
                c.name AS course_name, cs.section_code
         FROM assignments a
         JOIN class_sections cs ON a.class_section_id = cs.id
         JOIN courses c ON cs.course_id = c.id
         WHERE cs.teacher_id = $1
         ${orderDue}`,
        [req.user.teacherId]
      );
      rows = r.rows;
    } else {
      const r = await pool.query(
        `SELECT a.id, a.title, a.due_date, a.due_at, a.max_points, a.class_section_id,
                c.name AS course_name, cs.section_code
         FROM assignments a
         JOIN class_sections cs ON a.class_section_id = cs.id
         JOIN courses c ON cs.course_id = c.id
         JOIN enrollments e ON e.class_section_id = cs.id AND e.student_id = $1
         ${orderDue}`,
        [req.user.studentId]
      );
      rows = r.rows;
    }
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- API: My grades (student) ---
app.get('/api/me/grades', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id AS assignment_id, a.title, a.max_points, g.score, cs.id AS class_id,
              c.name AS course_name, cs.section_code, COALESCE(a.category, 'homework') AS category
       FROM enrollments e
       JOIN class_sections cs ON e.class_section_id = cs.id
       JOIN courses c ON cs.course_id = c.id
       JOIN assignments a ON a.class_section_id = cs.id
       LEFT JOIN grades g ON g.assignment_id = a.id AND g.student_id = e.student_id
       WHERE e.student_id = $1
       ORDER BY c.name, a.due_date`,
      [req.user.studentId]
    );
    const classIds = [...new Set(rows.map((r) => r.class_id))];
    const byClass = [];
    for (const classId of classIds) {
      const classRows = rows.filter((r) => r.class_id === classId);
      const assignments = classRows.map((r) => ({
        id: r.assignment_id,
        title: r.title,
        max_points: r.max_points,
        category: r.category,
      }));
      const gradeMap = {};
      classRows.forEach((r) => { gradeMap[`${req.user.studentId}-${r.assignment_id}`] = r.score; });
      const weightsRes = await pool.query('SELECT category, weight_percent FROM class_category_weights WHERE class_section_id = $1', [classId]);
      const weights = {};
      weightsRes.rows.forEach((r) => { weights[r.category] = Number(r.weight_percent); });
      const percent = computeFinalPercent(assignments, gradeMap, weights, req.user.studentId);
      byClass.push({
        class_id: classId,
        course_name: classRows[0]?.course_name,
        section_code: classRows[0]?.section_code,
        final_percent: percent != null ? Math.round(percent * 10) / 10 : null,
        letter_grade: percentToLetter(percent),
      });
    }
    res.json({ assignments: rows, by_class: byClass });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- Attachments ---
async function checkAssignmentAccess(req, assignmentId) {
  const asn = await pool.query('SELECT a.id, a.class_section_id, cs.teacher_id FROM assignments a JOIN class_sections cs ON a.class_section_id = cs.id WHERE a.id = $1', [assignmentId]);
  if (asn.rows.length === 0) return { ok: false, status: 404 };
  if (req.user.role === 'admin') return { ok: true };
  if (req.user.role === 'teacher' && asn.rows[0].teacher_id !== req.user.teacherId) return { ok: false, status: 403 };
  if (req.user.role === 'student') {
    const ok = await pool.query('SELECT 1 FROM enrollments WHERE class_section_id = $1 AND student_id = $2', [asn.rows[0].class_section_id, req.user.studentId]);
    if (ok.rows.length === 0) return { ok: false, status: 403 };
  }
  return { ok: true };
}

app.get('/api/assignments/:id/attachments', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const access = await checkAssignmentAccess(req, id);
    if (!access.ok) return res.status(access.status).json({ error: access.status === 404 ? 'Not found' : 'Forbidden' });
    const { rows } = await pool.query(
      'SELECT id, original_filename, mime_type, size_bytes FROM assignment_attachments WHERE assignment_id = $1 ORDER BY id',
      [id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/assignments/:id/attachments', authMiddleware, requireRole('admin', 'teacher'), upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const access = await checkAssignmentAccess(req, id);
    if (!access.ok) return res.status(access.status).json({ error: access.status === 404 ? 'Not found' : 'Forbidden' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { rows } = await pool.query(
      'INSERT INTO assignment_attachments (assignment_id, original_filename, stored_filename, mime_type, size_bytes) VALUES ($1, $2, $3, $4, $5) RETURNING id, original_filename, mime_type, size_bytes',
      [id, req.file.originalname, req.file.filename, req.file.mimetype || null, req.file.size || 0]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/attachments/:id/download', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query('SELECT aa.*, a.class_section_id FROM assignment_attachments aa JOIN assignments a ON a.id = aa.assignment_id WHERE aa.id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const att = rows[0];
    const access = await checkAssignmentAccess(req, att.assignment_id);
    if (!access.ok) return res.status(access.status).json({ error: access.status === 404 ? 'Not found' : 'Forbidden' });
    const filePath = path.join(UPLOAD_DIR, att.stored_filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(att.original_filename)}"`);
    if (att.mime_type) res.setHeader('Content-Type', att.mime_type);
    res.sendFile(path.resolve(filePath));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/assignments/:assignmentId/attachments/:fileId', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { assignmentId, fileId } = req.params;
    const access = await checkAssignmentAccess(req, assignmentId);
    if (!access.ok) return res.status(access.status).json({ error: access.status === 404 ? 'Not found' : 'Forbidden' });
    const { rows } = await pool.query('SELECT stored_filename FROM assignment_attachments WHERE id = $1 AND assignment_id = $2', [fileId, assignmentId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const fp = path.join(UPLOAD_DIR, rows[0].stored_filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    await pool.query('DELETE FROM assignment_attachments WHERE id = $1', [fileId]);
    res.json({ deleted: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/assignments/:id', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user.role === 'teacher') {
      const cls = await pool.query('SELECT class_section_id FROM assignments WHERE id = $1', [id]);
      if (cls.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      const ok = await pool.query('SELECT 1 FROM class_sections WHERE id = $1 AND teacher_id = $2', [cls.rows[0].class_section_id, req.user.teacherId]);
      if (ok.rows.length === 0) return res.status(403).json({ error: 'Not your assignment' });
    }
    const files = await pool.query('SELECT stored_filename FROM assignment_attachments WHERE assignment_id = $1', [id]);
    for (const f of files.rows) {
      const fp = path.join(UPLOAD_DIR, f.stored_filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    await pool.query('DELETE FROM grades WHERE assignment_id = $1', [id]);
    await pool.query('DELETE FROM assignment_attachments WHERE assignment_id = $1', [id]);
    const r = await pool.query('DELETE FROM assignments WHERE id = $1 RETURNING id', [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
