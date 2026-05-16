'use strict';

/* =========================================================
   FLOWPOINT ENTERPRISE DASHBOARD V2
========================================================= */

/* =========================================================
   STATE
========================================================= */

const STATE = {

  user: null,

  billing: null,

  overview: null,

  audits: [],

  monitors: [],

  missions: [],

  reports: [],

  activities: [],

  teamThreads: [],

  currentThread: null,

  currentPage: 'overview',

  loading: false,

  sse: null,

  sidebarOpen: false,

  notifications: [],

  aiMessages: [],

  theme:
    localStorage.getItem(
      'fp_theme'
    ) || 'dark',

};

/* =========================================================
   CONFIG
========================================================= */

const API_BASE = '';

/* =========================================================
   HELPERS
========================================================= */

function qs(selector) {

  return document.querySelector(
    selector
  );
}

function qsa(selector) {

  return [
    ...document.querySelectorAll(
      selector
    ),
  ];
}

function formatDate(date) {

  if (!date) {
    return '-';
  }

  return new Date(date)
    .toLocaleString();
}

function clamp(
  value,
  min,
  max
) {

  return Math.max(
    min,
    Math.min(max, value)
  );
}

function escapeHtml(str='') {

  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* =========================================================
   TOASTS
========================================================= */

function showToast(
  text='',
  type='info'
) {

  const wrap =
    qs('#fpToastWrap');

  if (!wrap) {
    return;
  }

  const el =
    document.createElement('div');

  el.className =
    `fp-toast fp-toast-${type}`;

  el.innerHTML =
    `
    <div class="fp-toast-text">
      ${escapeHtml(text)}
    </div>
    `;

  wrap.appendChild(el);

  requestAnimationFrame(() => {
    el.classList.add('show');
  });

  setTimeout(() => {

    el.classList.remove('show');

    setTimeout(() => {
      el.remove();
    }, 300);

  }, 3500);
}

/* =========================================================
   LOADING
========================================================= */

function setLoading(
  value
) {

  STATE.loading =
    !!value;

  const loading =
    qs('#fpLoadingScreen');

  if (!loading) {
    return;
  }

  loading.classList.toggle(
    'active',
    STATE.loading
  );
}

/* =========================================================
   API
========================================================= */

async function api(

  url,

  options={}

) {

  try {

    const response =
      await fetch(

        API_BASE + url,

        {

          credentials:
            'include',

          headers: {

            'Content-Type':
              'application/json',

            ...(options.headers || {}),

          },

          ...options,

        }
      );

    const json =
      await response.json();

    if (!response.ok) {

      throw new Error(
        json.error ||
        'Request failed'
      );
    }

    return json;

  } catch (err) {

    console.error(
      '[FP API]',
      err
    );

    showToast(
      err.message,
      'error'
    );

    throw err;
  }
}

/* =========================================================
   AUTH
========================================================= */

async function loadSession() {

  try {

    const data =
      await api(
        '/api/auth/me'
      );

    STATE.user =
      data.user;

    STATE.billing = {

      limits:
        data.limits,

    };

    return true;

  } catch {

    window.location.href =
      '/login.html';

    return false;
  }
}

/* =========================================================
   THEME
========================================================= */

function applyTheme() {

  document.documentElement
    .setAttribute(

      'data-theme',

      STATE.theme
    );
}

function toggleTheme() {

  STATE.theme =
    STATE.theme === 'dark'
      ? 'light'
      : 'dark';

  localStorage.setItem(
    'fp_theme',
    STATE.theme
  );

  applyTheme();
}

/* =========================================================
   SIDEBAR
========================================================= */

function toggleSidebar() {

  STATE.sidebarOpen =
    !STATE.sidebarOpen;

  document.body
    .classList.toggle(

      'fp-sidebar-open',

      STATE.sidebarOpen
    );
}

/* =========================================================
   ROUTER
========================================================= */

function getRoute() {

  return (
    window.location.hash
      .replace('#', '') ||
    'overview'
  );
}

function navigate(
  page
) {

  window.location.hash =
    page;
}

window.addEventListener(

  'hashchange',

  () => {

    STATE.currentPage =
      getRoute();

    renderCurrentPage();
  }
);

/* =========================================================
   PAGE WRAPPER
========================================================= */

function setPage(
  html=''
) {

  const root =
    qs('#fpPage');

  if (!root) {
    return;
  }

  root.innerHTML =
    html;
}

/* =========================================================
   CARDS
========================================================= */

function statCard({

  label='',
  value='',
  sub='',
  color='blue',

}) {

  return `
  <div class="fp-stat-card">

    <div class="fp-stat-top">

      <div class="fp-stat-label">
        ${escapeHtml(label)}
      </div>

      <div class="fp-stat-dot ${color}">
      </div>

    </div>

    <div class="fp-stat-value">
      ${escapeHtml(value)}
    </div>

    <div class="fp-stat-sub">
      ${escapeHtml(sub)}
    </div>

  </div>
  `;
}

function sectionCard({

  title='',
  content='',

}) {

  return `
  <section class="fp-card">

    <div class="fp-card-head">

      <h3>
        ${escapeHtml(title)}
      </h3>

    </div>

    <div class="fp-card-body">
      ${content}
    </div>

  </section>
  `;
}
/* =========================================================
   DATA LOADERS
========================================================= */

async function loadOverview() {

  const data =
    await api(
      '/api/overview'
    );

  STATE.overview =
    data.overview;

  STATE.audits =
    data.audits || [];

  STATE.monitors =
    data.monitors || [];

  STATE.missions =
    data.missions || [];

  STATE.reports =
    data.reports || [];

  STATE.activities =
    data.activities || [];
}

async function loadBilling() {

  const data =
    await api(
      '/api/billing'
    );

  STATE.billing =
    data.billing;
}

async function loadThreads() {

  const data =
    await api(
      '/api/team/threads'
    );

  STATE.teamThreads =
    data.threads || [];
}

async function loadMessages(
  threadId
) {

  const data =
    await api(
      `/api/team/messages/${threadId}`
    );

  return (
    data.messages || []
  );
}

/* =========================================================
   REALTIME SSE
========================================================= */

function connectRealtime() {

  try {

    if (STATE.sse) {

      STATE.sse.close();
    }

    const sse =
      new EventSource(
        '/api/events',
        {
          withCredentials:
            true,
        }
      );

    STATE.sse =
      sse;

    sse.onmessage =
      async (event) => {

        try {

          const payload =
            JSON.parse(
              event.data
            );

          handleRealtimeEvent(
            payload
          );

        } catch (err) {

          console.error(err);
        }
      };

    sse.onerror =
      () => {

        console.warn(
          '[FP] SSE reconnect'
        );

        setTimeout(
          connectRealtime,
          4000
        );
      };

  } catch (err) {

    console.error(err);
  }
}

function handleRealtimeEvent(
  payload
) {

  if (!payload?.type) {
    return;
  }

  switch (
    payload.type
  ) {

    case 'activity': {

      if (
        payload.activity
      ) {

        STATE.activities.unshift(
          payload.activity
        );

        STATE.activities =
          STATE.activities.slice(
            0,
            100
          );

        if (
          STATE.currentPage ===
          'overview'
        ) {

          renderOverviewPage();
        }
      }

      break;
    }

    case 'billing_issue': {

      showToast(
        'Problème de paiement détecté',
        'error'
      );

      break;
    }

    case 'team_message': {

      showToast(
        'Nouveau message équipe',
        'info'
      );

      break;
    }

    case 'connected': {

      console.log(
        '[FP] realtime connected'
      );

      break;
    }
  }
}

/* =========================================================
   TOPBAR
========================================================= */

function renderTopbar() {

  const user =
    STATE.user;

  return `
  <header class="fp-topbar">

    <div class="fp-topbar-left">

      <button
        class="fp-icon-btn"
        onclick="toggleSidebar()"
      >
        ☰
      </button>

      <div class="fp-topbar-title">
        FlowPoint
      </div>

    </div>

    <div class="fp-topbar-right">

      <button
        class="fp-topbar-btn"
        onclick="toggleTheme()"
      >
        ${STATE.theme === 'dark'
          ? '☀️'
          : '🌙'}
      </button>

      <div class="fp-user-chip">

        <div class="fp-user-avatar">
          ${escapeHtml(
            user?.firstName?.[0] || 'U'
          )}
        </div>

        <div class="fp-user-meta">

          <div class="fp-user-name">
            ${escapeHtml(
              user?.firstName || ''
            )}
          </div>

          <div class="fp-user-plan">
            ${escapeHtml(
              user?.plan || ''
            )}
          </div>

        </div>

      </div>

    </div>

  </header>
  `;
}

/* =========================================================
   SIDEBAR
========================================================= */

function sidebarItem({

  key='',
  label='',
  icon='',

}) {

  const active =
    STATE.currentPage === key;

  return `
  <button
    class="fp-sidebar-item ${active ? 'active' : ''}"
    onclick="navigate('${key}')"
  >

    <span class="fp-sidebar-icon">
      ${icon}
    </span>

    <span class="fp-sidebar-label">
      ${escapeHtml(label)}
    </span>

  </button>
  `;
}

function renderSidebar() {

  return `
  <aside class="fp-sidebar">

    <div class="fp-sidebar-brand">

      <div class="fp-logo">
        ⚡
      </div>

      <div class="fp-brand-text">

        <div class="fp-brand-name">
          FlowPoint
        </div>

        <div class="fp-brand-sub">
          Enterprise
        </div>

      </div>

    </div>

    <div class="fp-sidebar-group">

      ${sidebarItem({
        key: 'overview',
        label: 'Overview',
        icon: '📊',
      })}

      ${sidebarItem({
        key: 'audits',
        label: 'Audits',
        icon: '🧠',
      })}

      ${sidebarItem({
        key: 'monitors',
        label: 'Monitoring',
        icon: '🛰️',
      })}

      ${sidebarItem({
        key: 'missions',
        label: 'Missions',
        icon: '🎯',
      })}

      ${sidebarItem({
        key: 'reports',
        label: 'Reports',
        icon: '📄',
      })}

      ${sidebarItem({
        key: 'team',
        label: 'Team',
        icon: '👥',
      })}

      ${sidebarItem({
        key: 'billing',
        label: 'Billing',
        icon: '💳',
      })}

      ${sidebarItem({
        key: 'ai',
        label: 'FlowPoint AI',
        icon: '✨',
      })}

    </div>

    <div class="fp-sidebar-bottom">

      <button
        class="fp-sidebar-logout"
        onclick="logout()"
      >
        Déconnexion
      </button>

    </div>

  </aside>
  `;
}

/* =========================================================
   APP LAYOUT
========================================================= */

function renderLayout() {

  const app =
    qs('#app');

  if (!app) {
    return;
  }

  app.innerHTML =
    `
    <div class="fp-layout">

      ${renderSidebar()}

      <main class="fp-main">

        ${renderTopbar()}

        <div
          id="fpPage"
          class="fp-page-wrap"
        ></div>

      </main>

    </div>
    `;
}

/* =========================================================
   LOGOUT
========================================================= */

async function logout() {

  try {

    await api(

      '/api/auth/logout',

      {
        method: 'POST',
      }
    );

  } catch {}

  window.location.href =
    '/login.html';
}
/* =========================================================
   OVERVIEW PAGE
========================================================= */

function monitorStatusBadge(
  status='unknown'
) {

  return `
  <div class="fp-monitor-status ${status}">
    ${escapeHtml(status)}
  </div>
  `;
}

function renderOverviewPage() {

  const o =
    STATE.overview || {};

  const audits =
    STATE.audits || [];

  const monitors =
    STATE.monitors || [];

  const reports =
    STATE.reports || [];

  const activities =
    STATE.activities || [];

  const missions =
    STATE.missions || [];

  setPage(

    `
    <div class="fp-overview">

      <section class="fp-hero">

        <div class="fp-hero-content">

          <div class="fp-hero-label">
            WAR ROOM
          </div>

          <h1 class="fp-hero-title">
            FlowPoint Executive Center
          </h1>

          <p class="fp-hero-text">
            ${escapeHtml(
              o.executiveSummary ||
              'Analyse indisponible.'
            )}
          </p>

        </div>

        <div class="fp-hero-score">

          <div class="fp-hero-score-label">
            HEALTH SCORE
          </div>

          <div class="fp-hero-score-value">
            ${o.healthScore || 0}
          </div>

        </div>

      </section>

      <div class="fp-stats-grid">

        ${statCard({

          label:
            'SEO SCORE',

          value:
            String(
              o.seoScore || 0
            ),

          sub:
            'Optimisation globale',

          color:
            'blue',

        })}

        ${statCard({

          label:
            'PERFORMANCE',

          value:
            String(
              o.performanceScore || 0
            ),

          sub:
            'Temps de chargement',

          color:
            'green',

        })}

        ${statCard({

          label:
            'MONITORS ONLINE',

          value:
            `${o.monitorsOnline || 0}/${o.monitorsTotal || 0}`,

          sub:
            'Infrastructure',

          color:
            'purple',

        })}

        ${statCard({

          label:
            'MISSIONS',

          value:
            `${o.missionProgress || 0}%`,

          sub:
            'Progression globale',

          color:
            'orange',

        })}

      </div>

      <div class="fp-grid-2">

        ${sectionCard({

          title:
            'Quick Wins',

          content:
            `
            <div class="fp-quickwins">

              ${
                (o.quickWins || [])
                  .map(

                    item =>

                    `
                    <div class="fp-quickwin-item">

                      <div class="fp-quickwin-title">
                        ${escapeHtml(item.title)}
                      </div>

                      <div class="fp-quickwin-impact">
                        ${escapeHtml(item.impact)}
                      </div>

                    </div>
                    `
                  )
                  .join('')
              }

            </div>
            `,

        })}

        ${sectionCard({

          title:
            'Infrastructure',

          content:
            `
            <div class="fp-monitor-list">

              ${
                monitors
                  .slice(0, 6)
                  .map(

                    monitor =>

                    `
                    <div class="fp-monitor-item">

                      <div class="fp-monitor-left">

                        <div class="fp-monitor-label">
                          ${escapeHtml(
                            monitor.label ||
                            monitor.url
                          )}
                        </div>

                        <div class="fp-monitor-url">
                          ${escapeHtml(
                            monitor.url
                          )}
                        </div>

                      </div>

                      <div class="fp-monitor-right">

                        <div class="fp-monitor-latency">
                          ${
                            monitor.lastResponseTime || 0
                          } ms
                        </div>

                        ${monitorStatusBadge(
                          monitor.lastStatus
                        )}

                      </div>

                    </div>
                    `
                  )
                  .join('')
              }

            </div>
            `,

        })}

      </div>

      <div class="fp-grid-2">

        ${sectionCard({

          title:
            'Latest Audits',

          content:
            `
            <div class="fp-audit-list">

              ${
                audits
                  .slice(0, 5)
                  .map(

                    audit =>

                    `
                    <div class="fp-audit-item">

                      <div class="fp-audit-main">

                        <div class="fp-audit-url">
                          ${escapeHtml(
                            audit.url
                          )}
                        </div>

                        <div class="fp-audit-date">
                          ${formatDate(
                            audit.createdAt
                          )}
                        </div>

                      </div>

                      <div class="fp-audit-score">
                        ${audit.score || 0}
                      </div>

                    </div>
                    `
                  )
                  .join('')
              }

            </div>
            `,

        })}

        ${sectionCard({

          title:
            'Activity Feed',

          content:
            `
            <div class="fp-activity-list">

              ${
                activities
                  .slice(0, 10)
                  .map(

                    activity =>

                    `
                    <div class="fp-activity-item">

                      <div class="fp-activity-top">

                        <div class="fp-activity-title">
                          ${escapeHtml(
                            activity.title
                          )}
                        </div>

                        <div class="fp-activity-date">
                          ${formatDate(
                            activity.createdAt
                          )}
                        </div>

                      </div>

                      <div class="fp-activity-description">
                        ${escapeHtml(
                          activity.description || ''
                        )}
                      </div>

                    </div>
                    `
                  )
                  .join('')
              }

            </div>
            `,

        })}

      </div>

      ${sectionCard({

        title:
          'Critical Missions',

        content:
          `
          <div class="fp-mission-grid">

            ${
              missions
                .filter(

                  x =>
                    x.priority ===
                    'critical'
                )

                .slice(0, 8)

                .map(

                  mission =>

                  `
                  <div class="fp-mission-card">

                    <div class="fp-mission-priority critical">
                      CRITICAL
                    </div>

                    <div class="fp-mission-title">
                      ${escapeHtml(
                        mission.title
                      )}
                    </div>

                    <div class="fp-mission-description">
                      ${escapeHtml(
                        mission.description || ''
                      )}
                    </div>

                  </div>
                  `
                )
                .join('')
            }

          </div>
          `,

      })}

    </div>
    `
  );
}
/* =========================================================
   AUDITS PAGE
========================================================= */

function auditIssueBadge(
  type=''
) {

  return `
  <div class="fp-issue-badge ${type}">
    ${escapeHtml(type)}
  </div>
  `;
}

function renderAuditsPage() {

  const audits =
    STATE.audits || [];

  setPage(

    `
    <div class="fp-page">

      <div class="fp-page-header">

        <div>

          <div class="fp-page-label">
            SEO / PERFORMANCE
          </div>

          <h1 class="fp-page-title">
            Audits Engine
          </h1>

        </div>

        <button
          class="fp-primary-btn"
          onclick="openAuditModal()"
        >
          Nouveau Audit
        </button>

      </div>

      <div class="fp-audit-grid">

        ${
          audits.map(

            audit =>

            `
            <div class="fp-audit-card">

              <div class="fp-audit-card-top">

                <div>

                  <div class="fp-audit-card-url">
                    ${escapeHtml(
                      audit.url
                    )}
                  </div>

                  <div class="fp-audit-card-date">
                    ${formatDate(
                      audit.createdAt
                    )}
                  </div>

                </div>

                <div class="fp-audit-big-score">
                  ${audit.score || 0}
                </div>

              </div>

              <div class="fp-audit-scores">

                <div class="fp-inline-stat">
                  SEO:
                  <strong>
                    ${audit.seoScore || 0}
                  </strong>
                </div>

                <div class="fp-inline-stat">
                  PERF:
                  <strong>
                    ${audit.performanceScore || 0}
                  </strong>
                </div>

                <div class="fp-inline-stat">
                  ACCESS:
                  <strong>
                    ${audit.accessibilityScore || 0}
                  </strong>
                </div>

              </div>

              <div class="fp-audit-issues">

                ${
                  (audit.issues || [])
                    .slice(0, 5)
                    .map(

                      issue =>

                      `
                      <div class="fp-audit-issue">

                        ${auditIssueBadge(
                          issue.type
                        )}

                        <div class="fp-audit-issue-title">
                          ${escapeHtml(
                            issue.title
                          )}
                        </div>

                      </div>
                      `
                    )
                    .join('')
                }

              </div>

              <div class="fp-audit-actions">

                <button
                  class="fp-secondary-btn"
                  onclick="viewAudit('${audit._id}')"
                >
                  Voir
                </button>

              </div>

            </div>
            `
          ).join('')
        }

      </div>

    </div>
    `
  );
}

function openAuditModal() {

  const url =
    prompt(
      'URL à analyser'
    );

  if (!url) {
    return;
  }

  createAudit(
    url
  );
}

async function createAudit(
  url
) {

  try {

    setLoading(true);

    const data =
      await api(

        '/api/audits',

        {

          method: 'POST',

          body:
            JSON.stringify({
              url,
            }),
        }
      );

    STATE.audits.unshift(
      data.audit
    );

    renderAuditsPage();

    showToast(
      'Audit terminé',
      'success'
    );

  } catch (err) {

    console.error(err);

  } finally {

    setLoading(false);
  }
}

function viewAudit(
  id
) {

  const audit =
    STATE.audits.find(
      x => x._id === id
    );

  if (!audit) {
    return;
  }

  const modal =
    document.createElement(
      'div'
    );

  modal.className =
    'fp-modal-overlay';

  modal.innerHTML =
    `
    <div class="fp-modal">

      <div class="fp-modal-head">

        <h2>
          Audit Details
        </h2>

        <button
          class="fp-icon-btn"
          onclick="this.closest('.fp-modal-overlay').remove()"
        >
          ✕
        </button>

      </div>

      <div class="fp-modal-body">

        <div class="fp-modal-section">

          <div class="fp-modal-label">
            URL
          </div>

          <div class="fp-modal-value">
            ${escapeHtml(
              audit.url
            )}
          </div>

        </div>

        <div class="fp-modal-grid">

          <div class="fp-score-box">
            SEO
            <strong>
              ${audit.seoScore || 0}
            </strong>
          </div>

          <div class="fp-score-box">
            PERF
            <strong>
              ${audit.performanceScore || 0}
            </strong>
          </div>

          <div class="fp-score-box">
            ACCESS
            <strong>
              ${audit.accessibilityScore || 0}
            </strong>
          </div>

        </div>

        <div class="fp-modal-section">

          <div class="fp-modal-label">
            Issues
          </div>

          <div class="fp-issues-list">

            ${
              (audit.issues || [])
                .map(

                  issue =>

                  `
                  <div class="fp-issue-line">

                    ${auditIssueBadge(
                      issue.type
                    )}

                    <div>
                      ${escapeHtml(
                        issue.title
                      )}
                    </div>

                  </div>
                  `
                )
                .join('')
            }

          </div>

        </div>

      </div>

    </div>
    `;

  document.body.appendChild(
    modal
  );
}

/* =========================================================
   MONITORS PAGE
========================================================= */

function renderMonitorsPage() {

  const monitors =
    STATE.monitors || [];

  setPage(

    `
    <div class="fp-page">

      <div class="fp-page-header">

        <div>

          <div class="fp-page-label">
            UPTIME / LATENCY
          </div>

          <h1 class="fp-page-title">
            Monitoring Center
          </h1>

        </div>

        <button
          class="fp-primary-btn"
          onclick="openMonitorModal()"
        >
          Nouveau Monitor
        </button>

      </div>

      <div class="fp-monitor-grid">

        ${
          monitors.map(

            monitor =>

            `
            <div class="fp-monitor-card">

              <div class="fp-monitor-card-top">

                <div>

                  <div class="fp-monitor-card-title">
                    ${escapeHtml(
                      monitor.label ||
                      monitor.url
                    )}
                  </div>

                  <div class="fp-monitor-card-url">
                    ${escapeHtml(
                      monitor.url
                    )}
                  </div>

                </div>

                ${monitorStatusBadge(
                  monitor.lastStatus
                )}

              </div>

              <div class="fp-monitor-metrics">

                <div class="fp-monitor-metric">

                  <span>
                    Status Code
                  </span>

                  <strong>
                    ${
                      monitor.lastStatusCode || '-'
                    }
                  </strong>

                </div>

                <div class="fp-monitor-metric">

                  <span>
                    Latency
                  </span>

                  <strong>
                    ${
                      monitor.lastResponseTime || 0
                    } ms
                  </strong>

                </div>

                <div class="fp-monitor-metric">

                  <span>
                    Last Check
                  </span>

                  <strong>
                    ${formatDate(
                      monitor.lastCheckedAt
                    )}
                  </strong>

                </div>

              </div>

            </div>
            `
          ).join('')
        }

      </div>

    </div>
    `
  );
}
function openMonitorModal() {

  const url =
    prompt(
      'URL à monitorer'
    );

  if (!url) {
    return;
  }

  const label =
    prompt(
      'Nom du monitor'
    ) || '';

  createMonitor({
    url,
    label,
  });
}

async function createMonitor({

  url,
  label='',

}) {

  try {

    setLoading(true);

    const data =
      await api(

        '/api/monitors',

        {

          method: 'POST',

          body:
            JSON.stringify({

              url,
              label,

            }),
        }
      );

    STATE.monitors.unshift(
      data.monitor
    );

    renderMonitorsPage();

    showToast(
      'Monitor créé',
      'success'
    );

  } catch (err) {

    console.error(err);

  } finally {

    setLoading(false);
  }
}

/* =========================================================
   MISSIONS PAGE
========================================================= */

function missionPriorityBadge(
  priority='medium'
) {

  return `
  <div class="fp-priority-badge ${priority}">
    ${escapeHtml(priority)}
  </div>
  `;
}

function renderMissionsPage() {

  const missions =
    STATE.missions || [];

  setPage(

    `
    <div class="fp-page">

      <div class="fp-page-header">

        <div>

          <div class="fp-page-label">
            EXECUTION ENGINE
          </div>

          <h1 class="fp-page-title">
            Missions Center
          </h1>

        </div>

        <button
          class="fp-primary-btn"
          onclick="openMissionModal()"
        >
          Nouvelle Mission
        </button>

      </div>

      <div class="fp-mission-grid">

        ${
          missions.map(

            mission =>

            `
            <div class="fp-mission-card">

              <div class="fp-mission-card-top">

                ${missionPriorityBadge(
                  mission.priority
                )}

                <div class="fp-mission-status ${mission.status}">
                  ${escapeHtml(
                    mission.status
                  )}
                </div>

              </div>

              <div class="fp-mission-title">
                ${escapeHtml(
                  mission.title
                )}
              </div>

              <div class="fp-mission-description">
                ${escapeHtml(
                  mission.description || ''
                )}
              </div>

              <div class="fp-mission-footer">

                <div class="fp-mission-category">
                  ${escapeHtml(
                    mission.category || ''
                  )}
                </div>

                <button
                  class="fp-secondary-btn"
                  onclick="toggleMissionStatus('${mission._id}')"
                >
                  ${
                    mission.status === 'done'
                      ? 'Réouvrir'
                      : 'Terminer'
                  }
                </button>

              </div>

            </div>
            `
          ).join('')
        }

      </div>

    </div>
    `
  );
}

function openMissionModal() {

  const title =
    prompt(
      'Titre mission'
    );

  if (!title) {
    return;
  }

  const description =
    prompt(
      'Description'
    ) || '';

  createMission({

    title,
    description,

  });
}

async function createMission({

  title,
  description='',

}) {

  try {

    setLoading(true);

    const data =
      await api(

        '/api/missions',

        {

          method: 'POST',

          body:
            JSON.stringify({

              title,
              description,

            }),
        }
      );

    STATE.missions.unshift(
      data.mission
    );

    renderMissionsPage();

    showToast(
      'Mission créée',
      'success'
    );

  } catch (err) {

    console.error(err);

  } finally {

    setLoading(false);
  }
}

async function toggleMissionStatus(
  id
) {

  try {

    const mission =
      STATE.missions.find(
        x => x._id === id
      );

    if (!mission) {
      return;
    }

    const nextStatus =
      mission.status === 'done'
        ? 'todo'
        : 'done';

    const data =
      await api(

        `/api/missions/${id}`,

        {

          method: 'PATCH',

          body:
            JSON.stringify({

              status:
                nextStatus,

            }),
        }
      );

    Object.assign(
      mission,
      data.mission
    );

    renderMissionsPage();

    showToast(
      'Mission mise à jour',
      'success'
    );

  } catch (err) {

    console.error(err);
  }
}

/* =========================================================
   ACTIVITY PAGE
========================================================= */

function renderActivityPage() {

  const activities =
    STATE.activities || [];

  setPage(

    `
    <div class="fp-page">

      <div class="fp-page-header">

        <div>

          <div class="fp-page-label">
            REALTIME FEED
          </div>

          <h1 class="fp-page-title">
            Activity Center
          </h1>

        </div>

      </div>

      <div class="fp-activity-feed">

        ${
          activities.map(

            activity =>

            `
            <div class="fp-activity-card">

              <div class="fp-activity-card-top">

                <div class="fp-activity-card-title">
                  ${escapeHtml(
                    activity.title
                  )}
                </div>

                <div class="fp-activity-card-date">
                  ${formatDate(
                    activity.createdAt
                  )}
                </div>

              </div>

              <div class="fp-activity-card-description">
                ${escapeHtml(
                  activity.description || ''
                )}
              </div>

              <div class="fp-activity-card-type">
                ${escapeHtml(
                  activity.type || ''
                )}
              </div>

            </div>
            `
          ).join('')
        }

      </div>

    </div>
    `
  );
}
/* =========================================================
   REPORTS PAGE
========================================================= */

function renderReportsPage() {

  const reports =
    STATE.reports || [];

  setPage(

    `
    <div class="fp-page">

      <div class="fp-page-header">

        <div>

          <div class="fp-page-label">
            EXPORT / PDF
          </div>

          <h1 class="fp-page-title">
            Reports Center
          </h1>

        </div>

        <button
          class="fp-primary-btn"
          onclick="createReport()"
        >
          Générer Report
        </button>

      </div>

      <div class="fp-report-grid">

        ${
          reports.map(

            report =>

            `
            <div class="fp-report-card">

              <div class="fp-report-card-top">

                <div>

                  <div class="fp-report-title">
                    ${escapeHtml(
                      report.title
                    )}
                  </div>

                  <div class="fp-report-date">
                    ${formatDate(
                      report.createdAt
                    )}
                  </div>

                </div>

                <div class="fp-report-type">
                  ${escapeHtml(
                    report.type || ''
                  )}
                </div>

              </div>

              <div class="fp-report-status ${report.status}">
                ${escapeHtml(
                  report.status || ''
                )}
              </div>

              <div class="fp-report-actions">

                <button
                  class="fp-secondary-btn"
                  onclick="exportReport('${report._id}')"
                >
                  Export PDF
                </button>

              </div>

            </div>
            `
          ).join('')
        }

      </div>

    </div>
    `
  );
}

async function createReport() {

  try {

    setLoading(true);

    const data =
      await api(

        '/api/reports',

        {

          method: 'POST',

          body:
            JSON.stringify({

              title:
                'Executive Report',

              type:
                'executive',

            }),
        }
      );

    STATE.reports.unshift(
      data.report
    );

    renderReportsPage();

    showToast(
      'Rapport créé',
      'success'
    );

  } catch (err) {

    console.error(err);

  } finally {

    setLoading(false);
  }
}

async function exportReport(
  reportId
) {

  try {

    setLoading(true);

    const data =
      await api(

        '/api/reports/export',

        {

          method: 'POST',

          body:
            JSON.stringify({

              reportId,

            }),
        }
      );

    window.open(
      data.url,
      '_blank'
    );

    showToast(
      'PDF généré',
      'success'
    );

  } catch (err) {

    console.error(err);

  } finally {

    setLoading(false);
  }
}

/* =========================================================
   BILLING PAGE
========================================================= */

function usageBar(
  label='',
  used=0,
  limit=0
) {

  const percent =
    limit
      ? clamp(
          Math.round(
            (used / limit) * 100
          ),
          0,
          100
        )
      : 0;

  return `
  <div class="fp-usage-card">

    <div class="fp-usage-top">

      <div class="fp-usage-label">
        ${escapeHtml(label)}
      </div>

      <div class="fp-usage-value">
        ${used}/${limit}
      </div>

    </div>

    <div class="fp-usage-bar">

      <div
        class="fp-usage-fill"
        style="width:${percent}%"
      ></div>

    </div>

  </div>
  `;
}

function renderBillingPage() {

  const billing =
    STATE.billing || {};

  const usage =
    billing.usage || {};

  const limits =
    billing.limits || {};

  setPage(

    `
    <div class="fp-page">

      <div class="fp-page-header">

        <div>

          <div class="fp-page-label">
            STRIPE / SUBSCRIPTIONS
          </div>

          <h1 class="fp-page-title">
            Billing Center
          </h1>

        </div>

      </div>

      <div class="fp-grid-2">

        ${sectionCard({

          title:
            'Current Plan',

          content:
            `
            <div class="fp-billing-plan">

              <div class="fp-billing-plan-name">
                ${(billing.plan || '').toUpperCase()}
              </div>

              <div class="fp-billing-status">
                ${escapeHtml(
                  billing.subscriptionStatus || ''
                )}
              </div>

            </div>

            <div class="fp-billing-actions">

              <button
                class="fp-primary-btn"
                onclick="upgradePlan('pro')"
              >
                Upgrade PRO
              </button>

              <button
                class="fp-secondary-btn"
                onclick="upgradePlan('ultra')"
              >
                Upgrade ULTRA
              </button>

            </div>
            `,

        })}

        ${sectionCard({

          title:
            'Usage',

          content:
            `
            <div class="fp-usage-list">

              ${usageBar(

                'Audits',

                usage.audit?.used || 0,

                limits.audit || 0
              )}

              ${usageBar(

                'Monitors',

                usage.monitor?.used || 0,

                limits.monitor || 0
              )}

              ${usageBar(

                'Reports',

                usage.pdf?.used || 0,

                limits.pdf || 0
              )}

              ${usageBar(

                'AI Credits',

                STATE.user?.aiCredits?.used || 0,

                STATE.user?.aiCredits?.limit || 0
              )}

            </div>
            `,

        })}

      </div>

    </div>
    `
  );
}

async function upgradePlan(
  plan='pro'
) {

  try {

    setLoading(true);

    const data =
      await api(

        '/api/billing/create-checkout',

        {

          method: 'POST',

          body:
            JSON.stringify({

              plan,

            }),
        }
      );

    if (data.url) {

      window.location.href =
        data.url;
    }

  } catch (err) {

    console.error(err);

  } finally {

    setLoading(false);
  }
}
/* =========================================================
   TEAM PAGE
========================================================= */

async function renderTeamPage() {

  const threads =
    STATE.teamThreads || [];

  setPage(

    `
    <div class="fp-team-layout">

      <aside class="fp-team-sidebar">

        <div class="fp-team-sidebar-top">

          <div>

            <div class="fp-page-label">
              WORKSPACE
            </div>

            <h2 class="fp-team-title">
              Team Chat
            </h2>

          </div>

          <button
            class="fp-primary-btn"
            onclick="createThreadModal()"
          >
            +
          </button>

        </div>

        <div class="fp-thread-list">

          ${
            threads.map(

              thread =>

              `
              <button
                class="fp-thread-item ${
                  STATE.currentThread?._id === thread._id
                    ? 'active'
                    : ''
                }"

                onclick="openThread('${thread._id}')"
              >

                <div class="fp-thread-name">
                  ${escapeHtml(
                    thread.title
                  )}
                </div>

                <div class="fp-thread-channel">
                  #${escapeHtml(
                    thread.channel || 'general'
                  )}
                </div>

              </button>
              `
            ).join('')
          }

        </div>

      </aside>

      <section class="fp-team-main">

        ${
          STATE.currentThread
            ? renderThreadView()
            : `
              <div class="fp-empty-state">

                <div class="fp-empty-icon">
                  💬
                </div>

                <div class="fp-empty-title">
                  Sélectionne un thread
                </div>

              </div>
            `
        }

      </section>

    </div>
    `
  );
}

