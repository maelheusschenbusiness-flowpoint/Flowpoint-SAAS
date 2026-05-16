'use strict';

// ─────────────────────────────────────────────
// FLOWPOINT CORE
// ─────────────────────────────────────────────

const FP = {

  initialized: false,

  mobile:
    window.innerWidth <= 900,

  currentRoute: 'overview',

  loading: false,

  reconnectTimeout: null,
};

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

const STATE = {

  me: null,

  org: null,

  route: 'overview',

  theme:
    localStorage.getItem(
      'fp_theme'
    ) || 'dark',

  sidebarOpen: false,

  notifications: [],

  monitors: [],

  audits: [],

  reports: [],

  missions: [],
};

// ─────────────────────────────────────────────
// TOKEN
// ─────────────────────────────────────────────

const TOKEN_KEY =
  'fp_token';

function getToken() {

  return localStorage.getItem(
    TOKEN_KEY
  );
}

function setToken(token) {

  localStorage.setItem(
    TOKEN_KEY,
    token
  );
}

function removeToken() {

  localStorage.removeItem(
    TOKEN_KEY
  );
}

// ─────────────────────────────────────────────
// API
// ─────────────────────────────────────────────

async function api(
  path,
  options = {}
) {

  const token =
    getToken();

  let response;

  try {

    response = await fetch(
      `/api${path}`,
      {
        ...options,

        credentials:
          'include',

        headers: {

          'Content-Type':
            'application/json',

          ...(options.headers || {}),

          Authorization:
            token
              ? `Bearer ${token}`
              : '',
        },
      }
    );

  } catch (networkError) {

    console.error(
      '[FP] Network error:',
      networkError
    );

    throw new Error(
      'Erreur réseau'
    );
  }

  if (
    response.status === 401
  ) {

    removeToken();

    location.href =
      '/login.html';

    return null;
  }

  let data = null;

  try {

    data =
      await response.json();

  } catch (jsonError) {

    console.error(
      '[FP] Invalid JSON:',
      jsonError
    );

    throw new Error(
      'Réponse serveur invalide'
    );
  }

  if (!response.ok) {

    throw new Error(
      data?.error ||
      'Erreur API'
    );
  }

  return data;
}

// ─────────────────────────────────────────────
// SESSION
// ─────────────────────────────────────────────

async function verifySession() {

  const token =
    getToken();

  if (!token) {

    redirectLogin();

    return;
  }

  const data =
    await api('/auth/me');

  if (!data?.ok) {

    removeToken();

    redirectLogin();

    return;
  }

  STATE.me =
    data.user;

  STATE.org =
    data.org;

  console.log(
    '👤 Session loaded:',
    data.user?.email
  );
}

