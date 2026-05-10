import { api } from "./api.js";
import { fpState } from "./state.js";

// ========================================
// ACTIVITY PAGE
// ========================================

window.renderActivityPage = async function () {

  const app = document.querySelector(".fp-main-content");

  if (!app) return;

  app.innerHTML = `
    <div class="fp-loading-screen">
      <div class="fp-loading-spinner"></div>
    </div>
  `;

  const result = await api.get("/activity");

  if (!result.success) {

    app.innerHTML = `
      <div class="fp-error-block">
        Failed to load activity
      </div>
    `;

    return;
  }

  const activity = result.data.activity;

  fpState.activity = activity;

  app.innerHTML = `

    <section class="fp-overview-hero">

      <div>

        <div class="fp-overview-badge">
          FLOWPOINT ACTIVITY
        </div>

        <h1 class="fp-overview-title">
          Live Workspace Activity
        </h1>

        <p class="fp-overview-subtitle">
          Real-time events across monitors,
          AI systems, reports and operations.
        </p>

      </div>

      <div class="fp-health-score-card">

        <div class="fp-health-score-label">
          Active Events
        </div>

        <div class="fp-health-score-value">
          ${activity.length}
        </div>

      </div>

    </section>

    <section class="fp-overview-section">

      <div class="fp-section-header">
        Real-Time Activity Feed
      </div>

      <div class="fp-activity-feed">

        ${activity.map(item => `
        
          <div class="fp-live-activity-card">

            <div class="fp-live-activity-top">

              <div class="fp-live-activity-type">
                ${item.type}
              </div>

              <div class="fp-live-activity-time">
                ${item.time}
              </div>

            </div>

            <div class="fp-live-activity-title">
              ${item.title}
            </div>

            <div class="fp-live-activity-description">
              ${item.description}
            </div>

            <div class="fp-live-activity-level fp-level-${item.level}">
              ${item.level}
            </div>

          </div>

        `).join("")}

      </div>

    </section>
  `;
};
