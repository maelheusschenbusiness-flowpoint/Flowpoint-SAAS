/* =========================================================
   FLOWPOINT DASHBOARD
   PREMIUM SaaS ENGINE
========================================================= */

const API_BASE =
  window.location.origin + "/api";

/* =========================================================
   STORAGE
========================================================= */

const STORAGE_KEYS = {

  token:
    "fp_token_v1",

  theme:
    "fp_theme_v1",

  ui:
    "fp_dashboard_ui_v1",

  notes:
    "fp_notes_v1",

  calendar:
    "fp_calendar_v1"

};

/* =========================================================
   STATE
========================================================= */

const state = {

  user: null,

  overview: null,

  monitors: [],

  audits: [],

  missions: [],

  reports: [],

  activity: [],

  team: [],

  loading: false,

  route:
    window.location.hash ||
    "#overview"

};

/* =========================================================
   ROUTES
========================================================= */

const ROUTES = [

  "#overview",

  "#missions",

  "#monitors",

  "#audits",

  "#reports",

  "#team",

  "#billing",

  "#settings",

  "#local-seo",

  "#competitors",

  "#alerts"

];

/* =========================================================
   DOM
========================================================= */

const app =
  document.getElementById(
    "fpApp"
  );

const page =
  document.getElementById(
    "fpPage"
  );

const sidebar =
  document.getElementById(
    "fpSidebar"
  );

/* =========================================================
   TOKEN
========================================================= */

function getToken() {

  return localStorage.getItem(
    STORAGE_KEYS.token
  );

}

function setToken(token) {

  localStorage.setItem(
    STORAGE_KEYS.token,
    token
  );

}

function removeToken() {

  localStorage.removeItem(
    STORAGE_KEYS.token
  );

}

/* =========================================================
   API
========================================================= */

async function api(
  endpoint,
  options = {}
) {

  const token =
    getToken();

  const response =
    await fetch(
      `${API_BASE}${endpoint}`,
      {

        ...options,

        headers: {

          "Content-Type":
            "application/json",

          Authorization:
            token
              ? `Bearer ${token}`
              : "",

          ...(options.headers || {})

        }

      }
    );

  const data =
    await response.json();

  if (
    response.status === 401
  ) {

    logout();

    return;

  }

  return data;

}

/* =========================================================
   AUTH
========================================================= */

async function verifySession() {

  const token =
    getToken();

  if (!token) {

    redirectToLogin();

    return false;

  }

  const data =
    await api("/auth/me");

  if (!data?.success) {

    logout();

    return false;

  }

  state.user =
    data.user;

  return true;

}

function logout() {

  removeToken();

  window.location.href =
    "/login.html";

}

function redirectToLogin() {

  window.location.href =
    "/login.html";

}

/* =========================================================
   INIT
========================================================= */

async function init() {

  const valid =
    await verifySession();

  if (!valid) return;

  bindEvents();

  await loadOverview();

  render();

}

init();

/* =========================================================
   EVENTS
========================================================= */

function bindEvents() {

  window.addEventListener(
    "hashchange",
    () => {

      state.route =
        window.location.hash ||
        "#overview";

      render();

    }
  );

}

/* =========================================================
   LOADERS
========================================================= */

async function loadOverview() {

  const data =
    await api(
      "/dashboard/overview"
    );

  if (!data?.success) return;

  state.overview =
    data;

  state.monitors =
    data.monitors || [];

  state.audits =
    data.audits || [];

  state.missions =
    data.missions || [];

  state.activity =
    data.activity || [];

}

/* =========================================================
   RENDER
========================================================= */

function render() {

  updateSidebarActive();

  switch (
    state.route
  ) {

    case "#overview":
      renderOverview();
      break;

    case "#missions":
      renderMissions();
      break;

    case "#monitors":
      renderMonitors();
      break;

    case "#audits":
      renderAudits();
      break;

    case "#reports":
      renderReports();
      break;

    case "#team":
      renderTeam();
      break;

    case "#billing":
      renderBilling();
      break;

    case "#settings":
      renderSettings();
      break;

    case "#local-seo":
      renderLocalSEO();
      break;

    case "#competitors":
      renderCompetitors();
      break;

    case "#alerts":
      renderAlerts();
      break;

    default:
      renderOverview();

  }

}

/* =========================================================
   SIDEBAR
========================================================= */

function updateSidebarActive() {

  document
  .querySelectorAll(
    "[data-route]"
  )
  .forEach((item) => {

    item.classList.remove(
      "active"
    );

    if (
      item.dataset.route ===
      state.route
    ) {

      item.classList.add(
        "active"
      );

    }

  });

}

/* =========================================================
   HELPERS
========================================================= */

function setPage(html) {

  page.innerHTML =
    html;

}

function createStatCard(
  label,
  value,
  icon
) {

  return `
  <div class="fpStatCard">

    <div class="fpStatTop">

      <div class="fpStatIcon">
        ${icon}
      </div>

    </div>

    <div class="fpStatValue">
      ${value}
    </div>

    <div class="fpStatLabel">
      ${label}
    </div>

  </div>
  `;

}

function createSection(
  title,
  content
) {

  return `
  <section class="fpSection">

    <div class="fpSectionHeader">

      <h2>
        ${title}
      </h2>

    </div>

    <div class="fpSectionContent">
      ${content}
    </div>

  </section>
  `;

}

/* =========================================================
   OVERVIEW
========================================================= */

function renderOverview() {

  const stats =
    state.overview?.stats;

  if (!stats) {

    setPage(`
      <div class="fpLoading">
        Loading...
      </div>
    `);

    return;

  }

  setPage(`

  <div class="fpOverviewHero">

    <div class="fpHeroLeft">

      <div class="fpHeroBadge">
        FLOWPOINT WAR ROOM
      </div>

      <h1>
        Welcome back,
        ${state.user.fullName}
      </h1>

      <p>
        Your infrastructure,
        SEO,
        monitoring
        and conversion systems
        are being tracked in realtime.
      </p>

    </div>

    <div class="fpHeroRight">

      <div class="fpScoreCircle">

        <div class="fpScoreValue">
          ${stats.auditScore}
        </div>

        <div class="fpScoreLabel">
          Health Score
        </div>

      </div>

    </div>

  </div>

  <div class="fpStatsGrid">

    ${createStatCard(
      "Monitors",
      stats.monitors,
      "🌐"
    )}

    ${createStatCard(
      "Online",
      stats.onlineMonitors,
      "🟢"
    )}

    ${createStatCard(
      "Offline",
      stats.offlineMonitors,
      "🔴"
    )}

    ${createStatCard(
      "Audits",
      stats.audits,
      "📊"
    )}

    ${createStatCard(
      "Missions",
      stats.missions,
      "🎯"
    )}

    ${createStatCard(
      "Completed",
      stats.completedMissions,
      "✅"
    )}

  </div>

  ${createSection(
    "Recent Activity",
    renderActivityList()
  )}

  ${createSection(
    "Critical Missions",
    renderCriticalMissions()
  )}

  `);

}

/* =========================================================
   ACTIVITY
========================================================= */

function renderActivityList() {

  return `
  <div class="fpActivityList">

    ${state.activity.map(
      (item) => `

      <div class="fpActivityItem">

        <div class="fpActivityContent">

          <div class="fpActivityTitle">
            ${item.title}
          </div>

          <div class="fpActivityDescription">
            ${item.description}
          </div>

        </div>

      </div>

      `
    ).join("")}

  </div>
  `;

}

/* =========================================================
   MISSIONS
========================================================= */

function renderCriticalMissions() {

  const missions =
    state.missions
    .slice(0, 5);

  return `
  <div class="fpMissionList">

    ${missions.map(
      (mission) => `

      <div class="fpMissionCard">

        <div class="fpMissionTop">

          <div class="fpMissionTitle">
            ${mission.title}
          </div>

          <div class="fpMissionPriority">
            ${mission.priority}
          </div>

        </div>

        <div class="fpMissionDescription">
          ${mission.description}
        </div>

      </div>

      `
    ).join("")}

  </div>
  `;

}
/* =========================================================
   MISSIONS PAGE
========================================================= */

