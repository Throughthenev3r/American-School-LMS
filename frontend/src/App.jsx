import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { RichTextEditor } from "./RichTextEditor.jsx";
import { RichContentDisplay } from "./RichContentDisplay.jsx";
import { AssignmentAttachments } from "./AssignmentAttachments.jsx";
import { ClassSyllabus } from "./ClassSyllabus.jsx";

const API = "/api";

// Единый формат даты: M/D/YYYY (например 2/6/2026)
function formatDate(str) {
  if (!str) return "—";
  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear();
  return `${month}/${day}/${year}`;
}

// Дата и время: M/D/YYYY, h:mm AM/PM
function formatDateTime(str) {
  if (!str) return "—";
  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  const datePart = formatDate(str);
  const h = d.getHours();
  const m = d.getMinutes();
  const am = h < 12;
  const h12 = h % 12 || 12;
  const timePart = `${h12}:${String(m).padStart(2, "0")} ${am ? "AM" : "PM"}`;
  return `${datePart}, ${timePart}`;
}

function dueDateLabel(dueDate) {
  if (!dueDate) return "";
  const d = new Date(dueDate);
  const now = new Date();
  const diffMs = d - now;
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const sameDay = diffDays === 0 && d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  const timeStr = `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;
  if (diffMs < 0) return `Overdue ${Math.abs(diffDays)}d`;
  if (sameDay) return `Due today ${timeStr}`;
  if (diffDays === 0) return `Due tomorrow ${timeStr}`;
  if (diffDays === 1) return "Due tomorrow";
  return `Due in ${diffDays}d`;
}

// Для input type="datetime-local": ISO → YYYY-MM-DDTHH:mm (local)
function toDatetimeLocal(str) {
  if (!str) return "";
  const d = new Date(str);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
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

function downloadCSV(filename, rows, headers) {
  const escape = (v) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Безопасный парсинг JSON (если сервер вернёт HTML — будет понятная ошибка)
async function parseJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      text.startsWith("<")
        ? "Server returned HTML instead of JSON. Is the backend running on port 4000?"
        : "Invalid JSON response"
    );
  }
}

// Запросы с токеном; при 401 — logout
function apiFetch(url, options = {}) {
  const token = localStorage.getItem("token");
  const headers = { ...options.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...options, headers }).then((res) => {
    if (res.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.dispatchEvent(new Event("auth:logout"));
    }
    return res;
  });
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
  const [gradingAssignmentId, setGradingAssignmentId] = useState(null);
  const [editAssignmentId, setEditAssignmentId] = useState(null);
  const [viewAssignmentId, setViewAssignmentId] = useState(null);
  const [editClassId, setEditClassId] = useState(null);
  const [searchStudents, setSearchStudents] = useState("");
  const [filterClassYear, setFilterClassYear] = useState("");
  const [classReport, setClassReport] = useState([]);
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
  const [toast, setToast] = useState(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showRegisterUser, setShowRegisterUser] = useState(false);
  const [showCategoryWeightsModal, setShowCategoryWeightsModal] = useState(false);
  const [categoryWeights, setCategoryWeights] = useState({});
  const [classGradesSummary, setClassGradesSummary] = useState(null);
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem("darkMode") === "1"
  );

  useEffect(() => {
    document.documentElement.setAttribute(
      "data-theme",
      darkMode ? "dark" : "light"
    );
    localStorage.setItem("darkMode", darkMode ? "1" : "0");
  }, [darkMode]);

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

  const refreshStudents = () => {
    if (view === "students")
      apiFetch(`${API}/students`)
        .then((r) => r.json())
        .then(setStudents)
        .catch(console.error);
  };

  const refreshClasses = () => {
    if (view === "classes")
      apiFetch(`${API}/classes`)
        .then((r) => r.json())
        .then(setClasses)
        .catch(console.error);
  };

  const refreshClassDetail = () => {
    if (selectedClassId) {
      setLoading(true);
      Promise.all([
        apiFetch(`${API}/classes/${selectedClassId}/students`).then((r) =>
          r.json()
        ),
        apiFetch(`${API}/classes/${selectedClassId}/assignments`).then((r) =>
          r.json()
        ),
      ])
        .then(([st, as]) => {
          setClassStudents(Array.isArray(st) ? st : []);
          setAssignments(Array.isArray(as) ? as : []);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  };

  useEffect(() => {
    if (view === "classes") {
      setLoading(true);
      setError("");
      apiFetch(`${API}/classes`)
        .then((r) => {
          if (!r.ok)
            return r.json().then((d) => {
              throw new Error(d.error || "Failed");
            });
          return r.json();
        })
        .then((data) => setClasses(Array.isArray(data) ? data : []))
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
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
        .then(setAllAssignments)
        .catch(() => setAllAssignments([]));
      apiFetch(`${API}/announcements`)
        .then((r) => (r.ok ? r.json() : []))
        .then(setAnnouncements)
        .catch(() => setAnnouncements([]));
      apiFetch(`${API}/stats`)
        .then((r) => (r.ok ? r.json() : {}))
        .then(setStats)
        .catch(() => setStats((s) => ({ ...s, classes: 0, students: 0, assignments: 0, new_classes: 0, new_assignments: 0 })));
    }
    if (
      view === "students" &&
      (user?.role === "admin" || user?.role === "teacher")
    ) {
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
        .then(setStudents)
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [view, user?.role]);

  useEffect(() => {
    if (!user) return;
    apiFetch(`${API}/stats`)
      .then((r) => (r.ok ? r.json() : {}))
      .then(setStats)
      .catch(() => setStats((s) => ({ ...s, classes: 0, students: 0, assignments: 0, new_classes: 0, new_assignments: 0 })));
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
        r.json()
      ),
      apiFetch(`${API}/classes/${selectedClassId}/assignments`).then((r) =>
        r.json()
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
    if (
      selectedClassId &&
      (user?.role === "admin" || user?.role === "teacher")
    ) {
      apiFetch(`${API}/classes/${selectedClassId}/report`)
        .then((r) => (r.ok ? r.json() : []))
        .then(setClassReport)
        .catch(() => setClassReport([]));
    } else {
      setClassReport([]);
    }
  }, [selectedClassId, user?.role]);

  const getDue = (a) => (a.due_at || a.due_date) ? new Date(a.due_at || a.due_date) : null;

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
      const upcoming = getUpcomingAssignments();
      const overdue = getOverdueAssignments();
      return (
        <section className="content">
          <h2>Dashboard</h2>
          <p>
            Welcome, {user?.email}. You are logged in as{" "}
            <strong>{user?.role}</strong>.
          </p>
          {(user?.role === "admin") && (
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
          {(user?.role === "admin" || user?.role === "teacher") && (
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
                      {(user?.role === "admin" ||
                        (user?.role === "teacher" &&
                          a.author_email === user?.email)) && (
                        <button
                          className="btn-delete btn-small announcement-delete"
                          onClick={async () => {
                            const r = await apiFetch(
                              `${API}/announcements/${a.id}`,
                              {
                                method: "DELETE",
                              }
                            );
                            if (r.ok)
                              setAnnouncements((prev) =>
                                prev.filter((x) => x.id !== a.id)
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
                      {formatDateTime(a.due_at || a.due_date)} — {dueDateLabel(a.due_at || a.due_date)}
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
                      {formatDateTime(a.due_at || a.due_date)} — {dueDateLabel(a.due_at || a.due_date)}
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
      const canAddAssignment =
        selectedClassId && (user?.role === "admin" || user?.role === "teacher");
      const canManageClass = user?.role === "admin";
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
                        .includes(filterClassYear.toLowerCase())
                  )
                  .map((c) => (
                    <div
                      key={c.id}
                      className={`class-card ${
                        selectedClassId === c.id ? "selected" : ""
                      }`}
                      onClick={() =>
                        setSelectedClassId(
                          selectedClassId === c.id ? null : c.id
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
                          className="card-actions"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            className="btn-small"
                            onClick={() => setEditClassId(c.id)}
                          >
                            Edit
                          </button>
                          <button
                            className="btn-delete"
                            onClick={() =>
                              setConfirmModal({
                                title: "Delete class",
                                message: `Delete ${c.course_name} Section ${c.section_code}?`,
                                onConfirm: async () => {
                                  const r = await apiFetch(
                                    `${API}/classes/${c.id}`,
                                    { method: "DELETE" }
                                  );
                                  if (r.ok) {
                                    setSelectedClassId(null);
                                    refreshClasses();
                                    setConfirmModal(null);
                                  }
                                },
                              })
                            }
                          >
                            Delete
                          </button>
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
                  canEdit={
                    user?.role === "admin" || user?.role === "teacher"
                  }
                  showToast={showToast}
                  extraActions={
                    (user?.role === "admin" || user?.role === "teacher") && (
                      <>
                        <button
                          type="button"
                          className="btn-small"
                          onClick={() => {
                            setShowCategoryWeightsModal(true);
                            apiFetch(`${API}/classes/${selectedClassId}/category-weights`)
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
                              apiFetch(`${API}/classes/${selectedClassId}/gradebook`)
                                .then((r) => (r.ok ? r.json() : null))
                                .then(setClassGradesSummary)
                                .catch(() => setClassGradesSummary(null));
                            }
                          }}
                        >
                          {classGradesSummary ? "Hide grade summary" : "View grade summary"}
                        </button>
                      </>
                    )
                  }
                />
              </div>
              {Array.isArray(classGradesSummary?.students) && classGradesSummary.students.length > 0 && (
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
                          <td>{s.first_name} {s.last_name}</td>
                          <td>{s.final_percent != null ? `${s.final_percent}%` : "—"}</td>
                          <td className="letter-grade">{s.letter_grade ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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
                  enrolledIds={(Array.isArray(classStudents) ? classStudents : []).map((s) => s.id)}
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
                        `${b.last_name} ${b.first_name}`
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
                                { method: "DELETE" }
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
              <div className="class-detail-section">
                <div className="assignments-header">
                  <h3>Assignments</h3>
                </div>
              {loading ? null : (
                <ul>
                  {(Array.isArray(assignments) ? assignments : []).map((a) => (
                    <li key={a.id} className="assignment-row">
                      <span>
                        <button
                          type="button"
                          className="btn-link"
                          onClick={() =>
                            setViewAssignmentId(
                              viewAssignmentId === a.id ? null : a.id
                            )
                          }
                        >
                          {a.title}
                        </button>{" "}
                        — due {formatDateTime(a.due_at || a.due_date)} (max {a.max_points} pts)
                      </span>
                      <span>
                        {(user?.role === "admin" ||
                          user?.role === "teacher") && (
                          <button
                            className={`btn-small ${
                              gradingAssignmentId === a.id ? "btn-active" : ""
                            }`}
                            onClick={() =>
                              setGradingAssignmentId(
                                gradingAssignmentId === a.id ? null : a.id
                              )
                            }
                          >
                            Grades
                          </button>
                        )}
                        {(user?.role === "admin" ||
                          user?.role === "teacher") && (
                          <button
                            className="btn-delete"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmModal({
                                title: "Delete assignment",
                                message: `Delete "${a.title}"?`,
                                onConfirm: async () => {
                                  const r = await apiFetch(
                                    `${API}/assignments/${a.id}`,
                                    { method: "DELETE" }
                                  );
                                  const data = r.ok
                                    ? null
                                    : await parseJson(r).catch(() => ({}));
                                  if (r.ok) {
                                    setConfirmModal(null);
                                    refreshClassDetail();
                                    showToast("Assignment deleted");
                                  } else {
                                    showToast(data?.error || "Delete failed");
                                  }
                                },
                              });
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </span>
                      {viewAssignmentId === a.id && (
                        <div className="assignment-content">
                          <RichContentDisplay html={a.description} />
                          <AssignmentAttachments
                            assignmentId={a.id}
                            apiFetch={apiFetch}
                            API={API}
                            canEdit={
                              user?.role === "admin" || user?.role === "teacher"
                            }
                          />
                        </div>
                      )}
                    </li>
                  ))}
                  {assignments.length === 0 && !showAddAssignment && (
                    <li>No assignments yet.</li>
                  )}
                </ul>
              )}
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
              {canAddAssignment && (
                <button
                  className={`btn-add ${showAddAssignment ? "btn-active" : ""}`}
                  type="button"
                  onClick={() => setShowAddAssignment((v) => !v)}
                >
                  {showAddAssignment ? "− Add Assignment" : "+ Add Assignment"}
                </button>
              )}
              <div className="class-detail-section">
              {gradingAssignmentId &&
                (user?.role === "admin" || user?.role === "teacher") && (
                  <GradebookForm
                    assignmentId={gradingAssignmentId}
                    assignment={assignments.find(
                      (a) => a.id === gradingAssignmentId
                    )}
                    onClose={() => setGradingAssignmentId(null)}
                    onSaved={() => showToast("Grade saved")}
                    apiFetch={apiFetch}
                    API={API}
                  />
                )}
              {editAssignmentId && (
                <EditAssignmentForm
                  assignment={assignments.find(
                    (a) => a.id === editAssignmentId
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
              {(user?.role === "admin" || user?.role === "teacher") &&
                classReport.length > 0 && (
                  <div className="class-report">
                    <div className="report-header">
                      <h3>Report (averages)</h3>
                      <div className="report-actions">
                        <button
                          className="btn-small"
                          onClick={async () => {
                            const r = await apiFetch(
                              `${API}/classes/${selectedClassId}/gradebook`
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
                              headers
                            );
                            showToast("Gradebook exported");
                          }}
                        >
                          Export full gradebook
                        </button>
                        <button
                          className="btn-small"
                          onClick={() =>
                            downloadCSV(
                              `report-class-${selectedClassId}.csv`,
                              classReport.map((r) => ({
                                Assignment: r.title,
                                "Avg score": r.avg_score ?? "",
                                Max: r.max_points,
                                Graded: r.graded_count,
                              })),
                              ["Assignment", "Avg score", "Max", "Graded"]
                            )
                          }
                        >
                          Export averages
                        </button>
                      </div>
                    </div>
                    <table className="student-table">
                      <thead>
                        <tr>
                          <th>Assignment</th>
                          <th>Avg score</th>
                          <th>Max</th>
                          <th>Graded</th>
                        </tr>
                      </thead>
                      <tbody>
                        {classReport.map((r) => (
                          <tr key={r.id}>
                            <td>{r.title}</td>
                            <td>{r.avg_score ?? "—"}</td>
                            <td>{r.max_points}</td>
                            <td>{r.graded_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              </div>
            </div>
          )}
        </section>
      );
    }
    if (view === "students") {
      const canManage = user?.role === "admin";
      const filteredStudents = students.filter((s) => {
        const q = searchStudents.toLowerCase().trim();
        if (!q) return true;
        const name = `${s.first_name} ${s.last_name}`.toLowerCase();
        return name.includes(q) || String(s.grade_level).includes(q);
      });
      return (
        <section className="content">
          <h2>Students</h2>
          {students.length > 0 && (
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
            <button className="btn-add" onClick={() => setShowAddStudent(true)}>
              + Add student
            </button>
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
                  <th>Name</th>
                  <th>Grade Level</th>
                  {canManage && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.first_name} {s.last_name}
                    </td>
                    <td>{s.grade_level}</td>
                    {canManage && (
                      <td>
                        <button
                          className="btn-small"
                          onClick={() => setEditStudentId(s.id)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn-delete"
                          onClick={() =>
                            setConfirmModal({
                              title: "Delete student",
                              message: `Delete ${s.first_name} ${s.last_name}?`,
                              onConfirm: async () => {
                                const r = await apiFetch(
                                  `${API}/students/${s.id}`,
                                  { method: "DELETE" }
                                );
                                if (r.ok) {
                                  refreshStudents();
                                  setConfirmModal(null);
                                }
                              },
                            })
                          }
                        >
                          Delete
                        </button>
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
      const withDate = allAssignments
        .filter((a) => a.due_at || a.due_date)
        .map((a) => ({ ...a, _date: getDue(a) }))
        .sort((a, b) => a._date - b._date);
      return (
        <section className="content">
          <h2>📅 Calendar</h2>
          {withDate.length === 0 ? (
            <p>No assignments with due dates.</p>
          ) : (
            <table className="calendar-table student-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Title</th>
                  <th>Class</th>
                  <th>Max pts</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {withDate.map((a) => (
                  <tr
                    key={a.id}
                    className={isOverdue(a) ? "overdue-row" : ""}
                  >
                    <td>{formatDateTime(a.due_at || a.due_date)}</td>
                    <td>{a.title}</td>
                    <td>
                      {a.course_name} — Section {a.section_code}
                    </td>
                    <td>{a.max_points}</td>
                    <td>
                      {isOverdue(a) ? (
                        <span className="calendar-overdue">Overdue</span>
                      ) : (
                        dueDateLabel(a.due_at || a.due_date)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
                    due {formatDateTime(a.due_at || a.due_date)} · max {a.max_points} pts
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      );
    }
    if (view === "grades" && user?.role === "student") {
      const gradesData = Array.isArray(myGrades) ? { assignments: myGrades, by_class: [] } : (myGrades || { assignments: [], by_class: [] });
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
          ["Class", "Assignment", "Score", "Max"]
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
                        <strong>{c.course_name} — Section {c.section_code}</strong>
                        {" "}
                        {c.final_percent != null ? (
                          <span>{c.final_percent}% — <span className="letter-grade">{c.letter_grade}</span></span>
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

  const showStudents = user.role === "admin" || user.role === "teacher";

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
          {user?.role === "admin" && (
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
                <span className="nav-badge" title={`${stats.new_classes} new class${stats.new_classes !== 1 ? "es" : ""}`}>
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
                <span className="nav-badge" title={`${stats.new_assignments} new assignment${stats.new_assignments !== 1 ? "s" : ""}`}>
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
        {renderContent()}
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

function CategoryWeightsModal({ classId, initialWeights, onClose, onSaved, apiFetch, API }) {
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
  const total = Object.values(weights).reduce((s, v) => s + (Number(v) || 0), 0);
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
        <p className="text-muted">Weights should sum to 100. Leave 0 for unused categories.</p>
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
                onChange={(e) => setWeights((w) => ({ ...w, [c.value]: e.target.value }))}
              />
            </label>
          ))}
          <p>Total: {total}%</p>
          {error && <p className="msg-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-confirm" onClick={save} disabled={saving}>
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
      <button type="submit" disabled={loading}>
        Add
      </button>
      <button type="button" className="btn-cancel" onClick={onCancel}>
        Cancel
      </button>
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
          <button type="submit" disabled={loading}>
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
          <button type="submit" disabled={loading || !course_id || !teacher_id}>
            Create
          </button>
          <button type="button" className="btn-cancel" onClick={onCancel}>
            Cancel
          </button>
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
    classData?.school_year ?? "2024-2025"
  );
  const [section_code, setSectionCode] = useState(
    classData?.section_code ?? "A"
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
          <button type="submit" disabled={loading}>
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
      <button type="submit" disabled={loading || available.length === 0}>
        Enroll
      </button>
      <button type="button" className="btn-cancel" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function GradebookRow({
  studentId,
  firstName,
  lastName,
  initialScore,
  maxPts,
  onSave,
}) {
  const [localScore, setLocalScore] = useState(initialScore);
  const [saving, setSaving] = useState(false);
  useEffect(() => setLocalScore(initialScore), [initialScore]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(localScore);
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr>
      <td>
        {firstName} {lastName}
      </td>
      <td>
        <input
          type="number"
          min="0"
          max={maxPts}
          value={localScore}
          onChange={(e) => setLocalScore(e.target.value)}
          placeholder="0"
        />
      </td>
      <td>
        <button
          type="button"
          className="btn-small"
          disabled={saving}
          onClick={handleSave}
        >
          {saving ? "Saving..." : "Save"}
        </button>
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
        arr.forEach((r) => {
          init[r.student_id] = r.score != null ? String(r.score) : "";
        });
        setScores(init);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [assignmentId]);

  const saveGrade = async (studentId, val) => {
    const maxPts = assignment?.max_points ?? 100;
    const score =
      val === "" ? 0 : Math.max(0, Math.min(maxPts, Number(val) || 0));
    const aid = Number(assignmentId);
    const sid = Number(studentId);
    if (!aid || !sid || isNaN(aid) || isNaN(sid)) {
      setError(
        "Invalid assignment or student. Try closing and reopening Grades."
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
        }),
      });
      if (r.ok) {
        setGrades((g) =>
          g.map((r) => (r.student_id === studentId ? { ...r, score } : r))
        );
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
            <th>Score</th>
            <th></th>
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
              maxPts={maxPts}
              onSave={(val) => saveGrade(r.student_id, val)}
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
      <label>Content (tables, charts) — drag files here or use 📎 in toolbar</label>
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
          <option key={c.value} value={c.value}>{c.label}</option>
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
          <button type="submit" disabled={loading}>
            Register
          </button>
          <button type="button" className="btn-cancel" onClick={onCancel}>
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}

function EditAssignmentForm({ assignment, onDone, onCancel, apiFetch, API }) {
  const [title, setTitle] = useState(assignment?.title ?? "");
  const [description, setDescription] = useState(assignment?.description ?? "");
  const [due_at, setDueAt] = useState(
    assignment ? toDatetimeLocal(assignment.due_at || assignment.due_date) : ""
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
          <option key={c.value} value={c.value}>{c.label}</option>
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
      <button type="submit" disabled={loading}>
        Save
      </button>
      <button type="button" className="btn-cancel" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

export default App;
