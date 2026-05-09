// ========================================
// FlowPoint Router
// ========================================

import { fpState } from "./state.js";

// ========================================
// Route Registry
// ========================================

const routes = {
  "#overview": "renderOverviewPage",
  "#audits": "renderAuditsPage",
  "#missions": "renderMissionsPage",
  "#monitors": "renderMonitorsPage",
  "#reports": "renderReportsPage",
  "#competitors": "renderCompetitorsPage",
  "#local-seo": "renderLocalSeoPage",
  "#conversion": "renderConversionPage",
  "#activity": "renderActivityPage",
  "#alerts": "renderAlertsPage",
  "#team": "renderTeamPage",
  "#billing": "renderBillingPage",
  "#settings": "renderSettingsPage"
};

// ========================================
// Router Init
// ========================================

export function initRouter() {
  window.addEventListener("hashchange", handleRoute);

  handleRoute();
}

// ========================================
// Handle Route
// ========================================

function handleRoute() {
  const route = window.location.hash || "#overview";

  fpState.app.currentRoute = route;

  setActiveNav(route);

  const rendererName = routes[route];

  if (!rendererName) {
    console.warn("Unknown route:", route);

    return;
  }

  const renderer = window[rendererName];

  if (typeof renderer !== "function") {
    console.warn("Renderer missing:", rendererName);

    return;
  }

  renderer();
}

// ========================================
// Active Navigation
// ========================================

function setActiveNav(route) {
  document
    .querySelectorAll(".fp-nav-item")
    .forEach((item) => {
      item.classList.remove("active");

      if (item.dataset.route === route) {
        item.classList.add("active");
      }
    });
}
