// ========================================
// FlowPoint App Bootstrap
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

  try {
    await loadSession();

    bindGlobalEvents();

    initRouter();

    fpState.app.initialized = true;

    console.log("✅ FlowPoint Ready");
  } catch (err) {
    console.error("❌ Bootstrap Error:", err);
  } finally {
    fpState.app.loading = false;
  }
}

// ========================================
// Load Session
// ========================================

async function loadSession() {
  try {
    const result = await api.get("/auth/me");

    if (!result || !result.success) {
      redirectToLogin();
      return;
    }

    const user =
      result.data?.user || result.user;

    const org =
      result.data?.org || result.org;

    if (!user) {
      redirectToLogin();
      return;
    }

    fpState.auth.authenticated = true;

    fpState.user = user;

    fpState.org = org || null;

    console.log("👤 Session Loaded");
  } catch (err) {
    console.error(
      "❌ Session Error:",
      err
    );

    redirectToLogin();
  }
}

// ========================================
// Redirect Login
// ========================================

function redirectToLogin() {
  fpState.auth.authenticated = false;

  window.location.href = "/login.html";
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

      console.log(
        "🌐 Connection Restored"
      );
    }
  );

  window.addEventListener(
    "offline",
    () => {
      fpState.app.online = false;

      console.log(
        "📡 Connection Lost"
      );
    }
  );
}

// ========================================
// Start
// ========================================

bootstrap();
