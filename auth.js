// auth.js

// ========================================
// FlowPoint Auth
// ========================================

export function getAuthToken() {
  return (
    localStorage.getItem(
      "fp_token"
    ) ||
    localStorage.getItem(
      "token"
    ) ||
    ""
  );
}

export function setAuthToken(
  token
) {
  if (!token) return;

  localStorage.setItem(
    "fp_token",
    token
  );

  localStorage.setItem(
    "token",
    token
  );
}

export function clearAuth() {
  localStorage.removeItem(
    "fp_token"
  );

  localStorage.removeItem(
    "token"
  );
}

export function isAuthenticated() {
  return !!getAuthToken();
}