function renderThreadView() {

  const thread =
    STATE.currentThread;

  const messages =
    thread.messages || [];

  return `
  <div class="fp-thread-view">

    <div class="fp-thread-header">

      <div>

        <div class="fp-thread-header-title">
          ${escapeHtml(
            thread.title
          )}
        </div>

        <div class="fp-thread-header-channel">
          #${escapeHtml(
            thread.channel
          )}
        </div>

      </div>

    </div>

    <div class="fp-thread-messages">

      ${
        messages.map(

          message =>

          `
          <div class="fp-message">

            <div class="fp-message-avatar">
              ${
                STATE.user?.firstName?.[0] || 'U'
              }
            </div>

            <div class="fp-message-content">

              <div class="fp-message-top">

                <div class="fp-message-author">
                  ${escapeHtml(
                    STATE.user?.firstName || 'User'
                  )}
                </div>

                <div class="fp-message-date">
                  ${formatDate(
                    message.createdAt
                  )}
                </div>

              </div>

              <div class="fp-message-text">
                ${escapeHtml(
                  message.content || ''
                )}
              </div>

            </div>

          </div>
          `
        ).join('')
      }

    </div>

    <div class="fp-thread-input-wrap">

      <textarea
        id="fpThreadInput"
        class="fp-thread-input"
        placeholder="Écrire un message..."
      ></textarea>

      <button
        class="fp-primary-btn"
        onclick="sendThreadMessage()"
      >
        Envoyer
      </button>

    </div>

  </div>
  `;
}

