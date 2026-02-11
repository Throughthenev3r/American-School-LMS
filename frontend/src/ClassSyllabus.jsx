import React, { useState, useEffect } from "react";

function formatSize(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ClassSyllabus({ classId, apiFetch, API, canEdit, showToast, extraActions }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    if (!classId) return;
    apiFetch(`${API}/classes/${classId}/syllabus`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setFiles)
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [classId]);

  const handleUpload = async (e) => {
    const filesList = e.target.files;
    if (!filesList?.length || !classId) return;
    setUploading(true);
    setError("");
    try {
      for (let i = 0; i < filesList.length; i++) {
        const fd = new FormData();
        fd.append("file", filesList[i]);
        const r = await apiFetch(`${API}/classes/${classId}/syllabus`, {
          method: "POST",
          body: fd,
        });
        const data = !r.ok ? await r.json().catch(() => ({})) : null;
        if (r.ok) {
          load();
          showToast?.("Syllabus uploaded");
        } else {
          const msg = data?.error || `Upload failed (${r.status})`;
          setError(msg);
          showToast?.(msg);
        }
      }
    } catch (err) {
      const msg = err?.message || "Upload failed";
      setError(msg);
      showToast?.(msg);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDelete = async (fileId) => {
    if (!confirm("Delete this file?")) return;
    const r = await apiFetch(
      `${API}/classes/${classId}/syllabus/${fileId}`,
      { method: "DELETE" }
    );
    if (r.ok) load();
  };

  const getDownloadUrl = (id) => `${API}/classes/${classId}/syllabus/${id}/download`;
  const token = localStorage.getItem("token");

  if (loading) return <p className="attachments-loading">Loading syllabus...</p>;

  return (
    <div className="assignment-attachments syllabus-section">
      {error && <p className="msg-error">{error}</p>}
      {((canEdit || extraActions) && (
        <div className="attachments-header syllabus-actions-row">
          {canEdit && (
            <label className="btn-add btn-attach">
              <input
                type="file"
                multiple
                onChange={handleUpload}
                disabled={uploading}
              />
              {uploading ? "Uploading..." : "+ Add syllabus"}
            </label>
          )}
          {extraActions}
        </div>
      )) || null}
      {files.length === 0 ? (
        <p className="attachments-empty">No syllabus files yet</p>
      ) : (
        <ul className="attachments-list">
          {files.map((a) => (
            <li key={a.id} className="attachment-item">
              <div className="attachment-item-name">
                <a
                  href={getDownloadUrl(a.id)}
                  download={a.original_filename}
                  className="attachment-link"
                  onClick={(e) => {
                    if (token) {
                      e.preventDefault();
                      fetch(getDownloadUrl(a.id), {
                        headers: { Authorization: `Bearer ${token}` },
                      })
                        .then((r) => r.blob())
                        .then((blob) => {
                          const url = URL.createObjectURL(blob);
                          const aEl = document.createElement("a");
                          aEl.href = url;
                          aEl.download = a.original_filename;
                          aEl.click();
                          URL.revokeObjectURL(url);
                        });
                    }
                  }}
                >
                  📄 {a.original_filename}
                  <span className="attachment-size">
                    {" "}
                    ({formatSize(a.size_bytes)})
                  </span>
                </a>
                {canEdit && (
                  <button
                    type="button"
                    className="attachment-delete-x"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDelete(a.id);
                    }}
                    title="Delete"
                    aria-label="Delete"
                  >
                    ×
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
