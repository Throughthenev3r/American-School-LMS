# LMS Technical Audit Report

**Audit Date:** February 2025  
**Scope:** Full stack (React + Vite, Express + PostgreSQL)

---

## Executive Summary

The LMS project is functional but has significant technical debt that would impede production readiness and scalability. The main issues are:

1. **Monolithic structure** — `App.jsx` (~3,500 lines) and `server.js` (~2,100 lines) are too large.
2. **Little reuse** — Duplicated logic across backend and frontend.
3. **Performance gaps** — N+1 queries, no indexes, no memoization.
4. **Security risks** — Default secrets, test credentials in UI, weak file validation.
5. **No production tooling** — Missing rate limiting, structured logging, health checks.

---

## 1. Architecture Review

### Current Structure

```
LMS/
├── frontend/src/
│   ├── App.jsx          ~3,500 lines (god component)
│   ├── main.jsx
│   ├── api.js
│   ├── styles.css       ~2,300 lines
│   ├── AddCalendarEventForm.jsx
│   ├── AssignmentAttachments.jsx
│   ├── AssignmentSubmission.jsx
│   ├── ClassSyllabus.jsx
│   ├── RichContentDisplay.jsx
│   ├── RichTextEditor.jsx
│   ├── StudentDashboard.jsx
│   └── utils/{csv.js, format.js}
├── backend/src/
│   └── server.js        ~2,100 lines (monolithic)
└── backend/db/
    └── schema.sql + migrations
```

### Issues

| Issue | Severity | Description |
|-------|----------|-------------|
| God component | High | `App.jsx` has ~60 useState, 15+ inline components, routing, and all business logic |
| Monolithic backend | High | All routes, auth, grading, and SQL in one file |
| No route modules | Medium | All Express routes in `server.js` |
| No service/repository layer | Medium | SQL and business logic mixed in route handlers |
| Inconsistent component placement | Medium | Some forms in separate files, many inline in App.jsx |

### Suggested Structure

```
frontend/src/
├── components/       # Shared UI
│   ├── ConfirmModal.jsx
│   ├── FormField.jsx
│   └── ...
├── features/         # Feature modules
│   ├── auth/
│   │   ├── LoginForm.jsx
│   │   └── ChangePasswordForm.jsx
│   ├── classes/
│   │   ├── ClassList.jsx
│   │   ├── CreateClassForm.jsx
│   │   └── EditClassForm.jsx
│   ├── students/
│   ├── assignments/
│   ├── calendar/
│   └── ...
├── hooks/            # Custom hooks
│   ├── useClickOutside.js
│   └── useApiFetch.js
├── api/
│   ├── client.js
│   └── endpoints.js
└── App.jsx           # Routing only

backend/src/
├── routes/
│   ├── auth.js
│   ├── classes.js
│   ├── students.js
│   ├── assignments.js
│   └── calendar.js
├── services/
│   ├── grading.js
│   └── auth.js
├── db/
│   └── queries.js    # SQL helpers
└── server.js         # Bootstrap only
```

---

## 2. Performance Optimization

### Frontend

| Issue | Impact | Fix |
|-------|--------|-----|
| No `useMemo`/`useCallback` | Extra re-renders when callbacks change | Wrap handlers and derived data |
| No `React.memo` on list items | Re-renders all rows on any state change | Memo `GradebookRow`, calendar cell items |
| Large single bundle | Slow initial load | Use `React.lazy()` for route-level splitting |
| 150+ useState/useEffect in App | Full re-render on every state change | Split into feature components with local state |

### Backend — N+1 Queries

| Endpoint | Lines | Issue |
|----------|-------|-------|
| `PUT /api/classes/:id/attendance` | 892-897 | One query per record in loop |
| `POST /api/calendar-events` | 1341-1353 | Per-class validation + insert |
| `GET /api/me/grades` | 1539-1560 | Per-class weights query |
| `GET /api/me/dashboard` | 1771-1795 | Per-class dashboard data |
| `POST /api/assignments/:id/submit` | 1978-1982 | Per-file insert in loop |

### Database Indexes (Missing)