async function openThread(
  id
) {

  try {

    const thread =
      STATE.teamThreads.find(
        x => x._id === id
      );

    if (!thread) {
      return;
    }

    const messages =
      await loadMessages(id);

    STATE.currentThread = {

      ...thread,

      messages,

    };

    renderTeamPage();

  } catch (err) {

    console.error(err);
  }
}

async function createThreadModal() {

  const title =
    prompt(
      'Nom du thread'
    );

  if (!title) {
    return;
  }

  const channel =
    prompt(
      'Canal'
    ) || 'general';

  try {

    setLoading(true);

    const data =
      await api(

        '/api/team/threads',

        {

          method: 'POST',

          body:
            JSON.stringify({

              title,
              channel,

            }),
        }
      );

    STATE.teamThreads.unshift(
      data.thread
    );

    renderTeamPage();

    showToast(
      'Thread créé',
      'success'
    );

  } catch (err) {

    console.error(err);

  } finally {

    setLoading(false);
  }
}

async function sendThreadMessage() {

  try {

    const input =
      qs('#fpThreadInput');

    if (!input) {
      return;
    }

    const content =
      input.value.trim();

    if (!content) {
      return;
    }

    const data =
      await api(

        '/api/team/messages',

        {

          method: 'POST',

          body:
            JSON.stringify({

              threadId:
                STATE.currentThread._id,

              content,

            }),
        }
      );

    STATE.currentThread.messages.push(
      data.message
    );

    input.value = '';

    renderTeamPage();

  } catch (err) {

    console.error(err);
  }
}
/* =========================================================
   AI PAGE
========================================================= */

