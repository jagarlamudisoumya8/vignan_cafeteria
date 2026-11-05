
const BASE = (
  import.meta.env.VITE_API_URL || "/api"
).replace(/\/+$/, "");

export const getToken = () =>
  localStorage.getItem("vignan_token");

export async function api(path, options = {}) {
  const token = getToken();

  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const endpoint = `${BASE}/${path.replace(/^\/+/, "")}`;

  let response;

  try {
    response = await fetch(endpoint, {
      ...options,
      headers,
    });
  } catch (error) {
    console.error("API Connection Error:", error);

    throw new Error(
      "Cannot connect to Flask backend. Check whether the backend is running."
    );
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error || `Request failed: ${response.status}`
    );
  }

  return data;
}

export const money = (value) =>
  `₹${Number(value || 0).toFixed(0)}`;

export const imageFallback =
  "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80";