```sql
-- Add to migrations
CREATE INDEX IF NOT EXISTS idx_enrollments_student_class ON enrollments(student_id, class_section_id);
CREATE INDEX IF NOT EXISTS idx_grades_assignment_student ON grades(assignment_id, student_id);
CREATE INDEX IF NOT EXISTS idx_assignments_class ON assignments(class_section_id);
CREATE INDEX IF NOT EXISTS idx_class_sections_teacher ON class_sections(teacher_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(event_date);
```

---

## 3. Code Quality

### Dead Code / Unused

- `parseJson` imported in App.jsx but rarely used
- Potential unused state variables in large App component

### Duplicated Logic

| Pattern | Occurrences | Recommendation |
|---------|-------------|----------------|
| Close-on-click-outside `useEffect` | 3x (studentMenuOpen, classMenuOpen, calendarEventMenuOpen) | Extract `useClickOutside(id, onClose)` hook |
| `apiFetch().then(r => r.ok ? r.json() : []).catch(() => [])` | 15+ | Extract `useApi(endpoint, deps)` or `apiFetchJson(url, opts)` |
| Multer fileFilter | 2x identical blocks | Extract `createFileFilter(allowedMimes)` |
| Class access check | 19+ similar queries | Centralize `checkClassAccess(pool, classId, userId, role)` |
| Dashboard / grades computation | 3 nearly identical blocks | Extract `buildStudentDashboard(pool, studentId)` |

### Naming Consistency

- `canEdit` vs `canManageClass` vs `canEditEvent` — establish `can*` prefix consistently
- `refreshClasses` vs `refreshCalendarEvents` vs `refreshStudents` — consider `refetch*` or `invalidate*`

---

## 4. Database & Backend

### Query Inefficiencies

1. **Attendance bulk update** — Use single `INSERT ... ON CONFLICT` or `UNNEST` with batch params.
2. **Calendar event classes** — Use `INSERT INTO ... SELECT unnest($1::int[])` for batch insert.
3. **Dashboard weights** — Fetch all class weights in one query, then map in code.

### Example Refactor: Batch Calendar Event Classes

**Before (N+1):**
```javascript
for (const cid of ids) {
  await pool.query('INSERT INTO calendar_event_classes (event_id, class_section_id) VALUES ($1, $2)', [ev.id, cid]);
}
```

**After:**
```javascript
if (ids.length > 0) {
  await pool.query(
    `INSERT INTO calendar_event_classes (event_id, class_section_id)
     SELECT $1, unnest($2::int[])`,
    [ev.id, ids]
  );
}
```

---

## 5. Security

### Critical

| Issue | Location | Action |
|-------|----------|--------|
| Default JWT secret | server.js:59 | **Enforce** `JWT_SECRET` in production (exit if missing) |
| Test credentials in login UI | App.jsx:114-117 | Remove or gate behind `NODE_ENV !== 'production'` |
| Default DB URL with password | server.js:71 | Fail fast if `DATABASE_URL` unset in production |

### Medium

| Issue | Action |
|-------|--------|
| `if (!mime) return cb(null, true)` | Reject files without MIME type |
| No rate limiting | Add `express-rate-limit` on `/api/auth/login` and API |
| No password policy | Enforce min length, complexity on register/change-password |
| CORS `*` or permissive | Restrict `origin` in production |

### Good

- Parameterized queries throughout
- bcrypt for passwords
- JWT + role-based access
- `requireRole` middleware

---

## 6. UI/UX

### Repeated Elements

- Form blocks (label + input + error) — extract `FormField`
- Edit/Delete dropdown (classes, students, calendar events) — extract `ActionMenu` component
- Modal overlay pattern — extract `Modal` wrapper

### Admin Panel

- Already uses dropdowns for classes, students, calendar events
- Consider consistent icon (⋯) and placement across all lists

---

## 7. Scalability & Production Readiness

### Missing for Production