function renderAIPage() {

  const messages =
    STATE.aiMessages || [];

  setPage(

    `
    <div class="fp-ai-layout">

      <div class="fp-ai-header">

        <div>

          <div class="fp-page-label">
            GPT / ANALYSIS ENGINE
          </div>

          <h1 class="fp-page-title">
            FlowPoint AI
          </h1>

        </div>

        <div class="fp-ai-credits">

          ${
            STATE.user?.aiCredits?.limit -
            STATE.user?.aiCredits?.used
          }
          crédits restants

        </div>

      </div>

      <div
        id="fpAiMessages"
        class="fp-ai-messages"
      >

        ${
          messages.map(

            msg =>

            `
            <div class="fp-ai-message ${msg.role}">

              <div class="fp-ai-message-role">
                ${
                  msg.role === 'user'
                    ? 'YOU'
                    : 'FLOWPOINT AI'
                }
              </div>

              <div class="fp-ai-message-content">
                ${escapeHtml(
                  msg.content
                ).replace(/\n/g, '<br>')}
              </div>

            </div>
            `
          ).join('')
        }

      </div>

      <div class="fp-ai-input-wrap">

        <textarea
          id="fpAiInput"
          class="fp-ai-input"
          placeholder="Pose une question à FlowPoint AI..."
        ></textarea>

        <button
          class="fp-primary-btn"
          onclick="sendAIMessage()"
        >
          Envoyer
        </button>

      </div>

    </div>
    `
  );

  const box =
    qs('#fpAiMessages');

  if (box) {

    box.scrollTop =
      box.scrollHeight;
  }
}

