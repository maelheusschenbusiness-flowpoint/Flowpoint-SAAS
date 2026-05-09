// ========================================
// FlowPoint API Layer
// ========================================

const API_BASE = "/api";

async function request(path, options = {}) {
  const token = localStorage.getItem("fp_token");

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "API Error");
    }

    return {
      success: true,
      data
    };
  } catch (err) {
    console.error("FlowPoint API Error:", err);

    return {
      success: false,
      error: err.message
    };
  }
}

// ========================================
// API Helpers
// ========================================

export const api = {
  get: (path) =>
    request(path),

  post: (path, body) =>
    request(path, {
      method: "POST",
      body: JSON.stringify(body)
    }),

  put: (path, body) =>
    request(path, {
      method: "PUT",
      body: JSON.stringify(body)
    }),

  delete: (path) =>
    request(path, {
      method: "DELETE"
    })
};
