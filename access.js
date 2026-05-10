import { fpState } from "./state.js";

// ========================================
// PLAN HIERARCHY
// ========================================

const PLAN_LEVELS = {
  standard: 1,
  pro: 2,
  ultra: 3
};

// ========================================
// ROUTE ACCESS
// ========================================

const ROUTE_ACCESS = {

  "#overview": "standard",

  "#audits": "standard",

  "#missions": "standard",

  "#monitors": "standard",

  "#reports": "standard",

  "#activity": "standard",

  "#alerts": "pro",

  "#competitors": "pro",

  "#conversion": "pro",

  "#team": "pro",

  "#local-seo": "pro",

  "#billing": "standard",

  "#settings": "standard",

  "#enterprise": "ultra"

};

// ========================================
// CHECK PLAN ACCESS
// ========================================

export function hasPlanAccess(requiredPlan) {

  const currentPlan =
    fpState.org?.plan || "standard";

  return (
    PLAN_LEVELS[currentPlan] >=
    PLAN_LEVELS[requiredPlan]
  );
}

// ========================================
// CHECK ROUTE ACCESS
// ========================================

export function canAccessRoute(route) {

  const required =
    ROUTE_ACCESS[route] || "standard";

  return hasPlanAccess(required);
}

// ========================================
// REDIRECT IF BLOCKED
// ========================================

export function protectRoute(route) {

  if (!canAccessRoute(route)) {

    window.location.hash = "#billing";

    setTimeout(() => {

      const app = document.querySelector(
        ".fp-main-content"
      );

      if (!app) return;

      app.insertAdjacentHTML(
        "afterbegin",

        `
        <div class="fp-plan-warning">

          <div class="fp-plan-warning-title">
            Upgrade Required
          </div>

          <div class="fp-plan-warning-text">
            This feature requires a higher FlowPoint plan.
          </div>

        </div>
        `
      );

    }, 100);

    return false;
  }

  return true;
}

// ========================================
// QUOTA CHECK
// ========================================

export function hasQuota(type) {

  const quota = fpState.quotas[type];

  if (!quota) return true;

  return quota.used < quota.limit;
}

// ========================================
// QUOTA PROTECTION
// ========================================

export function requireQuota(type) {

  if (!hasQuota(type)) {

    showUpgradeModal(type);

    return false;
  }

  return true;
}

// ========================================
// UPGRADE MODAL
// ========================================

export function showUpgradeModal(type) {

  const overlay = document.createElement("div");

  overlay.className = "fp-upgrade-overlay";

  overlay.innerHTML = `

    <div class="fp-upgrade-modal">

      <div class="fp-upgrade-badge">
        FLOWPOINT UPGRADE
      </div>

      <h2 class="fp-upgrade-title">
        Limit Reached
      </h2>

      <p class="fp-upgrade-text">
        Your ${type} quota has been reached.
        Upgrade your FlowPoint plan
        to continue scaling.
      </p>

      <div class="fp-upgrade-actions">

        <button
          class="fp-primary-btn"
          id="fpUpgradeBtn"
        >
          Upgrade Plan
        </button>

        <button
          class="fp-secondary-btn"
          id="fpCloseUpgrade"
        >
          Close
        </button>

      </div>

    </div>
  `;

  document.body.appendChild(overlay);

  document
    .getElementById("fpCloseUpgrade")
    ?.addEventListener("click", () => {
      overlay.remove();
    });

  document
    .getElementById("fpUpgradeBtn")
    ?.addEventListener("click", () => {

      overlay.remove();

      window.location.hash = "#billing";
    });
}
