import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { RichTextEditor } from "./RichTextEditor.jsx";
import { RichContentDisplay } from "./RichContentDisplay.jsx";
import { AssignmentAttachments } from "./AssignmentAttachments.jsx";
import { AssignmentSubmission } from "./AssignmentSubmission.jsx";
import { ClassSyllabus } from "./ClassSyllabus.jsx";
import { StudentDashboard } from "./StudentDashboard.jsx";
import { AddCalendarEventForm } from "./AddCalendarEventForm.jsx";
import { apiFetch, API, parseJson } from "./api.js";
import {
  formatDate,
  formatDateTime,
  dueDateLabel,
  toDatetimeLocal,
} from "./utils/format.js";
import { downloadCSV } from "./utils/csv.js";

function dedupeById(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  return arr.filter((x) => {
    const id = x?.id;
    if (id == null || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function dedupeStudents(students) {
  const list = dedupeById(students);
  const seen = new Set();
  return list.filter((s) => {
    const key = `${(s?.first_name || "").trim().toLowerCase()}|${(s?.last_name || "").trim().toLowerCase()}|${s?.grade_level ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ConfirmModal({ open, title, message, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="modal-actions modal-actions-confirm">
          <button type="button" className="btn-confirm" onClick={onConfirm}>
            Confirm
          </button>
          <button type="button" className="btn-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function LoginForm({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-box">
        <h1>LMS American School</h1>
        <p className="login-sub">Sign in</p>
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="login-error">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? "..." : "Log in"}
          </button>
        </form>
        <p className="login-hint">
          admin@school.com / admin123 | sarah@school.com / teacher123 |
          james@school.com / student123
        </p>
      </div>
    </div>
  );
}

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const path = location.pathname;
  const view =
    path === "/"
      ? "dashboard"
      : path === "/students"
        ? "students"
        : path === "/grades"
          ? "grades"
          : path === "/assignments"
            ? "assignments"
            : path === "/calendar"
              ? "calendar"
              : path === "/profile"
                ? "profile"
                : path.startsWith("/classes")
                  ? "classes"
                  : "dashboard";
  const selectedClassIdFromUrl = path.match(/^\/classes\/(\d+)$/)?.[1];
  const selectedClassId =
    view === "classes" && selectedClassIdFromUrl
      ? Number(selectedClassIdFromUrl)
      : null;
  const setSelectedClassId = (id) =>
    navigate(id ? `/classes/${id}` : "/classes");
  const setView = (v) => {
    if (v === "dashboard") navigate("/");
    else if (v === "classes") navigate("/classes");
    else if (v === "calendar") navigate("/calendar");
    else if (v === "profile") navigate("/profile");
    else navigate(`/${v}`);
  };
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [classStudents, setClassStudents] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [showAddAssignment, setShowAddAssignment] = useState(false);
  const [showAddClass, setShowAddClass] = useState(false);
  const [showEnrollStudent, setShowEnrollStudent] = useState(false);
  const [editSubmissionsAssignmentId, setEditSubmissionsAssignmentId] = useState(null);
  const [editSubmissionsSaving, setEditSubmissionsSaving] = useState(false);
  const submissionSaveRef = useRef(null);
  const [editAssignmentId, setEditAssignmentId] = useState(null);
  const [viewAssignmentIds, setViewAssignmentIds] = useState([]);
  const [editClassId, setEditClassId] = useState(null);
  const [searchStudents, setSearchStudents] = useState("");
  const [filterClassYear, setFilterClassYear] = useState("");
  const [classReport, setClassReport] = useState([]);
  const [showAssignmentAverages, setShowAssignmentAverages] = useState(false);
  const [myGrades, setMyGrades] = useState([]);
  const [allAssignments, setAllAssignments] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [showAddAnnouncement, setShowAddAnnouncement] = useState(false);
  const [sortStudentsBy, setSortStudentsBy] = useState("name");
  const [confirmModal, setConfirmModal] = useState(null);
  const [stats, setStats] = useState({
    classes: 0,
    students: 0,
    assignments: 0,
    new_classes: 0,
    new_assignments: 0,
  });
  const [editStudentId, setEditStudentId] = useState(null);
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [studentMenuOpen, setStudentMenuOpen] = useState(null);
  const [classMenuOpen, setClassMenuOpen] = useState(null);
  const [selectedStudentProfileId, setSelectedStudentProfileId] = useState(null);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [showAddCalendarEvent, setShowAddCalendarEvent] = useState(false);
  const [editCalendarEvent, setEditCalendarEvent] = useState(null);
  const [calendarEventMenuOpen, setCalendarEventMenuOpen] = useState(null);
  const [toast, setToast] = useState(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showRegisterUser, setShowRegisterUser] = useState(false);
  const [showCategoryWeightsModal, setShowCategoryWeightsModal] =
    useState(false);
  const [categoryWeights, setCategoryWeights] = useState({});
  const [classGradesSummary, setClassGradesSummary] = useState(null);
  const [attendanceDate, setAttendanceDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceRangeRefresh, setAttendanceRangeRefresh] = useState(0);
  const [attendanceSummary, setAttendanceSummary] = useState(null);
  const [attendanceSavedForDate, setAttendanceSavedForDate] = useState(null);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem("darkMode") === "1",
  );

  // Роли: один раз определяем, чтобы не повторять длинные проверки
  const isAdmin = user?.role === "admin";
  const isTeacher = user?.role === "teacher";
  const canEdit = isAdmin || isTeacher;
  const canManageClass = isAdmin;

  useEffect(() => {
    document.documentElement.setAttribute(
      "data-theme",
      darkMode ? "dark" : "light",
    );
    localStorage.setItem("darkMode", darkMode ? "1" : "0");
  }, [darkMode]);

  useEffect(() => {
    setViewAssignmentIds([]);
  }, [selectedClassId]);

  useEffect(() => {
    const saved = localStorage.getItem("user");
    if (saved) {
      try {
        setUser(JSON.parse(saved));
      } catch (_) {}
    }
  }, []);

  useEffect(() => {
    const h = () => setUser(null);
    window.addEventListener("auth:logout", h);
    return () => window.removeEventListener("auth:logout", h);
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };
  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  };

  const fetchClasses = () =>
    apiFetch(`${API}/classes`)
      .then((r) => {
        if (!r.ok)
          return r.json().then((d) => {
            throw new Error(d.error || "Failed");
          });
        return r.json();
      })
      .then((data) => setClasses(dedupeById(Array.isArray(data) ? data : [])))
      .catch((e) => {
        setError(e.message);
        showToast(e.message);
      });

  const refreshStudents = () => {
    if (view === "students")
      apiFetch(`${API}/students`)
        .then((r) =>
          r.ok
            ? r.json()
            : r.json().then((d) => {
                throw new Error(d.error || "Failed");
              }),
        )
        .then((data) => setStudents(dedupeStudents(Array.isArray(data) ? data : [])))
        .catch((e) => {
          setError(e.message);
          showToast(e.message || "Failed to load students");
        });
  };

  const refreshClasses = () => {
    if (view === "classes") fetchClasses();
  };

  const refreshClassDetail = () => {
    if (selectedClassId) {
      setLoading(true);
      Promise.all([
        apiFetch(`${API}/classes/${selectedClassId}/students`).then((r) =>
          r.json(),
        ),
        apiFetch(`${API}/classes/${selectedClassId}/assignments`).then((r) =>
          r.json(),
        ),
      ])
        .then(([st, as]) => {
          setClassStudents(dedupeById(Array.isArray(st) ? st : []));
          setAssignments(dedupeById(Array.isArray(as) ? as : []));
        })
        .catch((e) => {
          showToast(e.message || "Failed to load class");
        })
        .finally(() => setLoading(false));
    }
  };

  useEffect(() => {
    if (view === "classes") {
      setLoading(true);
      setError("");
      fetchClasses().finally(() => setLoading(false));
    }
    if (view === "grades" && user?.role === "student") {
      setLoading(true);
      apiFetch(`${API}/me/grades`)
        .then((r) => r.json())
        .then(setMyGrades)
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
    if (view === "dashboard" || view === "calendar" || view === "assignments") {
      apiFetch(`${API}/me/assignments`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => setAllAssignments(dedupeById(Array.isArray(data) ? data : [])))
        .catch(() => setAllAssignments([]));
      apiFetch(`${API}/announcements`)
        .then((r) => (r.ok ? r.json() : []))
        .then(setAnnouncements)
        .catch(() => setAnnouncements([]));
      apiFetch(`${API}/stats`)
        .then((r) => (r.ok ? r.json() : {}))
        .then(setStats)
        .catch(() =>
          setStats((s) => ({
            ...s,
            classes: 0,
            students: 0,
            assignments: 0,
            new_classes: 0,
            new_assignments: 0,
          })),
        );
    }
    if (view === "students" && canEdit) {
      setLoading(true);
      setError("");
      apiFetch(`${API}/students`)
        .then((r) => {
          if (!r.ok)
            return r.json().then((d) => {
              throw new Error(d.error || "Failed");
            });
          return r.json();
        })
        .then((data) => setStudents(dedupeStudents(Array.isArray(data) ? data : [])))
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [view, user?.role]);

  useEffect(() => {
    if (!user) return;
    apiFetch(`${API}/stats`)
      .then((r) => (r.ok ? r.json() : {}))
      .then(setStats)
      .catch(() =>
        setStats((s) => ({
          ...s,
          classes: 0,
          students: 0,
          assignments: 0,
          new_classes: 0,
          new_assignments: 0,
        })),
      );
  }, [user]);

  // Mark "Classes" / "Assignments" as seen when user opens that view (clears +N badge)
  useEffect(() => {
    if (!user) return;
    if (view === "classes") {
      apiFetch(`${API}/me/seen-classes`, { method: "POST" })
        .then(() => apiFetch(`${API}/stats`))
        .then((r) => (r.ok ? r.json() : {}))
        .then(setStats)
        .catch(() => {});
    }
    if (view === "assignments") {
      apiFetch(`${API}/me/seen-assignments`, { method: "POST" })
        .then(() => apiFetch(`${API}/stats`))
        .then((r) => (r.ok ? r.json() : {}))
        .then(setStats)
        .catch(() => {});
    }
  }, [view, user]);

  useEffect(() => {
    if (!selectedClassId) {
      setClassStudents([]);
      setAssignments([]);
      return;
    }
    setLoading(true);
    setError("");
    Promise.all([
      apiFetch(`${API}/classes/${selectedClassId}/students`).then((r) =>
        r.json(),
      ),
      apiFetch(`${API}/classes/${selectedClassId}/assignments`).then((r) =>
        r.json(),
      ),
    ])
      .then(([st, as]) => {
        setClassStudents(Array.isArray(st) ? st : []);
        setAssignments(Array.isArray(as) ? as : []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedClassId]);
  useEffect(() => {
    setClassGradesSummary(null);
  }, [selectedClassId]);

  useEffect(() => {
    if (!studentMenuOpen) return;
    const close = () => setStudentMenuOpen(null);
    const t = setTimeout(() => document.addEventListener("click", close), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", close);
    };
  }, [studentMenuOpen]);

  useEffect(() => {
    if (!classMenuOpen) return;
    const close = () => setClassMenuOpen(null);
    const t = setTimeout(() => document.addEventListener("click", close), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", close);
    };
  }, [classMenuOpen]);

  useEffect(() => {
    if (!calendarEventMenuOpen) return;
    const close = () => setCalendarEventMenuOpen(null);
    const t = setTimeout(() => document.addEventListener("click", close), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", close);
    };
  }, [calendarEventMenuOpen]);

  useEffect(() => {
    if (view === "calendar" && canEdit) {
      fetchClasses();
    }
  }, [view]);

  useEffect(() => {
    if (view !== "calendar") return;
    apiFetch(`${API}/calendar-events?month=${calendarMonth}`)
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          console.error("Calendar fetch failed:", r.status, err);
          return [];
        }
        return r.json();
      })
      .then((data) => setCalendarEvents(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error("Calendar fetch error:", err);
        setCalendarEvents([]);
      });
  }, [view, calendarMonth]);

  const refreshCalendarEvents = () => {
    apiFetch(`${API}/calendar-events?month=${calendarMonth}`)
      .then(async (r) => {
        if (!r.ok) return [];
        return r.json();
      })
      .then((data) => setCalendarEvents(Array.isArray(data) ? data : []))
      .catch(() => setCalendarEvents([]));
  };

  useEffect(() => {
    if (selectedClassId && canEdit) {
      apiFetch(`${API}/classes/${selectedClassId}/report`)
        .then((r) => (r.ok ? r.json() : []))
        .then(setClassReport)
        .catch(() => setClassReport([]));
    } else {
      setClassReport([]);
    }
  }, [selectedClassId, user?.role]);

  useEffect(() => {
    if (!selectedClassId || !canEdit || !attendanceDate) {
      setAttendanceRecords([]);
      return;
    }
    setAttendanceLoading(true);
    apiFetch(
      `${API}/classes/${selectedClassId}/attendance?date=${attendanceDate}`,
    )
      .then((r) => (r.ok ? r.json() : { records: [] }))
      .then((data) =>
        setAttendanceRecords(Array.isArray(data.records) ? data.records : []),
      )
      .catch(() => setAttendanceRecords([]))
      .finally(() => setAttendanceLoading(false));
    setAttendanceSavedForDate(null);
  }, [selectedClassId, attendanceDate, canEdit]);

  useEffect(() => {
    if (!selectedClassId || !canEdit) {
      setAttendanceSummary(null);
      return;
    }
    apiFetch(`${API}/classes/${selectedClassId}/attendance/summary`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setAttendanceSummary)
      .catch(() => setAttendanceSummary(null));
  }, [selectedClassId, canEdit, attendanceRangeRefresh]);

  const getDue = (a) =>
    a.due_at || a.due_date ? new Date(a.due_at || a.due_date) : null;

  const getUpcomingAssignments = () => {
    const now = new Date();
    const in14 = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    return allAssignments.filter((a) => {
      const d = getDue(a);
      return d && d > now && d <= in14;
    });
  };

  const getOverdueAssignments = () => {
    const now = new Date();
    return allAssignments.filter((a) => {
      const d = getDue(a);
      return d && d < now;
    });
  };

  const isOverdue = (a) => {
    const d = getDue(a);
    return d ? d < new Date() : false;
  };

  const renderContent = () => {
    if (view === "dashboard") {
      if (user?.role === "student") {
        return (
          <StudentDashboard
            onNavigateToClass={(id) => setSelectedClassId(id)}
          />
        );
      }
      const upcoming = getUpcomingAssignments();
      const overdue = getOverdueAssignments();
      return (
        <section className="content">
          <h2>Dashboard</h2>
          <p>
            Welcome, {user?.email}. You are logged in as{" "}
            <strong>{user?.role}</strong>.
          </p>
          {isAdmin && (
            <div className="stats-row">
              <div className="stat-card">
                <span className="stat-value">{stats.students}</span>
                <span className="stat-label">Students</span>
              </div>
            </div>
          )}
          <p className="role-hint">
            {user?.role === "admin" &&
              "You can manage students, classes, and assignments."}
            {user?.role === "teacher" &&
              "You see only your classes. You can add assignments."}
            {user?.role === "student" &&
              "You see only classes you are enrolled in."}
          </p>
          {canEdit && (
            <div className="announcements-section">
              <div className="announcements-header">
                <h3>📢 Announcements</h3>
                <button
                  className={`btn-add ${showAddAnnouncement ? "btn-active" : ""}`}
                  onClick={() => setShowAddAnnouncement((v) => !v)}
                >
                  {showAddAnnouncement ? "− Post" : "+ Post"}
                </button>
              </div>
              {showAddAnnouncement && (
                <div className="announcement-form-block">
                  <AnnouncementForm
                    onDone={() => {
                      setShowAddAnnouncement(false);
                      apiFetch(`${API}/announcements`)
                        .then((r) => (r.ok ? r.json() : []))
                        .then(setAnnouncements)
                        .catch(() => {});
                      showToast("Announcement posted");
                    }}
                    onCancel={() => setShowAddAnnouncement(false)}
                    apiFetch={apiFetch}
                    API={API}
                  />
                </div>
              )}
              {announcements.length === 0 && !showAddAnnouncement ? (
                <p className="announcements-empty">No announcements yet.</p>
              ) : (
                <ul className="announcements-list">
                  {announcements.map((a) => (
                    <li key={a.id} className="announcement-item">
                      <div className="announcement-content">
                        <span className="announcement-email">
                          {a.author_email}
                        </span>
                        <strong>{a.title}</strong>
                        {a.body && <p>{a.body}</p>}
                        <span className="announcement-meta">
                          {a.created_at ? formatDateTime(a.created_at) : ""}
                        </span>
                      </div>
                      {(isAdmin ||
                        (isTeacher && a.author_email === user?.email)) && (
                        <button
                          className="btn-delete btn-small announcement-delete"
                          onClick={async () => {
                            const r = await apiFetch(
                              `${API}/announcements/${a.id}`,
                              {
                                method: "DELETE",
                              },
                            );
                            if (r.ok)
                              setAnnouncements((prev) =>
                                prev.filter((x) => x.id !== a.id),
                              );
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {announcements.length > 0 && user?.role === "student" && (
            <div className="announcements-section">
              <h3>📢 Announcements</h3>
              <ul className="announcements-list">
                {announcements.slice(0, 5).map((a) => (
                  <li key={a.id} className="announcement-item">
                    <div className="announcement-content">
                      <span className="announcement-email">
                        {a.author_email}
                      </span>
                      <strong>{a.title}</strong>
                      {a.body && <p>{a.body}</p>}
                      <span className="announcement-meta">
                        {a.created_at ? formatDateTime(a.created_at) : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {overdue.length > 0 && (
            <div className="upcoming-section overdue-section">
              <h3>⚠️ Overdue</h3>
              <ul className="upcoming-list">
                {overdue.slice(0, 5).map((a) => (
                  <li key={a.id} className="upcoming-item overdue-item">
                    <span>{a.title}</span>
                    <span className="upcoming-class">
                      {a.course_name} {a.section_code}
                    </span>
                    <span className="upcoming-date">
                      {formatDateTime(a.due_at || a.due_date)} —{" "}
                      {dueDateLabel(a.due_at || a.due_date)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {upcoming.length > 0 && (
            <div className="upcoming-section">
              <h3>📅 Upcoming (next 14 days)</h3>
              <ul className="upcoming-list">
                {upcoming.slice(0, 8).map((a) => (
                  <li key={a.id} className="upcoming-item">
                    <span>{a.title}</span>
                    <span className="upcoming-class">
                      {a.course_name} {a.section_code}
                    </span>
                    <span className="upcoming-date">
                      {formatDateTime(a.due_at || a.due_date)} —{" "}
                      {dueDateLabel(a.due_at || a.due_date)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      );
    }
    if (view === "classes") {
      const canAddAssignment = selectedClassId && canEdit;
      const classesList = Array.isArray(classes) ? classes : [];
      return (
        <section className="content view-classes">
          <h2>Classes</h2>
          {canManageClass && (
            <button className="btn-add" onClick={() => setShowAddClass(true)}>
              + Add class
            </button>
          )}
          {editClassId && (
            <EditClassForm
              classData={classesList.find((c) => c.id === editClassId)}
              onDone={() => {
                setEditClassId(null);
                refreshClasses();
                showToast("Class updated");
              }}
              onCancel={() => setEditClassId(null)}
              apiFetch={apiFetch}
              API={API}
            />
          )}
          {showAddClass && (
            <CreateClassForm
              onDone={() => {
                setShowAddClass(false);
                refreshClasses();
                showToast("Class created");
              }}
              onCancel={() => setShowAddClass(false)}
              apiFetch={apiFetch}
              API={API}
            />
          )}
          {error && <p className="msg-error">{error}</p>}
          {loading && !classesList.length ? (
            <p>Loading...</p>
          ) : (
            <>
              {classesList.length > 0 && (
                <div className="filter-row">
                  <label>Year:</label>
                  <input
                    type="text"
                    placeholder="e.g. 2024-2025"
                    value={filterClassYear}
                    onChange={(e) => setFilterClassYear(e.target.value)}
                    className="filter-input"
                  />
                </div>
              )}
              <div className="class-grid">
                {classesList
                  .filter(
                    (c) =>
                      !filterClassYear ||
                      (c.school_year || "")
                        .toLowerCase()
                        .includes(filterClassYear.toLowerCase()),
                  )
                  .map((c) => (
                    <div
                      key={c.id}
                      className={`class-card ${
                        selectedClassId === c.id ? "selected" : ""
                      }`}
                      onClick={() =>
                        setSelectedClassId(
                          selectedClassId === c.id ? null : c.id,
                        )
                      }
                    >
                      <h3>
                        {c.course_name} — Section {c.section_code}
                      </h3>
                      <p className="teacher">
                        {c.teacher_first} {c.teacher_last}
                      </p>
                      <p className="year">{c.school_year}</p>
                      {canManageClass && (
                        <div
                          className="card-actions card-actions-expandable"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {classMenuOpen === c.id ? (
                            <div className="expandable-buttons">
                              <button
                                type="button"
                                className="btn-small"
                                onClick={() => {
                                  setEditClassId(c.id);
                                  setClassMenuOpen(null);
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="btn-delete"
                                onClick={() => {
                                  setClassMenuOpen(null);
                                  setConfirmModal({
                                    title: "Delete class",
                                    message: `Delete ${c.course_name} Section ${c.section_code}?`,
                                    onConfirm: async () => {
                                      const r = await apiFetch(
                                        `${API}/classes/${c.id}`,
                                        { method: "DELETE" },
                                      );
                                      if (r.ok) {
                                        setSelectedClassId(null);
                                        refreshClasses();
                                        setConfirmModal(null);
                                      }
                                    },
                                  });
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="btn-icon btn-menu"
                              onClick={(e) => {
                                e.stopPropagation();
                                setClassMenuOpen(c.id);
                              }}
                              title="Actions"
                            >
                              ⋯
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </>
          )}
          {selectedClassId && (
            <div className="class-detail">
              <div className="syllabus-block">
                <ClassSyllabus
                  classId={selectedClassId}
                  apiFetch={apiFetch}
                  API={API}
                  canEdit={canEdit}
                  showToast={showToast}
                  extraActions={
                    canEdit && (
                      <>
                        <button
                          type="button"
                          className="btn-small"
                          onClick={() => {
                            setShowCategoryWeightsModal(true);
                            apiFetch(
                              `${API}/classes/${selectedClassId}/category-weights`,
                            )
                              .then((r) => (r.ok ? r.json() : {}))
                              .then(setCategoryWeights)
                              .catch(() => setCategoryWeights({}));
                          }}
                        >
                          Grading weights
                        </button>
                        <button
                          type="button"
                          className="btn-small"
                          onClick={() => {
                            if (classGradesSummary) setClassGradesSummary(null);
                            else {
                              apiFetch(
                                `${API}/classes/${selectedClassId}/gradebook`,
                              )
                                .then((r) => (r.ok ? r.json() : null))
                                .then(setClassGradesSummary)
                                .catch(() => setClassGradesSummary(null));
                            }
                          }}
                        >
                          {classGradesSummary
                            ? "Hide grade summary"
                            : "View grade summary"}
                        </button>
                      </>
                    )
                  }
                />
              </div>
              {Array.isArray(classGradesSummary?.students) &&
                classGradesSummary.students.length > 0 && (
                  <div className="class-detail-section grades-summary-below-buttons">
                    <table className="student-table grades-summary-table">
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>Final %</th>
                          <th>Letter</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(classGradesSummary.students || []).map((s) => (
                          <tr key={s.id}>
                            <td>
                              {s.first_name} {s.last_name}
                            </td>
                            <td>
                              {s.final_percent != null
                                ? `${s.final_percent}%`
                                : "—"}
                            </td>
                            <td className="letter-grade">
                              {s.letter_grade ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              {canManageClass && (
              <div className="class-detail-section">
                <h3>Students</h3>
                <div className="students-header">
                  {canManageClass && (
                    <button
                      className="btn-small"
                      onClick={() => setShowEnrollStudent(true)}
                    >
                      + Enroll student
                    </button>
                  )}
                  <select
                    value={sortStudentsBy}
                    onChange={(e) => setSortStudentsBy(e.target.value)}
                    className="sort-select"
                  >
                    <option value="name">Sort by name</option>
                    <option value="grade">Sort by grade</option>
                  </select>
                </div>
                {showEnrollStudent && canManageClass && (
                  <EnrollStudentForm
                    classId={selectedClassId}
                    enrolledIds={(Array.isArray(classStudents)
                      ? classStudents
                      : []
                    ).map((s) => s.id)}
                    onDone={() => {
                      setShowEnrollStudent(false);
                      refreshClassDetail();
                    }}
                    onCancel={() => setShowEnrollStudent(false)}
                    apiFetch={apiFetch}
                    API={API}
                  />
                )}
                {loading ? (
                  <p>Loading...</p>
                ) : (
                  <ul>
                    {[...(Array.isArray(classStudents) ? classStudents : [])]
                      .sort((a, b) => {
                        if (sortStudentsBy === "grade")
                          return (a.grade_level ?? 0) - (b.grade_level ?? 0);
                        return `${a.last_name} ${a.first_name}`.localeCompare(
                          `${b.last_name} ${b.first_name}`,
                        );
                      })
                      .map((s) => (
                        <li key={s.id} className="assignment-row">
                          <span>
                            {s.first_name} {s.last_name} (Grade {s.grade_level})
                          </span>
                          {canManageClass && (
                            <button
                              className="btn-delete"
                              onClick={async () => {
                                const r = await apiFetch(
                                  `${API}/classes/${selectedClassId}/enrollments/${s.id}`,
                                  { method: "DELETE" },
                                );
                                if (r.ok) refreshClassDetail();
                              }}
                            >
                              Remove
                            </button>
                          )}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
              )}
              {canEdit && (
                <div className="class-detail-section attendance-section">
                  <h3>Attendance</h3>
                  {attendanceLoading ? (
                    <p className="text-muted">Loading attendance...</p>
                  ) : attendanceRecords.length === 0 ? (
                    <p className="text-muted">No students in this class.</p>
                  ) : (
                    <div className="attendance-unified">
                      <div className="attendance-toolbar-inline attendance-toolbar-top">
                        <label className="attendance-date-label">
                          Date
                          <input
                            type="date"
                            value={attendanceDate}
                            onChange={(e) => setAttendanceDate(e.target.value)}
                            className="attendance-date-input"
                          />
                        </label>
                        <button
                          type="button"
                          className="btn-small btn-confirm"
                          disabled={attendanceSavedForDate === attendanceDate}
                          onClick={async () => {
                            const payload = {
                              date: attendanceDate,
                              records: attendanceRecords.map((rec) => ({
                                student_id: rec.student_id,
                                status: rec.status || "present",
                              })),
                            };
                            const res = await apiFetch(
                              `${API}/classes/${selectedClassId}/attendance`,
                              {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(payload),
                              },
                            );
                            if (res.ok) {
                              showToast("Attendance saved");
                              setAttendanceSavedForDate(attendanceDate);
                              setAttendanceRangeRefresh((t) => t + 1);
                            } else {
                              const data = await parseJson(res).catch(() => ({}));
                              showToast(data?.error || "Failed to save");
                            }
                          }}
                        >
                          Save
                        </button>
                      </div>
                      <div className="attendance-table-wrap">
                        <table className="student-table attendance-table">
                        <tbody>
                          {attendanceRecords.map((r) => {
                            const status = r.status || "present";
                            return (
                              <tr key={r.student_id}>
                                <td>
                                  {r.first_name} {r.last_name}
                                </td>
                                <td>
                                  <select
                                    value={status}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setAttendanceSavedForDate(null);
                                      setAttendanceRecords((prev) =>
                                        prev.map((x) =>
                                          x.student_id === r.student_id
                                            ? { ...x, status: val }
                                            : x,
                                        ),
                                      );
                                    }}
                                    className={`attendance-status-select attendance-status-${status}`}
                                  >
                                    <option value="present">Present</option>
                                    <option value="absent">Absent</option>
                                    <option value="tardy">Tardy</option>
                                    <option value="excused">Excused</option>
                                  </select>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      </div>
                      <div className="attendance-donuts-wrap">
                      <div className="attendance-infographic-donut attendance-donut-daily">
                        {(() => {
                          const p = attendanceRecords.filter((r) => (r.status || "present") === "present").length;
                          const a = attendanceRecords.filter((r) => r.status === "absent").length;
                          const t = attendanceRecords.filter((r) => r.status === "tardy").length;
                          const e = attendanceRecords.filter((r) => r.status === "excused").length;
                          const total = p + a + t + e;
                          if (total === 0) {
                            return (
                              <div className="donut-chart-wrap">
                                <span className="donut-title">On lesson</span>
                                <div className="donut-empty">
                                  <span>No data</span>
                                </div>
                              </div>
                            );
                          }
                          const pp = (p / total) * 100;
                          const ap = (a / total) * 100;
                          const tp = (t / total) * 100;
                          const ep = (e / total) * 100;
                          const segs = [
                            { pct: pp, cnt: p, color: "#22c55e", label: "Present" },
                            { pct: ap, cnt: a, color: "#ef4444", label: "Absent" },
                            { pct: tp, cnt: t, color: "#f59e0b", label: "Tardy" },
                            { pct: ep, cnt: e, color: "#6366f1", label: "Excused" },
                          ].filter((s) => s.pct > 0);
                          let offset = 0;
                          const presentPct = Math.round((p / total) * 100);
                          return (
                            <div className="donut-block">
                              <div className="donut-chart-wrap">
                                <span className="donut-title">On lesson</span>
                                <div className="donut-chart" aria-hidden="true">
                                <svg viewBox="0 0 36 36" className="donut-svg">
                                  {segs.map((seg, i) => {
                                    const dash = `${seg.pct} ${100 - seg.pct}`;
                                    const dashOffset = -offset;
                                    offset += seg.pct;
                                    return (
                                      <circle
                                        key={i}
                                        className="donut-segment"
                                        cx="18"
                                        cy="18"
                                        r="15.9"
                                        fill="none"
                                        stroke={seg.color}
                                        strokeWidth="3"
                                        strokeDasharray={dash}
                                        strokeDashoffset={dashOffset}
                                        transform="rotate(-90 18 18)"
                                      />
                                    );
                                  })}
                                </svg>
                                <span className="donut-center donut-center-pct">{presentPct}%</span>
                              </div>
                              </div>
                              <ul className="donut-legend donut-legend-numbers">
                                {segs.map((s, i) => (
                                  <li key={i}>
                                    <span className="donut-legend-dot" style={{ background: s.color }} />
                                    {s.label}: <strong>{s.cnt}</strong>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })()}
                      </div>
                      <div className="attendance-infographic-donut attendance-donut-overall">
                        {(() => {
                          if (!attendanceSummary) {
                            return (
                              <div className="donut-chart-wrap">
                                <span className="donut-title">Overall</span>
                                <div className="donut-empty"><span>No data yet</span></div>
                              </div>
                            );
                          }
                          const total = attendanceSummary.total || 0;
                          const p = attendanceSummary.present || 0;
                          const a = attendanceSummary.absent || 0;
                          const t = attendanceSummary.tardy || 0;
                          const e = attendanceSummary.excused || 0;
                          if (total === 0) {
                            return (
                              <div className="donut-chart-wrap">
                                <span className="donut-title">Overall</span>
                                <div className="donut-empty">
                                  <span>No data yet</span>
                                </div>
                              </div>
                            );
                          }
                          const pp = (p / total) * 100;
                          const ap = (a / total) * 100;
                          const tp = (t / total) * 100;
                          const ep = (e / total) * 100;
                          const segs = [
                            { pct: pp, color: "#22c55e", label: "Present" },
                            { pct: ap, color: "#ef4444", label: "Absent" },
                            { pct: tp, color: "#f59e0b", label: "Tardy" },
                            { pct: ep, color: "#6366f1", label: "Excused" },
                          ].filter((s) => s.pct > 0);
                          let offset = 0;
                          return (
                            <div className="donut-block">
                              <div className="donut-chart-wrap">
                                <span className="donut-title">Overall</span>
                                <div className="donut-chart" aria-hidden="true">
                                  <svg viewBox="0 0 36 36" className="donut-svg">
                                    {segs.map((s, i) => {
                                      const dash = `${s.pct} ${100 - s.pct}`;
                                      const dashOffset = -offset;
                                      offset += s.pct;
                                      return (
                                        <circle
                                          key={i}
                                          className="donut-segment"
                                          cx="18"
                                          cy="18"
                                          r="15.9"
                                          fill="none"
                                          stroke={s.color}
                                          strokeWidth="3"
                                          strokeDasharray={dash}
                                          strokeDashoffset={dashOffset}
                                          transform="rotate(-90 18 18)"
                                        />
                                      );
                                    })}
                                  </svg>
                                  <span className="donut-center">{attendanceSummary.present_pct}%</span>
                                </div>
                              </div>
                              <ul className="donut-legend">
                                {segs.map((s, i) => (
                                  <li key={i}>
                                    <span className="donut-legend-dot" style={{ background: s.color }} />
                                    {s.label}: {Math.round(s.pct)}%
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })()}
                      </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="class-detail-section assignments-section">
                <h3>Assignments</h3>
                <div className="assignments-header">
                  {canAddAssignment && (
                    <button
                      className={`btn-add ${showAddAssignment ? "btn-active" : ""}`}
                      type="button"
                      onClick={() => setShowAddAssignment((v) => !v)}
                    >
                      {showAddAssignment
                        ? "− Add Assignment"
                        : "+ Add Assignment"}
                    </button>
                  )}
                </div>
                <div className="assignments-inner">
                {showAddAssignment && canAddAssignment && (
                  <div className="announcement-form-block">
                    <AddAssignmentForm
                      classId={selectedClassId}
                      onDone={() => {
                        setShowAddAssignment(false);
                        refreshClassDetail();
                        showToast("Assignment added");
                      }}
                      onCancel={() => setShowAddAssignment(false)}
                      apiFetch={apiFetch}
                      API={API}
                    />
                  </div>
                )}
                {loading ? null : (
                  <ul className="assignments-in-class-list">
                    {(Array.isArray(assignments) ? assignments : []).map(
                      (a) => (
                        <li
                          key={a.id}
                          className={`assignment-row ${viewAssignmentIds.includes(a.id) ? "assignment-row-open" : ""}`}
                        >
                          <button
                            type="button"
                            className="assignment-row-header"
                            onClick={() => {
                              const isOpen = viewAssignmentIds.includes(a.id);
                              if (isOpen) {
                                setViewAssignmentIds((prev) => prev.filter((id) => id !== a.id));
                              } else {
                                setViewAssignmentIds((prev) => {
                                  const next = [...prev, a.id];
                                  if (next.length > 3) return next.slice(1);
                                  return next;
                                });
                              }
                            }}
                            aria-expanded={viewAssignmentIds.includes(a.id)}
                          >
                            <span className="assignment-row-title-wrap">
                              <span className="assignment-toggle">{a.title}</span>
                              <span className="assignment-row-points">max {a.max_points} pts</span>
                            </span>
                            <span className="assignment-row-right">
                              <span className="assignment-row-date">
                                due {formatDateTime(a.due_at || a.due_date)}
                              </span>
                              <span className="assignment-row-chevron">
                                {viewAssignmentIds.includes(a.id) ? "▲" : "▼"}
                              </span>
                            </span>
                          </button>
                          {viewAssignmentIds.includes(a.id) && (
                            <div className="assignment-content">
                              {a.description ? (
                                <RichContentDisplay html={a.description} />
                              ) : (
                                <p className="text-muted">No description.</p>
                              )}
                              <AssignmentAttachments
                                assignmentId={a.id}
                                apiFetch={apiFetch}
                                API={API}
                                canEdit={canEdit}
                              />
                              <AssignmentSubmission
                                ref={viewAssignmentIds.includes(a.id) && editSubmissionsAssignmentId === a.id ? submissionSaveRef : null}
                                assignmentId={a.id}
                                dueAt={a.due_at || a.due_date}
                                apiFetch={apiFetch}
                                API={API}
                                isStudent={user?.role === "student"}
                                canEdit={canEdit}
                                showToast={showToast}
                                maxPoints={a.max_points}
                                editMode={editSubmissionsAssignmentId === a.id}
                              />
                              {canEdit && (
                                <div className="assignment-content-actions">
                                  <button
                                    className={`btn-small ${
                                      editSubmissionsAssignmentId === a.id
                                        ? "btn-active btn-confirm"
                                        : ""
                                    }`}
                                    onClick={async () => {
                                      if (editSubmissionsAssignmentId === a.id) {
                                        setEditSubmissionsSaving(true);
                                        try {
                                          await submissionSaveRef.current?.();
                                          setEditSubmissionsAssignmentId(null);
                                          refreshClassDetail();
                                          showToast("Saved");
                                        } finally {
                                          setEditSubmissionsSaving(false);
                                        }
                                      } else {
                                        setEditSubmissionsAssignmentId(a.id);
                                      }
                                    }}
                                    disabled={editSubmissionsSaving}
                                  >
                                    {editSubmissionsSaving ? "Saving…" : editSubmissionsAssignmentId === a.id ? "Save" : "Edit"}
                                  </button>
                                  <button
                                    className="btn-delete btn-small"
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setConfirmModal({
                                        title: "Delete assignment",
                                        message: `Delete "${a.title}"?`,
                                        onConfirm: async () => {
                                          const r = await apiFetch(
                                            `${API}/assignments/${a.id}`,
                                            { method: "DELETE" },
                                          );
                                          const data = r.ok
                                            ? null
                                            : await parseJson(r).catch(
                                                () => ({}),
                                              );
                                          if (r.ok) {
                                            setConfirmModal(null);
                                            refreshClassDetail();
                                            showToast("Assignment deleted");
                                          } else {
                                            showToast(
                                              data?.error || "Delete failed",
                                            );
                                          }
                                        },
                                      });
                                    }}
                                  >
                                    Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </li>
                      ),
                    )}
                    {assignments.length === 0 && !showAddAssignment && (
                      <li>No assignments yet.</li>
                    )}
                  </ul>
                )}
                </div>
                {canEdit && classReport.length > 0 && (
                  <div className="class-report card-block">
                    <button
                      type="button"
                      className="report-tab-trigger"
                      onClick={() => setShowAssignmentAverages((prev) => !prev)}
                      aria-expanded={showAssignmentAverages}
                    >
                      <h3 className="report-title">Assignment averages</h3>
                      <span className="report-tab-chevron">{showAssignmentAverages ? "▲" : "▼"}</span>
                    </button>
                    {showAssignmentAverages && (
                    <>
                    <div className="report-header">
                      <div className="report-title-wrap">
                        <p className="report-subtitle">
                          Per-assignment class averages (gradebook report)
                        </p>
                      </div>
                      <div className="report-actions">
                        <button
                          className="btn-small btn-export"
                          onClick={async () => {
                            const r = await apiFetch(
                              `${API}/classes/${selectedClassId}/gradebook`,
                            );
                            if (!r.ok) return;
                            const { students, assignments, gradeMap } =
                              await r.json();
                            const rows = students.map((s) => {
                              const row = {
                                Student: `${s.first_name} ${s.last_name}`,
                              };
                              assignments.forEach((a) => {
                                row[a.title] =
                                  gradeMap[`${s.id}-${a.id}`] ?? "";
                              });
                              return row;
                            });
                            const headers = [
                              "Student",
                              ...assignments.map((a) => a.title),
                            ];
                            downloadCSV(
                              `gradebook-class-${selectedClassId}.csv`,
                              rows,
                              headers,
                            );
                            showToast("Gradebook exported");
                          }}
                        >
                          Export full gradebook
                        </button>
                        <button
                          className="btn-small btn-export"
                          onClick={() => {
                            const rows = classReport.map((r) => {
                              const max = Number(r.max_points);
                              const avg =
                                r.avg_score != null
                                  ? Number(r.avg_score)
                                  : null;
                              const pct =
                                max > 0 && avg != null
                                  ? ((avg / max) * 100).toFixed(1)
                                  : "";
                              return {
                                Assignment: r.title,
                                Category: r.category ?? "",
                                "Avg score": r.avg_score ?? "",
                                "Avg %": pct || "",
                                Max: r.max_points,
                                Graded: r.graded_count,
                              };
                            });
                            downloadCSV(
                              `report-class-${selectedClassId}.csv`,
                              rows,
                              [
                                "Assignment",
                                "Category",
                                "Avg score",
                                "Avg %",
                                "Max",
                                "Graded",
                              ],
                            );
                            showToast("Report exported");
                          }}
                        >
                          Export report (CSV)
                        </button>
                      </div>
                    </div>
                    <div className="report-table-wrap">
                      <table className="student-table report-averages-table">
                        <thead>
                          <tr>
                            <th>Assignment</th>
                            <th className="th-category">Category</th>
                            <th className="th-num">Avg %</th>
                            <th className="th-num">Avg score</th>
                            <th className="th-num">Max</th>
                            <th className="th-num">Graded</th>
                          </tr>
                        </thead>
                        <tbody>
                          {classReport.map((r) => {
                            const max = Number(r.max_points);
                            const avg =
                              r.avg_score != null ? Number(r.avg_score) : null;
                            const pct =
                              max > 0 && avg != null
                                ? ((avg / max) * 100).toFixed(1)
                                : null;
                            return (
                              <tr key={r.id}>
                                <td className="td-assignment">{r.title}</td>
                                <td className="td-category">
                                  {r.category ?? "—"}
                                </td>
                                <td className="td-num td-pct">
                                  {pct != null ? `${pct}%` : "—"}
                                </td>
                                <td className="td-num">{r.avg_score ?? "—"}</td>
                                <td className="td-num">{r.max_points}</td>
                                <td className="td-num">{r.graded_count}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    </>
                    )}
                  </div>
                )}
                <div className="class-detail-section">
                  {editAssignmentId && (
                    <EditAssignmentForm
                      assignment={assignments.find(
                        (a) => a.id === editAssignmentId,
                      )}
                      onDone={() => {
                        setEditAssignmentId(null);
                        refreshClassDetail();
                        showToast("Assignment updated");
                      }}
                      onCancel={() => setEditAssignmentId(null)}
                      apiFetch={apiFetch}
                      API={API}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      );
    }
    if (view === "students") {
      const canManage = canManageClass;
      const canViewProfile = isTeacher || isAdmin;
      const uniqueStudents = dedupeStudents(students);
      const filteredStudents = uniqueStudents.filter((s) => {
        const q = searchStudents.toLowerCase().trim();
        if (!q) return true;
        const name = `${s.first_name} ${s.last_name}`.toLowerCase();
        return name.includes(q) || String(s.grade_level).includes(q);
      });
      if (selectedStudentProfileId && canViewProfile) {
        const profileStudent = uniqueStudents.find((s) => s.id === selectedStudentProfileId);
        return (
          <StudentDashboard
            studentId={selectedStudentProfileId}
            studentName={profileStudent ? `${profileStudent.first_name} ${profileStudent.last_name}` : ""}
            onBack={() => setSelectedStudentProfileId(null)}
            onNavigateToClass={(id) => {
              setSelectedStudentProfileId(null);
              setSelectedClassId(id);
              setView("classes");
            }}
          />
        );
      }

      return (
        <section className="content">
          <h2>Students</h2>
          {uniqueStudents.length > 0 && (
            <div className="filter-row">
              <input
                type="text"
                placeholder="Search by name or grade..."
                value={searchStudents}
                onChange={(e) => setSearchStudents(e.target.value)}
                className="filter-input"
              />
            </div>
          )}
          {error && <p className="msg-error">{error}</p>}
          {canManage && (
            <div className="students-actions-row">
              <button className="btn-add" onClick={() => setShowAddStudent(true)}>
                + Add student
              </button>
              {selectedStudentIds.length > 0 && (
                <>
                  <button
                    className="btn-secondary"
                    onClick={async () => {
                      for (const id of selectedStudentIds) {
                        await apiFetch(`${API}/students/${id}`, {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ inactive: true }),
                        });
                      }
                      setSelectedStudentIds([]);
                      refreshStudents();
                      showToast("Students set inactive");
                    }}
                  >
                    Make inactive ({selectedStudentIds.length})
                  </button>
                  <button
                    className="btn-delete"
                    onClick={() =>
                      setConfirmModal({
                        title: "Delete selected students",
                      message: `Delete ${selectedStudentIds.length} student${selectedStudentIds.length !== 1 ? "s" : ""}?`,
                      onConfirm: async () => {
                        for (const id of selectedStudentIds) {
                          await apiFetch(`${API}/students/${id}`, {
                            method: "DELETE",
                          });
                        }
                        setSelectedStudentIds([]);
                        refreshStudents();
                        setConfirmModal(null);
                        showToast("Deleted");
                      },
                    })
                  }
                >
                  Delete selected ({selectedStudentIds.length})
                </button>
                </>
              )}
            </div>
          )}
          {showAddStudent && (
            <AddStudentForm
              onDone={() => {
                setShowAddStudent(false);
                refreshStudents();
                showToast("Student added");
              }}
              onCancel={() => setShowAddStudent(false)}
              apiFetch={apiFetch}
              API={API}
            />
          )}
          {editStudentId && (
            <EditStudentForm
              student={students.find((s) => s.id === editStudentId)}
              onDone={() => {
                setEditStudentId(null);
                refreshStudents();
                showToast("Student updated");
              }}
              onCancel={() => setEditStudentId(null)}
              apiFetch={apiFetch}
              API={API}
            />
          )}
          {loading ? (
            <p>Loading...</p>
          ) : (
            <table className="student-table">
              <thead>
                <tr>
                  {canManage && (
                    <th className="col-checkbox">
                      <input
                        type="checkbox"
                        checked={
                          filteredStudents.length > 0 &&
                          filteredStudents.every((s) =>
                            selectedStudentIds.includes(s.id),
                          )
                        }
                        onChange={(e) => {
                          if (e.target.checked)
                            setSelectedStudentIds(filteredStudents.map((s) => s.id));
                          else setSelectedStudentIds([]);
                        }}
                        title="Select all"
                      />
                    </th>
                  )}
                  <th>Name</th>
                  <th>Grade Level</th>
                  {canManage && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((s) => (
                  <tr key={s.id} className={s.inactive ? "student-inactive" : ""}>
                    {canManage && (
                      <td className="col-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedStudentIds.includes(s.id)}
                          onChange={(e) => {
                            if (e.target.checked)
                              setSelectedStudentIds((prev) => [...prev, s.id]);
                            else
                              setSelectedStudentIds((prev) =>
                                prev.filter((id) => id !== s.id),
                              );
                          }}
                        />
                      </td>
                    )}
                    <td
                      className={canViewProfile ? "student-name-clickable" : ""}
                      onClick={
                        canViewProfile
                          ? (e) => {
                              if (e.target.closest(".dropdown-wrap")) return;
                              setSelectedStudentProfileId(s.id);
                            }
                          : undefined
                      }
                    >
                      {s.first_name} {s.last_name}
                    </td>
                    <td>{s.grade_level}</td>
                    {canManage && (
                      <td>
                        <div className="dropdown-wrap">
                          <button
                            type="button"
                            className="btn-icon btn-menu"
                            onClick={(e) => {
                              e.stopPropagation();
                              setStudentMenuOpen(
                                studentMenuOpen === s.id ? null : s.id,
                              );
                            }}
                            title="Actions"
                          >
                            ⋯
                          </button>
                          {studentMenuOpen === s.id && (
                            <div
                              className="dropdown-menu"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                className="dropdown-item"
                                onClick={() => {
                                  setEditStudentId(s.id);
                                  setStudentMenuOpen(null);
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="dropdown-item"
                                onClick={async () => {
                                  setStudentMenuOpen(null);
                                  await apiFetch(`${API}/students/${s.id}`, {
                                    method: "PUT",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      inactive: !s.inactive,
                                    }),
                                  });
                                  refreshStudents();
                                  showToast(s.inactive ? "Student activated" : "Student set inactive");
                                }}
                              >
                                {s.inactive ? "Make active" : "Make inactive"}
                              </button>
                              <button
                                type="button"
                                className="dropdown-item dropdown-item-danger"
                                onClick={() => {
                                  setStudentMenuOpen(null);
                                  setConfirmModal({
                                    title: "Delete student",
                                    message: `Delete ${s.first_name} ${s.last_name}?`,
                                    onConfirm: async () => {
                                      await apiFetch(`${API}/students/${s.id}`, {
                                        method: "DELETE",
                                      });
                                      refreshStudents();
                                      setConfirmModal(null);
                                    },
                                  });
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      );
    }
    if (view === "calendar") {
      const [year, month] = calendarMonth.split("-").map(Number);
      const first = new Date(year, month - 1, 1);
      const last = new Date(year, month, 0);
      const startWeekday = first.getDay();
      const daysInMonth = last.getDate();
      const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
      const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const toYMD = (d) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const todayStr = toYMD(new Date());
      const cells = [];
      for (let i = 0; i < totalCells; i++) {
        const dayOffset = i - startWeekday;
        const d = new Date(year, month - 1, 1 + dayOffset);
        const dateStr = toYMD(d);
        const isCurrentMonth = d.getMonth() === month - 1;
        const assignmentEvents = allAssignments
          .filter((a) => {
            const due = getDue(a);
            if (!due) return false;
            return toYMD(due) === dateStr;
          })
          .map((a) => ({ ...a, _type: "assignment", _key: `a-${a.id}` }));
        const toEventDate = (v) =>
          !v ? "" : typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : toYMD(new Date(v));
        const calendarEvs = (calendarEvents || [])
          .filter((e) => toEventDate(e.event_date) === dateStr)
          .map((e) => ({
            ...e,
            _type: "event",
            _key: `e-${e.id}`,
            course_name: e.classes?.[0]?.course_name ?? "",
            section_code: e.classes?.[0]?.section_code ?? "",
          }));
        const events = [...assignmentEvents, ...calendarEvs];
        cells.push({ dateStr, dayNum: d.getDate(), isCurrentMonth, events });
      }
      const monthLabel = first.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });
      return (
        <section className="content">
          <div className="calendar-header">
            <div className="calendar-header-left">
              <h2>📅 Calendar</h2>
              {canEdit && (
                <button
                  type="button"
                  className={`btn-small ${(showAddCalendarEvent || editCalendarEvent) ? "btn-active" : ""}`}
                  onClick={() => {
                    if (showAddCalendarEvent || editCalendarEvent) {
                      setShowAddCalendarEvent(false);
                      setEditCalendarEvent(null);
                    } else {
                      setShowAddCalendarEvent(true);
                    }
                  }}
                >
                  {(showAddCalendarEvent || editCalendarEvent) ? "− Add event" : "+ Add event"}
                </button>
              )}
            </div>
            <div className="calendar-nav">
              <button
                type="button"
                className="btn-small"
                onClick={() => {
                  const [y, m] = calendarMonth.split("-").map(Number);
                  if (m === 1) setCalendarMonth(`${y - 1}-12`);
                  else
                    setCalendarMonth(`${y}-${String(m - 1).padStart(2, "0")}`);
                }}
              >
                ← Prev
              </button>
              <span className="calendar-month-title">{monthLabel}</span>
              <button
                type="button"
                className="btn-small"
                onClick={() => {
                  const [y, m] = calendarMonth.split("-").map(Number);
                  if (m === 12) setCalendarMonth(`${y + 1}-01`);
                  else
                    setCalendarMonth(`${y}-${String(m + 1).padStart(2, "0")}`);
                }}
              >
                Next →
              </button>
            </div>
          </div>
          {(showAddCalendarEvent || editCalendarEvent) && canEdit && (
            <AddCalendarEventForm
              classes={classes}
              defaultDate={`${calendarMonth}-01`}
              editEvent={editCalendarEvent}
              onDone={() => {
                setShowAddCalendarEvent(false);
                setEditCalendarEvent(null);
                refreshCalendarEvents();
                showToast(editCalendarEvent ? "Event updated" : "Event added");
              }}
              onCancel={() => {
                setShowAddCalendarEvent(false);
                setEditCalendarEvent(null);
              }}
            />
          )}
          <div className="calendar-grid-wrap">
            <table className="calendar-grid">
              <thead>
                <tr>
                  {dayLabels.map((label) => (
                    <th key={label} className="calendar-day-name">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: totalCells / 7 }, (_, week) => (
                  <tr key={week}>
                    {cells.slice(week * 7, week * 7 + 7).map((cell) => (
                      <td
                        key={cell.dateStr}
                        className={`calendar-cell ${!cell.isCurrentMonth ? "calendar-cell-other" : ""} ${cell.dateStr === todayStr ? "calendar-cell-today" : ""}`}
                      >
                        <span className="calendar-cell-num">{cell.dayNum}</span>
                        <ul className="calendar-cell-events">
                          {cell.events.map((item) => {
                            const canEditEvent =
                              item._type === "event" &&
                              canEdit &&
                              (isAdmin || item.user_id === user?.id);
                            return (
                              <li
                                key={item._key}
                                className={
                                  item._type === "assignment" && isOverdue(item)
                                    ? "calendar-event-overdue"
                                    : item._type === "event"
                                      ? "calendar-event calendar-event-teacher"
                                      : "calendar-event"
                                }
                                title={
                                  item.classes?.length
                                    ? item.classes.map((c) => `${c.course_name} — ${c.section_code}`).join(", ")
                                    : `${item.course_name || ""} — ${item.section_code || ""}`.trim() || item.title
                                }
                              >
                                <div className="calendar-event-inner">
                                  <span className="calendar-event-title">
                                    {item.title}
                                  </span>
                                  {canEditEvent && (
                                    <div
                                      className="calendar-event-actions"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {calendarEventMenuOpen === item.id ? (
                                        <div className="expandable-buttons">
                                          <button
                                            type="button"
                                            className="btn-small"
                                            onClick={() => {
                                              setEditCalendarEvent(item);
                                              setCalendarEventMenuOpen(null);
                                            }}
                                          >
                                            Edit
                                          </button>
                                          <button
                                            type="button"
                                            className="btn-delete btn-small"
                                            onClick={() => {
                                              setCalendarEventMenuOpen(null);
                                              setConfirmModal({
                                                title: "Delete event",
                                                message: `Delete "${item.title}"?`,
                                                onConfirm: async () => {
                                                  const r = await apiFetch(
                                                    `${API}/calendar-events/${item.id}`,
                                                    { method: "DELETE" }
                                                  );
                                                  if (r.ok) {
                                                    refreshCalendarEvents();
                                                    setConfirmModal(null);
                                                    showToast("Event deleted");
                                                  }
                                                },
                                              });
                                            }}
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          type="button"
                                          className="btn-icon btn-menu"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setCalendarEventMenuOpen(item.id);
                                          }}
                                          title="Actions"
                                        >
                                          ⋯
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );
    }
    if (view === "profile") {
      return (
        <section className="content">
          <h2>Profile</h2>
          <div className="profile-card">
            <p>
              <strong>Email:</strong> {user?.email}
            </p>
            <p>
              <strong>Role:</strong> {user?.role}
            </p>
            <div className="profile-actions">
              <button
                className="btn-add"
                onClick={() => setShowChangePassword(true)}
              >
                Change password
              </button>
            </div>
          </div>
        </section>
      );
    }
    if (view === "assignments") {
      return (
        <section className="content">
          <h2>Assignments</h2>
          {allAssignments.length === 0 ? (
            <p>No assignments yet.</p>
          ) : (
            <ul className="assignments-list-view">
              {allAssignments.map((a) => (
                <li
                  key={a.id}
                  className="assignments-list-item"
                  onClick={() => setSelectedClassId(a.class_section_id)}
                >
                  <span className="assignments-list-title">{a.title}</span>
                  <span className="assignments-list-class">
                    {a.course_name} — Section {a.section_code}
                  </span>
                  <span className="assignments-list-meta">
                    due {formatDateTime(a.due_at || a.due_date)} · max{" "}
                    {a.max_points} pts
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      );
    }
    if (view === "grades" && user?.role === "student") {
      const gradesData = Array.isArray(myGrades)
        ? { assignments: myGrades, by_class: [] }
        : myGrades || { assignments: [], by_class: [] };
      const assignmentsList = gradesData.assignments || [];
      const byClass = gradesData.by_class || [];
      const exportMyGrades = () =>
        downloadCSV(
          "my-grades.csv",
          assignmentsList.map((g) => ({
            Class: `${g.course_name} ${g.section_code}`,
            Assignment: g.title,
            Score: g.score ?? "",
            Max: g.max_points,
          })),
          ["Class", "Assignment", "Score", "Max"],
        );
      return (
        <section className="content">
          <div className="section-header">
            <h2>My Grades</h2>
            {assignmentsList.length > 0 && (
              <button className="btn-small" onClick={exportMyGrades}>
                Export CSV
              </button>
            )}
          </div>
          {loading ? (
            <p>Loading...</p>
          ) : (
            <>
              {byClass.length > 0 && (
                <div className="grades-summary">
                  <h3>Grade summary</h3>
                  <ul className="grades-by-class">
                    {byClass.map((c) => (
                      <li key={c.class_id}>
                        <strong>
                          {c.course_name} — Section {c.section_code}
                        </strong>{" "}
                        {c.final_percent != null ? (
                          <span>
                            {c.final_percent}% —{" "}
                            <span className="letter-grade">
                              {c.letter_grade}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted">No grades yet</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <table className="student-table">
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>Assignment</th>
                    <th>Score</th>
                    <th>Max</th>
                  </tr>
                </thead>
                <tbody>
                  {assignmentsList.map((g) => (
                    <tr key={`${g.class_id}-${g.assignment_id}`}>
                      <td>
                        {g.course_name} {g.section_code}
                      </td>
                      <td>{g.title}</td>
                      <td>{g.score ?? "—"}</td>
                      <td>{g.max_points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      );
    }
    return null;
  };

  if (!user) return <LoginForm onLogin={setUser} />;

  const showStudents = canEdit;

  return (
    <div className="app">
      <header className="topbar">
        <h1>LMS – American School</h1>
        <div className="topbar-right">
          <span className="user-badge">
            {user.email} ({user.role})
          </span>
          <button
            className="btn-small theme-toggle"
            style={{ marginBottom: 0 }}
            onClick={() => setDarkMode(!darkMode)}
            title={darkMode ? "Light mode" : "Dark mode"}
          >
            {darkMode ? "☀️" : "🌙"}
          </button>
          <button
            className="btn-small"
            style={{ marginBottom: 0 }}
            onClick={() => setShowChangePassword(true)}
          >
            Change password
          </button>
          {isAdmin && (
            <button
              className="btn-small"
              style={{ marginBottom: 0 }}
              onClick={() => setShowRegisterUser(true)}
            >
              Register user
            </button>
          )}
          <button className="btn-logout" onClick={logout}>
            Logout
          </button>
        </div>
      </header>
      <main className="layout">
        <nav className="sidebar">
          <h2>Navigation</h2>
          <ul>
            <li
              className={view === "dashboard" ? "active" : ""}
              onClick={() => setView("dashboard")}
            >
              Dashboard
            </li>
            <li
              className={view === "classes" ? "active" : ""}
              onClick={() => setView("classes")}
            >
              Classes
              {(stats.new_classes || 0) > 0 && (
                <span
                  className="nav-badge"
                  title={`${stats.new_classes} new class${stats.new_classes !== 1 ? "es" : ""}`}
                >
                  +{stats.new_classes > 99 ? "99" : stats.new_classes}
                </span>
              )}
            </li>
            {showStudents && (
              <li
                className={view === "students" ? "active" : ""}
                onClick={() => setView("students")}
              >
                Students
              </li>
            )}
            <li
              className={view === "assignments" ? "active" : ""}
              onClick={() => setView("assignments")}
            >
              Assignments
              {(stats.new_assignments || 0) > 0 && (
                <span
                  className="nav-badge"
                  title={`${stats.new_assignments} new assignment${stats.new_assignments !== 1 ? "s" : ""}`}
                >
                  +{stats.new_assignments > 99 ? "99" : stats.new_assignments}
                </span>
              )}
            </li>
            <li
              className={view === "calendar" ? "active" : ""}
              onClick={() => setView("calendar")}
            >
              Calendar
            </li>
            <li
              className={view === "profile" ? "active" : ""}
              onClick={() => setView("profile")}
            >
              Profile
            </li>
            {user?.role === "student" && (
              <li
                className={view === "grades" ? "active" : ""}
                onClick={() => setView("grades")}
              >
                My Grades
              </li>
            )}
          </ul>
        </nav>
        <div className="content-area">{renderContent()}</div>
      </main>
      {toast && <div className="toast">{toast}</div>}
      {showChangePassword && (
        <ChangePasswordForm
          onDone={() => {
            setShowChangePassword(false);
            showToast("Password changed");
          }}
          onCancel={() => setShowChangePassword(false)}
          apiFetch={apiFetch}
          API={API}
        />
      )}
      {showRegisterUser && (
        <RegisterUserForm
          onDone={() => {
            setShowRegisterUser(false);
            showToast("User registered");
          }}
          onCancel={() => setShowRegisterUser(false)}
          apiFetch={apiFetch}
          API={API}
        />
      )}
      {confirmModal && (
        <ConfirmModal
          open={!!confirmModal}
          title={confirmModal.title}
          message={confirmModal.message}
          onConfirm={async () => {
            try {
              await confirmModal.onConfirm?.();
            } catch (e) {
              showToast(e?.message || "Error");
            }
          }}
          onCancel={() => setConfirmModal(null)}
        />
      )}
      {showCategoryWeightsModal && selectedClassId && (
        <CategoryWeightsModal
          classId={selectedClassId}
          initialWeights={categoryWeights}
          onClose={() => setShowCategoryWeightsModal(false)}
          onSaved={() => {
            setShowCategoryWeightsModal(false);
            refreshClassDetail();
            showToast("Grading weights saved");
          }}
          apiFetch={apiFetch}
          API={API}
        />
      )}
    </div>
  );
}

function CategoryWeightsModal({
  classId,
  initialWeights,
  onClose,
  onSaved,
  apiFetch,
  API,
}) {
  const [weights, setWeights] = useState({
    homework: initialWeights.homework ?? "",
    quiz: initialWeights.quiz ?? "",
    test: initialWeights.test ?? "",
    project: initialWeights.project ?? "",
    participation: initialWeights.participation ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setWeights({
      homework: initialWeights.homework ?? "",
      quiz: initialWeights.quiz ?? "",
      test: initialWeights.test ?? "",
      project: initialWeights.project ?? "",
      participation: initialWeights.participation ?? "",
    });
  }, [initialWeights]);
  const total = Object.values(weights).reduce(
    (s, v) => s + (Number(v) || 0),
    0,
  );
  const save = async () => {
    setError("");
    setSaving(true);
    try {
      const r = await apiFetch(`${API}/classes/${classId}/category-weights`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(weights),
      });
      const data = !r.ok ? await r.json().catch(() => ({})) : null;
      if (r.ok) {
        onSaved();
      } else {
        setError(data?.error || `Failed to save (${r.status})`);
        setSaving(false);
      }
    } catch (e) {
      setError(e?.message || "Failed to save");
      setSaving(false);
    }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Grading weights (%)</h3>
        <p className="text-muted">
          Weights should sum to 100. Leave 0 for unused categories.
        </p>
        <div className="form-block">
          {ASSIGNMENT_CATEGORIES.map((c) => (
            <label key={c.value}>
              {c.label}
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={weights[c.value]}
                onChange={(e) =>
                  setWeights((w) => ({ ...w, [c.value]: e.target.value }))
                }
              />
            </label>
          ))}
          <p>Total: {total}%</p>
          {error && <p className="msg-error">{error}</p>}
          <div className="modal-actions">
            <button
              type="button"
              className="btn-confirm"
              onClick={save}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button type="button" className="btn-cancel" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddStudentForm({ onDone, onCancel, apiFetch, API }) {
  const [first_name, setFirstName] = useState("");
  const [last_name, setLastName] = useState("");
  const [grade_level, setGradeLevel] = useState(6);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const r = await apiFetch(`${API}/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name,
          last_name,
          grade_level: Number(grade_level),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="form-inline" onSubmit={submit}>
      <input
        placeholder="First name"
        value={first_name}
        onChange={(e) => setFirstName(e.target.value)}
        required
      />
      <input
        placeholder="Last name"
        value={last_name}
        onChange={(e) => setLastName(e.target.value)}
        required
      />
      <input
        type="number"
        min="1"
        max="12"
        value={grade_level}
        onChange={(e) => setGradeLevel(e.target.value)}
      />
      {err && <span className="msg-error">{err}</span>}
      <div className="modal-actions" style={{ marginTop: "0.5rem" }}>
        <button type="submit" className="btn-confirm" disabled={loading}>
          Add
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditStudentForm({ student, onDone, onCancel, apiFetch, API }) {
  const [first_name, setFirstName] = useState(student?.first_name || "");
  const [last_name, setLastName] = useState(student?.last_name || "");
  const [grade_level, setGradeLevel] = useState(student?.grade_level ?? 6);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const r = await apiFetch(`${API}/students/${student.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name,
          last_name,
          grade_level: Number(grade_level),
        }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || "Failed");
      }
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>Edit student</h3>
        <form onSubmit={submit}>
          <input
            placeholder="First name"
            value={first_name}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
          <input
            placeholder="Last name"
            value={last_name}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
          <input
            type="number"
            min="1"
            max="12"
            value={grade_level}
            onChange={(e) => setGradeLevel(e.target.value)}
          />
          {err && <p className="msg-error">{err}</p>}
          <div className="modal-actions">
            <button type="submit" className="btn-confirm" disabled={loading}>
              Save
            </button>
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateClassForm({ onDone, onCancel, apiFetch, API }) {
  const [courses, setCourses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [course_id, setCourseId] = useState("");
  const [teacher_id, setTeacherId] = useState("");
  const [school_year, setSchoolYear] = useState("2024-2025");
  const [section_code, setSectionCode] = useState("A");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([
      apiFetch(`${API}/courses`).then((r) => r.json()),
      apiFetch(`${API}/teachers`).then((r) => r.json()),
    ]).then(([c, t]) => {
      setCourses(c);
      setTeachers(t);
      if (c.length) setCourseId(c[0].id);
      if (t.length) setTeacherId(t[0].id);
    });
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const r = await apiFetch(`${API}/classes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_id,
          teacher_id,
          school_year,
          section_code,
        }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || "Failed");
      }
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>Create class</h3>
        <form onSubmit={submit}>
          <label>Course</label>
          <select
            value={course_id}
            onChange={(e) => setCourseId(Number(e.target.value))}
            required
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label>Teacher</label>
          <select
            value={teacher_id}
            onChange={(e) => setTeacherId(Number(e.target.value))}
            required
          >
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.first_name} {t.last_name}
              </option>
            ))}
          </select>
          <input
            placeholder="School year"
            value={school_year}
            onChange={(e) => setSchoolYear(e.target.value)}
            required
          />
          <input
            placeholder="Section code"
            value={section_code}
            onChange={(e) => setSectionCode(e.target.value)}
            required
          />
          {err && <p className="msg-error">{err}</p>}
          <div className="modal-actions">
            <button type="submit" className="btn-confirm" disabled={loading || !course_id || !teacher_id}>
              Create
            </button>
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditClassForm({ classData, onDone, onCancel, apiFetch, API }) {
  const [courses, setCourses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [course_id, setCourseId] = useState(classData?.course_id ?? "");
  const [teacher_id, setTeacherId] = useState(classData?.teacher_id ?? "");
  const [school_year, setSchoolYear] = useState(
    classData?.school_year ?? "2024-2025",
  );
  const [section_code, setSectionCode] = useState(
    classData?.section_code ?? "A",
  );
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([
      apiFetch(`${API}/courses`).then((r) => r.json()),
      apiFetch(`${API}/teachers`).then((r) => r.json()),
    ]).then(([c, t]) => {
      setCourses(c);
      setTeachers(t);
      if (classData) {
        setCourseId(classData.course_id ?? c[0]?.id);
        setTeacherId(classData.teacher_id ?? t[0]?.id);
        setSchoolYear(classData.school_year ?? "2024-2025");
        setSectionCode(classData.section_code ?? "A");
      }
    });
  }, [classData?.id]);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const r = await apiFetch(`${API}/classes/${classData.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_id,
          teacher_id,
          school_year,
          section_code,
        }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || "Failed");
      }
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>Edit class</h3>
        <form onSubmit={submit}>
          <label>Course</label>
          <select
            value={course_id}
            onChange={(e) => setCourseId(Number(e.target.value))}
            required
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label>Teacher</label>
          <select
            value={teacher_id}
            onChange={(e) => setTeacherId(Number(e.target.value))}
            required
          >
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.first_name} {t.last_name}
              </option>
            ))}
          </select>
          <input
            placeholder="School year"
            value={school_year}
            onChange={(e) => setSchoolYear(e.target.value)}
            required
          />
          <input
            placeholder="Section code"
            value={section_code}
            onChange={(e) => setSectionCode(e.target.value)}
            required
          />
          {err && <p className="msg-error">{err}</p>}
          <div className="modal-actions">
            <button type="submit" className="btn-confirm" disabled={loading}>
              Save
            </button>
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EnrollStudentForm({
  classId,
  enrolledIds,
  onDone,
  onCancel,
  apiFetch,
  API,
}) {
  const [allStudents, setAllStudents] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    apiFetch(`${API}/students`)
      .then((r) => r.json())
      .then(setAllStudents);
  }, []);

  const available = allStudents.filter((s) => !enrolledIds.includes(s.id));

  const submit = async (e) => {
    e.preventDefault();
    if (!selectedId) return;
    setErr("");
    setLoading(true);
    try {
      const r = await apiFetch(`${API}/classes/${classId}/enrollments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id: Number(selectedId) }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || "Failed");
      }
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="form-block" onSubmit={submit}>
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        required
      >
        <option value="">Select student...</option>
        {available.map((s) => (
          <option key={s.id} value={s.id}>
            {s.first_name} {s.last_name} (Grade {s.grade_level})
          </option>
        ))}
      </select>
      {available.length === 0 && <p>All students are already enrolled.</p>}
      {err && <p className="msg-error">{err}</p>}
      <div className="modal-actions" style={{ marginTop: "0.5rem" }}>
        <button type="submit" className="btn-confirm" disabled={loading || available.length === 0}>
          Enroll
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function GradebookRow({
  studentId,
  firstName,
  lastName,
  initialScore,
  initialFeedback,
  maxPts,
  onSave,
}) {
  const [localScore, setLocalScore] = useState(initialScore);
  const [localFeedback, setLocalFeedback] = useState(initialFeedback ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => setLocalScore(initialScore), [initialScore]);
  useEffect(() => setLocalFeedback(initialFeedback ?? ""), [initialFeedback]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(localScore, localFeedback);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const handleScoreChange = (e) => {
    setLocalScore(e.target.value);
    setSaved(false);
  };
  const handleFeedbackChange = (e) => {
    setLocalFeedback(e.target.value);
    setSaved(false);
  };

  return (
    <tr>
      <td>
        {firstName} {lastName}
      </td>
      <td>
        <div className="gradebook-row-inputs">
          <input
            type="number"
            min="0"
            max={maxPts}
            value={localScore}
            onChange={handleScoreChange}
            placeholder="0"
          />
          <input
            type="text"
            className="gradebook-comment-input"
            value={localFeedback}
            onChange={handleFeedbackChange}
            placeholder="Comment"
          />
          <button
            type="button"
            className="btn-small gradebook-save-btn"
            disabled={saving || saved}
            onClick={handleSave}
          >
            {saving ? "Saving..." : saved ? "Saved" : "Save"}
          </button>
        </div>
      </td>
    </tr>
  );
}

function GradebookForm({
  assignmentId,
  assignment,
  onClose,
  onSaved,
  apiFetch,
  API,
}) {
  const [grades, setGrades] = useState([]);
  const [scores, setScores] = useState({});
  const [feedbacks, setFeedbacks] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    setError("");
    setLoading(true);
    apiFetch(`${API}/assignments/${assignmentId}/grades`)
      .then((r) => {
        if (!r.ok)
          return r.json().then((d) => {
            throw new Error(d.error || "Failed");
          });
        return r.json();
      })
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        setGrades(arr);
        const init = {};
        const fbInit = {};
        arr.forEach((r) => {
          init[r.student_id] = r.score != null ? String(r.score) : "";
          fbInit[r.student_id] = r.feedback ?? "";
        });
        setScores(init);
        setFeedbacks(fbInit);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [assignmentId]);

  const saveGrade = async (studentId, val, feedback = "") => {
    const maxPts = assignment?.max_points ?? 100;
    const score =
      val === "" ? 0 : Math.max(0, Math.min(maxPts, Number(val) || 0));
    const aid = Number(assignmentId);
    const sid = Number(studentId);
    if (!aid || !sid || isNaN(aid) || isNaN(sid)) {
      setError(
        "Invalid assignment or student. Try closing and reopening Grades.",
      );
      return;
    }
    try {
      const r = await apiFetch(`${API}/grades`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment_id: aid,
          student_id: sid,
          score: score,
          feedback: feedback ? String(feedback).trim() : null,
        }),
      });
      if (r.ok) {
        const fb = feedback ? String(feedback).trim() : null;
        setScores((prev) => ({ ...prev, [studentId]: String(score) }));
        setGrades((g) =>
          g.map((r) =>
            r.student_id === studentId ? { ...r, score, feedback: fb } : r,
          ),
        );
        setFeedbacks((prev) => ({ ...prev, [studentId]: feedback ?? "" }));
        onSaved?.();
      } else {
        const d = await r.json().catch(() => ({}));
        const msg = d.received
          ? `${d.error || "Save failed"} (got: ${JSON.stringify(d.received)})`
          : d.error || "Save failed";
        throw new Error(msg);
      }
    } catch (e) {
      setError(e.message || "Save failed");
      throw e;
    }
  };

  if (loading) return <p className="gradebook">Loading grades...</p>;
  if (error)
    return (
      <div className="gradebook">
        <p className="msg-error">{error}</p>
        <button className="btn-small" onClick={onClose}>
          Close
        </button>
      </div>
    );
  if (grades.length === 0)
    return (
      <div className="gradebook">
        <p>No students in this class.</p>
        <button className="btn-small" onClick={onClose}>
          Close
        </button>
      </div>
    );

  const maxPts = assignment?.max_points ?? 100;
  return (
    <div className="gradebook">
      <h4>
        Grades: {assignment?.title} (max {maxPts} pts)
      </h4>
      <table className="student-table">
        <thead>
          <tr>
            <th>Student</th>
            <th>Score / Comment</th>
          </tr>
        </thead>
        <tbody>
          {grades.map((r) => (
            <GradebookRow
              key={r.student_id}
              studentId={r.student_id}
              firstName={r.first_name}
              lastName={r.last_name}
              initialScore={scores[r.student_id] ?? ""}
              initialFeedback={feedbacks[r.student_id] ?? ""}
              maxPts={maxPts}
              onSave={(val, fb) => saveGrade(r.student_id, val, fb)}
            />
          ))}
        </tbody>
      </table>
      <button className="btn-small" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

const ASSIGNMENT_CATEGORIES = [
  { value: "homework", label: "Homework" },
  { value: "quiz", label: "Quiz" },
  { value: "test", label: "Test" },
  { value: "project", label: "Project" },
  { value: "participation", label: "Participation" },
];

function AddAssignmentForm({ classId, onDone, onCancel, apiFetch, API }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [due_at, setDueAt] = useState("");
  const [max_points, setMaxPoints] = useState(100);
  const [category, setCategory] = useState("homework");
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const dueAtISO = due_at ? new Date(due_at).toISOString() : null;
      const r = await apiFetch(`${API}/classes/${classId}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || null,
          due_at: dueAtISO,
          max_points: Number(max_points) || 100,
          category: category || "homework",
        }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || "Failed");
      }
      const data = await r.json();
      for (let i = 0; i < files.length; i++) {
        const fd = new FormData();
        fd.append("file", files[i]);
        await apiFetch(`${API}/assignments/${data.id}/attachments`, {
          method: "POST",
          body: fd,
        });
      }
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="form-block" onSubmit={submit}>
      <input
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <label>
        Content (tables, charts) — drag files here or use 📎 in toolbar
      </label>
      <RichTextEditor
        value={description}
        onChange={setDescription}
        placeholder="Assignment content..."
        onFilesAdded={(newFiles) => setFiles((prev) => [...prev, ...newFiles])}
        filesCount={files.length}
      />
      {files.length > 0 && (
        <p className="files-preview">{files.length} file(s) attached</p>
      )}
      <label>Category</label>
      <select value={category} onChange={(e) => setCategory(e.target.value)}>
        {ASSIGNMENT_CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <label>Due date & time</label>
      <input
        type="datetime-local"
        value={due_at}
        onChange={(e) => setDueAt(e.target.value)}
      />
      <input
        type="number"
        min="1"
        placeholder="Max points"
        value={max_points}
        onChange={(e) => setMaxPoints(e.target.value)}
      />
      {err && <p className="msg-error">{err}</p>}
      <button type="submit" className="btn-add" disabled={loading}>
        Add assignment
      </button>
      <button type="button" className="btn-cancel" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function AnnouncementForm({ onDone, onCancel, apiFetch, API }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const r = await apiFetch(`${API}/announcements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || "Failed");
      }
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="form-block announcement-form" onSubmit={submit}>
      <input
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <textarea
        placeholder="Body (optional)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
      />
      {err && <p className="msg-error">{err}</p>}
      <button type="submit" className="btn-add" disabled={loading}>
        Post
      </button>
      <button type="button" className="btn-cancel" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function ChangePasswordForm({ onDone, onCancel, apiFetch, API }) {
  const [current, setCurrent] = useState("");
  const [newPass, setNewPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const r = await apiFetch(`${API}/auth/change-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: current,
          new_password: newPass,
        }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || "Failed");
      }
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>Change password</h3>
        <form onSubmit={submit}>
          <input
            type="password"
            placeholder="Current password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="New password"
            value={newPass}
            onChange={(e) => setNewPass(e.target.value)}
            required
          />
          {err && <p className="msg-error">{err}</p>}
          <button type="submit" className="btn-confirm" disabled={loading}>
            Save
          </button>
          <button type="button" className="btn-cancel" onClick={onCancel}>
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}

function RegisterUserForm({ onDone, onCancel, apiFetch, API }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("student");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const r = await apiFetch(`${API}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || "Failed");
      }
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>Register new user</h3>
        <form onSubmit={submit}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="admin">Admin</option>
            <option value="teacher">Teacher</option>
            <option value="student">Student</option>
          </select>
          {err && <p className="msg-error">{err}</p>}
          <div className="modal-actions">
            <button type="submit" className="btn-confirm" disabled={loading}>
              Register
            </button>
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditAssignmentForm({ assignment, onDone, onCancel, apiFetch, API }) {
  const [title, setTitle] = useState(assignment?.title ?? "");
  const [description, setDescription] = useState(assignment?.description ?? "");
  const [due_at, setDueAt] = useState(
    assignment ? toDatetimeLocal(assignment.due_at || assignment.due_date) : "",
  );
  const [max_points, setMaxPoints] = useState(assignment?.max_points ?? 100);
  const [category, setCategory] = useState(assignment?.category ?? "homework");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const dueAtISO = due_at ? new Date(due_at).toISOString() : null;
      const r = await apiFetch(`${API}/assignments/${assignment.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || null,
          due_at: dueAtISO,
          max_points: Number(max_points) || 100,
          category: category || "homework",
        }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || "Failed");
      }
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="form-block" onSubmit={submit}>
      <input
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <label>Content (tables, charts)</label>
      <RichTextEditor
        value={description}
        onChange={setDescription}
        placeholder="Assignment content..."
      />
      {assignment?.id && (
        <AssignmentAttachments
          assignmentId={assignment.id}
          apiFetch={apiFetch}
          API={API}
          canEdit={true}
        />
      )}
      <label>Category</label>
      <select value={category} onChange={(e) => setCategory(e.target.value)}>
        {ASSIGNMENT_CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <label>Due date & time</label>
      <input
        type="datetime-local"
        value={due_at}
        onChange={(e) => setDueAt(e.target.value)}
      />
      <input
        type="number"
        min="1"
        placeholder="Max points"
        value={max_points}
        onChange={(e) => setMaxPoints(e.target.value)}
      />
      {err && <p className="msg-error">{err}</p>}
      <div className="modal-actions">
        <button type="submit" className="btn-confirm" disabled={loading}>
          Save
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default App;