| Item | Recommendation |
|------|----------------|
| Structured logging | Use `pino` or `winston` with JSON output |
| Error boundaries | Add React error boundary at app root |
| Health check | `/api/health` exists — add DB ping and disk check |
| Graceful shutdown | Handle SIGTERM, close pool |
| Environment validation | Validate `DATABASE_URL`, `JWT_SECRET` at startup |
| Migration runner | Use `node-pg-migrate` or similar for ordered migrations |

---

## 8. Prioritized Action List

### Critical (Do First)

1. **Remove test credentials from login UI** — Security risk in production.
2. **Enforce JWT_SECRET and DATABASE_URL in production** — Fail startup if missing.
3. **Reject files without MIME type** — Change `if (!mime) return cb(null, true)` to `return cb(new Error('Missing MIME type'))`.
4. **Add rate limiting on login** — Prevent brute force.

### Medium (Next Sprint)

5. Extract `useClickOutside` hook — Remove 3 duplicated useEffects.
6. Extract inline forms from App.jsx into separate files — Improves maintainability.
7. Add database indexes — Improves query performance.
8. Batch N+1 inserts (attendance, calendar_event_classes) — Reduces DB round-trips.
9. Add React.lazy for route-level code splitting — Faster initial load.

### Minor (Backlog)

10. Centralize multer fileFilter.
11. Extract `apiFetchJson` helper for consistent error handling.
12. Add `useMemo`/`useCallback` to hot paths (gradebook, calendar).
13. Split server.js into route modules.
14. Add password policy (min length, complexity).

---

## 9. Refactored Code Examples

### A. useClickOutside Hook

```javascript
// frontend/src/hooks/useClickOutside.js
import { useEffect } from 'react';

export function useClickOutside(isActive, onClose) {
  useEffect(() => {
    if (!isActive) return;
    const handler = (e) => {
      if (!e.target.closest('[data-click-outside-ignore]')) onClose();
    };
    const t = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', handler);
    };
  }, [isActive, onClose]);
}
```

**Usage in App.jsx:**
```javascript
useClickOutside(!!classMenuOpen, () => setClassMenuOpen(null));
useClickOutside(!!studentMenuOpen, () => setStudentMenuOpen(null));
useClickOutside(!!calendarEventMenuOpen, () => setCalendarEventMenuOpen(null));
```

---

### B. Multer FileFilter — Single Factory

```javascript
// backend/src/server.js
function createFileFilter(allowedMimes) {
  return (req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    if (!mime) return cb(new Error('File MIME type is required'));
    if (allowedMimes.has(mime)) return cb(null, true);
    cb(new Error(`File type not allowed: ${file.mimetype}`));
  };
}

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: createFileFilter(ALLOWED_MIMES),
});
const uploadSubmissionFiles = multer({
  storage: storageSubmission,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: createFileFilter(ALLOWED_MIMES),
});
```

---

### C. Production Secret Enforcement

```javascript
// backend/src/server.js - add at top after dotenv.config()
const isProd = process.env.NODE_ENV === 'production';
if (isProd) {
  if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET is required in production');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('FATAL: DATABASE_URL is required in production');
    process.exit(1);
  }
}
```

---

### D. Remove Test Credentials (Conditional)

```javascript
// App.jsx - LoginForm
<p className="login-hint">
  {process.env.NODE_ENV === 'development' && (
    <>admin@school.com / admin123 | sarah@school.com / teacher123 | james@school.com / student123</>
  )}
</p>
```

---

### E. Batch Calendar Event Classes Insert

```javascript
// backend - POST /api/calendar-events
if (ids.length > 0) {
  await pool.query(
    `INSERT INTO calendar_event_classes (event_id, class_section_id)
     SELECT $1, unnest($2::int[])`,
    [ev.id, ids]
  );
}
```

---

## 10. File Size Summary

| File | Lines | Recommendation |
|------|-------|----------------|
| App.jsx | ~3,527 | Split into 10+ feature components |
| server.js | ~2,100 | Split into 6-8 route modules |
| styles.css | ~2,300 | Consider CSS modules or Tailwind |
| StudentDashboard.jsx | ~285 | OK |
| AssignmentSubmission.jsx | ~250 | OK |

---

*End of Technical Audit*
