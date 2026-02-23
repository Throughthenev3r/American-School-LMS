// Форматирование дат и времени для отображения в интерфейсе

export function formatDate(str) {
  if (!str) return "—";
  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear();
  return `${month}/${day}/${year}`;
}

export function formatDateTime(str) {
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

export function dueDateLabel(dueDate) {
  if (!dueDate) return "";
  const d = new Date(dueDate);
  const now = new Date();
  const diffMs = d - now;
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const sameDay =
    diffDays === 0 &&
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  const timeStr = `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;
  if (diffMs < 0) return `Overdue ${Math.abs(diffDays)}d`;
  if (sameDay) return `Due today ${timeStr}`;
  if (diffDays === 0) return `Due tomorrow ${timeStr}`;
  if (diffDays === 1) return "Due tomorrow";
  return `Due in ${diffDays}d`;
}

export function toDatetimeLocal(str) {
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