function redirectLogin() {

  location.href =
    '/login.html';
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────

document.addEventListener(
  'DOMContentLoaded',
  async () => {

    try {

      console.log(
        '⚡ FlowPoint boot'
      );

      await verifySession();

      bindGlobalEvents();

      initRouter();

      initTheme();

      initSidebar();

      render();

      FP.initialized =
        true;

      console.log(
        '✅ FlowPoint ready'
      );

    } catch (err) {

      console.error(
        '[FP] Bootstrap error:',
        err
      );

      showFatalError(
        err.message
      );
    }
  }
);

// ─────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────

function initRouter() {

  window.addEventListener(
    'hashchange',
    handleRoute
  );

  if (!location.hash) {

    location.hash =
      '#overview';
  }

  handleRoute();
}

function handleRoute() {

  const route =
    location.hash.replace(
      '#',
      ''
    ) || 'overview';

  STATE.route =
    route;

  FP.currentRoute =
    route;

  setActiveNav(route);

  render();
}

function navigate(route) {

  location.hash =
    `#${route}`;

  closeMobileSidebar();
}

// ─────────────────────────────────────────────
// SIDEBAR
// ─────────────────────────────────────────────

function initSidebar() {

  const toggle =
    document.querySelector(
      '.fpSidebarToggle'
    );

  const overlay =
    document.getElementById(
      'fpOverlay'
    );

  if (toggle) {

    toggle.addEventListener(
      'click',
      toggleSidebar
    );
  }

  if (overlay) {

    overlay.addEventListener(
      'click',
      closeMobileSidebar
    );
  }
}

function toggleSidebar() {

  STATE.sidebarOpen =
    !STATE.sidebarOpen;

  document.body.classList.toggle(
    'fpSidebarOpen',
    STATE.sidebarOpen
  );
}

function closeMobileSidebar() {

  if (
    window.innerWidth > 900
  ) {
    return;
  }

  STATE.sidebarOpen =
    false;

  document.body.classList.remove(
    'fpSidebarOpen'
  );
}

// ─────────────────────────────────────────────
// ACTIVE NAV
// ─────────────────────────────────────────────

function setActiveNav(route) {

  document
    .querySelectorAll(
      '.fpNavItem'
    )
    .forEach(item => {

      item.classList.remove(
        'active'
      );

      const href =
        item.getAttribute(
          'href'
        );

      if (
        href === `#${route}`
      ) {

        item.classList.add(
          'active'
        );
      }
    });
}
// ─────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────

function render() {

  const app =
    document.getElementById(
      'app'
    );

  if (!app) {
    return;
  }

  switch (STATE.route) {

    case 'overview':
      renderOverview(app);
      break;

    case 'audits':
      renderAudits(app);
      break;

    case 'monitors':
      renderMonitors(app);
      break;

    case 'reports':
      renderReports(app);
      break;

    case 'billing':
      renderBilling(app);
      break;

    case 'settings':
      renderSettings(app);
      break;

    default:
      renderOverview(app);
  }
}

// ─────────────────────────────────────────────
// OVERVIEW
// ─────────────────────────────────────────────

function renderOverview(app) {

  const user =
    STATE.me;

  app.innerHTML = `
    <div class="fpPage">

      <section class="fpHeroCard">

        <div class="fpHeroContent">

          <div class="fpEyebrow">
            FLOWPOINT
          </div>

          <h1 class="fpHeroTitle">
            Bonjour ${
              user?.firstName ||
              'User'
            }
          </h1>

          <p class="fpHeroText">
            Votre dashboard FlowPoint est opérationnel.
          </p>

        </div>

      </section>

      <section class="fpStatsGrid">

        <div class="fpStatCard">

          <div class="fpStatLabel">
            SEO Score
          </div>

          <div class="fpStatValue">
            84
          </div>

        </div>

        <div class="fpStatCard">

          <div class="fpStatLabel">
            Active Monitors
          </div>

          <div class="fpStatValue">
            4
          </div>

        </div>

        <div class="fpStatCard">

          <div class="fpStatLabel">
            Reports
          </div>

          <div class="fpStatValue">
            18
          </div>

        </div>

        <div class="fpStatCard">

          <div class="fpStatLabel">
            Status
          </div>

          <div class="fpStatValue">
            Stable
          </div>

        </div>

      </section>

    </div>
  `;
}

// ─────────────────────────────────────────────
// AUDITS
// ─────────────────────────────────────────────

function renderAudits(app) {

  app.innerHTML = `
    <div class="fpPage">

      <div class="fpPageHeader">

        <div>

          <div class="fpEyebrow">
            FLOWPOINT
          </div>

          <h1 class="fpPageTitle">
            Audits
          </h1>

        </div>

      </div>

      <div class="fpCard">
        Les audits apparaîtront ici.
      </div>

    </div>
  `;
}

// ─────────────────────────────────────────────
// MONITORS
// ─────────────────────────────────────────────

function renderMonitors(app) {

  app.innerHTML = `
    <div class="fpPage">

      <div class="fpPageHeader">

        <div>

          <div class="fpEyebrow">
            FLOWPOINT
          </div>

          <h1 class="fpPageTitle">
            Monitors
          </h1>

        </div>

      </div>

      <div class="fpCard">
        Les monitors apparaîtront ici.
      </div>

    </div>
  `;
}

// ─────────────────────────────────────────────
// REPORTS
// ─────────────────────────────────────────────

function renderReports(app) {

  app.innerHTML = `
    <div class="fpPage">

      <div class="fpPageHeader">

        <div>

          <div class="fpEyebrow">
            FLOWPOINT
          </div>

          <h1 class="fpPageTitle">
            Reports
          </h1>

        </div>

      </div>

      <div class="fpCard">
        Les rapports apparaîtront ici.
      </div>

    </div>
  `;
}

// ─────────────────────────────────────────────
// BILLING
// ─────────────────────────────────────────────

function renderBilling(app) {

  app.innerHTML = `
    <div class="fpPage">

      <div class="fpPageHeader">

        <div>

          <div class="fpEyebrow">
            FLOWPOINT
          </div>

          <h1 class="fpPageTitle">
            Billing
          </h1>

        </div>

      </div>

      <div class="fpBillingGrid">

        <div class="fpCard">

          <div class="fpCardTitle">
            Current Plan
          </div>

          <div class="fpPlanValue">
            PRO
          </div>

        </div>

        <div class="fpCard">

          <div class="fpCardTitle">
            Trial
          </div>

          <div class="fpPlanValue">
            Active
          </div>

        </div>

      </div>

    </div>
  `;
}

// ─────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────

function renderSettings(app) {

  app.innerHTML = `
    <div class="fpPage">

      <div class="fpPageHeader">

        <div>

          <div class="fpEyebrow">
            FLOWPOINT
          </div>

          <h1 class="fpPageTitle">
            Settings
          </h1>

        </div>

      </div>

      <div class="fpCard">

        <button
          class="fpPrimaryBtn"
          onclick="logout()"
        >
          Déconnexion
        </button>

      </div>

    </div>
  `;
}

// ─────────────────────────────────────────────
// THEME
// ─────────────────────────────────────────────

function initTheme() {

  document.documentElement.setAttribute(
    'data-theme',
    STATE.theme
  );
}

// ─────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────

function bindGlobalEvents() {

  let resizeTimeout;

  window.addEventListener(
    'resize',
    () => {

      clearTimeout(
        resizeTimeout
      );

      resizeTimeout =
        setTimeout(() => {

          FP.mobile =
            window.innerWidth <= 900;

        }, 120);
    }
  );
}

// ─────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────

function showToast(
  text,
  type = 'info'
) {

  console.log(
    `[${type}] ${text}`
  );
}

// ─────────────────────────────────────────────
// FATAL ERROR
// ─────────────────────────────────────────────

function showFatalError(
  message
) {

  document.body.innerHTML = `
    <div style="
      min-height:100vh;
      display:flex;
      align-items:center;
      justify-content:center;
      background:#070b19;
      color:white;
      font-family:Inter,sans-serif;
      padding:24px;
    ">

      <div style="
        width:100%;
        max-width:520px;
        background:rgba(255,255,255,.04);
        border:1px solid rgba(255,255,255,.08);
        border-radius:24px;
        padding:32px;
      ">

        <div style="
          font-size:28px;
          font-weight:700;
          margin-bottom:12px;
        ">
          Dashboard indisponible
        </div>

        <div style="
          color:rgba(255,255,255,.7);
          line-height:1.7;
          margin-bottom:24px;
        ">
          ${message}
        </div>

        <button
          onclick="window.location.reload()"
          style="
            border:none;
            background:#2f5bff;
            color:white;
            padding:14px 18px;
            border-radius:14px;
            font-weight:600;
            cursor:pointer;
          "
        >
          Réessayer
        </button>

      </div>

    </div>
  `;
}

// ─────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────

async function logout() {

  try {

    await api(
      '/auth/logout',
      {
        method: 'POST',
      }
    );

  } catch (err) {

    console.error(err);
  }

  removeToken();

  location.href =
    '/login.html';
}
// ─────────────────────────────────────────────
// TEAM WORKSPACE
// ─────────────────────────────────────────────

function renderTeam(app) {

  app.innerHTML = `
    <div class="fpPage">

      <div class="fpPageHeader">

        <div>

          <div class="fpEyebrow">
            FLOWPOINT TEAM
          </div>

          <h1 class="fpPageTitle">
            Workspace
          </h1>

        </div>

      </div>

      <div class="fpTeamLayout">

        <div class="fpCard fpTeamChat">

          <div class="fpCardTitle">
            Team Chat
          </div>

          <div class="fpChatMessages">

            <div class="fpMessage">
              Bienvenue sur FlowPoint Team.
            </div>

          </div>

          <div class="fpChatInputRow">

            <input
              id="fp-team-input"
              class="fpInput"
              placeholder="Envoyer un message..."
            />

            <button
              class="fpPrimaryBtn"
              onclick="sendTeamMessage()"
            >
              Envoyer
            </button>

          </div>

        </div>

        <div class="fpCard">

          <div class="fpCardTitle">
            Activité
          </div>

          <div id="fp-activity-feed">

            ${renderActivityFeed()}

          </div>

        </div>

      </div>

    </div>
  `;
}

// ─────────────────────────────────────────────
// TEAM MESSAGE
// ─────────────────────────────────────────────

function sendTeamMessage() {

  const input =
    document.getElementById(
      'fp-team-input'
    );

  if (!input) return;

  const text =
    input.value.trim();

  if (!text) return;

  STATE.activity.unshift({
    type: 'message',
    text,
    ts: Date.now(),
  });

  input.value = '';

  render();
}

// ─────────────────────────────────────────────
// ACTIVITY FEED
// ─────────────────────────────────────────────

function renderActivityFeed() {

  if (
    !STATE.activity.length
  ) {

    return `
      <div class="fpEmpty">
        Aucune activité récente
      </div>
    `;
  }

  return STATE.activity
    .slice(0, 10)
    .map(item => {

      return `
        <div class="fpActivityItem">

          <div class="fpActivityDot"></div>

          <div>

            <div class="fpActivityText">
              ${item.text}
            </div>

            <div class="fpActivityTime">
              ${formatTime(item.ts)}
            </div>

          </div>

        </div>
      `;
    })
    .join('');
}

// ─────────────────────────────────────────────
// COMMAND PALETTE
// ─────────────────────────────────────────────

function initCommandPalette() {

  window.addEventListener(
    'keydown',
    event => {

      if (
        (event.metaKey ||
          event.ctrlKey) &&
        event.key === 'k'
      ) {

        event.preventDefault();

        toggleCommandPalette();
      }
    }
  );
}

function toggleCommandPalette() {

  let palette =
    document.getElementById(
      'fp-cmdk'
    );

  if (!palette) {

    palette =
      document.createElement(
        'div'
      );

    palette.id =
      'fp-cmdk';

    palette.innerHTML = `
      <div class="fpCmdOverlay">

        <div class="fpCmdBox">

          <input
            id="fp-cmd-input"
            class="fpCmdInput"
            placeholder="Rechercher une page..."
          />

          <div class="fpCmdResults">

            <button onclick="navigate('overview')">
              Overview
            </button>

            <button onclick="navigate('audits')">
              Audits
            </button>

            <button onclick="navigate('monitors')">
              Monitors
            </button>

            <button onclick="navigate('reports')">
              Reports
            </button>

            <button onclick="navigate('billing')">
              Billing
            </button>

            <button onclick="navigate('settings')">
              Settings
            </button>

          </div>

        </div>

      </div>
    `;

    document.body.appendChild(
      palette
    );
  }

  palette.classList.toggle(
    'show'
  );
}

// ─────────────────────────────────────────────
// REALTIME
// ─────────────────────────────────────────────

let billingEventsSource =
  null;

function subscribeBillingEvents() {

  if (
    billingEventsSource
  ) {
    billingEventsSource.close();
  }

  billingEventsSource =
    new EventSource(
      '/api/billing/events'
    );

  billingEventsSource.onmessage =
    event => {

      try {

        const payload =
          JSON.parse(
            event.data
          );

        console.log(
          '[FP] Billing event:',
          payload
        );

        STATE.activity.unshift({
          type: 'billing',
          text:
            payload.message ||
            'Nouvelle activité billing',
          ts: Date.now(),
        });

      } catch (err) {

        console.error(err);
      }
    };

  billingEventsSource.onerror =
    () => {

      billingEventsSource.close();

      clearTimeout(
        FP.reconnectTimeout
      );

      FP.reconnectTimeout =
        setTimeout(() => {

          subscribeBillingEvents();

        }, 10000);
    };
}

// ─────────────────────────────────────────────
// FORMAT TIME
// ─────────────────────────────────────────────

function formatTime(ts) {

  try {

    return new Date(ts)
      .toLocaleTimeString(
        'fr-FR',
        {
          hour: '2-digit',
          minute: '2-digit',
        }
      );

  } catch {

    return '--:--';
  }
}

// ─────────────────────────────────────────────
// START EXTRA SYSTEMS
// ─────────────────────────────────────────────

setTimeout(() => {

  try {

    initCommandPalette();

    subscribeBillingEvents();

  } catch (err) {

    console.error(err);
  }

}, 1000);
// ─────────────────────────────────────────────
// LOAD DASHBOARD DATA
// ─────────────────────────────────────────────

async function loadDashboardData() {

  try {

    const [
      audits,
      monitors,
      reports,
      missions
    ] = await Promise.all([

      api('/audits'),

      api('/monitors'),

      api('/reports'),

      api('/missions')
    ]);

    STATE.audits =
      audits?.audits || [];

    STATE.monitors =
      monitors?.monitors || [];

    STATE.reports =
      reports?.reports || [];

    STATE.missions =
      missions?.missions || [];

    console.log(
      '📊 Dashboard data loaded'
    );

  } catch (err) {

    console.error(
      '[FP] Dashboard load error:',
      err
    );
  }
}

// ─────────────────────────────────────────────
// ENHANCED OVERVIEW
// ─────────────────────────────────────────────

function renderOverview(app) {

  const user =
    STATE.me || {};

  const totalAudits =
    STATE.audits.length;

  const totalMonitors =
    STATE.monitors.length;

  const totalReports =
    STATE.reports.length;

  const totalMissions =
    STATE.missions.length;

  const onlineMonitors =
    STATE.monitors.filter(
      monitor =>
        monitor.status === 'up'
    ).length;

  app.innerHTML = `
    <div class="fpPage">

      <!-- HERO -->

      <section class="fpHeroCard">

        <div class="fpHeroContent">

          <div class="fpEyebrow">
            FLOWPOINT CONTROL CENTER
          </div>

          <h1 class="fpHeroTitle">
            Bonjour ${
              user.firstName ||
              'User'
            }
          </h1>

          <p class="fpHeroText">
            Votre infrastructure digitale est surveillée et analysée en temps réel.
          </p>

          <div class="fpHeroActions">

            <button
              class="fpPrimaryBtn"
              onclick="navigate('audits')"
            >
              Voir les audits
            </button>

            <button
              class="fpSecondaryBtn"
              onclick="navigate('billing')"
            >
              Billing
            </button>

          </div>

        </div>

      </section>

      <!-- STATS -->

      <section class="fpStatsGrid">

        <div class="fpStatCard">

          <div class="fpStatLabel">
            Audits
          </div>

          <div class="fpStatValue">
            ${totalAudits}
          </div>

        </div>

        <div class="fpStatCard">

          <div class="fpStatLabel">
            Monitors actifs
          </div>

          <div class="fpStatValue">
            ${onlineMonitors}
          </div>

        </div>

        <div class="fpStatCard">

          <div class="fpStatLabel">
            Reports
          </div>

          <div class="fpStatValue">
            ${totalReports}
          </div>

        </div>

        <div class="fpStatCard">

          <div class="fpStatLabel">
            Missions
          </div>

          <div class="fpStatValue">
            ${totalMissions}
          </div>

        </div>

      </section>

      <!-- QUICK GRID -->

      <section class="fpQuickGrid">

        <div class="fpCard">

          <div class="fpCardTitle">
            Infrastructure
          </div>

          <div class="fpInfrastructureList">

            ${STATE.monitors
              .slice(0, 5)
              .map(monitor => `
                <div class="fpInfraItem">

                  <div class="fpInfraLeft">

                    <div class="fpInfraDot ${
                      monitor.status === 'up'
                        ? 'up'
                        : 'down'
                    }"></div>

                    <div>
                      ${monitor.name || monitor.url}
                    </div>

                  </div>

                  <div class="fpInfraLatency">
                    ${monitor.latency || 0}ms
                  </div>

                </div>
              `)
              .join('')}

          </div>

        </div>

        <div class="fpCard">

          <div class="fpCardTitle">
            Activité récente
          </div>

          <div>

            ${renderActivityFeed()}

          </div>

        </div>

      </section>

      <!-- MISSIONS -->

      <section class="fpCard">

        <div class="fpSectionTop">

          <div class="fpCardTitle">
            Missions prioritaires
          </div>

          <button
            class="fpSecondaryBtn"
            onclick="navigate('missions')"
          >
            Voir tout
          </button>

        </div>

        <div class="fpMissionGrid">

          ${STATE.missions
            .slice(0, 6)
            .map(mission => `

              <div class="fpMissionCard">

                <div class="fpMissionTop">

                  <div class="fpMissionCategory">
                    ${
                      mission.category ||
                      'Mission'
                    }
                  </div>

                  <div class="fpMissionStatus ${
                    mission.status || 'todo'
                  }">
                    ${
                      mission.status || 'todo'
                    }
                  </div>

                </div>

                <div class="fpMissionTitle">
                  ${mission.title}
                </div>

              </div>

            `)
            .join('')}

        </div>

      </section>

    </div>
  `;
}

