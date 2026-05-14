// auth.js

// ========================================
// FlowPoint Auth Helper
// ========================================

export function getAuthToken() {
  return (
    localStorage.getItem("token") ||
    localStorage.getItem("fp_token") ||
    ""
  );
}

export function setAuthToken(token) {
  if (!token) return;

  localStorage.setItem("token", token);
  localStorage.setItem("fp_token", token);
}

export function clearAuth() {
  localStorage.removeItem("token");
  localStorage.removeItem("fp_token");
}

export async function authFetch(
  url,
  options = {}
) {
  const token = getAuthToken();

  const headers = {
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });

  if (response.status === 401) {
    clearAuth();

    window.location.href =
      "/login.html";

    return null;
  }

  return response;
}
