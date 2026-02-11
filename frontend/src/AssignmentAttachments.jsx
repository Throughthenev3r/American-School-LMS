import React, { useState, useEffect } from "react";

function formatSize(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AssignmentAttachments({
  assignmentId,
  apiFetch,
  API,
  canEdit,
}) {
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const load = () => {
    if (!assignmentId) return;
    apiFetch(`${API}/assignments/${assignmentId}/attachments`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setAttachments)
      .catch(() => setAttachments([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [assignmentId]);

  const handleUpload = async (e) => {
    const files = e.target.files;
    if (!files?.length || !assignmentId) return;
    setUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const fd = new FormData();
        fd.append("file", files[i]);
        const r = await apiFetch(
          `${API}/assignments/${assignmentId}/attachments`,
          {
            method: "POST",
            body: fd,
          }
        );
        if (r.ok) load();
      }
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDelete = async (fileId) => {
    if (!confirm("Delete this file?")) return;
    const r = await apiFetch(
      `${API}/assignments/${assignmentId}/attachments/${fileId}`,
      {
        method: "DELETE",
      }
    );
    if (r.ok) load();
  };

  const getDownloadUrl = (id) => `${API}/attachments/${id}/download`;
  const token = localStorage.getItem("token");

  if (loading)
    return <p className="attachments-loading">Loading attachments...</p>;

  return (
    <div className="assignment-attachments">
      <div className="attachments-header">
        <span className="attachments-title">📎 Attachments</span>
        {canEdit && (
          <label className="btn-attach">
            <input
              type="file"
              multiple
              onChange={handleUpload}
              disabled={uploading}
            />
            {uploading ? "Uploading..." : "+ Add file"}
          </label>
        )}
      </div>
      {attachments.length === 0 ? (
        <p className="attachments-empty">No files attached</p>
      ) : (
        <ul className="attachments-list">
          {attachments.map((a) => (
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