function renderMissions() {

  setPage(`

  <div class="fpPageHero">

    <div>

      <div class="fpPageBadge">
        FLOWPOINT MISSIONS
      </div>

      <h1 class="fpPageTitle">
        Smart Mission Center
      </h1>

      <p class="fpPageDescription">
        Personalized SEO,
        monitoring,
        conversion
        and growth actions.
      </p>

    </div>

    <div class="fpPageActions">

      <button
        class="fpPrimaryButton"
        onclick="generateMissions()"
      >
        Generate AI Missions
      </button>

    </div>

  </div>

  <div class="fpMissionGrid">

    ${state.missions.map(
      (mission) => `

      <div class="fpMissionBigCard">

        <div class="fpMissionBigTop">

          <div class="fpMissionBigLeft">

            <div class="fpMissionBigCategory">
              ${mission.category}
            </div>

            <div class="fpMissionBigTitle">
              ${mission.title}
            </div>

          </div>

          <button
            class="
              fpMissionToggle
              ${mission.completed
                ? "completed"
                : ""}
            "
            onclick="
              toggleMission(
                '${mission._id}'
              )
            "
          >

            ${
              mission.completed
                ? "Completed"
                : "Mark Done"
            }

          </button>

        </div>

        <div class="fpMissionBigDescription">
          ${mission.description}
        </div>

        <div class="fpMissionMeta">

          <div class="fpMissionMetaItem">

            <span>
              Impact
            </span>

            <strong>
              ${mission.estimatedImpact}
            </strong>

          </div>

          <div class="fpMissionMetaItem">

            <span>
              Difficulty
            </span>

            <strong>
              ${mission.estimatedDifficulty}
            </strong>

          </div>

          <div class="fpMissionMetaItem">

            <span>
              Priority
            </span>

            <strong>
              ${mission.priority}
            </strong>

          </div>

        </div>

      </div>

      `
    ).join("")}

  </div>

  `);

}

/* =========================================================
   GENERATE MISSIONS
========================================================= */

async function generateMissions() {

  const button =
    document.querySelector(
      ".fpPrimaryButton"
    );

  if (button) {

    button.disabled = true;

    button.innerHTML =
      "Generating...";

  }

  const data =
    await api(
      "/missions/generate",
      {
        method: "POST"
      }
    );

  if (data?.success) {

    state.missions =
      data.missions;

    renderMissions();

  }

}

/* =========================================================
   TOGGLE MISSION
========================================================= */

async function toggleMission(
  missionId
) {

  const data =
    await api(
      `/missions/${missionId}/toggle`,
      {
        method: "PATCH"
      }
    );

  if (!data?.success) return;

  state.missions =
    state.missions.map(
      (mission) => {

        if (
          mission._id ===
          missionId
        ) {

          return data.mission;

        }

        return mission;

      }
    );

  renderMissions();

}

/* =========================================================
   MONITORS PAGE
========================================================= */

function renderMonitors() {

  setPage(`

  <div class="fpPageHero">

    <div>

      <div class="fpPageBadge">
        REALTIME MONITORING
      </div>

      <h1 class="fpPageTitle">
        Infrastructure Monitoring
      </h1>

      <p class="fpPageDescription">
        Uptime,
        SSL,
        performance
        and incident tracking.
      </p>

    </div>

    <div class="fpPageActions">

      <button
        class="fpPrimaryButton"
        onclick="openCreateMonitorModal()"
      >
        Add Monitor
      </button>

    </div>

  </div>

  <div class="fpMonitorGrid">

    ${state.monitors.map(
      (monitor) => `

      <div class="fpMonitorCard">

        <div class="fpMonitorTop">

          <div>

            <div class="fpMonitorLabel">
              ${monitor.label}
            </div>

            <div class="fpMonitorUrl">
              ${monitor.url}
            </div>

          </div>

          <div class="
            fpMonitorStatus
            ${monitor.status}
          ">

            ${monitor.status}

          </div>

        </div>

        <div class="fpMonitorStats">

          <div class="fpMonitorStat">

            <span>
              Response
            </span>

            <strong>
              ${monitor.responseTime}ms
            </strong>

          </div>

          <div class="fpMonitorStat">

            <span>
              Uptime
            </span>

            <strong>
              ${monitor.uptime}%
            </strong>

          </div>

          <div class="fpMonitorStat">

            <span>
              Incidents
            </span>

            <strong>
              ${monitor.incidents}
            </strong>

          </div>

        </div>

        <div class="fpMonitorActions">

          <button
            class="fpSecondaryButton"
            onclick="
              deleteMonitor(
                '${monitor._id}'
              )
            "
          >
            Delete
          </button>

        </div>

      </div>

      `
    ).join("")}

  </div>

  `);

}

/* =========================================================
   CREATE MONITOR MODAL
========================================================= */

function openCreateMonitorModal() {

  const overlay =
    document.createElement(
      "div"
    );

  overlay.className =
    "fpModalOverlay";

  overlay.innerHTML = `

  <div class="fpModal">

    <div class="fpModalHeader">

      <h2>
        Add Monitor
      </h2>

    </div>

    <div class="fpModalBody">

      <input
        id="fpMonitorLabel"
        class="fpInput"
        placeholder="Website Label"
      />

      <input
        id="fpMonitorUrl"
        class="fpInput"
        placeholder="https://example.com"
      />

    </div>

    <div class="fpModalActions">

      <button
        class="fpSecondaryButton"
        onclick="
          closeModal()
        "
      >
        Cancel
      </button>

      <button
        class="fpPrimaryButton"
        onclick="
          createMonitor()
        "
      >
        Create
      </button>

    </div>

  </div>

  `;

  document.body.appendChild(
    overlay
  );

}

/* =========================================================
   CLOSE MODAL
========================================================= */

function closeModal() {

  document
  .querySelectorAll(
    ".fpModalOverlay"
  )
  .forEach((item) => {

    item.remove();

  });

}

/* =========================================================
   CREATE MONITOR
========================================================= */

async function createMonitor() {

  const label =
    document.getElementById(
      "fpMonitorLabel"
    ).value;

  const url =
    document.getElementById(
      "fpMonitorUrl"
    ).value;

  if (
    !label ||
    !url
  ) return;

  const data =
    await api(
      "/monitors",
      {
        method: "POST",

        body: JSON.stringify({
          label,
          url
        })
      }
    );

  if (!data?.success) return;

  state.monitors.push(
    data.monitor
  );

  closeModal();

  renderMonitors();

}

/* =========================================================
   DELETE MONITOR
========================================================= */

async function deleteMonitor(
  monitorId
) {

  const confirmed =
    confirm(
      "Delete monitor?"
    );

  if (!confirmed) return;

  const data =
    await api(
      `/monitors/${monitorId}`,
      {
        method: "DELETE"
      }
    );

  if (!data?.success) return;

  state.monitors =
    state.monitors.filter(
      (monitor) =>
        monitor._id !==
        monitorId
    );

  renderMonitors();

}

/* =========================================================
   AUDITS PAGE
========================================================= */

function renderAudits() {

  setPage(`

  <div class="fpPageHero">

    <div>

      <div class="fpPageBadge">
        SEO & PERFORMANCE
      </div>

      <h1 class="fpPageTitle">
        Audit Center
      </h1>

      <p class="fpPageDescription">
        Analyze SEO,
        conversion,
        local visibility
        and performance.
      </p>

    </div>

    <div class="fpPageActions">

      <button
        class="fpPrimaryButton"
        onclick="generateAudit()"
      >
        Generate Audit
      </button>

    </div>

  </div>

  <div class="fpAuditGrid">

    ${state.audits.map(
      (audit) => `

      <div class="fpAuditCard">

        <div class="fpAuditTop">

          <div>

            <div class="fpAuditWebsite">
              ${audit.website}
            </div>

            <div class="fpAuditDate">
              ${new Date(
                audit.createdAt
              ).toLocaleDateString()}
            </div>

          </div>

          <div class="fpAuditScore">
            ${audit.score}
          </div>

        </div>

        <div class="fpAuditStats">

          <div class="fpAuditStat">

            <span>
              SEO
            </span>

            <strong>
              ${audit.seoScore}
            </strong>

          </div>

          <div class="fpAuditStat">

            <span>
              Performance
            </span>

            <strong>
              ${audit.performanceScore}
            </strong>

          </div>

          <div class="fpAuditStat">

            <span>
              Conversion
            </span>

            <strong>
              ${audit.conversionScore}
            </strong>

          </div>

          <div class="fpAuditStat">

            <span>
              Local SEO
            </span>

            <strong>
              ${audit.localSeoScore}
            </strong>

          </div>

        </div>

        <div class="fpAuditActions">

          <button
            class="fpPrimaryButton"
            onclick="
              exportAuditPdf(
                '${audit._id}'
              )
            "
          >
            Export PDF
          </button>

        </div>

      </div>

      `
    ).join("")}

  </div>

  `);

}
/* =========================================================
   GENERATE AUDIT
========================================================= */

