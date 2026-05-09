// ========================================
// FlowPoint App Bootstrap
// ========================================

import { fpState } from "./state.js";
import { api } from "./api.js";

// ========================================
// Initialize App
// ========================================

async function bootstrap() {
  console.log("⚡ FlowPoint Boot");

  await loadSession();

  bindGlobalEvents();

  fpState.app.initialized = true;
  fpState.app.loading = false;

  console.log("✅ FlowPoint Ready");
}

// ========================================
// Session Loader
// ========================================

async function loadSession() {
  const token = localStorage.getItem("fp_token");

  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  const result = await api.get("/auth/me");

  if (!result.success) {
    localStorage.removeItem("fp_token");
    window.location.href = "/login.html";
    return;
  }

  fpState.user = result.data.user;
  fpState.org = result.data.org;

  console.log("👤 Session Loaded");
}

// ========================================
// Global Events
// ========================================

function bindGlobalEvents() {
  window.addEventListener("resize", () => {
    fpState.app.mobile = window.innerWidth <= 900;
  });

  window.addEventListener("online", () => {
    fpState.app.online = true;
  });

  window.addEventListener("offline", () => {
    fpState.app.online = false;
  });
}

// ========================================
// Start
// ========================================

bootstrap();