// ─────────────────────────────────────────────
// LOAD DATA AFTER SESSION
// ─────────────────────────────────────────────

const originalRender =
  render;

render = async function () {

  if (!STATE.__loaded__) {

    STATE.__loaded__ = true;

    await loadDashboardData();
  }

  originalRender();
};
// ─────────────────────────────────────────────
// MISSIONS
// ─────────────────────────────────────────────

function renderMissions(app) {

  app.innerHTML = `
    <div class="fpPage">

      <div class="fpPageHeader">

        <div>

          <div class="fpEyebrow">
            FLOWPOINT MISSIONS
          </div>

          <h1 class="fpPageTitle">
            Missions
          </h1>

        </div>

        <button
          class="fpPrimaryBtn"
          onclick="createMission()"
        >
          Nouvelle mission
        </button>

      </div>

      <div class="fpMissionGrid">

        ${STATE.missions
          .map(mission => `

            <div class="fpMissionCard">

              <div class="fpMissionTop">

                <div class="fpMissionCategory">
                  ${
                    mission.category ||
                    'Mission'
                  }
                </div>

                <div class="fpMissionStatus ${
                  mission.status || 'todo'
                }">
                  ${
                    mission.status || 'todo'
                  }
                </div>

              </div>

              <div class="fpMissionTitle">
                ${mission.title}
              </div>

            </div>

          `)
          .join('')}

      </div>

    </div>
  `;
}

