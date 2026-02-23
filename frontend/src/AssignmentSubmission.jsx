import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from "react";

function formatSize(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DownloadLink({ url, filename, sizeBytes, token }) {
  const handleClick = (e) => {
    e.preventDefault();
    if (!token) return;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const u = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = u;
        a.download = filename || "file";
        a.click();
        URL.revokeObjectURL(u);
      });
  };
  return (
    <a href={url} className="submission-file-link" onClick={handleClick} download={filename}>
      {filename}
      {sizeBytes != null && <span className="submission-file-size"> ({formatSize(sizeBytes)})</span>}
    </a>
  );
}

export const AssignmentSubmission = forwardRef(function AssignmentSubmission({
  assignmentId,
  apiFetch,
  API,
  isStudent,
  canEdit,
  showToast,
  maxPoints = 100,
  editMode = false,
  dueAt = null,
}, ref) {
  const [mySubmission, setMySubmission] = useState(null);
  const [submissionsList, setSubmissionsList] = useState([]);
  const [studentsList, setStudentsList] = useState([]);
  const [gradesMap, setGradesMap] = useState({});
  const [scoreInputs, setScoreInputs] = useState({});
  const [feedbackInputs, setFeedbackInputs] = useState({});
  const [expandedStudent, setExpandedStudent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitBodyText, setSubmitBodyText] = useState("");
  const [submitFiles, setSubmitFiles] = useState([]);
  const fileInputRef = useRef(null);
  const token = localStorage.getItem("token");

  const handleAddFile = (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    const newFiles = Array.from(files);
    setSubmitFiles((prev) => [...prev, ...newFiles]);
    e.target.value = "";
  };
  const removeFile = (index) => {
    setSubmitFiles((prev) => prev.filter((_, i) => i !== index));
  };

  useEffect(() => {
    if (!assignmentId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const promises = [];
    if (isStudent) promises.push(apiFetch(`${API}/assignments/${assignmentId}/my-submission`).then((r) => (r.ok ? r.json() : null)));
    if (canEdit) {
      promises.push(apiFetch(`${API}/assignments/${assignmentId}/submissions`).then((r) => (r.ok ? r.json() : [])));
      promises.push(apiFetch(`${API}/assignments/${assignmentId}/grades`).then((r) => (r.ok ? r.json() : [])));
    }
    Promise.all(promises)
      .then((results) => {
        let mySub = null;
        let list = [];
        let gradesRows = [];
        if (isStudent) mySub = results.shift() ?? null;
        if (canEdit) {
          list = results.shift() ?? [];
          gradesRows = results.shift() ?? [];
        }
        setMySubmission(mySub);
        setSubmissionsList(Array.isArray(list) ? list : []);
        const gradesArr = Array.isArray(gradesRows) ? gradesRows : [];
        setStudentsList(gradesArr);
        const map = {};
        const inputs = {};
        const fbInputs = {};
        gradesArr.forEach((r) => {
          map[r.student_id] = r.score;
          inputs[r.student_id] = r.score != null ? String(r.score) : "";
          fbInputs[r.student_id] = r.feedback ?? "";
        });
        setGradesMap(map);
        setScoreInputs(inputs);
        setFeedbackInputs(fbInputs);
      })
      .catch(() => {
        setMySubmission(null);
        setSubmissionsList([]);
        setStudentsList([]);
      })
      .finally(() => setLoading(false));
  }, [assignmentId, isStudent, canEdit, apiFetch, API]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!assignmentId || !isStudent) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("body_text", submitBodyText);
      if (submitFiles?.length) {
        for (let i = 0; i < submitFiles.length; i++) fd.append("files", submitFiles[i]);
      }
      const r = await apiFetch(`${API}/assignments/${assignmentId}/submit`, { method: "POST", body: fd });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        setMySubmission(data);
        setSubmitFiles([]);
        showToast?.("Saved");
      } else {
        showToast?.(data?.error || "Failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const saveAll = useCallback(async () => {
    const maxPts = Number(maxPoints) || 100;
    let ok = true;
    for (const row of studentsList) {
      const sid = row.student_id;
      const val = scoreInputs[sid] ?? "";
      const score = val === "" ? 0 : Math.max(0, Math.min(maxPts, Number(val) || 0));
      const feedback = feedbackInputs[sid] ?? "";
      try {
        const r = await apiFetch(`${API}/grades`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assignment_id: Number(assignmentId),
            student_id: Number(sid),
            score,
            feedback: feedback ? String(feedback).trim() : null,
          }),
        });
        if (r.ok) {
          setGradesMap((prev) => ({ ...prev, [sid]: score }));
          setScoreInputs((prev) => ({ ...prev, [sid]: String(score) }));
        } else ok = false;
      } catch {
        ok = false;
      }
    }
    return ok;
  }, [assignmentId, studentsList, scoreInputs, feedbackInputs, maxPoints, apiFetch, API]);

  useImperativeHandle(ref, () => saveAll, [saveAll]);

  if (!assignmentId || (!isStudent && !canEdit)) return null;
  const submittedByStudent = new Map(submissionsList.map((s) => [s.student_id, s]));
  const loadingEmpty = loading && !mySubmission && studentsList.length === 0;
  if (loadingEmpty) return <p className="submissions-loading">Loading...</p>;

  const downloadUrl = (fileId) => `${API}/submission-files/${fileId}/download`;
  const dueDate = dueAt ? new Date(dueAt) : null;
  const isDeadlinePassed = dueDate && new Date() > dueDate;

  const getStatus = (sub) => {
    const hasSubmitted = !!sub;
    let overdue = false;
    if (hasSubmitted) {
      const submittedAt = sub.submitted_at ? new Date(sub.submitted_at) : null;
      overdue = !!(dueDate && submittedAt && submittedAt > dueDate);
    } else {
      overdue = isDeadlinePassed;
    }
    return { base: hasSubmitted ? "submitted" : "not-submitted", overdue };
  };

  return (
    <div className="assignment-submissions">
      {isStudent && (
        <div className="submission-my-block">
          <h4 className="submission-section-title">Submit work</h4>
          {mySubmission ? (
            <div className="submission-my-done">
              <p className="submission-done-at">Submitted</p>
              {mySubmission.body_text && <div className="submission-body-text"><pre>{mySubmission.body_text}</pre></div>}
              {mySubmission.files?.length > 0 && (
                <ul className="submission-files-list">
                  {mySubmission.files.map((f) => (
                    <li key={f.id}>
                      <DownloadLink url={downloadUrl(f.id)} filename={f.original_filename} sizeBytes={f.size_bytes} token={token} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <form className="submission-form" onSubmit={handleSubmit}>
              <div className="submission-form-actions">
                <label className="submission-btn submission-add-file-btn">
                  <input ref={fileInputRef} type="file" multiple className="submission-file-input" onChange={handleAddFile} />
                  + Add file
                </label>
                <button type="submit" className="submission-btn submission-submit-btn btn-confirm" disabled={submitting}>
                  {submitting ? "Saving..." : "Submit"}
                </button>
              </div>
              {submitFiles.length > 0 && (
                <ul className="submission-pending-files">
                  {submitFiles.map((f, i) => (
                    <li key={i} className="submission-pending-file">
                      <span>{f.name}</span>
                      <button type="button" className="submission-remove-file" onClick={() => removeFile(i)} aria-label="Remove">×</button>
                    </li>
                  ))}
                </ul>
              )}
              <label className="submission-form-label">Comment (optional)</label>
              <textarea
                className="submission-textarea"
                value={submitBodyText}
                onChange={(e) => setSubmitBodyText(e.target.value)}
                placeholder="Add a note..."
                rows={3}
              />
            </form>
          )}
        </div>
      )}
      {canEdit && (
        <div className="submission-list-block">
          <h4 className="submission-section-title">Students</h4>
          {studentsList.length === 0 ? (
            <p className="text-muted">No students in class.</p>
          ) : (
            <div className="submission-students-table-wrap">
              <table className="submission-students-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Status</th>
                    <th>Grade</th>
                    {editMode && <th>Comment</th>}
                  </tr>
                </thead>
                <tbody>
                  {studentsList.map((row) => {
                    const sid = row.student_id;
                    const sub = submittedByStudent.get(sid);
                    const hasSubmitted = !!sub;
                    const { base, overdue } = getStatus(sub);
                    const name = `${row.first_name || ""} ${row.last_name || ""}`.trim() || `#${sid}`;
                    const isExpanded = expandedStudent === sid;
                    const displayScore = gradesMap[sid];
                    const hasGrade = displayScore != null;
                    return (
                      <React.Fragment key={sid}>
                        <tr className={`submission-row-${base}${overdue ? " submission-row-overdue" : ""}`}>
                          <td className="submission-student-name">
                            {hasSubmitted ? (
                              <button
                                type="button"
                                className="submission-name-link"
                                onClick={() => setExpandedStudent((prev) => (prev === sid ? null : sid))}
                                aria-expanded={isExpanded}
                              >
                                <strong>{name}</strong>
                              </button>
                            ) : (
                              <strong>{name}</strong>
                            )}
                          </td>
                          <td>
                            {base === "submitted" ? (
                              <span className="submission-status-badge submission-status-done">Submitted</span>
                            ) : (
                              <span className="submission-status-badge submission-status-not-done">Not submitted</span>
                            )}
                            {overdue && (
                              <span className="submission-status-badge submission-status-overdue">Overdue</span>
                            )}
                          </td>
                          <td>
                            {editMode ? (
                              <span className="submission-grade-cell">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="submission-grade-input submission-grade-input-no-spinner"
                                  value={scoreInputs[sid] ?? ""}
                                  onChange={(e) => setScoreInputs((prev) => ({ ...prev, [sid]: e.target.value }))}
                                  placeholder="—"
                                />
                                <span className="submission-grade-max">/ {maxPoints}</span>
                              </span>
                            ) : (
                              <span className="submission-grade-display">
                                {hasGrade ? (
                                  <span className="submission-grade-value">{displayScore} <span className="submission-grade-max">/ {maxPoints}</span></span>
                                ) : (
                                  <span className="submission-grade-empty">—</span>
                                )}
                              </span>
                            )}
                          </td>
                          {editMode && (
                            <td>
                              <input
                                type="text"
                                className="submission-grade-comment submission-comment-inline"
                                value={feedbackInputs[sid] ?? ""}
                                onChange={(e) => setFeedbackInputs((prev) => ({ ...prev, [sid]: e.target.value }))}
                                placeholder="Teacher comment..."
                              />
                            </td>
                          )}
                        </tr>
                        {hasSubmitted && isExpanded && sub && (
                          <tr className="submission-details-row">
                            <td colSpan={editMode ? 4 : 3}>
                              <div className="submission-details-inner">
                                {sub.body_text && <div className="submission-list-body"><pre>{sub.body_text}</pre></div>}
                                {sub.files?.length > 0 && (
                                  <ul className="submission-list-files">
                                    {sub.files.map((f) => (
                                      <li key={f.id}>
                                        <DownloadLink url={downloadUrl(f.id)} filename={f.original_filename} sizeBytes={f.size_bytes} token={token} />
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