async function generateAudit() {

  const button =
    document.querySelector(
      ".fpPrimaryButton"
    );

  if (button) {

    button.disabled = true;

    button.innerHTML =
      "Generating...";

  }

  const data =
    await api(
      "/audits/generate",
      {
        method: "POST"
      }
    );

  if (!data?.success) return;

  state.audits.unshift(
    data.audit
  );

  renderAudits();

}

/* =========================================================
   EXPORT PDF
========================================================= */

function exportAuditPdf(
  auditId
) {

  window.open(
    `${API_BASE}/reports/pdf/${auditId}`,
    "_blank"
  );

}

/* =========================================================
   REPORTS PAGE
========================================================= */

function renderReports() {

  setPage(`

  <div class="fpPageHero">

    <div>

      <div class="fpPageBadge">
        REPORT CENTER
      </div>

      <h1 class="fpPageTitle">
        Reports & Exports
      </h1>

      <p class="fpPageDescription">
        Generate client-ready
        PDF reports
        and executive summaries.
      </p>

    </div>

  </div>

  <div class="fpReportsGrid">

    ${state.audits.map(
      (audit) => `

      <div class="fpReportCard">

        <div class="fpReportTop">

          <div>

            <div class="fpReportTitle">
              Executive Report
            </div>

            <div class="fpReportWebsite">
              ${audit.website}
            </div>

          </div>

          <div class="fpReportScore">
            ${audit.score}
          </div>

        </div>

        <div class="fpReportContent">

          <div class="fpReportLine">

            <span>
              SEO Score
            </span>

            <strong>
              ${audit.seoScore}
            </strong>

          </div>

          <div class="fpReportLine">

            <span>
              Performance
            </span>

            <strong>
              ${audit.performanceScore}
            </strong>

          </div>

          <div class="fpReportLine">

            <span>
              Conversion
            </span>

            <strong>
              ${audit.conversionScore}
            </strong>

          </div>

          <div class="fpReportLine">

            <span>
              Local SEO
            </span>

            <strong>
              ${audit.localSeoScore}
            </strong>

          </div>

        </div>

        <div class="fpReportActions">

          <button
            class="fpPrimaryButton"
            onclick="
              exportAuditPdf(
                '${audit._id}'
              )
            "
          >
            Download PDF
          </button>

        </div>

      </div>

      `
    ).join("")}

  </div>

  `);

}

/* =========================================================
   TEAM PAGE
========================================================= */

async function renderTeam() {

  const data =
    await api("/team");

  if (data?.success) {

    state.team =
      data.members || [];

  }

  setPage(`

  <div class="fpPageHero">

    <div>

      <div class="fpPageBadge">
        TEAM WORKSPACE
      </div>

      <h1 class="fpPageTitle">
        Team Collaboration
      </h1>

      <p class="fpPageDescription">
        Communication,
        collaboration,
        notes
        and workflows.
      </p>

    </div>

  </div>

  <div class="fpTeamLayout">

    <div class="fpTeamSidebar">

      <div class="fpTeamSection">

        <div class="fpTeamSectionTitle">
          Channels
        </div>

        <div class="fpChannelList">

          <div class="fpChannelItem active">
            # general
          </div>

          <div class="fpChannelItem">
            # seo
          </div>

          <div class="fpChannelItem">
            # monitoring
          </div>

          <div class="fpChannelItem">
            # reports
          </div>

        </div>

      </div>

      <div class="fpTeamSection">

        <div class="fpTeamSectionTitle">
          Team
        </div>

        <div class="fpTeamMembers">

          ${state.team.map(
            (member) => `

            <div class="fpTeamMember">

              <div class="fpTeamAvatar">
                ${member.name
                  .charAt(0)
                  .toUpperCase()}
              </div>

              <div>

                <div class="fpTeamMemberName">
                  ${member.name}
                </div>

                <div class="fpTeamMemberRole">
                  ${member.role}
                </div>

              </div>

            </div>

            `
          ).join("")}

        </div>

      </div>

    </div>

    <div class="fpTeamChat">

      <div class="fpChatMessages">

        <div class="fpChatMessage">

          <div class="fpChatAuthor">
            FlowPoint AI
          </div>

          <div class="fpChatBubble">

            Welcome to your
            collaborative workspace.

          </div>

        </div>

      </div>

      <div class="fpChatInputArea">

        <input
          class="fpChatInput"
          placeholder="
            Send a message...
          "
        />

        <button
          class="fpPrimaryButton"
        >
          Send
        </button>

      </div>

    </div>

  </div>

  `);

}

/* =========================================================
   BILLING PAGE
========================================================= */

function renderBilling() {

  const user =
    state.user;

  setPage(`

  <div class="fpPageHero">

    <div>

      <div class="fpPageBadge">
        BILLING CENTER
      </div>

      <h1 class="fpPageTitle">
        Subscription & Add-ons
      </h1>

      <p class="fpPageDescription">
        Manage plans,
        upgrades,
        usage
        and advanced features.
      </p>

    </div>

  </div>

  <div class="fpBillingGrid">

    ${renderPlanCard(
      "Standard",
      "29",
      "standard",
      [
        "30 audits",
        "3 monitors",
        "30 reports",
        "1 seat"
      ]
    )}

    ${renderPlanCard(
      "Pro",
      "99",
      "pro",
      [
        "300 audits",
        "50 monitors",
        "300 reports",
        "5 seats",
        "AI insights"
      ]
    )}

    ${renderPlanCard(
      "Ultra",
      "299",
      "ultra",
      [
        "2000 audits",
        "300 monitors",
        "Unlimited exports",
        "10 seats",
        "Agency mode"
      ]
    )}

  </div>

  <div class="fpAddonSection">

    <div class="fpSectionTitle">
      Add-ons
    </div>

    <div class="fpAddonGrid">

      ${renderAddonCard(
        "Extra Monitors",
        "+50 monitors",
        "29"
      )}

      ${renderAddonCard(
        "AI Reports",
        "Advanced AI reports",
        "39"
      )}

      ${renderAddonCard(
        "White Label",
        "Custom branding",
        "49"
      )}

      ${renderAddonCard(
        "API Access",
        "Developer access",
        "59"
      )}

      ${renderAddonCard(
        "Extra Seats",
        "+5 team members",
        "19"
      )}

      ${renderAddonCard(
        "Automation Pack",
        "Advanced workflows",
        "79"
      )}

    </div>

  </div>

  `);

}
/* =========================================================
   PLAN CARD
========================================================= */

function renderPlanCard(
  title,
  price,
  plan,
  features
) {

  const active =
    state.user?.plan ===
    plan;

  return `

  <div class="
    fpPlanCard
    ${active ? "active" : ""}
  ">

    <div class="fpPlanTop">

      <div>

        <div class="fpPlanName">
          ${title}
        </div>

        <div class="fpPlanPrice">

          <span class="fpPlanPriceValue">
            €${price}
          </span>

          <span class="fpPlanPriceMonth">
            /month
          </span>

        </div>

      </div>

      ${
        active
          ? `
          <div class="fpCurrentPlan">
            Current
          </div>
          `
          : ""
      }

    </div>

    <div class="fpPlanFeatures">

      ${features.map(
        (feature) => `

        <div class="fpPlanFeature">

          <span class="fpPlanFeatureIcon">
            ✓
          </span>

          <span>
            ${feature}
          </span>

        </div>

        `
      ).join("")}

    </div>

    <button
      class="
        ${
          active
            ? "fpSecondaryButton"
            : "fpPrimaryButton"
        }
      "
      onclick="
        subscribePlan(
          '${plan}'
        )
      "
    >

      ${
        active
          ? "Current Plan"
          : "Upgrade"
      }

    </button>

  </div>

  `;

}

