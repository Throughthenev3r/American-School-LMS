import React, { useState, useEffect } from "react";
import { apiFetch, API } from "./api.js";

export function AddCalendarEventForm({
  onDone,
  onCancel,
  classes: classesProp = [],
  defaultDate = "",
  editEvent = null,
}) {
  const isEdit = !!editEvent;
  const [title, setTitle] = useState(editEvent?.title ?? "");
  const [description, setDescription] = useState(editEvent?.description ?? "");
  const [eventDate, setEventDate] = useState(
    editEvent?.event_date ?? defaultDate
  );
  const [classIds, setClassIds] = useState(
    (editEvent?.classes ?? []).map((c) => c.id)
  );
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [classes, setClasses] = useState(classesProp);

  useEffect(() => {
    if (editEvent) {
      setTitle(editEvent.title ?? "");
      setDescription(editEvent.description ?? "");
      setEventDate(editEvent.event_date ?? defaultDate);
      setClassIds((editEvent.classes ?? []).map((c) => c.id));
    }
  }, [editEvent, defaultDate]);

  useEffect(() => {
    if (Array.isArray(classesProp) && classesProp.length > 0) {
      setClasses(classesProp);
      return;
    }
    apiFetch(`${API}/classes`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setClasses(Array.isArray(data) ? data : []))
      .catch(() => setClasses([]));
  }, [classesProp]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!eventDate) {
      setError("Date is required");
      return;
    }
    if (classIds.length === 0) {
      setError("Select at least one class");
      return;
    }

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("description", description.trim());
      fd.append("event_date", eventDate);
      fd.append("class_section_ids", JSON.stringify(classIds));
      if (file) fd.append("file", file);

      const url = isEdit ? `${API}/calendar-events/${editEvent.id}` : `${API}/calendar-events`;
      const res = await apiFetch(url, {
        method: isEdit ? "PUT" : "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || (isEdit ? "Failed to update event" : "Failed to create event"));
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-block calendar-event-form">
      <h3>{isEdit ? "Edit calendar event" : "Add calendar event"}</h3>
      <form onSubmit={handleSubmit}>
        <label>Title *</label>
        <input
          type="text"
          placeholder="Event name"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="filter-input"
          required
        />
        <label>Description</label>
        <textarea
          placeholder="Event description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="filter-input"
        />
        <label>Date *</label>
        <div className="date-row">
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className="filter-input"
            required
          />
          <button
            type="button"
            className="btn-small"
            onClick={() => {
              const t = new Date();
              t.setDate(t.getDate() + 1);
              const y = t.getFullYear();
              const m = String(t.getMonth() + 1).padStart(2, "0");
              const d = String(t.getDate()).padStart(2, "0");
              setEventDate(`${y}-${m}-${d}`);
            }}
          >
            Tomorrow
          </button>
        </div>
        <label>Class(es) *</label>
        <select
          multiple
          className="filter-input"
          value={classIds.map(String)}
          onChange={(e) => {
            const opts = Array.from(e.target.selectedOptions, (o) => Number(o.value));
            setClassIds(opts);
          }}
          size={Math.min(6, Math.max(3, classes.length))}
        >
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.course_name} — Section {c.section_code}
            </option>
          ))}
        </select>
        <p className="form-hint">Hold Ctrl/Cmd to select multiple classes</p>
        <label className="attachments-title">Attachment</label>
        <div className="attachments-header">
          <label className="btn-add btn-attach">
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.txt,.doc,.docx"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            {file ? file.name : "+ Add file"}
          </label>
        </div>
        {error && <p className="msg-error">{error}</p>}
        <div className="modal-actions">
          <button type="submit" className="btn-confirm" disabled={loading}>
            {loading ? (isEdit ? "Updating…" : "Creating…") : (isEdit ? "Update event" : "Create event")}
          </button>
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
