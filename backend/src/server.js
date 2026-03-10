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
import { runPdfIndexingPipeline } from './services/aiPipeline.js';
import { askAssistant } from './services/aiAssistantService.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '../uploads');
const SUBMISSION_UPLOAD_DIR = path.join(UPLOAD_DIR, 'submissions');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(SUBMISSION_UPLOAD_DIR)) fs.mkdirSync(SUBMISSION_UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const ALLOWED_MIMES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const storageSubmission = multer.diskStorage({
  destination: (req, file, cb) => cb(null, SUBMISSION_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    if (mime && ALLOWED_MIMES.has(mime)) return cb(null, true);
    if (!mime) return cb(null, true);
    cb(new Error(`File type not allowed: ${file.mimetype}`));
  },
});
const uploadSubmissionFiles = multer({
  storage: storageSubmission,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    if (mime && ALLOWED_MIMES.has(mime)) return cb(null, true);
    if (!mime) return cb(null, true);
    cb(new Error(`File type not allowed: ${file.mimetype}`));
  },
});

const { Pool } = pkg;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret-change-in-production')) {
  console.warn('WARNING: Set JWT_SECRET in production!');
}

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
        `SELECT DISTINCT ON (cs.id) cs.id, cs.school_year, cs.section_code,
                c.name AS course_name,
                t.first_name AS teacher_first, t.last_name AS teacher_last
         FROM class_sections cs
         JOIN courses c ON cs.course_id = c.id
         JOIN teachers t ON cs.teacher_id = t.id
         JOIN enrollments e ON e.class_section_id = cs.id AND e.student_id = $1
         ORDER BY cs.id, c.name`,
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
      `SELECT DISTINCT s.id, s.first_name, s.last_name, s.grade_level, COALESCE(s.inactive, false) AS inactive
       FROM students s
       JOIN enrollments e ON s.id = e.student_id AND e.class_section_id = $1
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
        `SELECT id, first_name, last_name, grade_level, COALESCE(inactive, false) AS inactive
         FROM (
           SELECT DISTINCT ON (LOWER(TRIM(first_name)), LOWER(TRIM(last_name)), grade_level)
             id, first_name, last_name, grade_level, inactive
           FROM students
           ORDER BY LOWER(TRIM(first_name)), LOWER(TRIM(last_name)), grade_level, id
         ) sub
         ORDER BY last_name, first_name`
      );
      rows = r.rows;
    } else {
      const r = await pool.query(
        `SELECT DISTINCT s.id, s.first_name, s.last_name, s.grade_level, COALESCE(s.inactive, false) AS inactive
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
    const { first_name, last_name, grade_level, inactive } = req.body || {};
    await pool.query(
      `UPDATE students SET
        first_name = COALESCE($1, first_name),
        last_name = COALESCE($2, last_name),
        grade_level = COALESCE($3, grade_level),
        inactive = COALESCE($4, inactive)
       WHERE id = $5`,
      [first_name, last_name, grade_level, inactive !== undefined ? inactive : null, id]
    );
    const { rows } = await pool.query('SELECT id, first_name, last_name, grade_level, COALESCE(inactive, false) AS inactive FROM students WHERE id = $1', [id]);
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