/* =========================================================
   ADDON CARD
========================================================= */

function renderAddonCard(
  title,
  description,
  price
) {

  return `

  <div class="fpAddonCard">

    <div class="fpAddonTop">

      <div class="fpAddonTitle">
        ${title}
      </div>

      <div class="fpAddonPrice">
        €${price}
      </div>

    </div>

    <div class="fpAddonDescription">
      ${description}
    </div>

    <button class="fpSecondaryButton">
      Add Add-on
    </button>

  </div>

  `;

}

/* =========================================================
   STRIPE SUBSCRIBE
========================================================= */

async function subscribePlan(
  plan
) {

  const PRICE_IDS = {

    standard:
      window.FLOWPOINT_STRIPE_STANDARD,

    pro:
      window.FLOWPOINT_STRIPE_PRO,

    ultra:
      window.FLOWPOINT_STRIPE_ULTRA

  };

  const priceId =
    PRICE_IDS[plan];

  if (!priceId) {

    alert(
      "Missing Stripe price"
    );

    return;

  }

  const data =
    await api(
      "/stripe/create-checkout",
      {

        method: "POST",

        body: JSON.stringify({

          priceId

        })

      }
    );

  if (
    data?.success &&
    data.url
  ) {

    window.location.href =
      data.url;

  }

}

/* =========================================================
   SETTINGS PAGE
========================================================= */

function renderSettings() {

  const user =
    state.user;

  setPage(`

  <div class="fpPageHero">

    <div>

      <div class="fpPageBadge">
        ACCOUNT SETTINGS
      </div>

      <h1 class="fpPageTitle">
        Workspace Settings
      </h1>

      <p class="fpPageDescription">
        Manage profile,
        workspace,
        branding
        and preferences.
      </p>

    </div>

  </div>

  <div class="fpSettingsGrid">

    <div class="fpSettingsCard">

      <div class="fpSettingsCardTitle">
        Profile
      </div>

      <div class="fpFormGroup">

        <label>
          Full Name
        </label>

        <input
          id="fpSettingsName"
          class="fpInput"
          value="${user.fullName || ""}"
        />

      </div>

      <div class="fpFormGroup">

        <label>
          Company Name
        </label>

        <input
          id="fpSettingsCompany"
          class="fpInput"
          value="${user.companyName || ""}"
        />

      </div>

      <div class="fpFormGroup">

        <label>
          Website
        </label>

        <input
          id="fpSettingsWebsite"
          class="fpInput"
          value="${user.website || ""}"
        />

      </div>

      <button
        class="fpPrimaryButton"
        onclick="saveSettings()"
      >
        Save Changes
      </button>

    </div>

    <div class="fpSettingsCard">

      <div class="fpSettingsCardTitle">
        Workspace
      </div>

      <div class="fpWorkspaceStats">

        <div class="fpWorkspaceStat">

          <span>
            Plan
          </span>

          <strong>
            ${user.plan}
          </strong>

        </div>

        <div class="fpWorkspaceStat">

          <span>
            Trial Ends
          </span>

          <strong>
            ${
              user.trialEndsAt
                ? new Date(
                    user.trialEndsAt
                  ).toLocaleDateString()
                : "N/A"
            }
          </strong>

        </div>

        <div class="fpWorkspaceStat">

          <span>
            Subscription
          </span>

          <strong>
            ${
              user.subscriptionStatus
            }
          </strong>

        </div>

      </div>

      <button
        class="fpSecondaryButton"
        onclick="openBillingPortal()"
      >
        Open Billing Portal
      </button>

    </div>

  </div>

  `);

}

/* =========================================================
   SAVE SETTINGS
========================================================= */

async function saveSettings() {

  const fullName =
    document.getElementById(
      "fpSettingsName"
    ).value;

  const companyName =
    document.getElementById(
      "fpSettingsCompany"
    ).value;

  const website =
    document.getElementById(
      "fpSettingsWebsite"
    ).value;

  const data =
    await api(
      "/settings",
      {

        method: "PATCH",

        body: JSON.stringify({

          fullName,
          companyName,
          website

        })

      }
    );

  if (!data?.success) {

    alert(
      "Save failed"
    );

    return;

  }

  state.user =
    data.user;

  alert(
    "Settings updated"
  );

}

/* =========================================================
   BILLING PORTAL
========================================================= */

async function openBillingPortal() {

  const data =
    await api(
      "/stripe/portal",
      {
        method: "POST"
      }
    );

  if (
    data?.success &&
    data.url
  ) {

    window.location.href =
      data.url;

  }

}

/* =========================================================
   LOCAL SEO PAGE
========================================================= */

function renderLocalSEO() {

  setPage(`

  <div class="fpPageHero">

    <div>

      <div class="fpPageBadge">
        LOCAL SEO
      </div>

      <h1 class="fpPageTitle">
        Local Visibility Engine
      </h1>

      <p class="fpPageDescription">
        Improve local rankings,
        visibility
        and map performance.
      </p>

    </div>

  </div>

  <div class="fpLocalGrid">

    <div class="fpLocalCard">

      <div class="fpLocalCardTitle">
        Visibility Score
      </div>

      <div class="fpLocalBigValue">
        82
      </div>

      <div class="fpLocalSmallText">
        Local SEO health is strong
        but can still improve.
      </div>

    </div>

    <div class="fpLocalCard">

      <div class="fpLocalCardTitle">
        Google Business
      </div>

      <div class="fpLocalChecklist">

        <div class="fpChecklistItem">
          ✓ Business optimized
        </div>

        <div class="fpChecklistItem">
          ✓ Reviews monitored
        </div>

        <div class="fpChecklistItem">
          ⚠ Missing local pages
        </div>

      </div>

    </div>

    <div class="fpLocalCard">

      <div class="fpLocalCardTitle">
        Recommended Actions
      </div>

      <div class="fpLocalActions">

        <div class="fpActionCard">
          Create city landing pages
        </div>

        <div class="fpActionCard">
          Improve review velocity
        </div>

        <div class="fpActionCard">
          Optimize map categories
        </div>

      </div>

    </div>

  </div>

  `);

}

/* =========================================================
   COMPETITORS PAGE
========================================================= */

function renderCompetitors() {

  setPage(`

  <div class="fpPageHero">

    <div>

      <div class="fpPageBadge">
        COMPETITOR TRACKING
      </div>

      <h1 class="fpPageTitle">
        Competitor Intelligence
      </h1>

      <p class="fpPageDescription">
        Analyze SEO,
        performance,
        visibility
        and opportunities.
      </p>

    </div>

  </div>

  <div class="fpCompetitorGrid">

    ${[
      "Competitor A",
      "Competitor B",
      "Competitor C"
    ].map(
      (name) => `

      <div class="fpCompetitorCard">

        <div class="fpCompetitorTop">

          <div class="fpCompetitorName">
            ${name}
          </div>

          <div class="fpCompetitorScore">
            ${
              Math.floor(
                Math.random() * 20
              ) + 70
            }
          </div>

        </div>

        <div class="fpCompetitorMetrics">

          <div class="fpCompetitorMetric">

            <span>
              SEO
            </span>

            <strong>
              ${
                Math.floor(
                  Math.random() * 20
                ) + 70
              }
            </strong>

          </div>

          <div class="fpCompetitorMetric">

            <span>
              Speed
            </span>

            <strong>
              ${
                Math.floor(
                  Math.random() * 20
                ) + 70
              }
            </strong>

          </div>

          <div class="fpCompetitorMetric">

            <span>
              Visibility
            </span>

            <strong>
              ${
                Math.floor(
                  Math.random() * 20
                ) + 70
              }
            </strong>

          </div>

        </div>

      </div>

      `
    ).join("")}

  </div>

  `);

}
/* =========================================================
   ALERTS PAGE
========================================================= */

