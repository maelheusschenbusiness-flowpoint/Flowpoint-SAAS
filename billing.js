import { api } from "./api.js";
import { fpState } from "./state.js";

// ========================================
// BILLING PAGE
// ========================================

window.renderBillingPage = async function () {

  const app = document.querySelector(".fp-main-content");

  if (!app) return;

  app.innerHTML = `
    <div class="fp-loading-screen">
      <div class="fp-loading-spinner"></div>
    </div>
  `;

  const result = await api.get("/org/quotas");

  if (!result.success) {

    app.innerHTML = `
      <div class="fp-error-block">
        Failed to load billing
      </div>
    `;

    return;
  }

  const quotas = result.data.quotas;

  fpState.quotas = quotas;

  app.innerHTML = `

    <section class="fp-billing-hero">

      <div>

        <div class="fp-overview-badge">
          FLOWPOINT BILLING
        </div>

        <h1 class="fp-overview-title">
          ${quotas.plan.toUpperCase()} PLAN
        </h1>

        <p class="fp-overview-subtitle">
          Monitor usage, AI credits,
          addons and workspace scaling.
        </p>

      </div>

      <div class="fp-health-score-card">

        <div class="fp-health-score-label">
          Workspace Plan
        </div>

        <div class="fp-health-score-value">
          ${quotas.plan.toUpperCase()}
        </div>

      </div>

    </section>

    <section class="fp-overview-grid">

      ${quotaCard(
        "Audits",
        quotas.audits.used,
        quotas.audits.limit
      )}

      ${quotaCard(
        "Monitors",
        quotas.monitors.used,
        quotas.monitors.limit
      )}

      ${quotaCard(
        "Reports",
        quotas.reports.used,
        quotas.reports.limit
      )}

      ${quotaCard(
        "Exports",
        quotas.exports.used,
        quotas.exports.limit
      )}

      ${quotaCard(
        "AI Credits",
        quotas.aiCredits.used,
        quotas.aiCredits.limit
      )}

      ${quotaCard(
        "Seats",
        quotas.seats.used,
        quotas.seats.limit
      )}

    </section>

    <section class="fp-overview-section">

      <div class="fp-section-header">
        Active Add-ons
      </div>

      <div class="fp-opportunities-grid">

        ${quotas.addons.map(addon => `
          <div class="fp-opportunity-card">

            <div class="fp-opportunity-title">
              ${addon}
            </div>

          </div>
        `).join("")}

      </div>

    </section>
  `;
};

// ========================================
// QUOTA CARD
// ========================================

function quotaCard(label, used, limit) {

  const percent = Math.min(
    100,
    Math.round((used / limit) * 100)
  );

  return `
    <div class="fp-metric-card">

      <div class="fp-metric-label">
        ${label}
      </div>

      <div class="fp-metric-value">
        ${used}/${limit}
      </div>

      <div class="fp-quota-bar">

        <div
          class="fp-quota-fill"
          style="width:${percent}%"
        ></div>

      </div>

    </div>
  `;
}
