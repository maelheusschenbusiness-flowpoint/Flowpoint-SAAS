// app.js

// ========================================
// FlowPoint App Bootstrap
// ========================================

import "./overview.js";
import { fpState } from "./state.js";
import { api } from "./api.js";
import { initRouter } from "./router.js";
import "./billing.js";

import {
  clearAuth,
  getAuthToken,
} from "./auth.js";

// ========================================
// Bootstrap
// ========================================

async function bootstrap() {
  console.log(
    "⚡ FlowPoint Boot"
  );

  fpState.app.loading = true;

  await loadSession();

  bindGlobalEvents();

  initRouter();

  fpState.app.initialized = true;
  fpState.app.loading = false;

  console.log(
    "✅ FlowPoint Ready"
  );
}

// ========================================
// Load Session
// ========================================

async function loadSession() {
  try {
    const token =
      getAuthToken();

    if (!token) {
      console.log(
        "❌ No token"
      );

      redirectLogin();

      return;
    }

    const result =
      await api.get(
        "/auth/me"
      );

    console.log(
      "AUTH RESULT:",
      result
    );

    if (
      !result ||
      !result.ok ||
      !result.user
    ) {
      clearAuth();

      redirectLogin();

      return;
    }

    fpState.auth.authenticated = true;

    fpState.user =
      result.user;

    fpState.org =
      result.org || null;

    console.log(
      "👤 Session Loaded"
    );
  } catch (err) {
    console.error(err);

    clearAuth();

    redirectLogin();
  }
}

// ========================================
// Redirect Login
// ========================================

function redirectLogin() {
  if (
    window.location.pathname !==
    "/login.html"
  ) {
    window.location.href =
      "/login.html";
  }
}

// ========================================
// Global Events
// ========================================

function bindGlobalEvents() {
  fpState.app.mobile =
    window.innerWidth <= 900;

  fpState.app.online =
    navigator.onLine;

  window.addEventListener(
    "resize",
    () => {
      fpState.app.mobile =
        window.innerWidth <=
        900;
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