function renderAlerts() {

  setPage(`

  <div class="fpPageHero">

    <div>

      <div class="fpPageBadge">
        ALERT CENTER
      </div>

      <h1 class="fpPageTitle">
        Realtime Alerts
      </h1>

      <p class="fpPageDescription">
        Monitor incidents,
        SEO risks,
        downtime
        and performance problems.
      </p>

    </div>

  </div>

  <div class="fpAlertsGrid">

    ${renderAlertCard(
      "Critical",
      "Website downtime detected",
      "2 minutes ago",
      "critical"
    )}

    ${renderAlertCard(
      "SEO",
      "Missing metadata on key pages",
      "15 minutes ago",
      "warning"
    )}

    ${renderAlertCard(
      "Performance",
      "Homepage loading slower",
      "30 minutes ago",
      "warning"
    )}

    ${renderAlertCard(
      "Security",
      "SSL expiration in 12 days",
      "1 hour ago",
      "info"
    )}

  </div>

  `);

}

/* =========================================================
   ALERT CARD
========================================================= */

function renderAlertCard(
  title,
  description,
  time,
  type
) {

  return `

  <div class="
    fpAlertCard
    ${type}
  ">

    <div class="fpAlertTop">

      <div class="fpAlertType">
        ${title}
      </div>

      <div class="fpAlertTime">
        ${time}
      </div>

    </div>

    <div class="fpAlertDescription">
      ${description}
    </div>

  </div>

  `;

}

/* =========================================================
   AI INSIGHTS
========================================================= */

async function generateAIInsights(
  prompt
) {

  const data =
    await api(
      "/ai/insights",
      {

        method: "POST",

        body: JSON.stringify({

          prompt

        })

      }
    );

  return data?.text || "";

}

/* =========================================================
   COMMAND PALETTE
========================================================= */

function openCommandPalette() {

  const overlay =
    document.createElement(
      "div"
    );

  overlay.className =
    "fpCommandPaletteOverlay";

  overlay.innerHTML = `

  <div class="fpCommandPalette">

    <input
      id="fpCommandInput"
      class="fpCommandInput"
      placeholder="
        Search pages,
        actions,
        commands...
      "
    />

    <div class="fpCommandResults">

      ${renderCommandItem(
        "Overview",
        "#overview"
      )}

      ${renderCommandItem(
        "Missions",
        "#missions"
      )}

      ${renderCommandItem(
        "Monitors",
        "#monitors"
      )}

      ${renderCommandItem(
        "Reports",
        "#reports"
      )}

      ${renderCommandItem(
        "Billing",
        "#billing"
      )}

      ${renderCommandItem(
        "Settings",
        "#settings"
      )}

    </div>

  </div>

  `;

  document.body.appendChild(
    overlay
  );

}

/* =========================================================
   COMMAND ITEM
========================================================= */

function renderCommandItem(
  label,
  route
) {

  return `

  <button
    class="fpCommandItem"
    onclick="
      navigateTo(
        '${route}'
      )
    "
  >

    ${label}

  </button>

  `;

}

/* =========================================================
   NAVIGATE
========================================================= */

function navigateTo(
  route
) {

  closeCommandPalette();

  window.location.hash =
    route;

}

/* =========================================================
   CLOSE COMMAND PALETTE
========================================================= */

function closeCommandPalette() {

  document
  .querySelectorAll(
    ".fpCommandPaletteOverlay"
  )
  .forEach((item) => {

    item.remove();

  });

}

/* =========================================================
   GLOBAL SHORTCUTS
========================================================= */

document.addEventListener(
  "keydown",
  (event) => {

    if (
      (
        event.metaKey ||
        event.ctrlKey
      ) &&
      event.key === "k"
    ) {

      event.preventDefault();

      openCommandPalette();

    }

  }
);

/* =========================================================
   THEME
========================================================= */

function loadTheme() {

  const theme =
    localStorage.getItem(
      STORAGE_KEYS.theme
    ) || "dark";

  document.body.dataset.theme =
    theme;

}

function toggleTheme() {

  const current =
    document.body.dataset.theme;

  const next =
    current === "dark"
      ? "light"
      : "dark";

  document.body.dataset.theme =
    next;

  localStorage.setItem(
    STORAGE_KEYS.theme,
    next
  );

}

loadTheme();

/* =========================================================
   NOTIFICATIONS
========================================================= */

function showNotification(
  message,
  type = "success"
) {

  const notification =
    document.createElement(
      "div"
    );

  notification.className =
    `
    fpNotification
    ${type}
    `;

  notification.innerHTML =
    message;

  document.body.appendChild(
    notification
  );

  setTimeout(() => {

    notification.classList.add(
      "visible"
    );

  }, 10);

  setTimeout(() => {

    notification.classList.remove(
      "visible"
    );

    setTimeout(() => {

      notification.remove();

    }, 300);

  }, 3000);

}

/* =========================================================
   SEARCH
========================================================= */

function globalSearch(
  query
) {

  const pages = [

    "overview",
    "missions",
    "monitors",
    "audits",
    "reports",
    "billing",
    "settings",
    "local seo",
    "competitors"

  ];

  return pages.filter(
    (item) =>
      item
      .toLowerCase()
      .includes(
        query.toLowerCase()
      )
  );

}

/* =========================================================
   LOADING STATE
========================================================= */

function showPageLoading() {

  page.innerHTML = `

  <div class="fpPageLoading">

    <div class="fpSpinner"></div>

    <div class="fpLoadingText">
      Loading workspace...
    </div>

  </div>

  `;

}

/* =========================================================
   ERROR STATE
========================================================= */

function showErrorState(
  message
) {

  page.innerHTML = `

  <div class="fpErrorState">

    <div class="fpErrorIcon">
      ⚠️
    </div>

    <div class="fpErrorTitle">
      Something went wrong
    </div>

    <div class="fpErrorDescription">
      ${message}
    </div>

  </div>

  `;

}

/* =========================================================
   EMPTY STATE
========================================================= */

function createEmptyState(
  title,
  description,
  buttonLabel,
  buttonAction
) {

  return `

  <div class="fpEmptyState">

    <div class="fpEmptyIcon">
      ✨
    </div>

    <div class="fpEmptyTitle">
      ${title}
    </div>

    <div class="fpEmptyDescription">
      ${description}
    </div>

    <button
      class="fpPrimaryButton"
      onclick="${buttonAction}"
    >
      ${buttonLabel}
    </button>

  </div>

  `;

}

/* =========================================================
   ONBOARDING
========================================================= */

function renderOnboarding() {

  setPage(`

  <div class="fpOnboarding">

    <div class="fpOnboardingHero">

      <div class="fpOnboardingBadge">
        FLOWPOINT SETUP
      </div>

      <h1>
        Welcome to FlowPoint
      </h1>

      <p>
        Configure your workspace
        to unlock monitoring,
        SEO insights,
        AI recommendations
        and growth systems.
      </p>

    </div>

    <div class="fpOnboardingSteps">

      <div class="fpOnboardingStep">

        <div class="fpOnboardingStepNumber">
          1
        </div>

        <div>

          <div class="fpOnboardingStepTitle">
            Add your website
          </div>

          <div class="fpOnboardingStepText">
            Start monitoring your
            infrastructure and SEO.
          </div>

        </div>

      </div>

      <div class="fpOnboardingStep">

        <div class="fpOnboardingStepNumber">
          2
        </div>

        <div>

          <div class="fpOnboardingStepTitle">
            Generate your first audit
          </div>

          <div class="fpOnboardingStepText">
            Analyze SEO,
            performance
            and conversion.
          </div>

        </div>

      </div>

      <div class="fpOnboardingStep">

        <div class="fpOnboardingStepNumber">
          3
        </div>

        <div>

          <div class="fpOnboardingStepTitle">
            Activate monitoring
          </div>

          <div class="fpOnboardingStepText">
            Realtime uptime
            and incident tracking.
          </div>

        </div>

      </div>

    </div>

  </div>

  `);

}
/* =========================================================
   ANALYTICS ENGINE
========================================================= */