async function sendAIMessage() {

  try {

    const input =
      qs('#fpAiInput');

    if (!input) {
      return;
    }

    const message =
      input.value.trim();

    if (!message) {
      return;
    }

    STATE.aiMessages.push({

      role:
        'user',

      content:
        message,

    });

    renderAIPage();

    input.value = '';

    setLoading(true);

    const data =
      await api(

        '/api/ai/chat',

        {

          method: 'POST',

          body:
            JSON.stringify({

              message,

            }),
        }
      );

    STATE.aiMessages.push({

      role:
        'assistant',

      content:
        data.response || '',
    });

    if (
      STATE.user?.aiCredits
    ) {

      STATE.user.aiCredits.used += 1;
    }

    renderAIPage();

  } catch (err) {

    console.error(err);

    showToast(
      'Erreur IA',
      'error'
    );

  } finally {

    setLoading(false);
  }
}

/* =========================================================
   PAGE ROUTER
========================================================= */

function renderCurrentPage() {

  switch (
    STATE.currentPage
  ) {

    case 'overview':

      renderOverviewPage();
      break;

    case 'audits':

      renderAuditsPage();
      break;

    case 'monitors':

      renderMonitorsPage();
      break;

    case 'missions':

      renderMissionsPage();
      break;

    case 'reports':

      renderReportsPage();
      break;

    case 'billing':

      renderBillingPage();
      break;

    case 'team':

      renderTeamPage();
      break;

    case 'activity':

      renderActivityPage();
      break;

    case 'ai':

      renderAIPage();
      break;

    default:

      renderOverviewPage();
      break;
  }
}

