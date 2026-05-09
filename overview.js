import { api } from "./api.js";
import { fpState } from "./state.js";

// ========================================
// OVERVIEW PAGE
// ========================================

window.renderOverviewPage = async function () {

  const app = document.querySelector(".fp-main-content");

  if (!app) return;

  app.innerHTML = `
    <div class="fp-loading-screen">
      <div class="fp-loading-spinner"></div>
      <div class="fp-loading-text">
        Loading FlowPoint Overview...
      </div>
    </div>
  `;

  const result = await api.get("/dashboard/overview");

  if (!result.success) {
    app.innerHTML = `
      <div class="fp-error-block">
        Failed to load overview
      </div>
    `;

    return;
  }

  const data = result.data.overview;

  fpState.overview = data;

  app.innerHTML = `
  
    <section class="fp-overview-hero">

      <div class="fp-overview-left">

        <div class="fp-overview-badge">
          FLOWPOINT AI OVERVIEW
        </div>

        <h1 class="fp-overview-title">
          Business Operating System
        </h1>

        <p class="fp-overview-subtitle">
          Real-time executive visibility across SEO,
          monitoring, conversions, competitors and growth.
        </p>

        <div class="fp-overview-ai-summary">

          ${data.aiSummary.map(item => `
            <div class="fp-ai-summary-item">
              ⚡ ${item}
            </div>
          `).join("")}

        </div>

      </div>

      <div class="fp-overview-right">

        <div class="fp-health-score-card">

          <div class="fp-health-score-label">
            Workspace Health
          </div>

          <div class="fp-health-score-value">
            ${data.healthScore}
          </div>

          <div class="fp-health-score-sub">
            Stable growth momentum
          </div>

        </div>

      </div>

    </section>

    <section class="fp-overview-grid">

      ${metricCard("SEO Score", data.seoScore)}
      ${metricCard("Conversion", data.conversionScore)}
      ${metricCard("Local SEO", data.localSeoScore)}
      ${metricCard("Uptime", data.uptime + "%")}
      ${metricCard("Alerts", data.criticalAlerts)}
      ${metricCard("Missions", data.activeMissions)}

    </section>

    <section class="fp-overview-section">

      <div class="fp-section-header">
        AI Opportunities
      </div>

      <div class="fp-opportunities-grid">

        ${data.opportunities.map(item => `
          <div class="fp-opportunity-card">

            <div class="fp-opportunity-title">
              ${item.title}
            </div>

            <div class="fp-opportunity-impact">
              ${item.impact}
            </div>

            <div class="fp-opportunity-roi">
              ${item.roi}
            </div>

          </div>
        `).join("")}

      </div>

    </section>

    <section class="fp-overview-section">

      <div class="fp-section-header">
        Live Activity
      </div>

      <div class="fp-activity-feed">

        ${data.activity.map(item => `
          <div class="fp-activity-item">

            <div class="fp-activity-type">
              ${item.type}
            </div>

            <div class="fp-activity-label">
              ${item.label}
            </div>

            <div class="fp-activity-time">
              ${item.time}
            </div>

          </div>
        `).join("")}

      </div>

    </section>
  `;
};

// ========================================
// METRIC CARD
// ========================================

function metricCard(label, value) {
  return `
    <div class="fp-metric-card">

      <div class="fp-metric-label">
        ${label}
      </div>

      <div class="fp-metric-value">
        ${value}
      </div>

    </div>
  `;
}