function renderAnalyticsCards() {

  if (!state.overview?.stats) {
    return "";
  }

  const stats =
    state.overview.stats;

  return `

  <div class="fpAnalyticsGrid">

    <div class="fpAnalyticsCard">

      <div class="fpAnalyticsHeader">

        <div class="fpAnalyticsTitle">
          SEO Health
        </div>

        <div class="fpAnalyticsTrend positive">
          +12%
        </div>

      </div>

      <div class="fpAnalyticsValue">
        ${stats.auditScore}
      </div>

      <div class="fpAnalyticsFooter">
        Optimized visibility score
      </div>

    </div>

    <div class="fpAnalyticsCard">

      <div class="fpAnalyticsHeader">

        <div class="fpAnalyticsTitle">
          Uptime
        </div>

        <div class="fpAnalyticsTrend positive">
          Stable
        </div>

      </div>

      <div class="fpAnalyticsValue">
        ${stats.uptime}%
      </div>

      <div class="fpAnalyticsFooter">
        Infrastructure availability
      </div>

    </div>

    <div class="fpAnalyticsCard">

      <div class="fpAnalyticsHeader">

        <div class="fpAnalyticsTitle">
          Conversion Readiness
        </div>

        <div class="fpAnalyticsTrend warning">
          Needs work
        </div>

      </div>

      <div class="fpAnalyticsValue">
        74
      </div>

      <div class="fpAnalyticsFooter">
        Funnel optimization score
      </div>

    </div>

    <div class="fpAnalyticsCard">

      <div class="fpAnalyticsHeader">

        <div class="fpAnalyticsTitle">
          Local Visibility
        </div>

        <div class="fpAnalyticsTrend positive">
          Growing
        </div>

      </div>

      <div class="fpAnalyticsValue">
        82
      </div>

      <div class="fpAnalyticsFooter">
        Maps & local SEO impact
      </div>

    </div>

  </div>

  `;

}

/* =========================================================
   OVERVIEW ENHANCED
========================================================= */

function renderOverviewEnhanced() {

  const stats =
    state.overview?.stats;

  if (!stats) return;

  setPage(`

  <div class="fpOverviewWrapper">

    <div class="fpExecutiveHero">

      <div class="fpExecutiveLeft">

        <div class="fpExecutiveBadge">
          EXECUTIVE WAR ROOM
        </div>

        <h1 class="fpExecutiveTitle">
          Infrastructure stable,
          but conversion opportunities remain.
        </h1>

        <p class="fpExecutiveDescription">

          FlowPoint AI detected
          multiple opportunities
          to improve local SEO,
          conversion rate
          and organic visibility.

        </p>

        <div class="fpExecutiveActions">

          <button
            class="fpPrimaryButton"
            onclick="
              generateAudit()
            "
          >
            Generate Audit
          </button>

          <button
            class="fpSecondaryButton"
            onclick="
              navigateTo('#missions')
            "
          >
            Open Missions
          </button>

        </div>

      </div>

      <div class="fpExecutiveRight">

        <div class="fpExecutiveScoreCard">

          <div class="fpExecutiveScoreLabel">
            Global Health
          </div>

          <div class="fpExecutiveScoreValue">
            ${stats.auditScore}
          </div>

          <div class="fpExecutiveScoreBottom">
            Premium infrastructure monitoring
          </div>

        </div>

      </div>

    </div>

    ${renderAnalyticsCards()}

    <div class="fpOverviewColumns">

      <div class="fpOverviewColumn">

        ${createSection(
          "Critical Missions",
          renderCriticalMissions()
        )}

        ${createSection(
          "Recent Activity",
          renderActivityList()
        )}

      </div>

      <div class="fpOverviewColumn">

        ${renderRealtimeInsights()}

        ${renderQuickWins()}

      </div>

    </div>

  </div>

  `);

}

/* =========================================================
   REALTIME INSIGHTS
========================================================= */

function renderRealtimeInsights() {

  return `

  <section class="fpRealtimeInsights">

    <div class="fpSectionHeader">

      <h2>
        Realtime AI Insights
      </h2>

    </div>

    <div class="fpInsightList">

      <div class="fpInsightCard">

        <div class="fpInsightIcon">
          🚀
        </div>

        <div>

          <div class="fpInsightTitle">
            Performance Opportunity
          </div>

          <div class="fpInsightDescription">

            Compressing hero images
            could improve loading speed
            by 28%.

          </div>

        </div>

      </div>

      <div class="fpInsightCard">

        <div class="fpInsightIcon">
          📍
        </div>

        <div>

          <div class="fpInsightTitle">
            Local SEO Expansion
          </div>

          <div class="fpInsightDescription">

            Creating geo-targeted pages
            may increase local traffic.

          </div>

        </div>

      </div>

      <div class="fpInsightCard">

        <div class="fpInsightIcon">
          💰
        </div>

        <div>

          <div class="fpInsightTitle">
            Conversion Optimization
          </div>

          <div class="fpInsightDescription">

            CTA placement improvements
            detected for key landing pages.

          </div>

        </div>

      </div>

    </div>

  </section>

  `;

}

/* =========================================================
   QUICK WINS
========================================================= */

function renderQuickWins() {

  return `

  <section class="fpQuickWins">

    <div class="fpSectionHeader">

      <h2>
        Quick Wins
      </h2>

    </div>

    <div class="fpQuickWinList">

      <div class="fpQuickWinItem">
        Add missing H1 tags
      </div>

      <div class="fpQuickWinItem">
        Optimize mobile spacing
      </div>

      <div class="fpQuickWinItem">
        Improve CTA visibility
      </div>

      <div class="fpQuickWinItem">
        Reduce unused JavaScript
      </div>

      <div class="fpQuickWinItem">
        Improve internal linking
      </div>

    </div>

  </section>

  `;

}

/* =========================================================
   MOBILE SIDEBAR
========================================================= */

function toggleSidebar() {

  sidebar.classList.toggle(
    "mobile-open"
  );

}

/* =========================================================
   GLOBAL CLICK CLOSE
========================================================= */

document.addEventListener(
  "click",
  (event) => {

    if (
      event.target.classList.contains(
        "fpModalOverlay"
      )
    ) {

      closeModal();

    }

    if (
      event.target.classList.contains(
        "fpCommandPaletteOverlay"
      )
    ) {

      closeCommandPalette();

    }

  }
);

/* =========================================================
   AUTO REFRESH
========================================================= */

setInterval(
  async () => {

    if (
      state.route ===
      "#overview"
    ) {

      await loadOverview();

      renderOverviewEnhanced();

    }

  },
  60000
);

/* =========================================================
   INITIAL ROUTE FIX
========================================================= */

if (
  !ROUTES.includes(
    state.route
  )
) {

  window.location.hash =
    "#overview";

}

/* =========================================================
   ROUTE OVERRIDE
========================================================= */

const originalRender =
  render;

render = function() {

  updateSidebarActive();

  switch (
    state.route
  ) {

    case "#overview":
      renderOverviewEnhanced();
      break;

    case "#missions":
      renderMissions();
      break;

    case "#monitors":
      renderMonitors();
      break;

    case "#audits":
      renderAudits();
      break;

    case "#reports":
      renderReports();
      break;

    case "#team":
      renderTeam();
      break;

    case "#billing":
      renderBilling();
      break;

    case "#settings":
      renderSettings();
      break;

    case "#local-seo":
      renderLocalSEO();
      break;

    case "#competitors":
      renderCompetitors();
      break;

    case "#alerts":
      renderAlerts();
      break;

    default:
      renderOverviewEnhanced();

  }

};

/* =========================================================
   STARTUP
========================================================= */

(async () => {

  try {

    showPageLoading();

    const valid =
      await verifySession();

    if (!valid) return;

    await loadOverview();

    render();

    console.log(
      "✅ FlowPoint Dashboard Loaded"
    );

  } catch (err) {

    console.error(err);

    showErrorState(
      "Failed to initialize dashboard."
    );

  }

})();
/* =========================================================
   ADVANCED CLIENT LIBRARIES
========================================================= */