/* =========================================================
   INITIAL LOAD
========================================================= */

async function bootstrap() {

  try {

    setLoading(true);

    applyTheme();

    const logged =
      await loadSession();

    if (!logged) {
      return;
    }

    renderLayout();

    STATE.currentPage =
      getRoute();

    await Promise.all([

      loadOverview(),

      loadBilling(),

      loadThreads(),

    ]);

    connectRealtime();

    renderCurrentPage();

    showToast(
      'FlowPoint chargé',
      'success'
    );

  } catch (err) {

    console.error(err);

    const fatal =
      qs('#fpFatalError');

    if (fatal) {

      fatal.classList.add(
        'active'
      );
    }

  } finally {

    setLoading(false);
  }
}

/* =========================================================
   INIT
========================================================= */

window.addEventListener(

  'DOMContentLoaded',

  bootstrap
);

/* =========================================================
   GLOBALS
========================================================= */

window.navigate =
  navigate;

window.toggleTheme =
  toggleTheme;

window.toggleSidebar =
  toggleSidebar;

window.logout =
  logout;

window.openAuditModal =
  openAuditModal;

window.createAudit =
  createAudit;

window.viewAudit =
  viewAudit;

window.openMonitorModal =
  openMonitorModal;

window.createMonitor =
  createMonitor;

window.openMissionModal =
  openMissionModal;

window.createMission =
  createMission;

window.toggleMissionStatus =
  toggleMissionStatus;

window.createReport =
  createReport;

window.exportReport =
  exportReport;

window.upgradePlan =
  upgradePlan;

window.createThreadModal =
  createThreadModal;

window.openThread =
  openThread;

window.sendThreadMessage =
  sendThreadMessage;

window.sendAIMessage =
  sendAIMessage;