// ─────────────────────────────────────────────
// CREATE MISSION
// ─────────────────────────────────────────────

async function createMission() {

  const title =
    prompt(
      'Titre de la mission'
    );

  if (!title) return;

  try {

    const data =
      await api(
        '/missions',
        {
          method: 'POST',

          body: JSON.stringify({
            title,
            status: 'todo',
            category: 'Custom',
          }),
        }
      );

    STATE.missions.unshift(
      data.mission
    );

    showToast(
      'Mission créée',
      'success'
    );

    render();

  } catch (err) {

    console.error(err);

    showToast(
      err.message,
      'error'
    );
  }
}

// ─────────────────────────────────────────────
// LOCAL SEO
// ─────────────────────────────────────────────

function renderLocalSeo(app) {

  app.innerHTML = `
    <div class="fpPage">

      <div class="fpPageHeader">

        <div>

          <div class="fpEyebrow">
            FLOWPOINT LOCAL SEO
          </div>

          <h1 class="fpPageTitle">
            Local SEO
          </h1>

        </div>

      </div>

      <div class="fpQuickGrid">

        <div class="fpCard">

          <div class="fpCardTitle">
            Google Business Profile
          </div>

          <div class="fpLocalSeoValue">
            Optimisé
          </div>

        </div>

        <div class="fpCard">

          <div class="fpCardTitle">
            Visibilité locale
          </div>

          <div class="fpLocalSeoValue">
            +28%
          </div>

        </div>

      </div>

    </div>
  `;
}