const FLOWPOINT_LIBRARIES = {

  seo: [

    {
      title:
        "Optimize meta titles",
      category:
        "seo",
      priority:
        "high",
      impact:
        "High"
    },

    {
      title:
        "Fix duplicate metadata",
      category:
        "seo",
      priority:
        "medium",
      impact:
        "Medium"
    },

    {
      title:
        "Improve internal linking",
      category:
        "seo",
      priority:
        "medium",
      impact:
        "High"
    },

    {
      title:
        "Create semantic clusters",
      category:
        "seo",
      priority:
        "high",
      impact:
        "Very High"
    }

  ],

  localSeo: [

    {
      title:
        "Create city landing pages",
      category:
        "local-seo"
    },

    {
      title:
        "Optimize Google Business Profile",
      category:
        "local-seo"
    },

    {
      title:
        "Increase review frequency",
      category:
        "local-seo"
    }

  ],

  performance: [

    {
      title:
        "Compress hero images",
      category:
        "performance"
    },

    {
      title:
        "Reduce unused JavaScript",
      category:
        "performance"
    },

    {
      title:
        "Optimize caching strategy",
      category:
        "performance"
    }

  ],

  conversion: [

    {
      title:
        "Improve CTA visibility",
      category:
        "conversion"
    },

    {
      title:
        "Add trust sections",
      category:
        "conversion"
    },

    {
      title:
        "Optimize mobile UX",
      category:
        "conversion"
    }

  ]

};

/* =========================================================
   SMART MISSION ENGINE
========================================================= */

function generateSmartMissionLibrary() {

  const website =
    (
      state.user?.website ||
      ""
    ).toLowerCase();

  const generated = [];

  if (
    website.includes(
      "shopify"
    )
  ) {

    generated.push({

      title:
        "Optimize Shopify collections",

      category:
        "ecommerce",

      description:
        "Improve collection structures and internal links."

    });

  }

  if (
    website.includes(
      "restaurant"
    )
  ) {

    generated.push({

      title:
        "Optimize restaurant local SEO",

      category:
        "local-seo",

      description:
        "Improve local map visibility and reviews."

    });

  }

  Object.values(
    FLOWPOINT_LIBRARIES
  )
  .forEach((group) => {

    group.forEach((item) => {

      generated.push({

        ...item,

        description:
          `${item.title} recommended by FlowPoint AI.`

      });

    });

  });

  return generated;

}

/* =========================================================
   ADVANCED OVERVIEW BLOCKS
========================================================= */

function renderExecutiveBlocks() {

  return `

  <div class="fpExecutiveGrid">

    <div class="fpExecutiveBlock">

      <div class="fpExecutiveBlockTitle">
        Revenue Opportunity
      </div>

      <div class="fpExecutiveBlockValue">
        +18%
      </div>

      <div class="fpExecutiveBlockText">

        Conversion optimization
        opportunities detected.

      </div>

    </div>

    <div class="fpExecutiveBlock">

      <div class="fpExecutiveBlockTitle">
        SEO Expansion
      </div>

      <div class="fpExecutiveBlockValue">
        34
      </div>

      <div class="fpExecutiveBlockText">

        New keyword opportunities identified.

      </div>

    </div>

    <div class="fpExecutiveBlock">

      <div class="fpExecutiveBlockTitle">
        Infrastructure Risk
      </div>

      <div class="fpExecutiveBlockValue warning">
        Medium
      </div>

      <div class="fpExecutiveBlockText">

        SSL expiration and latency issues detected.

      </div>

    </div>

    <div class="fpExecutiveBlock">

      <div class="fpExecutiveBlockTitle">
        AI Opportunities
      </div>

      <div class="fpExecutiveBlockValue">
        12
      </div>

      <div class="fpExecutiveBlockText">

        AI-powered quick wins available.

      </div>

    </div>

  </div>

  `;

}

/* =========================================================
   ADVANCED ANALYTICS
========================================================= */

function renderAdvancedAnalytics() {

  return `

  <div class="fpAdvancedAnalytics">

    <div class="fpAdvancedChart">

      <div class="fpAdvancedChartHeader">

        <div class="fpAdvancedChartTitle">
          SEO Visibility Trend
        </div>

      </div>

      <div class="fpFakeChart">

        <div style="height:45%"></div>
        <div style="height:65%"></div>
        <div style="height:58%"></div>
        <div style="height:82%"></div>
        <div style="height:78%"></div>
        <div style="height:92%"></div>
        <div style="height:88%"></div>

      </div>

    </div>

    <div class="fpAdvancedChart">

      <div class="fpAdvancedChartHeader">

        <div class="fpAdvancedChartTitle">
          Infrastructure Stability
        </div>

      </div>

      <div class="fpInfrastructureStats">

        <div class="fpInfraItem">

          <span>
            Avg Response
          </span>

          <strong>
            124ms
          </strong>

        </div>

        <div class="fpInfraItem">

          <span>
            Incidents
          </span>

          <strong>
            2
          </strong>

        </div>

        <div class="fpInfraItem">

          <span>
            SSL Health
          </span>

          <strong>
            Stable
          </strong>

        </div>

        <div class="fpInfraItem">

          <span>
            CDN Status
          </span>

          <strong>
            Active
          </strong>

        </div>

      </div>

    </div>

  </div>

  `;

}

/* =========================================================
   ADVANCED OVERVIEW EXTENSION
========================================================= */

function renderAdvancedOverview() {

  return `

  ${renderExecutiveBlocks()}

  ${renderAdvancedAnalytics()}

  <div class="fpOverviewBottomGrid">

    <div class="fpOverviewLargeCard">

      <div class="fpOverviewLargeTitle">
        AI Recommended Actions
      </div>

      <div class="fpRecommendedActions">

        ${generateSmartMissionLibrary()
          .slice(0, 10)
          .map(
            (mission) => `

            <div class="fpRecommendedAction">

              <div>

                <div class="fpRecommendedActionTitle">
                  ${mission.title}
                </div>

                <div class="fpRecommendedActionDescription">
                  ${mission.description}
                </div>

              </div>

              <button class="fpSecondaryButton">
                Add
              </button>

            </div>

            `
          )
          .join("")}

      </div>

    </div>

    <div class="fpOverviewLargeCard">

      <div class="fpOverviewLargeTitle">
        AI Executive Summary
      </div>

      <div class="fpExecutiveSummary">

        <p>

          FlowPoint AI detected
          strong technical foundations,
          but several growth opportunities
          remain underexploited.

        </p>

        <p>

          Local SEO expansion,
          conversion optimization
          and improved CTA hierarchy
          may significantly improve
          visibility and lead generation.

        </p>

        <p>

          Infrastructure remains stable,
          although monitoring detected
          latency spikes during
          peak traffic periods.

        </p>

      </div>

    </div>

  </div>

  `;

}

/* =========================================================
   EXTEND OVERVIEW
========================================================= */

const originalEnhancedOverview =
  renderOverviewEnhanced;

renderOverviewEnhanced =
  function() {

    const stats =
      state.overview?.stats;

    if (!stats) return;

    setPage(`

    <div class="fpOverviewWrapper">

      <div class="fpExecutiveHero">

        <div class="fpExecutiveLeft">

          <div class="fpExecutiveBadge">
            FLOWPOINT EXECUTIVE SYSTEM
          </div>

          <h1 class="fpExecutiveTitle">

            Your business infrastructure
            is operational,
            but growth opportunities remain.

          </h1>

          <p class="fpExecutiveDescription">

            FlowPoint continuously analyzes
            your SEO,
            monitoring,
            conversion,
            infrastructure
            and growth systems.

          </p>

          <div class="fpExecutiveActions">

            <button
              class="fpPrimaryButton"
              onclick="
                generateAudit()
              "
            >
              Generate Audit
            </button>

            <button
              class="fpSecondaryButton"
              onclick="
                navigateTo('#missions')
              "
            >
              Open Missions
            </button>

          </div>

        </div>

        <div class="fpExecutiveRight">

          <div class="fpExecutiveScoreCard">

            <div class="fpExecutiveScoreLabel">
              Global Health Score
            </div>

            <div class="fpExecutiveScoreValue">
              ${stats.auditScore}
            </div>

            <div class="fpExecutiveScoreBottom">

              Monitoring all critical systems

            </div>

          </div>

        </div>

      </div>

      ${renderAnalyticsCards()}

      ${renderAdvancedOverview()}

    </div>

    `);

  };