// --- API: Attendance (teacher/admin) ---
// Overall summary for class/semester (all time)
app.get('/api/classes/:id/attendance/summary', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    const access = await checkClassAccess(req, id);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    if (req.user.role === 'teacher' && req.user.teacherId) {
      const ok = await pool.query('SELECT 1 FROM class_sections WHERE id = $1 AND teacher_id = $2', [id, req.user.teacherId]);
      if (ok.rows.length === 0) return res.status(403).json({ error: 'Not your class' });
    }
    const range = await pool.query(
      `SELECT MIN(date)::text AS date_from, MAX(date)::text AS date_to FROM attendance WHERE class_section_id = $1`,
      [id]
    );
    const { date_from, date_to } = range.rows[0] || {};
    const counts = await pool.query(
      `SELECT status, COUNT(*)::int AS cnt FROM attendance WHERE class_section_id = $1 GROUP BY status`,
      [id]
    );
    const students = await pool.query(
      `SELECT COUNT(DISTINCT student_id)::int AS cnt FROM enrollments WHERE class_section_id = $1`,
      [id]
    );
    const byStatus = { present: 0, absent: 0, tardy: 0, excused: 0 };
    counts.rows.forEach((r) => { byStatus[r.status] = r.cnt; });
    const total = byStatus.present + byStatus.absent + byStatus.tardy + byStatus.excused;
    const presentPct = total > 0 ? Math.round((byStatus.present / total) * 100) : null;
    const daily = await pool.query(
      `SELECT date::text, status, COUNT(*)::int AS cnt FROM attendance WHERE class_section_id = $1 GROUP BY date, status ORDER BY date`,
      [id]
    );
    const byDate = {};
    daily.rows.forEach((r) => {
      if (!byDate[r.date]) byDate[r.date] = { present: 0, absent: 0, tardy: 0, excused: 0 };
      byDate[r.date][r.status] = r.cnt;
    });
    res.json({
      date_from: date_from || null,
      date_to: date_to || null,
      student_count: students.rows[0]?.cnt || 0,
      total,
      present: byStatus.present,
      absent: byStatus.absent,
      tardy: byStatus.tardy,
      excused: byStatus.excused,
      present_pct: presentPct,
      daily: byDate,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Date range for attendance-over-time table
app.get('/api/classes/:id/attendance/range', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    const from = req.query.from;
    const to = req.query.to;
    const access = await checkClassAccess(req, id);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    if (req.user.role === 'teacher' && req.user.teacherId) {
      const ok = await pool.query('SELECT 1 FROM class_sections WHERE id = $1 AND teacher_id = $2', [id, req.user.teacherId]);
      if (ok.rows.length === 0) return res.status(403).json({ error: 'Not your class' });
    }
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!from || !to || !dateRe.test(from) || !dateRe.test(to)) {
      return res.status(400).json({ error: 'Query params from and to required (YYYY-MM-DD)' });
    }
    if (from > to) return res.status(400).json({ error: 'from must be <= to' });
    const students = await pool.query(
      `SELECT s.id, s.first_name, s.last_name
       FROM students s
       JOIN enrollments e ON s.id = e.student_id
       WHERE e.class_section_id = $1
       ORDER BY s.last_name, s.first_name`,
      [id]
    );
    const { rows } = await pool.query(
      `SELECT student_id, date, status FROM attendance
       WHERE class_section_id = $1 AND date >= $2 AND date <= $3`,
      [id, from, to]
    );
    res.json({ from, to, students: students.rows, records: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/classes/:id/attendance', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    const date = req.query.date;
    const access = await checkClassAccess(req, id);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    if (req.user.role === 'teacher' && req.user.teacherId) {
      const ok = await pool.query('SELECT 1 FROM class_sections WHERE id = $1 AND teacher_id = $2', [id, req.user.teacherId]);
      if (ok.rows.length === 0) return res.status(403).json({ error: 'Not your class' });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Query param date required (YYYY-MM-DD)' });
    }
    const students = await pool.query(
      `SELECT s.id, s.first_name, s.last_name
       FROM students s
       JOIN enrollments e ON s.id = e.student_id
       WHERE e.class_section_id = $1
       ORDER BY s.last_name, s.first_name`,
      [id]
    );
    const marks = await pool.query(
      `SELECT student_id, status FROM attendance
       WHERE class_section_id = $1 AND date = $2`,
      [id, date]
    );
    const byStudent = {};
    marks.rows.forEach((r) => { byStudent[r.student_id] = r.status; });
    const records = students.rows.map((s) => ({
      student_id: s.id,
      first_name: s.first_name,
      last_name: s.last_name,
      status: byStudent[s.id] || null,
    }));
    res.json({ date, records });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/classes/:id/attendance', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    const access = await checkClassAccess(req, id);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    if (req.user.role === 'teacher' && req.user.teacherId) {
      const ok = await pool.query('SELECT 1 FROM class_sections WHERE id = $1 AND teacher_id = $2', [id, req.user.teacherId]);
      if (ok.rows.length === 0) return res.status(403).json({ error: 'Not your class' });
    }
    const { date, records } = req.body || {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Body date required (YYYY-MM-DD)' });
    }
    if (!Array.isArray(records)) return res.status(400).json({ error: 'Body records array required' });
    const validStatuses = ['present', 'absent', 'tardy', 'excused'];
    for (const rec of records) {
      if (!rec.student_id || !validStatuses.includes(rec.status)) continue;
      await pool.query(
        `INSERT INTO attendance (class_section_id, student_id, date, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (class_section_id, student_id, date) DO UPDATE SET status = $4, noted_at = NOW()`,
        [id, rec.student_id, date, rec.status]
      );
    }
    res.json({ saved: true, date });
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
    let rows;
    try {
      const r = await pool.query(
        `SELECT s.id AS student_id, g.score, g.feedback, s.first_name, s.last_name
         FROM enrollments e
         JOIN students s ON e.student_id = s.id
         LEFT JOIN grades g ON g.student_id = s.id AND g.assignment_id = $1
         WHERE e.class_section_id = (SELECT class_section_id FROM assignments WHERE id = $1)
         ORDER BY s.last_name, s.first_name`,
        [id]
      );
      rows = r.rows;
    } catch (err) {
      if (err.message && err.message.includes('feedback')) {
        const r = await pool.query(
          `SELECT s.id AS student_id, g.score, s.first_name, s.last_name
           FROM enrollments e
           JOIN students s ON e.student_id = s.id
           LEFT JOIN grades g ON g.student_id = s.id AND g.assignment_id = $1
           WHERE e.class_section_id = (SELECT class_section_id FROM assignments WHERE id = $1)
           ORDER BY s.last_name, s.first_name`,
          [id]
        );
        rows = r.rows.map((x) => ({ ...x, feedback: null }));
      } else throw err;
    }
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
    const feedback = body.feedback != null ? String(body.feedback).trim() || null : null;
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
    try {
      await pool.query(
        `INSERT INTO grades (assignment_id, student_id, score, feedback) VALUES ($1, $2, $3, $4)
         ON CONFLICT (assignment_id, student_id) DO UPDATE SET score = $3, feedback = $4, graded_at = NOW()`,
        [assignment_id, student_id, Number(score), feedback]
      );
    } catch (err) {
      if (err.message && err.message.includes('feedback')) {
        await pool.query(
          `INSERT INTO grades (assignment_id, student_id, score) VALUES ($1, $2, $3)
           ON CONFLICT (assignment_id, student_id) DO UPDATE SET score = $3, graded_at = NOW()`,
          [assignment_id, student_id, Number(score)]
        );
      } else throw err;
    }
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

// --- AI Assistant (students only) ---
app.post('/api/ai/ask', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const { question } = req.body || {};
    const q = String(question || '').trim();
    if (!q) return res.status(400).json({ error: 'question required' });
    const studentId = req.user.studentId;
    if (!studentId) return res.status(403).json({ error: 'Student account required' });

    const openaiApiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || null;
    const anthropicApiKey = openaiApiKey ? null : (process.env.ANTHROPIC_API_KEY || null);
    if (!openaiApiKey && !anthropicApiKey) {
      return res.status(503).json({ error: 'AI assistant not configured (OPENAI_API_KEY or ANTHROPIC_API_KEY)' });
    }

    const baseURL = process.env.AI_API_BASE_URL || null;
    const model = process.env.AI_MODEL || null;
    const anthropicModel = process.env.ANTHROPIC_MODEL || null;
    const { answer, intent } = await askAssistant(pool, {
      question: q,
      studentId,
      apiKey: openaiApiKey,
      baseURL,
      model,
      anthropicApiKey,
      anthropicModel,
    });
    res.json({ answer, intent });
  } catch (e) {
    console.error('[AI Assistant]', e);
    res.status(500).json({ error: e.message || 'AI request failed' });
  }
});

// Teacher/Admin: view AI ask analytics
app.get('/api/ai/ask-log', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    let rows;
    if (req.user.role === 'admin') {
      const r = await pool.query(
        `SELECT l.id, l.student_id, s.first_name, s.last_name, l.question, l.answer_summary, l.topics, l.intent, l.created_at
         FROM ai_ask_log l
         JOIN students s ON s.id = l.student_id
         ORDER BY l.created_at DESC
         LIMIT $1`,
        [limit]
      );
      rows = r.rows;
    } else {
      const r = await pool.query(
        `SELECT l.id, l.student_id, s.first_name, s.last_name, l.question, l.answer_summary, l.topics, l.intent, l.created_at
         FROM ai_ask_log l
         JOIN students s ON s.id = l.student_id
         JOIN enrollments e ON e.student_id = l.student_id
         JOIN class_sections cs ON cs.id = e.class_section_id AND cs.teacher_id = $2
         ORDER BY l.created_at DESC
         LIMIT $1`,
        [limit, req.user.teacherId]
      );
      rows = r.rows;
    }
    res.json(rows);
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

// --- Calendar events (teacher creates, students see for their classes) ---
app.get('/api/calendar-events', authMiddleware, async (req, res) => {
  try {
    const month = req.query.month || '';
    const [y, m] = month ? month.split('-').map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1];
    const pad = (n) => String(n).padStart(2, '0');
    const start = `${y}-${pad(m)}-01`;
    const lastDay = new Date(y, m, 0);
    const end = `${lastDay.getFullYear()}-${pad(lastDay.getMonth() + 1)}-${pad(lastDay.getDate())}`;

    let rows;
    const eventDateSelect = `to_char(e.event_date, 'YYYY-MM-DD') AS event_date`;
    if (req.user.role === 'admin') {
      const r = await pool.query(
        `SELECT e.id, e.title, e.description, ${eventDateSelect}, e.user_id,
                (SELECT json_agg(json_build_object('id', c.id, 'course_name', co.name, 'section_code', c.section_code))
                 FROM calendar_event_classes ec
                 JOIN class_sections c ON ec.class_section_id = c.id
                 JOIN courses co ON c.course_id = co.id
                 WHERE ec.event_id = e.id) AS classes
         FROM calendar_events e
         WHERE e.event_date >= $1 AND e.event_date <= $2
         ORDER BY e.event_date, e.id`,
        [start, end]
      );
      rows = r.rows;
    } else if (req.user.role === 'teacher') {
      const r = await pool.query(
        `SELECT e.id, e.title, e.description, ${eventDateSelect}, e.user_id,
                (SELECT json_agg(json_build_object('id', c.id, 'course_name', co.name, 'section_code', c.section_code))
                 FROM calendar_event_classes ec
                 JOIN class_sections c ON ec.class_section_id = c.id
                 JOIN courses co ON c.course_id = co.id
                 WHERE ec.event_id = e.id) AS classes
         FROM calendar_events e
         WHERE e.event_date >= $1 AND e.event_date <= $2
           AND (e.user_id = $3 OR EXISTS (
             SELECT 1 FROM calendar_event_classes ec
             JOIN class_sections cs ON ec.class_section_id = cs.id
             WHERE ec.event_id = e.id AND cs.teacher_id = $4
           ))
         ORDER BY e.event_date, e.id`,
        [start, end, req.user.id, req.user.teacherId]
      );
      rows = r.rows;
    } else {
      const r = await pool.query(
        `SELECT e.id, e.title, e.description, ${eventDateSelect}, e.user_id,
                (SELECT json_agg(json_build_object('id', c.id, 'course_name', co.name, 'section_code', c.section_code))
                 FROM calendar_event_classes ec
                 JOIN class_sections c ON ec.class_section_id = c.id
                 JOIN courses co ON c.course_id = co.id
                 WHERE ec.event_id = e.id) AS classes
         FROM calendar_events e
         JOIN calendar_event_classes ec ON ec.event_id = e.id
         JOIN enrollments en ON en.class_section_id = ec.class_section_id AND en.student_id = $3
         WHERE e.event_date >= $1 AND e.event_date <= $2
         ORDER BY e.event_date, e.id`,
        [start, end, req.user.studentId]
      );
      rows = r.rows;
    }

    const out = rows.map((r) => ({
      ...r,
      class_section_id: null,
      course_name: (r.classes && r.classes[0]) ? r.classes[0].course_name : null,
      section_code: (r.classes && r.classes[0]) ? r.classes[0].section_code : null,
      classes: r.classes || [],
    }));
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/calendar-events', authMiddleware, requireRole('admin', 'teacher'), upload.single('file'), async (req, res) => {
  try {
    const { title, description, event_date, class_section_ids } = req.body || {};
    if (!title || !event_date) return res.status(400).json({ error: 'title and event_date required' });
    const ids = Array.isArray(class_section_ids) ? class_section_ids : (typeof class_section_ids === 'string' ? JSON.parse(class_section_ids || '[]') : []);
    if (ids.length === 0) return res.status(400).json({ error: 'At least one class required' });

    if (req.user.role === 'teacher') {
      for (const cid of ids) {
        const ok = await pool.query('SELECT 1 FROM class_sections WHERE id = $1 AND teacher_id = $2', [cid, req.user.teacherId]);
        if (ok.rows.length === 0) return res.status(403).json({ error: `Class ${cid} is not yours` });
      }
    }

    const { rows: [ev] } = await pool.query(
      'INSERT INTO calendar_events (user_id, title, description, event_date) VALUES ($1, $2, $3, $4) RETURNING id, title, description, event_date',
      [req.user.id, title.trim(), description?.trim() || null, event_date]
    );

    for (const cid of ids) {
      await pool.query('INSERT INTO calendar_event_classes (event_id, class_section_id) VALUES ($1, $2)', [ev.id, cid]);
    }

    if (req.file) {
      await pool.query(
        'INSERT INTO calendar_event_attachments (event_id, original_filename, stored_filename, mime_type, size_bytes) VALUES ($1, $2, $3, $4, $5)',
        [ev.id, req.file.originalname, req.file.filename, req.file.mimetype || null, req.file.size || 0]
      );
    }

    res.status(201).json(ev);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/calendar-events/:id', authMiddleware, requireRole('admin', 'teacher'), upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, event_date, class_section_ids } = req.body || {};
    if (!title || !event_date) return res.status(400).json({ error: 'title and event_date required' });
    const ids = Array.isArray(class_section_ids) ? class_section_ids : (typeof class_section_ids === 'string' ? JSON.parse(class_section_ids || '[]') : []);
    if (ids.length === 0) return res.status(400).json({ error: 'At least one class required' });

    const check = await pool.query('SELECT id, user_id FROM calendar_events WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'teacher' && check.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Can only edit your own event' });
    }

    if (req.user.role === 'teacher') {
      for (const cid of ids) {
        const ok = await pool.query('SELECT 1 FROM class_sections WHERE id = $1 AND teacher_id = $2', [cid, req.user.teacherId]);
        if (ok.rows.length === 0) return res.status(403).json({ error: `Class ${cid} is not yours` });
      }
    }

    await pool.query(
      'UPDATE calendar_events SET title = $1, description = $2, event_date = $3 WHERE id = $4',
      [title.trim(), description?.trim() || null, event_date, id]
    );
    await pool.query('DELETE FROM calendar_event_classes WHERE event_id = $1', [id]);
    for (const cid of ids) {
      await pool.query('INSERT INTO calendar_event_classes (event_id, class_section_id) VALUES ($1, $2)', [id, cid]);
    }

    if (req.file) {
      await pool.query(
        'INSERT INTO calendar_event_attachments (event_id, original_filename, stored_filename, mime_type, size_bytes) VALUES ($1, $2, $3, $4, $5)',
        [id, req.file.originalname, req.file.filename, req.file.mimetype || null, req.file.size || 0]
      );
    }

    const { rows: [ev] } = await pool.query(
      'SELECT id, title, description, to_char(event_date, \'YYYY-MM-DD\') AS event_date FROM calendar_events WHERE id = $1',
      [id]
    );
    res.json(ev);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/calendar-events/:id/attachments', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      'SELECT id, original_filename, mime_type, size_bytes FROM calendar_event_attachments WHERE event_id = $1',
      [id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/calendar-events/:eventId/attachments/:fileId/download', authMiddleware, async (req, res) => {
  try {
    const { eventId, fileId } = req.params;
    const r = await pool.query(
      'SELECT stored_filename, original_filename FROM calendar_event_attachments WHERE id = $1 AND event_id = $2',
      [fileId, eventId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const fp = path.join(UPLOAD_DIR, r.rows[0].stored_filename);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
    res.download(fp, r.rows[0].original_filename);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/calendar-events/:id', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user.role === 'teacher') {
      const r = await pool.query('SELECT user_id FROM calendar_events WHERE id = $1', [id]);
      if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      if (r.rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Can only delete your own' });
    }
    const files = await pool.query('SELECT stored_filename FROM calendar_event_attachments WHERE event_id = $1', [id]);
    for (const f of files.rows) {
      const fp = path.join(UPLOAD_DIR, f.stored_filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    const r = await pool.query('DELETE FROM calendar_events WHERE id = $1 RETURNING id', [id]);
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
        `SELECT sub.* FROM (
           SELECT DISTINCT ON (a.id) a.id, a.title, a.due_date, a.due_at, a.max_points, a.class_section_id,
                  c.name AS course_name, cs.section_code
           FROM assignments a
           JOIN class_sections cs ON a.class_section_id = cs.id
           JOIN courses c ON cs.course_id = c.id
           JOIN enrollments e ON e.class_section_id = cs.id AND e.student_id = $1
           ORDER BY a.id
         ) sub
         ORDER BY COALESCE(sub.due_at, (sub.due_date::date + time '23:59:59') AT TIME ZONE 'UTC')`,
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

// --- API: Student dashboard for teacher/admin (view a specific student's profile) ---
app.get('/api/students/:id/dashboard', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const sid = Number(req.params.id);
    if (!sid) return res.status(400).json({ error: 'Invalid student id' });

    if (req.user.role === 'teacher') {
      const ok = await pool.query(
        `SELECT 1 FROM enrollments e
         JOIN class_sections cs ON e.class_section_id = cs.id
         WHERE e.student_id = $1 AND cs.teacher_id = $2`,
        [sid, req.user.teacherId]
      );
      if (ok.rows.length === 0) return res.status(403).json({ error: 'Student not in your classes' });
    }

    const orderDue = `ORDER BY COALESCE(a.due_at, (a.due_date::date + time '23:59:59') AT TIME ZONE 'UTC')`;

    const [assignmentsRes, gradesRes, submissionsRes] = await Promise.all([
      pool.query(
        `SELECT a.id, a.title, a.due_date, a.due_at, a.max_points, a.class_section_id,
                COALESCE(a.category, 'homework') AS category,
                c.name AS course_name, cs.section_code
         FROM assignments a
         JOIN class_sections cs ON a.class_section_id = cs.id
         JOIN courses c ON cs.course_id = c.id
         JOIN enrollments e ON e.class_section_id = cs.id AND e.student_id = $1
         ${orderDue}`,
        [sid]
      ),
      pool.query(
        `SELECT a.id AS assignment_id, a.max_points, g.score
         FROM enrollments e
         JOIN assignments a ON a.class_section_id = e.class_section_id
         LEFT JOIN grades g ON g.assignment_id = a.id AND g.student_id = e.student_id
         WHERE e.student_id = $1`,
        [sid]
      ),
      pool.query(
        `SELECT s.assignment_id, s.submitted_at
         FROM submissions s
         WHERE s.student_id = $1`,
        [sid]
      )
    ]);

    const assignments = assignmentsRes.rows;
    const gradeMap = {};
    gradesRes.rows.forEach((r) => { gradeMap[`${sid}-${r.assignment_id}`] = r.score; });
    const subMap = {};
    submissionsRes.rows.forEach((r) => { subMap[r.assignment_id] = r; });

    const now = new Date();
    const classIds = [...new Set(assignments.map((a) => a.class_section_id))];

    const byClass = [];
    let totalScore = 0, totalMax = 0, totalGraded = 0;

    for (const cid of classIds) {
      const classAsns = assignments.filter((a) => a.class_section_id === cid);
      const weightsRes = await pool.query(
        'SELECT category, weight_percent FROM class_category_weights WHERE class_section_id = $1',
        [cid]
      );
      const weights = {};
      weightsRes.rows.forEach((r) => { weights[r.category] = Number(r.weight_percent); });
      const asnForCompute = classAsns.map((a) => ({
        id: a.id,
        max_points: a.max_points,
        category: a.category ?? 'homework',
      }));
      const percent = computeFinalPercent(asnForCompute, gradeMap, weights, sid);

      let completed = 0;
      classAsns.forEach((a) => {
        const g = gradeMap[`${sid}-${a.id}`];
        if (g != null) completed++;
        const mx = Number(a.max_points) || 0;
        if (mx > 0 && g != null) {
          totalScore += Number(g);
          totalMax += mx;
          totalGraded++;
        }
      });

      byClass.push({
        class_id: cid,
        course_name: classAsns[0]?.course_name,
        section_code: classAsns[0]?.section_code,
        avg_percent: percent != null ? Math.round(percent * 10) / 10 : null,
        letter_grade: percentToLetter(percent),
        completed,
        total: classAsns.length,
      });
    }

    const overallAvg = totalMax > 0 ? Math.round((totalScore / totalMax) * 1000) / 10 : null;
    const totalAssignments = assignments.length;
    const completedAssignments = assignments.filter((a) => gradeMap[`${sid}-${a.id}`] != null).length;
    const completionPct = totalAssignments > 0 ? Math.round((completedAssignments / totalAssignments) * 100) : 0;

    const assignmentStatuses = assignments.map((a) => {
      const g = gradeMap[`${sid}-${a.id}`];
      const sub = subMap[a.id];
      const due = a.due_at ? new Date(a.due_at) : (a.due_date ? new Date(a.due_date) : null);
      const submitted = !!sub;
      const overdue = due && now > due;
      let status = 'Pending';
      if (g != null) status = 'Graded';
      else if (submitted && overdue) status = 'Overdue';
      else if (submitted) status = 'Submitted';
      else if (overdue) status = 'Overdue';
      else status = 'Pending';

      const pct = (a.max_points > 0 && g != null)
        ? Math.round((Number(g) / Number(a.max_points)) * 1000) / 10
        : null;

      return {
        id: a.id,
        class_section_id: a.class_section_id,
        title: a.title,
        course_name: a.course_name,
        section_code: a.section_code,
        due_at: a.due_at || a.due_date,
        max_points: a.max_points,
        score: g ?? null,
        percent: pct,
        status,
      };
    });

    const gradeTrend = assignmentStatuses
      .filter((a) => a.score != null && a.due_at)
      .map((a) => ({
        date: a.due_at,
        percent: a.percent,
        title: a.title,
      }))
      .sort((x, y) => new Date(x.date) - new Date(y.date));

    res.json({
      overall_avg_percent: overallAvg,
      letter_grade: percentToLetter(overallAvg),
      completion_percent: completionPct,
      completed_assignments: completedAssignments,
      total_assignments: totalAssignments,
      by_class: byClass,
      assignment_statuses: assignmentStatuses,
      grade_trend: gradeTrend,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// --- API: Student dashboard (all data in one call) ---
app.get('/api/me/dashboard', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const sid = req.user.studentId;
    const orderDue = `ORDER BY COALESCE(a.due_at, (a.due_date::date + time '23:59:59') AT TIME ZONE 'UTC')`;

    const [assignmentsRes, gradesRes, submissionsRes] = await Promise.all([
      pool.query(
        `SELECT a.id, a.title, a.due_date, a.due_at, a.max_points, a.class_section_id,
                COALESCE(a.category, 'homework') AS category,
                c.name AS course_name, cs.section_code
         FROM assignments a
         JOIN class_sections cs ON a.class_section_id = cs.id
         JOIN courses c ON cs.course_id = c.id
         JOIN enrollments e ON e.class_section_id = cs.id AND e.student_id = $1
         ${orderDue}`,
        [sid]
      ),
      pool.query(
        `SELECT a.id AS assignment_id, a.max_points, g.score
         FROM enrollments e
         JOIN assignments a ON a.class_section_id = e.class_section_id
         LEFT JOIN grades g ON g.assignment_id = a.id AND g.student_id = e.student_id
         WHERE e.student_id = $1`,
        [sid]
      ),
      pool.query(
        `SELECT s.assignment_id, s.submitted_at
         FROM submissions s
         WHERE s.student_id = $1`,
        [sid]
      )
    ]);

    const assignments = assignmentsRes.rows;
    const gradeMap = {};
    gradesRes.rows.forEach((r) => { gradeMap[`${sid}-${r.assignment_id}`] = r.score; });
    const subMap = {};
    submissionsRes.rows.forEach((r) => { subMap[r.assignment_id] = r; });

    const now = new Date();
    const classIds = [...new Set(assignments.map((a) => a.class_section_id))];

    const byClass = [];
    let totalScore = 0, totalMax = 0, totalGraded = 0;

    for (const cid of classIds) {
      const classAsns = assignments.filter((a) => a.class_section_id === cid);
      const weightsRes = await pool.query(
        'SELECT category, weight_percent FROM class_category_weights WHERE class_section_id = $1',
        [cid]
      );
      const weights = {};
      weightsRes.rows.forEach((r) => { weights[r.category] = Number(r.weight_percent); });
      const asnForCompute = classAsns.map((a) => ({
        id: a.id,
        max_points: a.max_points,
        category: a.category ?? 'homework',
      }));
      const percent = computeFinalPercent(asnForCompute, gradeMap, weights, sid);

      let completed = 0;
      classAsns.forEach((a) => {
        const g = gradeMap[`${sid}-${a.id}`];
        if (g != null) completed++;
        const mx = Number(a.max_points) || 0;
        if (mx > 0 && g != null) {
          totalScore += Number(g);
          totalMax += mx;
          totalGraded++;
        }
      });

      byClass.push({
        class_id: cid,
        course_name: classAsns[0]?.course_name,
        section_code: classAsns[0]?.section_code,
        avg_percent: percent != null ? Math.round(percent * 10) / 10 : null,
        letter_grade: percentToLetter(percent),
        completed,
        total: classAsns.length,
      });
    }

    const overallAvg = totalMax > 0 ? Math.round((totalScore / totalMax) * 1000) / 10 : null;
    const totalAssignments = assignments.length;
    const completedAssignments = assignments.filter((a) => gradeMap[`${sid}-${a.id}`] != null).length;
    const completionPct = totalAssignments > 0 ? Math.round((completedAssignments / totalAssignments) * 100) : 0;

    const assignmentStatuses = assignments.map((a) => {
      const g = gradeMap[`${sid}-${a.id}`];
      const sub = subMap[a.id];
      const due = a.due_at ? new Date(a.due_at) : (a.due_date ? new Date(a.due_date) : null);
      const submitted = !!sub;
      const overdue = due && now > due;
      let status = 'Pending';
      if (g != null) status = 'Graded';
      else if (submitted && overdue) status = 'Overdue';
      else if (submitted) status = 'Submitted';
      else if (overdue) status = 'Overdue';
      else status = 'Pending';

      const pct = (a.max_points > 0 && g != null)
        ? Math.round((Number(g) / Number(a.max_points)) * 1000) / 10
        : null;

      return {
        id: a.id,
        class_section_id: a.class_section_id,
        title: a.title,
        course_name: a.course_name,
        section_code: a.section_code,
        due_at: a.due_at || a.due_date,
        max_points: a.max_points,
        score: g ?? null,
        percent: pct,
        status,
      };
    });

    const gradeTrend = assignmentStatuses
      .filter((a) => a.score != null && a.due_at)
      .map((a) => ({
        date: a.due_at,
        percent: a.percent,
        title: a.title,
      }))
      .sort((x, y) => new Date(x.date) - new Date(y.date));

    res.json({
      overall_avg_percent: overallAvg,
      letter_grade: percentToLetter(overallAvg),
      completion_percent: completionPct,
      completed_assignments: completedAssignments,
      total_assignments: totalAssignments,
      by_class: byClass,
      assignment_statuses: assignmentStatuses,
      grade_trend: gradeTrend,
    });
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
    runPdfIndexingPipeline(pool, UPLOAD_DIR, req.file, 'assignment_attachment', rows[0].id)
      .catch((e) => console.error('[AI Pipeline]', e));
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

app.get('/api/assignments/:id/my-submission', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const { id } = req.params;
    const access = await checkAssignmentAccess(req, id);
    if (!access.ok) return res.status(access.status).json({ error: access.status === 404 ? 'Not found' : 'Forbidden' });
    const sub = await pool.query(
      'SELECT id, submitted_at, body_text FROM submissions WHERE assignment_id = $1 AND student_id = $2',
      [id, req.user.studentId]
    );
    if (sub.rows.length === 0) return res.json(null);
    const files = await pool.query(
      'SELECT id, original_filename, mime_type, size_bytes FROM submission_files WHERE submission_id = $1 ORDER BY id',
      [sub.rows[0].id]
    );
    res.json({ ...sub.rows[0], files: files.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/assignments/:id/submit', authMiddleware, requireRole('student'), uploadSubmissionFiles.array('files', 10), async (req, res) => {
  try {
    const { id } = req.params;
    const access = await checkAssignmentAccess(req, id);
    if (!access.ok) return res.status(access.status).json({ error: access.status === 404 ? 'Not found' : 'Forbidden' });
    const bodyText = (req.body && req.body.body_text) ? String(req.body.body_text).trim() : null;
    const files = Array.isArray(req.files) ? req.files : [];
    let sub = await pool.query(
      'SELECT id FROM submissions WHERE assignment_id = $1 AND student_id = $2',
      [id, req.user.studentId]
    );
    if (sub.rows.length === 0) {
      const ins = await pool.query(
        'INSERT INTO submissions (assignment_id, student_id, body_text) VALUES ($1, $2, $3) RETURNING id, submitted_at, body_text',
        [id, req.user.studentId, bodyText || null]
      );
      sub = ins;
    } else {
      await pool.query('UPDATE submissions SET body_text = $1, submitted_at = NOW() WHERE id = $2', [bodyText, sub.rows[0].id]);
      sub = await pool.query('SELECT id, submitted_at, body_text FROM submissions WHERE id = $1', [sub.rows[0].id]);
    }
    const submissionId = sub.rows[0].id;
    for (const f of files) {
      await pool.query(
        'INSERT INTO submission_files (submission_id, original_filename, stored_filename, mime_type, size_bytes) VALUES ($1, $2, $3, $4, $5)',
        [submissionId, f.originalname, f.filename, f.mimetype || null, f.size || 0]
      );
    }
    const filesRows = await pool.query(
      'SELECT id, original_filename, mime_type, size_bytes FROM submission_files WHERE submission_id = $1 ORDER BY id',
      [submissionId]
    );
    res.status(200).json({ ...sub.rows[0], files: filesRows.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/assignments/:id/submissions', authMiddleware, requireRole('admin', 'teacher'), async (req, res) => {
  try {
    const { id } = req.params;
    const access = await checkAssignmentAccess(req, id);
    if (!access.ok) return res.status(access.status).json({ error: access.status === 404 ? 'Not found' : 'Forbidden' });
    const { rows } = await pool.query(
      `SELECT s.id, s.student_id, s.submitted_at, s.body_text,
       (SELECT COALESCE(json_agg(json_build_object('id', sf.id, 'original_filename', sf.original_filename, 'mime_type', sf.mime_type, 'size_bytes', sf.size_bytes)), '[]'::json)
        FROM submission_files sf WHERE sf.submission_id = s.id) AS files,
       st.first_name, st.last_name
       FROM submissions s
       JOIN students st ON st.id = s.student_id
       WHERE s.assignment_id = $1 ORDER BY s.submitted_at DESC`,
      [id]
    );
    const out = rows.map((r) => ({
      id: r.id,
      student_id: r.student_id,
      student_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      submitted_at: r.submitted_at,
      body_text: r.body_text,
      files: Array.isArray(r.files) ? r.files : [],
    }));
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/submission-files/:id/download', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT sf.id, sf.stored_filename, sf.original_filename, sf.mime_type, sf.submission_id,
              s.assignment_id, s.student_id, a.class_section_id
       FROM submission_files sf
       JOIN submissions s ON s.id = sf.submission_id
       JOIN assignments a ON a.id = s.assignment_id
       WHERE sf.id = $1`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = rows[0];
    if (req.user.role === 'student') {
      if (row.student_id !== req.user.studentId) return res.status(403).json({ error: 'Forbidden' });
    } else if (req.user.role === 'teacher') {
      const ok = await pool.query('SELECT 1 FROM class_sections WHERE id = $1 AND teacher_id = $2', [row.class_section_id, req.user.teacherId]);
      if (ok.rows.length === 0) return res.status(403).json({ error: 'Forbidden' });
    }
    const filePath = path.join(SUBMISSION_UPLOAD_DIR, row.stored_filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.original_filename)}"`);
    if (row.mime_type) res.setHeader('Content-Type', row.mime_type);
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
    let subFiles = { rows: [] };
    try {
      subFiles = await pool.query(
        'SELECT sf.stored_filename FROM submission_files sf JOIN submissions s ON s.id = sf.submission_id WHERE s.assignment_id = $1',
        [id]
      );
    } catch (_) { /* submissions table may not exist */ }
    for (const f of files.rows) {
      const fp = path.join(UPLOAD_DIR, f.stored_filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    for (const f of subFiles.rows) {
      const fp = path.join(SUBMISSION_UPLOAD_DIR, f.stored_filename);
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
const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

async function ensureCalendarTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        title VARCHAR(200) NOT NULL,
        description TEXT,
        event_date DATE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS calendar_event_classes (
        event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
        class_section_id INTEGER NOT NULL REFERENCES class_sections(id),
        PRIMARY KEY (event_id, class_section_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS calendar_event_attachments (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
        original_filename VARCHAR(255) NOT NULL,
        stored_filename VARCHAR(255) NOT NULL,
        mime_type VARCHAR(100),
        size_bytes INTEGER DEFAULT 0
      )
    `);
  } catch (e) {
    console.error('Calendar tables init failed:', e.message);
  }
}

async function ensureDocumentChunksTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS document_chunks (
        id SERIAL PRIMARY KEY,
        source_type VARCHAR(50) NOT NULL,
        source_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        char_count INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_document_chunks_source ON document_chunks(source_type, source_id)
    `);
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      await pool.query('ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS embedding vector(1536)');
    } catch (ve) {
      if (!ve.message?.includes('vector')) console.warn('[DB] pgvector not available, semantic search disabled:', ve.message);
    }
  } catch (e) {
    console.error('Document chunks table init failed:', e.message);
  }
}

async function ensureAiAskLogTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_ask_log (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL REFERENCES students(id),
        question TEXT NOT NULL,
        answer_summary TEXT,
        chunk_ids INTEGER[],
        topics TEXT[],
        intent VARCHAR(32) DEFAULT 'question_about_material',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE ai_ask_log ADD COLUMN IF NOT EXISTS intent VARCHAR(32) DEFAULT 'question_about_material'`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_ask_log_student ON ai_ask_log(student_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_ask_log_created ON ai_ask_log(created_at)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_ask_log_intent ON ai_ask_log(intent)`);
  } catch (e) {
    console.error('AI ask log table init failed:', e.message);
  }
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`API running on http://localhost:${port}`);
      resolve(server);
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Kill the process: taskkill /IM node.exe /F`);
        console.error('Or run with another port: PORT=4001 npm run dev');
      }
      reject(err);
    });
  });
}

function gracefulShutdown(server) {
  const shutdown = () => {
    if (!server) return;
    server.close(() => {
      pool.end().catch(() => {}).finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (isMain) {
  (async () => {
    try {
      await ensureCalendarTables();
      await ensureDocumentChunksTable();
      await ensureAiAskLogTable();
      const server = await startServer(PORT);
      gracefulShutdown(server);
    } catch (e) {
      console.error('Failed to start:', e.message);
      process.exit(1);
    }
  })();
}
export { app, pool };