// ─────────────────────────────────────────────
// COMPETITORS
// ─────────────────────────────────────────────

function renderCompetitors(app) {

  app.innerHTML = `
    <div class="fpPage">

      <div class="fpPageHeader">

        <div>

          <div class="fpEyebrow">
            FLOWPOINT COMPETITORS
          </div>

          <h1 class="fpPageTitle">
            Competitors
          </h1>

        </div>

      </div>

      <div class="fpCompetitorGrid">

        <div class="fpCard">

          <div class="fpCardTitle">
            SEO Ranking
          </div>

          <div class="fpCompetitorValue">
            #3
          </div>

        </div>

        <div class="fpCard">

          <div class="fpCardTitle">
            Visibility
          </div>

          <div class="fpCompetitorValue">
            82%
          </div>

        </div>

      </div>

    </div>
  `;
}

// ─────────────────────────────────────────────
// UPDATE ROUTER
// ─────────────────────────────────────────────

const originalHandleRoute =
  handleRoute;

handleRoute = function () {

  const route =
    location.hash.replace(
      '#',
      ''
    ) || 'overview';

  STATE.route = route;

  FP.currentRoute = route;

  setActiveNav(route);

  render();
};

// ─────────────────────────────────────────────
// UPDATE RENDER
// ─────────────────────────────────────────────

