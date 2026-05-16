// ========================================
// FlowPoint Bootstrap
// ========================================

import "./overview.js";
import "./billing.js";

import { fpState } from "./state.js";
import { api } from "./api.js";
import { initRouter } from "./router.js";

// ========================================
// Bootstrap
// ========================================

async function bootstrap() {
  console.log("⚡ FlowPoint Boot");

  fpState.app.loading = true;

  await loadSession();

  bindGlobalEvents();

  initRouter();

  fpState.app.initialized = true;
  fpState.app.loading = false;

  console.log("✅ FlowPoint Ready");
}

// ========================================
// Session
// ========================================

async function loadSession() {
  try {
    const token =
      localStorage.getItem(
        "fp_token"
      );

    if (!token) {
      redirectToLogin();
      return;
    }

    const result =
      await api.get(
        "/auth/me"
      );

    if (
      !result ||
      !result.success ||
      !result.user
    ) {
      localStorage.removeItem(
        "fp_token"
      );

      redirectToLogin();

      return;
    }

    fpState.auth.authenticated = true;

    fpState.user =
      result.user;

    console.log(
      "👤 Session loaded"
    );

  } catch (err) {
    console.error(err);

    localStorage.removeItem(
      "fp_token"
    );

    redirectToLogin();
  }
}

// ========================================
// Redirect
// ========================================

function redirectToLogin() {
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