/* =========================================================
   AGENCY MODE
========================================================= */

const agencyState = {

  clients: [

    {
      id: 1,
      name:
        "Restaurant Premium",
      score: 82,
      plan: "pro",
      status: "healthy"
    },

    {
      id: 2,
      name:
        "Ecommerce Store",
      score: 74,
      plan: "ultra",
      status: "warning"
    },

    {
      id: 3,
      name:
        "Local Business",
      score: 91,
      plan: "standard",
      status: "healthy"
    }

  ]

};

/* =========================================================
   CLIENT MODE PAGE
========================================================= */

function renderClientMode() {

  setPage(`

  <div class="fpPageHero">

    <div>

      <div class="fpPageBadge">
        CLIENT WORKSPACE
      </div>

      <h1 class="fpPageTitle">
        Agency Client Management
      </h1>

      <p class="fpPageDescription">

        Manage multiple clients,
        reports,
        monitoring
        and growth systems.

      </p>

    </div>

  </div>

  <div class="fpClientGrid">

    ${agencyState.clients.map(
      (client) => `

      <div class="fpClientCard">

        <div class="fpClientTop">

          <div>

            <div class="fpClientName">
              ${client.name}
            </div>

            <div class="fpClientPlan">
              ${client.plan}
            </div>

          </div>

          <div class="
            fpClientStatus
            ${client.status}
          ">

            ${client.status}

          </div>

        </div>

        <div class="fpClientScore">

          ${client.score}

        </div>

        <div class="fpClientActions">

          <button
            class="fpPrimaryButton"
          >
            Open Workspace
          </button>

        </div>

      </div>

      `
    ).join("")}

  </div>

  `);

}

/* =========================================================
   AUTOMATION ENGINE
========================================================= */

const automationLibrary = [

  {
    title:
      "Weekly SEO Report",
    description:
      "Automatically send SEO reports every week."
  },

  {
    title:
      "Downtime Alerts",
    description:
      "Notify instantly when downtime is detected."
  },

  {
    title:
      "Client Executive Summary",
    description:
      "Generate AI summaries for clients."
  },

  {
    title:
      "Conversion Monitoring",
    description:
      "Track conversion-related changes."
  },

  {
    title:
      "Performance Regression Detection",
    description:
      "Detect loading speed degradations."
  }

];

/* =========================================================
   AUTOMATIONS PAGE
========================================================= */

function renderAutomations() {

  setPage(`

  <div class="fpPageHero">

    <div>

      <div class="fpPageBadge">
        AUTOMATION ENGINE
      </div>

      <h1 class="fpPageTitle">
        Smart Automations
      </h1>

      <p class="fpPageDescription">

        Automate reports,
        monitoring,
        alerts
        and AI workflows.

      </p>

    </div>

  </div>

  <div class="fpAutomationGrid">

    ${automationLibrary.map(
      (automation) => `

      <div class="fpAutomationCard">

        <div class="fpAutomationTop">

          <div class="fpAutomationTitle">
            ${automation.title}
          </div>

          <div class="fpAutomationStatus">
            Active
          </div>

        </div>

        <div class="fpAutomationDescription">
          ${automation.description}
        </div>

        <div class="fpAutomationActions">

          <button
            class="fpSecondaryButton"
          >
            Configure
          </button>

          <button
            class="fpPrimaryButton"
          >
            Activate
          </button>

        </div>

      </div>

      `
    ).join("")}

  </div>

  `);

}

/* =========================================================
   ADVANCED ALERT ENGINE
========================================================= */

const advancedAlerts = [

  {
    type:
      "critical",
    title:
      "Infrastructure instability detected",
    description:
      "Latency spikes detected on production infrastructure."
  },

  {
    type:
      "warning",
    title:
      "SEO decline detected",
    description:
      "Keyword visibility decreased by 8%."
  },

  {
    type:
      "info",
    title:
      "New AI opportunities available",
    description:
      "FlowPoint AI generated new recommendations."
  }

];

/* =========================================================
   ADVANCED ALERT CENTER
========================================================= */

function renderAdvancedAlerts() {

  return `

  <div class="fpAdvancedAlertCenter">

    ${advancedAlerts.map(
      (alert) => `

      <div class="
        fpAdvancedAlert
        ${alert.type}
      ">

        <div class="fpAdvancedAlertTop">

          <div class="fpAdvancedAlertTitle">
            ${alert.title}
          </div>

          <div class="fpAdvancedAlertBadge">
            ${alert.type}
          </div>

        </div>

        <div class="fpAdvancedAlertDescription">
          ${alert.description}
        </div>

      </div>

      `
    ).join("")}

  </div>

  `;

}

/* =========================================================
   AI CHAT
========================================================= */

async function askFlowPointAI() {

  const input =
    document.getElementById(
      "fpAIInput"
    );

  if (!input) return;

  const prompt =
    input.value.trim();

  if (!prompt) return;

  const container =
    document.getElementById(
      "fpAIChatMessages"
    );

  container.innerHTML += `

  <div class="fpAIMessage user">
    ${prompt}
  </div>

  `;

  input.value = "";

  const response =
    await generateAIInsights(
      prompt
    );

  container.innerHTML += `

  <div class="fpAIMessage ai">
    ${response}
  </div>

  `;

  container.scrollTop =
    container.scrollHeight;

}

/* =========================================================
   AI WORKSPACE
========================================================= */

function renderAIWorkspace() {

  setPage(`

  <div class="fpPageHero">

    <div>

      <div class="fpPageBadge">
        FLOWPOINT AI
      </div>

      <h1 class="fpPageTitle">
        AI Command Center
      </h1>

      <p class="fpPageDescription">

        Generate insights,
        recommendations,
        SEO improvements
        and growth systems.

      </p>

    </div>

  </div>

  <div class="fpAIWorkspace">

    <div
      class="fpAIChat"
      id="fpAIChatMessages"
    >

      <div class="fpAIMessage ai">

        Welcome to FlowPoint AI.
        Ask anything about:
        SEO,
        monitoring,
        conversion,
        performance
        or local growth.

      </div>

    </div>

    <div class="fpAIInputArea">

      <input
        id="fpAIInput"
        class="fpAIInput"
        placeholder="
          Ask FlowPoint AI...
        "
      />

      <button
        class="fpPrimaryButton"
        onclick="
          askFlowPointAI()
        "
      >
        Send
      </button>

    </div>

  </div>

  `);

}

/* =========================================================
   EXTEND ROUTES
========================================================= */

ROUTES.push(
  "#agency"
);

ROUTES.push(
  "#automations"
);

ROUTES.push(
  "#ai-workspace"
);

/* =========================================================
   FINAL ROUTER OVERRIDE
========================================================= */

const finalRender =
  render;

render = function() {

  updateSidebarActive();

  switch (
    state.route
  ) {

    case "#overview":
      renderOverviewEnhanced();
      break;

    case "#missions":
      renderMissions();
      break;

    case "#monitors":
      renderMonitors();
      break;

    case "#audits":
      renderAudits();
      break;

    case "#reports":
      renderReports();
      break;

    case "#team":
      renderTeam();
      break;

    case "#billing":
      renderBilling();
      break;

    case "#settings":
      renderSettings();
      break;

    case "#local-seo":
      renderLocalSEO();
      break;

    case "#competitors":
      renderCompetitors();
      break;

    case "#alerts":
      renderAlerts();
      break;

    case "#agency":
      renderClientMode();
      break;

    case "#automations":
      renderAutomations();
      break;

    case "#ai-workspace":
      renderAIWorkspace();
      break;

    default:
      renderOverviewEnhanced();

  }

};

/* =========================================================
   FINAL INITIALIZATION
========================================================= */

console.log(
  "🚀 FlowPoint Ultra Engine Ready"
);
