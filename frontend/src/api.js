export const API = "/api";

export async function parseJson(res) {
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

export function apiFetch(url, options = {}) {
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
