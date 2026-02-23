import React, { useState, useEffect } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { apiFetch, API } from "./api.js";
import { formatDate } from "./utils/format.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

function ProgressBar({ value, max = 100, height = 8, showLabel = false }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="sd-progress-wrap">
      <div className="sd-progress-track" style={{ height }}>
        <div className="sd-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      {showLabel && (
        <span className="sd-progress-label">{pct}%</span>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const cls =
    status === "Graded"
      ? "sd-status-graded"
      : status === "Submitted"
        ? "sd-status-submitted"
        : status === "Overdue"
          ? "sd-status-overdue"
          : "sd-status-pending";
  return <span className={`sd-status-badge ${cls}`}>{status}</span>;
}

export function StudentDashboard({ studentId, studentName, onBack, onNavigateToClass }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDashboard = () => {
    setLoading(true);
    setError(null);
    const url = studentId
      ? `${API}/students/${studentId}/dashboard`
      : API + "/me/dashboard";
    apiFetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load dashboard");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchDashboard();
  }, [studentId]);

  if (loading) {
    return (
      <section className="content sd-dashboard">
        <div className="sd-loading">Loading dashboard...</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="content sd-dashboard">
        <div className="sd-error">{error}</div>
      </section>
    );
  }

  const {
    overall_avg_percent,
    letter_grade,
    completion_percent,
    completed_assignments,
    total_assignments,
    by_class = [],
    assignment_statuses = [],
    grade_trend = [],
  } = data || {};

  const chartData = {
    labels: grade_trend.map((t) => formatDate(t.date)),
    datasets: [
      {
        label: "Grade %",
        data: grade_trend.map((t) => t.percent),
        borderColor: "rgb(99, 102, 241)",
        backgroundColor: "rgba(99, 102, 241, 0.1)",
        fill: true,
        tension: 0.3,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          afterLabel: (ctx) => {
            const idx = ctx.dataIndex;
            const t = grade_trend[idx];
            return t?.title ? ` ${t.title}` : "";
          },
        },
      },
    },
    scales: {
      y: {
        min: 0,
        max: 100,
        ticks: { stepSize: 20 },
      },
    },
  };

  return (
    <section className="content sd-dashboard">
      <div className="sd-header-row">
        {onBack && (
          <button type="button" className="btn-secondary btn-back" onClick={onBack}>
            ← Back to list
          </button>
        )}
        <h2 className="sd-page-title">
          {studentName ? `${studentName} — Profile` : "Dashboard"}
        </h2>
      </div>

      {/* 1. Performance Overview Card */}
      <div className="sd-card sd-overview">
        <h3 className="sd-card-title">Performance Overview</h3>
        <div className="sd-overview-grid">
          <div className="sd-stat">
            <span className="sd-stat-value">
              {overall_avg_percent != null ? `${overall_avg_percent}%` : "—"}
            </span>
            <span className="sd-stat-label">Average Grade</span>
          </div>
          <div className="sd-stat">
            <span className="sd-stat-value">{letter_grade ?? "—"}</span>
            <span className="sd-stat-label">GPA</span>
          </div>
          <div className="sd-stat sd-stat-wide">
            <span className="sd-stat-label">Course Completion</span>
            <ProgressBar
              value={completed_assignments}
              max={total_assignments || 1}
              height={10}
              showLabel
            />
          </div>
        </div>
      </div>

      {/* 2. Course Performance Section */}
      <div className="sd-card sd-courses">
        <h3 className="sd-card-title">Course Performance</h3>
        {by_class.length === 0 ? (
          <p className="sd-empty">No courses yet.</p>
        ) : (
          <div className="sd-course-list">
            {by_class.map((c) => (
              <div key={c.class_id} className="sd-course-item">
                <div className="sd-course-header">
                  <span className="sd-course-name">
                    {c.course_name} — Section {c.section_code}
                  </span>
                  <span className="sd-course-avg">
                    {c.avg_percent != null ? `${c.avg_percent}%` : "—"}
                  </span>
                </div>
                <div className="sd-course-progress-row">
                  <ProgressBar
                    value={c.completed}
                    max={c.total || 1}
                    height={6}
                  />
                  <span className="sd-course-count">
                    {c.completed} / {c.total} assignments
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Grade Trend Chart */}
      <div className="sd-card sd-chart">
        <h3 className="sd-card-title">Grade Trend</h3>
        {grade_trend.length === 0 ? (
          <p className="sd-empty">No graded assignments yet.</p>
        ) : (
          <div className="sd-chart-wrap">
            <Line data={chartData} options={chartOptions} />
          </div>
        )}
      </div>

      {/* 4. Assignment Status Table */}
      <div className="sd-card sd-table-card">
        <h3 className="sd-card-title">Assignments</h3>
        {assignment_statuses.length === 0 ? (
          <p className="sd-empty">No assignments yet.</p>
        ) : (
          <div className="sd-table-wrap">
            <table className="sd-table">
              <thead>
                <tr>
                  <th>Assignment</th>
                  <th>Due Date</th>
                  <th>Status</th>
                  <th>Grade</th>
                </tr>
              </thead>
              <tbody>
                {assignment_statuses.map((a) => (
                  <tr
                    key={a.id}
                    className="sd-table-row"
                    onClick={() =>
                      onNavigateToClass && onNavigateToClass(a.class_section_id)
                    }
                  >
                    <td>
                      <span className="sd-asn-title">{a.title}</span>
                      <span className="sd-asn-course">
                        {a.course_name} — {a.section_code}
                      </span>
                    </td>
                    <td>{a.due_at ? formatDate(a.due_at) : "—"}</td>
                    <td>
                      <StatusBadge status={a.status} />
                    </td>
                    <td>
                      {a.score != null ? (
                        <span className="sd-grade">
                          {a.score} / {a.max_points}
                          {a.percent != null && (
                            <span className="sd-grade-pct"> ({a.percent}%)</span>
                          )}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
