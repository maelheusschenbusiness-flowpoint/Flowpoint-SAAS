// app.js

import "./overview.js";
import { fpState } from "./state.js";
import { initRouter } from "./router.js";
import "./billing.js";

import {
  authFetch,
  getAuthToken,
  clearAuth,
} from "./auth.js";

// ========================================
// Bootstrap
// ========================================

async function bootstrap() {
  console.log("⚡ FlowPoint Boot");

  await loadSession();

  bindGlobalEvents();

  initRouter();

  fpState.app.initialized = true;
  fpState.app.loading = false;

  console.log("✅ FlowPoint Ready");
}

// ========================================
// Load Session
// ========================================

async function loadSession() {
  const token = getAuthToken();

  if (!token) {
    window.location.href =
      "/login.html";

    return;
  }

  const response =
    await authFetch(
      "/api/auth/me"
    );

  if (!response) {
    return;
  }

  const result =
    await response.json();

  if (!result.success) {
    clearAuth();

    window.location.href =
      "/login.html";

    return;
  }

  fpState.auth.authenticated = true;

  fpState.user =
    result.data.user;

  console.log(
    "👤 Session Loaded"
  );
}

// ========================================
// Global Events
// ========================================

function bindGlobalEvents() {
  window.addEventListener(
    "resize",
    () => {
      fpState.app.mobile =
        window.innerWidth <= 900;
    }
  );

  window.addEventListener(
    "online",
    () => {
      fpState.app.online = true;
    }
  );

  window.addEventListener(
    "offline",
    () => {
      fpState.app.online = false;
    }
  );
}

// ========================================
// Start
// ========================================

bootstrap();