const previousRender =
  render;

render = async function () {

  if (!STATE.__loaded__) {

    STATE.__loaded__ = true;

    await loadDashboardData();
  }

  const app =
    document.getElementById(
      'app'
    );

  if (!app) return;

  switch (STATE.route) {

    case 'overview':
      renderOverview(app);
      break;

    case 'audits':
      renderAudits(app);
      break;

    case 'monitors':
      renderMonitors(app);
      break;

    case 'reports':
      renderReports(app);
      break;

    case 'billing':
      renderBilling(app);
      break;

    case 'settings':
      renderSettings(app);
      break;

    case 'team':
      renderTeam(app);
      break;

    case 'missions':
      renderMissions(app);
      break;

    case 'local-seo':
      renderLocalSeo(app);
      break;

    case 'competitors':
      renderCompetitors(app);
      break;

    default:
      renderOverview(app);
  }
};

// ─────────────────────────────────────────────
// GLOBAL EXPORTS
// ─────────────────────────────────────────────

window.navigate =
  navigate;

window.logout =
  logout;

window.render =
  render;

window.showToast =
  showToast;

window.createMission =
  createMission;

// ─────────────────────────────────────────────
// FINAL START
// ─────────────────────────────────────────────

console.log(
  '🚀 FlowPoint Enterprise Loaded'
);
